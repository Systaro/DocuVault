import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  openaiApiKey: required('OPENAI_API_KEY'),
  /** DocuVault API base, including the /api context path. Trailing slash stripped. */
  docuvaultApiUrl: (process.env.DOCUVAULT_API_URL ?? 'http://localhost:7030/api').replace(/\/+$/, ''),
  transcribeModel: process.env.TRANSCRIBE_MODEL ?? 'gpt-4o-transcribe',
  notesModel: process.env.NOTES_MODEL ?? 'gpt-5.5',
  silenceMs: Number(process.env.SILENCE_MS ?? 1200),
  maxMeetingMinutes: Number(process.env.MAX_MEETING_MINUTES ?? 180),
};
