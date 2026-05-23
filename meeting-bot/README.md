# DocuVault Meeting Bot

A Discord bot that joins a voice call, transcribes it per speaker, and files the
result into a DocuVault space inbox as a structured meeting note plus the raw
transcript.

Full feature description and Discord app setup: [`../docs/meeting-bot.md`](../docs/meeting-bot.md).

## Quick start

```bash
cp .env.example .env      # fill DISCORD_TOKEN, OPENAI_API_KEY, DOCUVAULT_API_URL
npm install
npm run build && npm start
```

Dev mode with reload: `npm run dev`.

## Commands (in Discord)

| Command | Effect |
|---------|--------|
| `/transcribe token:dvm_…` | Bot joins your voice channel and starts recording |
| `/stop` | Ends recording, transcribes, files notes into DocuVault |

Get the `dvm_…` token from a DocuVault space: **Inbox → Meeting transkribieren**.
The bot also auto-stops when the last person leaves the voice channel.

## Architecture

```
src/
  config.ts            environment configuration
  docuvault.ts         DocuVault meeting-bot API client
  session.ts           platform-neutral meeting lifecycle
  transcribe.ts        OpenAI speech-to-text per utterance
  audio.ts             raw PCM → mono WAV
  meetingNotes.ts      AI meeting-note generation + Markdown→HTML
  discord/
    bot.ts             Discord adapter — slash commands, voice join
    recorder.ts        Discord adapter — per-speaker audio capture
```

The Discord-specific code is confined to `discord/`. A future Teams adapter
plugs into the same `MeetingSession` core.
