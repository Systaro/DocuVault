import 'dotenv/config';
import { tmpdir } from 'node:os';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function flag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value !== 'false' && value !== '0';
}

export const config = {
  /** Discord adapter is started only when this is set (see index.ts). */
  discordToken: optional('DISCORD_TOKEN'),
  /** Service-level token for polling the Teams dispatch endpoints. The Teams
   *  adapter is started only when this is set. */
  dispatchToken: optional('MEETING_BOT_DISPATCH_TOKEN'),
  openaiApiKey: required('OPENAI_API_KEY'),
  /** DocuVault API base, including the /api context path. Trailing slash stripped. */
  docuvaultApiUrl: (process.env.DOCUVAULT_API_URL ?? 'http://localhost:7030/api').replace(/\/+$/, ''),
  transcribeModel: process.env.TRANSCRIBE_MODEL ?? 'gpt-4o-transcribe',
  notesModel: process.env.NOTES_MODEL ?? 'gpt-5.5',
  silenceMs: Number(process.env.SILENCE_MS ?? 1200),
  maxMeetingMinutes: Number(process.env.MAX_MEETING_MINUTES ?? 180),
  /** Display name the Teams browser bot joins the meeting under. */
  teamsBotName: process.env.TEAMS_BOT_NAME ?? 'DocuVault Notetaker',
  /** How often the Teams dispatcher polls for pending invites, in ms. */
  teamsPollMs: Number(process.env.TEAMS_POLL_MS ?? 15_000),
  /** Cap on simultaneous Teams meetings (each is a headless Chromium). */
  maxConcurrentTeams: Number(process.env.MEETING_MAX_CONCURRENT_TEAMS ?? 2),
  /** Run Chromium headless. Set TEAMS_HEADLESS=0 to watch it locally. */
  teamsHeadless: flag('TEAMS_HEADLESS', true),
  /** Max time to wait in the lobby for a human to admit the bot, in ms. */
  teamsAdmitTimeoutMs: Number(process.env.TEAMS_ADMIT_TIMEOUT_MS ?? 120_000),
  /** Where in-progress meeting recordings (PCM + manifest) are written. Point
   *  this at a mounted volume in production so a meeting survives a bot restart
   *  and can be finalized on the next boot; defaults to the OS temp dir for
   *  local dev (where ephemeral storage is fine). */
  recordingsDir: process.env.RECORDINGS_DIR ?? tmpdir(),
};
