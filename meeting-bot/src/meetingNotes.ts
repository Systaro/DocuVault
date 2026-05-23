import OpenAI from 'openai';
import { marked } from 'marked';
import { config } from './config.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

export interface TranscriptLine {
  tsMs: number;
  speaker: string;
  text: string;
}

/** Renders transcript lines as `[mm:ss] Speaker: text`. */
export function formatTranscript(lines: TranscriptLine[]): string {
  return lines.map((l) => `[${formatTimestamp(l.tsMs)}] ${l.speaker}: ${l.text}`).join('\n');
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/**
 * Condenses a raw transcript into a structured German meeting note (Markdown).
 * Sections with no content are omitted by the model.
 */
export async function generateMeetingNote(
  label: string,
  participants: string[],
  transcript: string,
): Promise<string> {
  const system = [
    'Du bist ein Protokoll-Assistent. Erstelle aus dem Transkript eine strukturierte',
    'Meeting-Notiz in deutschem Markdown. Verwende diese Gliederung:',
    '',
    `# ${label}`,
    '**Teilnehmer:** <Namen>',
    '',
    '## Zusammenfassung',
    '<3-6 Sätze>',
    '',
    '## Entscheidungen',
    '<Bulletpoints — nur wenn welche getroffen wurden>',
    '',
    '## Action Items',
    '<- [ ] Aufgabe — Verantwortlich — nur wenn vorhanden>',
    '',
    '## Offene Punkte',
    '<Bulletpoints — nur wenn vorhanden>',
    '',
    'Regeln: Erfinde nichts. Lass leere Abschnitte komplett weg.',
    'Antworte ausschließlich mit dem Markdown, ohne Code-Fences drumherum.',
  ].join('\n');

  const user = `Teilnehmer: ${participants.join(', ')}\n\nTranskript:\n${transcript}`;

  const completion = await openai.chat.completions.create({
    model: config.notesModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  return (
    completion.choices[0]?.message?.content?.trim() ??
    `# ${label}\n\n_(Es konnte keine Meeting-Notiz erzeugt werden.)_`
  );
}

/** Converts Markdown to the HTML the DocuVault inbox stores as note content. */
export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string;
}
