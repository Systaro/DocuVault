# Meeting Transcription Bot — Feature & Setup

## Overview

The meeting bot joins a voice call, transcribes it per speaker, and files the
result into a space's [Inbox](space-inbox.md) as two notes — a structured
meeting note and the raw transcript. From there the existing inbox AI routes
the notes onto documents.

The bot never holds a user session. A **meeting invite** issued inside DocuVault
gives it a one-time token (`dvm_…`) scoped to exactly one space and one meeting.

Discord is supported today. Teams is a planned second adapter (the bot core is
platform-neutral; only the audio-receive adapter differs).

---

## How it works

```
DocuVault UI                meeting-bot (Discord)            DocuVault API
─────────────               ─────────────────────           ─────────────
Inbox → "Meeting
 transkribieren"
  └─ create invite ──────────────────────────────────────►  POST /spaces/{id}/meetings
        dvm_… token  ◄──────────────────────────────────────  (token shown once)

  user runs /transcribe token:dvm_…  in Discord
        bot joins voice channel ───────────────────────────► POST /meetings/bot/claim
        posts "🔴 wird transkribiert"
        records one audio file per speaking turn

  user runs /stop  (or everyone leaves the call)
        transcribe each turn (OpenAI)
        AI condenses → meeting note
        ────────────────────────────────────────────────────► POST /meetings/bot/notes
                                                                creates 2 inbox notes
                                                                runs routing rules
```

Discord delivers a **separate audio stream per speaking user**, so speaker
attribution is exact — no diarization model is needed. Each speaking turn is
recorded to its own file, transcribed, and the turns are merged by timestamp
into `[mm:ss] Name: text` lines.

---

## Data model

### `meeting_invites`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| space_id | UUID FK → spaces | |
| created_by | UUID FK → users | Inbox notes are attributed to this user |
| label | VARCHAR(255) | Human meeting name |
| platform | VARCHAR(20) | `DISCORD` \| `TEAMS` |
| status | VARCHAR(20) | `PENDING` \| `ACTIVE` \| `COMPLETED` \| `FAILED` \| `CANCELLED` |
| token_hash | VARCHAR(64) | SHA-256 of the raw token (raw token never stored) |
| token_prefix | VARCHAR(16) | First 12 chars, for display |
| meeting_channel | VARCHAR(500) | Call the bot joined, recorded on claim |
| participants | TEXT | Comma-separated speaker names |
| note_count | INT | Inbox notes produced |
| error | TEXT | Set when the bot reports a failure |
| expires_at | TIMESTAMPTZ | Pending invites expire after 24 h |
| claimed_at / completed_at / created_at | TIMESTAMPTZ | |

Migration: `V014__meeting_invites.sql`.

---

## REST API

### User-facing (session or `dv_` API token)

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| GET | `/api/spaces/{spaceId}/meetings` | VIEW | List invites |
| POST | `/api/spaces/{spaceId}/meetings` | EDIT | Create invite — response includes the raw `token` once |
| DELETE | `/api/spaces/{spaceId}/meetings/{inviteId}` | EDIT | Cancel a pending invite |

### Bot-facing (public; the `dvm_` meeting token is the credential)

The token goes in `Authorization: Bearer dvm_…`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/meetings/bot/claim` | Bot joined a call — body `{ meetingChannel }` |
| POST | `/api/meetings/bot/notes` | Submit notes — body `{ notes: string[], participants }` |
| POST | `/api/meetings/bot/fail` | Report an error — body `{ error }` |

---

## Discord setup

### 1. Create the Discord application

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. **Bot** tab → **Reset Token** → copy the token. This is `DISCORD_BOT_TOKEN`.
3. No privileged intents are required (the bot uses Guilds + Voice States only).

### 2. Invite the bot to your server

Open this URL (replace `APP_ID` with your application's Client ID):

```
https://discord.com/oauth2/authorize?client_id=APP_ID&scope=bot+applications.commands&permissions=70257664
```

`permissions=70257664` covers: View Channels, Send Messages, Connect, Speak,
Change Nickname. Pick your server and authorize.

### 3. Deploy the bot

The bot is shipped as an opt-in compose service alongside backend and frontend.
One bot per DocuVault installation (Discord identities are single-instance).

**Production install (uses pre-built image from `registry.git.systaro.de`):**

```bash
# in the directory with docker-compose.product.yml and .env
$EDITOR .env                       # set DISCORD_BOT_TOKEN (plus OPENAI_API_KEY)
./deploy.sh <version>              # deploy.sh detects DISCORD_BOT_TOKEN
                                   # and includes the bot automatically
```

**Local dev (builds from the source tree):**

```bash
cd meeting-bot
cp .env.example .env
$EDITOR .env                       # DISCORD_TOKEN, OPENAI_API_KEY, DOCUVAULT_API_URL
npm install
npm run build && npm start
```

Or via the dev compose with the source built locally:

```bash
docker compose --profile meeting-bot up -d --build meeting-bot
```

### Updating the bot

`deploy.sh <version>` re-pulls the bot image whenever `DISCORD_BOT_TOKEN` is
set in `.env`. The bot is restarted in the same step as backend/frontend.
Active recordings are interrupted — pick a quiet time, or temporarily comment
out `DISCORD_BOT_TOKEN` to defer.

### Multi-customer note

A Discord bot token can only be logged in at one place at a time. Each
DocuVault installation (your own host, a customer's host,
etc.) creates its own Discord application and runs its own bot container.
There is no central hosted bot.

The `meeting-bot` compose service is behind a profile, so a normal
`docker compose up` is unaffected if you do not use the bot.

### 4. Use it

1. In DocuVault: open a space's **Inbox → Meeting transkribieren → Token erzeugen**.
2. In Discord: join a voice channel, then run `/transcribe token:dvm_…`.
3. The bot joins, renames itself `🔴 … REC`, and posts a transcription notice.
4. Run `/stop` (or just leave the call) to end it. The bot transcribes and
   files the notes — they appear in the space inbox within a minute or two.

---

## Configuration

Bot environment variables (`meeting-bot/.env`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `DISCORD_TOKEN` | — | Discord bot token (required) |
| `OPENAI_API_KEY` | — | Transcription + note generation (required) |
| `DOCUVAULT_API_URL` | `http://localhost:7030/api` | DocuVault API base incl. `/api` |
| `TRANSCRIBE_MODEL` | `gpt-4o-transcribe` | Speech-to-text model |
| `NOTES_MODEL` | `gpt-5.5` | Meeting-note summarisation model |
| `SILENCE_MS` | `1200` | Silence that ends a speaking turn |
| `MAX_MEETING_MINUTES` | `180` | Safety auto-stop |

---

## Privacy

The bot is visible and announces itself: it renames to `🔴 … REC` and posts a
"this meeting is being transcribed" message naming the target space when it
joins. Anyone who does not consent can leave the voice channel. Raw audio is
written to a temp directory and deleted right after transcription; only the
text transcript and the generated note are persisted (in the space inbox).

---

## Known limitations

- Voice receive is a community-supported part of `@discordjs/voice` — robust in
  practice but not officially guaranteed by Discord.
- A single uninterrupted speaking turn over ~4 minutes can exceed the OpenAI
  upload limit; natural pauses split turns well before that.
- One meeting per Discord server at a time.
- Teams adapter is not implemented yet.
