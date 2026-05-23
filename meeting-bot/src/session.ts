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
  type TranscriptLine,
} from './meetingNotes.js';

export interface RawUtterance {
  speaker: string;
  /** Milliseconds since the meeting started. */
  startMs: number;
  pcmPath: string;
}

/**
 * Platform-neutral meeting lifecycle. A platform adapter (Discord today, Teams
 * later) feeds it recorded utterances; on finish it transcribes, builds the two
 * notes, and submits them to DocuVault.
 */
export class MeetingSession {
  readonly id = `mtg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  readonly dir = join(tmpdir(), this.id);
  readonly startedAt = Date.now();

  private readonly utterances: RawUtterance[] = [];
  private readonly speakers = new Set<string>();

  constructor(
    private readonly client: DocuVaultClient,
    readonly label: string,
    readonly spaceName: string,
    readonly inboxUrl: string,
  ) {}

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  addUtterance(utterance: RawUtterance): void {
    this.utterances.push(utterance);
    this.speakers.add(utterance.speaker);
  }

  get utteranceCount(): number {
    return this.utterances.length;
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
    const ordered = [...this.utterances].sort((a, b) => a.startMs - b.startMs);
    const lines: TranscriptLine[] = [];

    for (const utterance of ordered) {
      const text = await transcribePcm(utterance.pcmPath).catch((err) => {
        console.error(`Transcription failed for ${utterance.pcmPath}:`, err);
        return '';
      });
      if (text) {
        lines.push({ tsMs: utterance.startMs, speaker: utterance.speaker, text });
      }
    }

    await this.cleanup();

    if (lines.length === 0) {
      throw new Error('Kein verständlicher Sprachinhalt aufgenommen.');
    }

    const transcript = formatTranscript(lines);
    const participants = this.speakerList;

    const meetingNoteMd = await generateMeetingNote(this.label, participants, transcript);
    const rawTranscriptMd =
      `# Roh-Transkript — ${this.label}\n\n` +
      `_Teilnehmer: ${participants.join(', ')}_\n\n` +
      formatTranscriptParagraphs(lines) +
      '\n';

    const notes = [markdownToHtml(meetingNoteMd), markdownToHtml(rawTranscriptMd)];
    await this.client.submitNotes(notes, participants.join(', '));
    return notes.length;
  }

  async cleanup(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true }).catch(() => {});
  }
}
