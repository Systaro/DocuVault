# DocuVault Meeting Bot

Joins a meeting, transcribes it, and files the result into a DocuVault space
inbox as a structured meeting note plus the raw transcript. Two platforms:

- **Discord** — joins a voice call and transcribes per speaker (one Opus stream
  per participant, so speaker attribution is exact).
- **Microsoft Teams** — joins the meeting as a headless-browser guest and scrapes
  the live captions (speaker name + text), so no audio capture is needed.

Full feature description and setup: [`../docs/meeting-bot.md`](../docs/meeting-bot.md).

## Quick start

```bash
cp .env.example .env      # set OPENAI_API_KEY + at least one adapter credential
npm install
npm run build && npm start
```

Each adapter starts only when its credential is present, so one process can run
Discord, Teams, or both:

- `DISCORD_TOKEN` → Discord adapter
- `MEETING_BOT_DISPATCH_TOKEN` → Teams adapter (must match
  `app.meeting-bot.dispatch-token` on the backend)

Dev mode with reload: `npm run dev`.

> The Teams adapter drives a real Chromium via Playwright. The Docker image is
> based on `mcr.microsoft.com/playwright` so the browser ships with it; for a
> local run install browsers once with `npx playwright install chromium`.

## Discord

| Command | Effect |
|---------|--------|
| `/transcribe token:dvm_…` | Bot joins your voice channel and starts recording |
| `/stop` | Ends recording, transcribes, files notes into DocuVault |

Get the `dvm_…` token from a DocuVault space: **Inbox → Meeting transkribieren →
Discord**. The bot also auto-stops when the last person leaves the voice channel.

## Teams

1. In a space: **Inbox → Meeting transkribieren → Microsoft Teams**, paste the
   Teams meeting link, and create the invite.
2. The bot (polling DocuVault) joins the meeting as **DocuVault Notetaker** and
   waits in the lobby.
3. A participant admits it from the lobby. It enables live captions and
   transcribes until the meeting ends, then files the notes into the inbox.

No Azure/tenant admin is required — the bot joins as an anonymous guest. It needs
captions to be available in the meeting (it turns them on in its own session).

## Architecture

```
src/
  config.ts            environment configuration
  docuvault.ts         DocuVault meeting-bot API client (+ Teams dispatch poll)
  session.ts           platform-neutral meeting lifecycle (PCM or pre-transcribed)
  transcribe.ts        OpenAI speech-to-text per utterance (Discord path)
  audio.ts             raw PCM → mono WAV
  meetingNotes.ts      AI meeting-note generation + Markdown→HTML
  discord/
    bot.ts             Discord adapter — slash commands, voice join
    recorder.ts        Discord adapter — per-speaker audio capture
  teams/
    dispatcher.ts      Teams adapter — polls DocuVault, dispatches a bot per meeting
    bot.ts             Teams adapter — Playwright join, lobby, captions, end-detect
    recorder.ts        Teams adapter — live-caption scraping → transcript lines
```

Both adapters feed the same `MeetingSession` core, which builds and submits the
notes. Discord supplies raw PCM (transcribed via OpenAI); Teams supplies
already-transcribed caption lines and skips speech-to-text.
