import OpenAI from 'openai';
import { marked } from 'marked';
import { config } from './config.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

export interface TranscriptLine {
  tsMs: number;
  speaker: string;
  text: string;
}

/** Renders transcript lines as a single string (`[mm:ss] Speaker: text` per line). */
export function formatTranscript(lines: TranscriptLine[]): string {
  return lines.map((l) => `[${formatTimestamp(l.tsMs)}] ${l.speaker}: ${l.text}`).join('\n');
}

/** Renders transcript lines as Markdown paragraphs — one utterance per paragraph
 *  so the inbox view can wrap long lines instead of overflowing. */
export function formatTranscriptParagraphs(lines: TranscriptLine[]): string {
  return lines
    .map((l) => `**[${formatTimestamp(l.tsMs)}]** ${l.speaker}: ${l.text}`)
    .join('\n\n');
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/** All language-dependent wording for a meeting note, keyed by ISO-639-1 code.
 *  The transcription language picked at invite creation drives which one is
 *  used, so the note comes out in the same language that was spoken. */
export interface NoteLocale {
  intro: string;
  participants: string;
  /** Heading for the raw-transcript note (used by [rawTranscriptHeading]). */
  rawTranscript: string;
  transcriptLabel: string;
  summary: string;
  summaryHint: string;
  decisions: string;
  decisionsHint: string;
  actionItems: string;
  actionItemsHint: string;
  openPoints: string;
  openPointsHint: string;
  rule1: string;
  rule2: string;
  fallback: string;
}

const NOTE_LOCALES: Record<string, NoteLocale> = {
  de: {
    intro:
      'Du bist ein Protokoll-Assistent. Erstelle aus dem Transkript eine strukturierte ' +
      'Meeting-Notiz in deutschem Markdown. Verwende diese Gliederung:',
    participants: 'Teilnehmer',
    rawTranscript: 'Roh-Transkript',
    transcriptLabel: 'Transkript',
    summary: 'Zusammenfassung',
    summaryHint: '3-6 Sätze',
    decisions: 'Entscheidungen',
    decisionsHint: 'Bulletpoints — nur wenn welche getroffen wurden',
    actionItems: 'Action Items',
    actionItemsHint: '- [ ] Aufgabe — Verantwortlich — nur wenn vorhanden',
    openPoints: 'Offene Punkte',
    openPointsHint: 'Bulletpoints — nur wenn vorhanden',
    rule1: 'Erfinde nichts. Lass leere Abschnitte komplett weg.',
    rule2: 'Antworte ausschließlich mit dem Markdown, ohne Code-Fences drumherum.',
    fallback: '_(Es konnte keine Meeting-Notiz erzeugt werden.)_',
  },
  en: {
    intro:
      'You are a meeting-minutes assistant. Turn the transcript into a structured ' +
      'meeting note in English Markdown. Use this outline:',
    participants: 'Participants',
    rawTranscript: 'Raw transcript',
    transcriptLabel: 'Transcript',
    summary: 'Summary',
    summaryHint: '3-6 sentences',
    decisions: 'Decisions',
    decisionsHint: 'Bullet points — only if any were made',
    actionItems: 'Action Items',
    actionItemsHint: '- [ ] Task — Owner — only if present',
    openPoints: 'Open Questions',
    openPointsHint: 'Bullet points — only if present',
    rule1: 'Do not invent anything. Omit empty sections entirely.',
    rule2: 'Respond with the Markdown only, without surrounding code fences.',
    fallback: '_(No meeting note could be generated.)_',
  },
  fr: {
    intro:
      'Tu es un assistant de compte rendu. Transforme la transcription en une note de ' +
      'réunion structurée en Markdown français. Utilise ce plan :',
    participants: 'Participants',
    rawTranscript: 'Transcription brute',
    transcriptLabel: 'Transcription',
    summary: 'Résumé',
    summaryHint: '3 à 6 phrases',
    decisions: 'Décisions',
    decisionsHint: 'Puces — uniquement si des décisions ont été prises',
    actionItems: 'Actions à mener',
    actionItemsHint: '- [ ] Tâche — Responsable — uniquement si présent',
    openPoints: 'Points ouverts',
    openPointsHint: 'Puces — uniquement si présent',
    rule1: "N'invente rien. Omets entièrement les sections vides.",
    rule2: 'Réponds uniquement avec le Markdown, sans blocs de code autour.',
    fallback: "_(Aucune note de réunion n'a pu être générée.)_",
  },
  es: {
    intro:
      'Eres un asistente de actas. Convierte la transcripción en una nota de reunión ' +
      'estructurada en Markdown en español. Usa este esquema:',
    participants: 'Participantes',
    rawTranscript: 'Transcripción en bruto',
    transcriptLabel: 'Transcripción',
    summary: 'Resumen',
    summaryHint: '3-6 frases',
    decisions: 'Decisiones',
    decisionsHint: 'Viñetas — solo si se tomaron',
    actionItems: 'Tareas',
    actionItemsHint: '- [ ] Tarea — Responsable — solo si existe',
    openPoints: 'Puntos abiertos',
    openPointsHint: 'Viñetas — solo si existen',
    rule1: 'No inventes nada. Omite por completo las secciones vacías.',
    rule2: 'Responde solo con el Markdown, sin bloques de código alrededor.',
    fallback: '_(No se pudo generar ninguna nota de reunión.)_',
  },
  it: {
    intro:
      'Sei un assistente per i verbali. Trasforma la trascrizione in una nota di riunione ' +
      'strutturata in Markdown italiano. Usa questa struttura:',
    participants: 'Partecipanti',
    rawTranscript: 'Trascrizione grezza',
    transcriptLabel: 'Trascrizione',
    summary: 'Riepilogo',
    summaryHint: '3-6 frasi',
    decisions: 'Decisioni',
    decisionsHint: 'Punti elenco — solo se ne sono state prese',
    actionItems: 'Azioni',
    actionItemsHint: '- [ ] Attività — Responsabile — solo se presente',
    openPoints: 'Punti aperti',
    openPointsHint: 'Punti elenco — solo se presenti',
    rule1: 'Non inventare nulla. Ometti completamente le sezioni vuote.',
    rule2: 'Rispondi solo con il Markdown, senza blocchi di codice intorno.',
    fallback: '_(Non è stato possibile generare alcuna nota di riunione.)_',
  },
};

/** Resolves the note wording for a language, falling back to German. */
export function noteLocale(language: string): NoteLocale {
  return NOTE_LOCALES[language] ?? NOTE_LOCALES.de;
}

/**
 * Condenses a raw transcript into a structured meeting note (Markdown), written
 * in the meeting's language. Sections with no content are omitted by the model.
 */
export async function generateMeetingNote(
  label: string,
  participants: string[],
  transcript: string,
  language: string,
): Promise<string> {
  const t = noteLocale(language);
  const system = [
    t.intro,
    '',
    `# ${label}`,
    `**${t.participants}:** <…>`,
    '',
    `## ${t.summary}`,
    `<${t.summaryHint}>`,
    '',
    `## ${t.decisions}`,
    `<${t.decisionsHint}>`,
    '',
    `## ${t.actionItems}`,
    `<${t.actionItemsHint}>`,
    '',
    `## ${t.openPoints}`,
    `<${t.openPointsHint}>`,
    '',
    `${t.rule1} ${t.rule2}`,
  ].join('\n');

  const user = `${t.participants}: ${participants.join(', ')}\n\n${t.transcriptLabel}:\n${transcript}`;

  const completion = await openai.chat.completions.create({
    model: config.notesModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  return (
    completion.choices[0]?.message?.content?.trim() ??
    `# ${label}\n\n${t.fallback}`
  );
}

/** Converts Markdown to the HTML the DocuVault inbox stores as note content. */
export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string;
}
