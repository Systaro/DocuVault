import * as path from 'path';
import { Browser, Page } from 'puppeteer';
import { launchBrowser, loadEnv, loginAsAdmin, takeScreenshot } from '../helpers/browser';
import { TestSpace, api, createTestSpace, deleteTestSpace, dismissChangelog, waitForIndexed } from '../helpers/api';

/**
 * Quick notes that are written or spoken first and placed after: the
 * assistant (real OpenAI) suggests the space and the tasks, the user confirms,
 * and only then is anything saved. The fake microphone plays a recorded
 * sentence about renewing the parking permit.
 */
describe('Capture', () => {
  let browser: Browser;
  let page: Page;
  let facilities: TestSpace;
  let engineering: TestSpace;

  const base = () => process.env.BASE_URL!;
  const voiceFile = path.join(__dirname, '..', 'fixtures', 'voice-note.wav');

  async function openQuickNote(): Promise<void> {
    await page.goto(`${base()}/dashboard`, { waitUntil: 'networkidle2' });
    await dismissChangelog(page);
    await page.waitForSelector('.quick-note-btn', { timeout: 15000 });
    await page.click('.quick-note-btn');
    await page.waitForSelector('app-quick-capture-modal .editor-content', { timeout: 5000 });
  }

  async function clickPrimary(): Promise<void> {
    await page.click('app-quick-capture-modal .capture-actions .btn-primary');
  }

  beforeAll(async () => {
    loadEnv();
    browser = await launchBrowser([
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${voiceFile}`,
    ]);
    page = await browser.newPage();
    await browser.defaultBrowserContext().overridePermissions(base(), ['microphone']);
    await loginAsAdmin(page);
    await dismissChangelog(page);
    facilities = await createTestSpace(page, 'Facilities', {
      'kitchen.md': '# Kitchen\n\nThe office kitchen has a dishwasher, a coffee machine and a fridge. Repairs are ordered by the office manager.\n',
      'parking.md': '# Parking\n\nStaff park in zone B. Parking permits for the office cars are renewed every year.\n',
    });
    engineering = await createTestSpace(page, 'Engineering', {
      'deployments.md': '# Deployments\n\nReleases go out on Tuesdays through the CI pipeline. Rollbacks use the previous image tag.\n',
    });
    await waitForIndexed(page, facilities.spaceId, 'dishwasher in the kitchen', 'dishwasher');
    await waitForIndexed(page, engineering.spaceId, 'release pipeline', 'Releases');
  }, 180000);

  afterAll(async () => {
    await deleteTestSpace(page, facilities);
    await deleteTestSpace(page, engineering);
    await browser?.close();
  });

  it('suggests where a written note belongs and saves it with the tasks it names', async () => {
    await openQuickNote();
    await page.click('app-quick-capture-modal .editor-content');
    await page.keyboard.type('The dishwasher in the office kitchen is leaking. Order a replacement seal by 2026-10-05.');

    // With AI, nothing can be saved before a place is suggested.
    expect(await page.$eval('app-quick-capture-modal .capture-actions .btn-primary', (el) => el.textContent?.trim())).toContain('Find a place');
    await clickPrimary();
    await page.waitForSelector('app-quick-capture-modal .capture-destination:not(.loading) app-searchable-select', { timeout: 90000 });
    await takeScreenshot(page, 'capture-01-suggested');

    const suggestedSpace = await page.$eval('app-quick-capture-modal .select-trigger .trigger-label', (el) => el.textContent?.trim());
    expect(suggestedSpace).toBe(facilities.name);
    const tasks = await page.$$eval('.capture-task', (els) => els.map((el) => (el as HTMLElement).innerText));
    expect(tasks.some((t) => /seal/i.test(t))).toBe(true);

    await clickPrimary();
    // The dialog closes once the note and its tasks are saved.
    await page.waitForFunction(() => !document.querySelector('app-quick-capture-modal'), { timeout: 20000 });

    const notes = await api<any>(page, 'GET', `/api/spaces/${facilities.spaceId}/inbox/notes`);
    const list: any[] = Array.isArray(notes.body) ? notes.body : notes.body.content;
    const saved = list.find((n) => String(n.content).includes('dishwasher'));
    expect(saved).toBeDefined();
    const created = await api<any[]>(page, 'GET', `/api/tasks?sourceType=INBOX_NOTE&sourceId=${saved.id}`);
    expect(created.body.some((t) => /seal/i.test(t.title) && t.dueDate === '2026-10-05')).toBe(true);
    expect((await api<any[]>(page, 'GET', `/api/spaces/${engineering.spaceId}/tasks`)).body).toEqual([]);
  }, 180000);

  it('turns speech into text in a quick note and in the ask box', async () => {
    await openQuickNote();
    await page.waitForSelector('app-quick-capture-modal app-voice-input-button .voice-btn', { timeout: 5000 });
    await page.click('app-quick-capture-modal app-voice-input-button .voice-btn');
    await page.waitForSelector('app-quick-capture-modal .voice-btn.recording', { timeout: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await page.click('app-quick-capture-modal .voice-btn.recording');
    await page.waitForFunction(
      () => /parking permit/i.test(document.querySelector('app-quick-capture-modal .editor-content')?.textContent ?? ''),
      { timeout: 60000 }
    );
    await takeScreenshot(page, 'capture-02-spoken-note');
    await page.click('app-quick-capture-modal .capture-header .icon-btn');

    await page.goto(`${base()}/ask?space=${facilities.spaceId}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('app-ask-composer app-voice-input-button .voice-btn', { timeout: 15000 });
    await page.click('app-ask-composer .voice-btn');
    await page.waitForSelector('app-ask-composer .voice-btn.recording', { timeout: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await page.click('app-ask-composer .voice-btn.recording');
    await page.waitForFunction(
      () => /parking permit/i.test((document.querySelector('app-ask-composer textarea') as HTMLTextAreaElement | null)?.value ?? ''),
      { timeout: 60000 }
    );
    await takeScreenshot(page, 'capture-03-spoken-question');
  }, 180000);
});
