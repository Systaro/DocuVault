import { chromium, type Browser, type Page } from 'playwright';
import { config } from '../config.js';
import { DocuVaultClient, type PendingTeamsInvite } from '../docuvault.js';
import { MeetingSession } from '../session.js';
import { TeamsCaptionRecorder } from './recorder.js';

/**
 * UI strings / selectors for the Teams web client. Teams localizes button text
 * and revises its DOM often, so the bot tries several candidates for each step
 * and these are collected here for easy maintenance. German + English variants
 * are included because the join surface follows the browser/meeting locale.
 */
const UI = {
  continueOnBrowser: [
    'button:has-text("Continue on this browser")',
    'button:has-text("In diesem Browser fortfahren")',
    '[data-tid="joinOnWeb"]',
  ],
  nameInput: [
    '[data-tid="prejoin-display-name-input"]',
    'input[placeholder*="name" i]',
    'input[placeholder*="Name" i]',
  ],
  joinNow: [
    '[data-tid="prejoin-join-button"]',
    'button:has-text("Join now")',
    'button:has-text("Jetzt teilnehmen")',
  ],
  /** Present only once admitted into the call (the in-call toolbar). */
  inCall: [
    '[data-tid="callingButtons-showMoreBtn"]',
    '#roster-button',
    '[data-tid="toggle-mute"]',
  ],
  moreMenu: ['[data-tid="callingButtons-showMoreBtn"]', 'button[aria-label*="More" i]'],
  languageSpeech: [
    '[data-tid="callingButtons-deviceSettingsBtn"]',
    'div[role="menuitem"]:has-text("Language and speech")',
    'div[role="menuitem"]:has-text("Sprache und Sprachfunktionen")',
  ],
  turnOnCaptions: [
    'div[role="menuitem"]:has-text("Turn on live captions")',
    'div[role="menuitem"]:has-text("Live-Untertitel aktivieren")',
    'div[role="menuitemcheckbox"]:has-text("captions")',
  ],
  /** The call-ended / removed screen (a meeting that is over). */
  callEnded: [
    'text=/You.?ve left the meeting/i',
    'text=/Die Besprechung wurde beendet/i',
    'button:has-text("Rejoin")',
    'button:has-text("Erneut beitreten")',
  ],
};

/** One Teams meeting, driven end to end by a headless Chromium guest. */
export class TeamsMeeting {
  constructor(
    private readonly invite: PendingTeamsInvite,
    private readonly dispatchToken: string,
  ) {}

  async run(): Promise<void> {
    const client = DocuVaultClient.forTeamsInvite(this.dispatchToken, this.invite.inviteId);

    // Claim first so the invite flips ACTIVE and won't be re-dispatched. If the
    // claim is rejected (cancelled/expired) there's nothing to clean up.
    let claim;
    try {
      claim = await client.claim(`Teams: ${this.invite.label}`);
    } catch (err) {
      console.error(`[teams ${this.invite.inviteId}] claim rejected:`, (err as Error).message);
      return;
    }

    const session = new MeetingSession(
      client,
      claim.label,
      claim.spaceName,
      claim.inboxUrl,
      claim.language,
    );
    await session.init();

    let browser: Browser | undefined;
    try {
      void client.progress('RECORDING', { message: 'Tritt dem Teams-Meeting bei…' });
      browser = await chromium.launch({
        headless: config.teamsHeadless,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream'],
      });
      const context = await browser.newContext({
        permissions: [],
        locale: 'de-DE',
      });
      const page = await context.newPage();

      await this.join(page);
      await this.waitForAdmission(page, client);
      void client.progress('RECORDING', { message: 'Aufnahme läuft' });

      await this.enableCaptions(page);
      const recorder = new TeamsCaptionRecorder(page, session);
      await recorder.start();

      const reason = await this.waitForMeetingEnd(page);
      recorder.stop();

      if (session.utteranceCount === 0) {
        await session.cleanup();
        await client.fail('Keine Untertitel aufgenommen — sind im Meeting Untertitel verfügbar?');
        return;
      }

      void client.progress('PROCESSING', { message: `Aufnahme beendet (${reason}). Verarbeite…` });
      await session.finishAndSubmit();
      console.log(`[teams ${this.invite.inviteId}] done — notes filed`);
    } catch (err) {
      console.error(`[teams ${this.invite.inviteId}] failed:`, err);
      await session.cleanup();
      await client.fail((err as Error).message);
    } finally {
      await browser?.close().catch(() => {});
    }
  }

  /** Opens the meeting link, picks the web client, sets the guest name, joins. */
  private async join(page: Page): Promise<void> {
    await page.goto(this.invite.meetingUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // The launcher page may offer a native-app handoff; stay on the web.
    await clickFirst(page, UI.continueOnBrowser, 15_000).catch(() => {});

    const name = await waitForFirst(page, UI.nameInput, 60_000);
    await name.fill(config.teamsBotName);

    const join = await waitForFirst(page, UI.joinNow, 30_000);
    await join.click();
  }

  /** Waits in the lobby until a participant admits the bot. Fails cleanly if no
   *  one admits it within the configured window. */
  private async waitForAdmission(page: Page, client: DocuVaultClient): Promise<void> {
    void client.progress('RECORDING', { message: 'Wartet auf Einlass in den Call…' });
    try {
      await waitForFirst(page, UI.inCall, config.teamsAdmitTimeoutMs);
    } catch {
      throw new Error('Nicht in den Call eingelassen (Lobby-Timeout).');
    }
  }

  /** Best-effort: walks the Teams menu to turn on live captions. Non-fatal on
   *  failure — but with no captions there will be nothing to transcribe, which
   *  surfaces later as an empty-meeting failure. */
  private async enableCaptions(page: Page): Promise<void> {
    try {
      await clickFirst(page, UI.moreMenu, 10_000);
      await clickFirst(page, UI.languageSpeech, 5_000).catch(() => {});
      await clickFirst(page, UI.turnOnCaptions, 5_000);
      console.log(`[teams ${this.invite.inviteId}] live captions enabled`);
    } catch (err) {
      console.warn(
        `[teams ${this.invite.inviteId}] could not enable captions automatically:`,
        (err as Error).message,
      );
    }
  }

  /**
   * Resolves when the meeting is over: the call-ended/removed screen appears, or
   * the hard safety cap is reached. Returns a short German reason.
   *
   * We deliberately do NOT treat a missing in-call toolbar as "ended" — Teams
   * auto-hides the toolbar while idle, which would cut recording short. So an
   * unattended call that nobody ends runs until the safety cap; the call-ended
   * screen (organizer ends it, or the bot is removed) is the fast path.
   */
  private async waitForMeetingEnd(page: Page): Promise<string> {
    const deadline = Date.now() + config.maxMeetingMinutes * 60_000;
    while (Date.now() < deadline) {
      if (await anyVisible(page, UI.callEnded)) return 'Meeting beendet';
      if (page.isClosed()) return 'Browser geschlossen';
      await delay(5_000);
    }
    return `Maximale Länge (${config.maxMeetingMinutes} min)`;
  }
}

// --- Playwright helpers (kept tiny + selector-list aware) ---

async function waitForFirst(page: Page, selectors: string[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) return locator;
    }
    await delay(500);
    lastErr = new Error(`none of [${selectors.join(', ')}] appeared`);
  }
  throw lastErr ?? new Error('timeout');
}

async function clickFirst(page: Page, selectors: string[], timeoutMs: number): Promise<void> {
  const locator = await waitForFirst(page, selectors, timeoutMs);
  await locator.click();
}

async function anyVisible(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) return true;
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
