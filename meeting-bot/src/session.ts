import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
 */
export class MeetingSession {
  readonly id = `mtg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  readonly dir = join(tmpdir(), this.id);
  readonly startedAt = Date.now();

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
  ) {}

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  addUtterance(utterance: RawUtterance): void {
    this.utterances.push(utterance);
    this.speakers.add(utterance.speaker);
  }

  /** Adds an already-transcribed utterance (e.g. from a Teams live caption),
   *  bypassing speech-to-text. */
  addTranscribedUtterance(utterance: TranscribedUtterance): void {
    this.transcribedLines.push({
      tsMs: utterance.startMs,
      speaker: utterance.speaker,
      text: utterance.text,
    });
    this.speakers.add(utterance.speaker);
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
   * the note and the raw transcript into the space inbox.
   *
   * @returns the number of notes filed
   */
  async finishAndSubmit(): Promise<number> {
    // Already-transcribed lines (caption path) need no speech-to-text; raw PCM
    // utterances (Discord) do. Transcribe the latter, then merge and order both.
    const lines: TranscriptLine[] = [...this.transcribedLines];
    lines.push(...(await this.transcribePcmUtterances()));
    lines.sort((a, b) => a.tsMs - b.tsMs);

    await this.cleanup();

    if (lines.length === 0) {
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
}
