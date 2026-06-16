import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { DocuVaultClient } from './docuvault.js';
import { transcribePcm } from './transcribe.js';
import {
  formatTranscript,
  formatTranscriptParagraphs,
  generateMeetingNote,
  markdownToHtml,
  noteLocale,
  type TranscriptLine,
} from './meetingNotes.js';

export interface RawUtterance {
  speaker: string;
  /** Milliseconds since the meeting started. */
  startMs: number;
  pcmPath: string;
}

export interface TranscribedUtterance {
  speaker: string;
  /** Milliseconds since the meeting started. */
  startMs: number;
  text: string;
}

/** Everything needed to rebuild the DocuVault client for a session on recovery.
 *  The Discord one-time token is stored (it is scoped + short-lived); the Teams
 *  service dispatch token is NOT — only the invite id is kept, and the token is
 *  re-read from the environment at recovery time. */
export type RecoveryDescriptor =
  | { platform: 'DISCORD'; token: string }
  | { platform: 'TEAMS'; inviteId: string };

/** On-disk header for an in-progress recording, written at session start and
 *  re-read on boot to finalize meetings interrupted by a bot restart. */
export interface SessionMeta {
  id: string;
  label: string;
  spaceName: string;
  inboxUrl: string;
  language: string;
  recovery: RecoveryDescriptor;
  startedAt: number;
  /** Finalize attempts so far — caps retries on a poison recording. */
  attempts: number;
}

const META_FILE = 'meta.json';
const UTTERANCES_FILE = 'utterances.jsonl';
const LINES_FILE = 'lines.jsonl';

/**
 * Platform-neutral meeting lifecycle. A platform adapter feeds it utterances;
 * on finish it builds the two notes and submits them to DocuVault.
 *
 * Two input shapes are supported, so an adapter uses whichever its platform
 * gives it cheaply:
 *  • {@link addUtterance} — raw PCM that still needs speech-to-text. Discord
 *    delivers one stream per speaker, so this carries exact speaker attribution.
 *  • {@link addTranscribedUtterance} — already-transcribed text + speaker. The
 *    Teams adapter scrapes live captions, which arrive pre-transcribed with the
 *    speaker name attached, so it skips the OpenAI transcription step entirely.
 *
 * Everything captured is also streamed to a manifest under {@link dir} so an
 * interrupted meeting can be reconstructed and filed on the next boot (see
 * {@link restore} and recovery.ts).
 */
export class MeetingSession {
  readonly id: string;
  readonly dir: string;
  readonly startedAt: number;

  private readonly utterances: RawUtterance[] = [];
  private readonly transcribedLines: TranscriptLine[] = [];
  private readonly speakers = new Set<string>();

  constructor(
    private readonly client: DocuVaultClient,
    readonly label: string,
    readonly spaceName: string,
    readonly inboxUrl: string,
    /** ISO-639-1 language pinned for transcription and the generated note. */
    readonly language: string,
    /** How to rebuild the client if this meeting has to be recovered later. */
    private readonly recovery: RecoveryDescriptor,
    /** Restore hook: reuse an existing id/start time instead of minting new ones. */
    opts?: { id?: string; startedAt?: number },
  ) {
    this.id = opts?.id ?? `mtg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.dir = join(config.recordingsDir, this.id);
    this.startedAt = opts?.startedAt ?? Date.now();
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await this.writeMeta(0);
  }

  addUtterance(utterance: RawUtterance): void {
    this.utterances.push(utterance);
    this.speakers.add(utterance.speaker);
    this.append(UTTERANCES_FILE, utterance);
  }

  /** Adds an already-transcribed utterance (e.g. from a Teams live caption),
   *  bypassing speech-to-text. */
  addTranscribedUtterance(utterance: TranscribedUtterance): void {
    const line: TranscriptLine = {
      tsMs: utterance.startMs,
      speaker: utterance.speaker,
      text: utterance.text,
    };
    this.transcribedLines.push(line);
    this.speakers.add(utterance.speaker);
    this.append(LINES_FILE, line);
  }

  /** Total captured utterances across both input shapes. */
  get utteranceCount(): number {
    return this.utterances.length + this.transcribedLines.length;
  }

  get speakerList(): string[] {
    return [...this.speakers];
  }

  /**
   * Transcribes every utterance, generates the AI meeting note, and files both
   * the note and the raw transcript into the space inbox. The recording dir is
   * removed only after a successful submit, so a failure (or crash) leaves the
   * manifest in place for recovery to retry.
   *
   * @returns the number of notes filed
   */
  async finishAndSubmit(): Promise<number> {
    // Already-transcribed lines (caption path) need no speech-to-text; raw PCM
    // utterances (Discord) do. Transcribe the latter, then merge and order both.
    const lines: TranscriptLine[] = [...this.transcribedLines];
    lines.push(...(await this.transcribePcmUtterances()));
    lines.sort((a, b) => a.tsMs - b.tsMs);

    if (lines.length === 0) {
      await this.cleanup();
      throw new Error('Kein verständlicher Sprachinhalt aufgenommen.');
    }

    const transcript = formatTranscript(lines);
    const participants = this.speakerList;

    void this.client.progress('SUMMARIZING', { message: 'Erstelle Protokoll…' });
    const meetingNoteMd = await generateMeetingNote(this.label, participants, transcript, this.language);
    const t = noteLocale(this.language);
    const rawTranscriptMd =
      `# ${t.rawTranscript} — ${this.label}\n\n` +
      `_${t.participants}: ${participants.join(', ')}_\n\n` +
      formatTranscriptParagraphs(lines) +
      '\n';

    const notes = [markdownToHtml(meetingNoteMd), markdownToHtml(rawTranscriptMd)];
    await this.client.submitNotes(notes, participants.join(', '));
    await this.cleanup();
    return notes.length;
  }

