import type { Page } from 'playwright';
import type { MeetingSession } from '../session.js';

/**
 * Teams platform adapter: scrapes the live-caption overlay and feeds finalized
 * captions into the meeting session as pre-transcribed utterances (speaker +
 * text), so no speech-to-text or audio capture is needed.
 *
 * NOTE: these selectors track Microsoft Teams' *unofficial* web DOM. Teams ships
 * UI changes regularly; if captions stop being captured, re-inspect a live
 * meeting and update the selectors here. They are deliberately collected in one
 * place for exactly that reason.
 */
const SELECTORS = {
  /** A single caption line (speaker + text). */
  captionItem: '[data-tid="closed-caption-message-content"], [data-tid="closed-caption-v2-window-content"] [class*="ui-chat__message"]',
  /** The speaker name within a caption line. */
  author: '[data-tid="author"], [class*="ui-chat__message__author"]',
  /** The spoken text within a caption line. */
  text: '[data-tid="closed-caption-text"], [class*="ui-chat__message__content"]',
};

/** A caption line is treated as final once it has not changed for this long.
 *  Teams grows a line in place as recognition firms up, then moves on. */
const FINALIZE_MS = 2_500;

interface PendingCaption {
  speaker: string;
  text: string;
  firstMs: number;
  timer: NodeJS.Timeout;
}

export class TeamsCaptionRecorder {
  private readonly pending = new Map<string, PendingCaption>();
  private stopped = false;

  constructor(
    private readonly page: Page,
    private readonly session: MeetingSession,
  ) {}

  /** Installs the in-page observer that streams caption updates back to Node. */
  async start(): Promise<void> {
    await this.page.exposeFunction(
      '__dvCaption',
      (c: { id: string; speaker: string; text: string }) => this.onCaption(c),
    );
    await this.page.evaluate(installObserver, SELECTORS);
  }

  /** Stops accepting updates and flushes any still-pending captions. */
  stop(): void {
    this.stopped = true;
    for (const id of [...this.pending.keys()]) this.finalize(id);
  }

  private onCaption(c: { id: string; speaker: string; text: string }): void {
    if (this.stopped) return;
    const text = c.text.trim();
    if (!text) return;
    const speaker = c.speaker.trim() || 'Sprecher';

    const existing = this.pending.get(c.id);
    if (existing) clearTimeout(existing.timer);
    const firstMs = existing?.firstMs ?? Date.now() - this.session.startedAt;
    this.pending.set(c.id, {
      speaker,
      text,
      firstMs,
      timer: setTimeout(() => this.finalize(c.id), FINALIZE_MS),
    });
  }

  private finalize(id: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    this.session.addTranscribedUtterance({
      speaker: entry.speaker,
      startMs: entry.firstMs,
      text: entry.text,
    });
  }
}

/**
 * Runs inside the Teams page. Tags each caption line with a stable id the first
 * time it is seen, then reports the line's current speaker + text on every
 * mutation. Node-side debouncing decides when a line is final.
 */
function installObserver(selectors: typeof SELECTORS): void {
  const w = window as unknown as {
    __dvCaption: (c: { id: string; speaker: string; text: string }) => void;
    __dvCaptionCounter?: number;
  };
  const report = (): void => {
    const items = document.querySelectorAll<HTMLElement>(selectors.captionItem);
    items.forEach((el) => {
      if (!el.dataset.dvId) {
        w.__dvCaptionCounter = (w.__dvCaptionCounter ?? 0) + 1;
        el.dataset.dvId = String(w.__dvCaptionCounter);
      }
      const speaker = el.querySelector(selectors.author)?.textContent ?? '';
      const text = el.querySelector(selectors.text)?.textContent ?? el.textContent ?? '';
      w.__dvCaption({ id: el.dataset.dvId, speaker, text });
    });
  };
  const observer = new MutationObserver(() => report());
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  report();
}