  /** Runs speech-to-text over the raw PCM utterances, reporting live progress.
   *  Returns the transcribed lines (no-op when there are none, e.g. captions). */
  private async transcribePcmUtterances(): Promise<TranscriptLine[]> {
    const ordered = [...this.utterances].sort((a, b) => a.startMs - b.startMs);
    const lines: TranscriptLine[] = [];
    const total = ordered.length;
    if (total === 0) return lines;

    // Report at most ~15 updates so a long meeting doesn't flood the API.
    const step = Math.max(1, Math.floor(total / 15));
    void this.client.progress('TRANSCRIBING', {
      current: 0,
      total,
      message: `Transkribiere ${total} Wortbeiträge…`,
    });

    for (let i = 0; i < ordered.length; i++) {
      const utterance = ordered[i];
      const text = await transcribePcm(utterance.pcmPath, this.language).catch((err) => {
        console.error(`Transcription failed for ${utterance.pcmPath}:`, err);
        return '';
      });
      if (text) {
        lines.push({ tsMs: utterance.startMs, speaker: utterance.speaker, text });
      }
      const done = i + 1;
      if (done === total || done % step === 0) {
        void this.client.progress('TRANSCRIBING', {
          current: done,
          total,
          message: `Transkribiere Wortbeiträge… (${done}/${total})`,
        });
      }
    }
    return lines;
  }

  async cleanup(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true }).catch(() => {});
  }

  // --- Manifest persistence ---

  private async writeMeta(attempts: number): Promise<void> {
    const meta: SessionMeta = {
      id: this.id,
      label: this.label,
      spaceName: this.spaceName,
      inboxUrl: this.inboxUrl,
      language: this.language,
      recovery: this.recovery,
      startedAt: this.startedAt,
      attempts,
    };
    await fs.writeFile(join(this.dir, META_FILE), JSON.stringify(meta, null, 2)).catch((err) => {
      console.error(`Failed to write session manifest for ${this.id}:`, err);
    });
  }

  /** Appends one record to a manifest log. Best-effort — persistence must never
   *  break live capture, so failures are swallowed (worst case: that one
   *  utterance is not recoverable after a crash). */
  private append(file: string, record: unknown): void {
    void fs
      .appendFile(join(this.dir, file), `${JSON.stringify(record)}\n`)
      .catch((err) => console.error(`Failed to persist to ${file} for ${this.id}:`, err));
  }

  /** Lists recording-dir names that hold an in-progress manifest. */
  static async listRecoverable(): Promise<string[]> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(config.recordingsDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const ids: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('mtg-')) continue;
      const hasMeta = await fs
        .access(join(config.recordingsDir, entry.name, META_FILE))
        .then(() => true)
        .catch(() => false);
      if (hasMeta) ids.push(entry.name);
    }
    return ids;
  }

  /** Reads the manifest header for a recording dir (by id). */
  static async readMeta(id: string): Promise<SessionMeta> {
    const raw = await fs.readFile(join(config.recordingsDir, id, META_FILE), 'utf8');
    return JSON.parse(raw) as SessionMeta;
  }

  /** Persists a bumped attempt count for a recording dir before a retry, so a
   *  recording that crashes the bot mid-finalize still counts toward the cap. */
  static async bumpAttempts(id: string): Promise<number> {
    const meta = await MeetingSession.readMeta(id);
    const next = (meta.attempts ?? 0) + 1;
    await fs.writeFile(
      join(config.recordingsDir, id, META_FILE),
      JSON.stringify({ ...meta, attempts: next }, null, 2),
    );
    return next;
  }

  /** Removes a recording dir by id (used when giving up on an unrecoverable one). */
  static async discard(id: string): Promise<void> {
    await fs.rm(join(config.recordingsDir, id), { recursive: true, force: true }).catch(() => {});
  }

  /**
   * Rebuilds a session from its on-disk manifest so it can be finalized after a
   * restart. Loads the captured utterances/lines back into memory but does NOT
   * re-create the manifest (no init()), so the original capture is preserved.
   */
  static async restore(client: DocuVaultClient, id: string): Promise<MeetingSession> {
    const meta = await MeetingSession.readMeta(id);
    const session = new MeetingSession(
      client,
      meta.label,
      meta.spaceName,
      meta.inboxUrl,
      meta.language,
      meta.recovery,
      { id: meta.id, startedAt: meta.startedAt },
    );
    for (const u of await readJsonl<RawUtterance>(join(session.dir, UTTERANCES_FILE))) {
      session.utterances.push(u);
      session.speakers.add(u.speaker);
    }
    for (const l of await readJsonl<TranscriptLine>(join(session.dir, LINES_FILE))) {
      session.transcribedLines.push(l);
      session.speakers.add(l.speaker);
    }
    return session;
  }
}

/** Parses a JSON-lines file, tolerating a truncated trailing line (a crash can
 *  cut the last append mid-write). Returns [] when the file is absent. */
async function readJsonl<T>(path: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // Truncated final line from an interrupted write — skip it.
    }
  }
  return out;
}
