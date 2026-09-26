# Meeting Transcription Bot — Feature & Setup

> **Status: alpha.** The bot works but is still being calibrated against live
> meetings. Expect rough edges and changes between minor versions.

## Overview

The meeting bot joins a meeting, transcribes it, and files the result into a
space's [Inbox](space-inbox.md) as two notes — a structured meeting note and the
raw transcript. From there the existing inbox AI routes the notes onto documents.

The action items of the meeting note become suggested [tasks](tasks.md) for the
person who invited the bot. They appear under "To confirm" on My tasks and on the
note in the inbox, and reach nobody else until they are confirmed.

Two platforms are supported:

- **Discord** — the bot joins a voice call. Discord delivers a separate audio
  stream per speaker, so speaker attribution is exact and notes carry real names.
- **Microsoft Teams** — the bot joins the meeting as a headless-browser guest and
  scrapes the live captions (speaker name + text). No Azure/tenant admin is
  required; it joins as an anonymous guest and a participant admits it from the
  lobby.

The bot never holds a user session. A **meeting invite** issued inside DocuVault
scopes its work to exactly one space and one meeting. Discord and Teams differ in
how the bot authenticates (see [Credential models](#credential-models)).

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

### Teams

```
DocuVault UI                meeting-bot (Teams)              DocuVault API
─────────────               ───────────────────             ─────────────
Inbox → "Meeting
 transkribieren" → Teams
  └─ paste meeting link
     create invite ──────────────────────────────────────►  POST /spaces/{id}/meetings
                                                              (platform=TEAMS, meetingUrl)

  bot polls for pending Teams invites ───────────────────►  GET  /meetings/bot/teams/pending
  joins meeting as "DocuVault Notetaker" (headless browser)
  a participant admits it from the lobby ────────────────►  POST /meetings/bot/teams/{id}/claim
  turns on live captions, scrapes them live

  meeting ends (or safety cap)
  caption lines already carry speaker + text → no STT
        AI condenses → meeting note
        ────────────────────────────────────────────────►  POST /meetings/bot/teams/{id}/notes
                                                              creates 2 inbox notes
                                                              runs routing rules
```

Teams gives a browser guest only one mixed audio stream, so the bot reads the
**live-caption overlay** instead — each caption already pairs a speaker name with
text, which maps directly onto the same `[mm:ss] Name: text` transcript. No audio
is captured and no speech-to-text step runs on the Teams path.

Because a browser bot has no gateway and isn't resident in Teams, it can't be
triggered from inside the call (the way `/transcribe` triggers Discord). Instead
it **polls** DocuVault for pending Teams invites and dispatches itself.

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
| meeting_url | TEXT | Teams join link (TEAMS invites only; NULL for Discord) |
| participants | TEXT | Comma-separated speaker names |
| note_count | INT | Inbox notes produced |
| error | TEXT | Set when the bot reports a failure |
| expires_at | TIMESTAMPTZ | Pending invites expire after 24 h |
| claimed_at / completed_at / created_at | TIMESTAMPTZ | |

Migrations: `V014__meeting_invites.sql`, `V018__meeting_invite_url.sql`.

### Credential models

Both platforms reach the same invite state machine, but authenticate differently:

- **Discord** — the per-invite token `dvm_…` (the bot holds it). Only its SHA-256
  hash is stored; the raw token is shown once at creation and pasted into Discord.
- **Teams** — a service-level **dispatch token** (`MEETING_BOT_DISPATCH_TOKEN`,
  shared between backend and bot) plus the invite id. No per-invite token is ever
  minted or stored, because the bot is trusted infrastructure talking
  server-to-server — there's no human to hand a token to.

---

## REST API

### User-facing (session or `dv_` API token)

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| GET | `/api/spaces/{spaceId}/meetings` | VIEW | List invites |
| POST | `/api/spaces/{spaceId}/meetings` | EDIT | Create invite — `{ label, platform, language, meetingUrl? }`; response includes the raw `token` once (Discord). `meetingUrl` is required for `TEAMS` |
| DELETE | `/api/spaces/{spaceId}/meetings/{inviteId}` | EDIT | Cancel a pending invite |

### Bot-facing — Discord (public; the `dvm_` meeting token is the credential)

The token goes in `Authorization: Bearer dvm_…`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/meetings/bot/claim` | Bot joined a call — body `{ meetingChannel }` |
| POST | `/api/meetings/bot/progress` | Live progress — body `{ phase, current?, total?, message? }` |
| POST | `/api/meetings/bot/notes` | Submit notes — body `{ notes: string[], participants }` |
| POST | `/api/meetings/bot/fail` | Report an error — body `{ error }` |

### Bot-facing — Teams (public; the dispatch token is the credential)

`Authorization: Bearer <MEETING_BOT_DISPATCH_TOKEN>`; the invite is addressed by id.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/meetings/bot/teams/pending` | Pending Teams invites to join — `[{ inviteId, meetingUrl, label, language }]` |
| POST | `/api/meetings/bot/teams/{inviteId}/claim` | Bot joined — body `{ meetingChannel }` |
| POST | `/api/meetings/bot/teams/{inviteId}/progress` | Live progress |
| POST | `/api/meetings/bot/teams/{inviteId}/notes` | Submit notes |
| POST | `/api/meetings/bot/teams/{inviteId}/fail` | Report an error |

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

**Production install (uses the pre-built image from `ghcr.io/systaro/docuvault`):**

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

## Teams setup

No Azure app, bot registration, or tenant admin is needed — the bot joins as an
anonymous guest via the meeting web link.

### 1. Configure the dispatch token

Pick a strong shared secret and set it **identically** on the backend and the bot:

```bash
# in the install .env (backend reads it; the bot polls with it)
MEETING_BOT_DISPATCH_TOKEN=$(openssl rand -hex 32)
OPENAI_API_KEY=…            # still needed for meeting-note generation
```

The backend exposes the Teams dispatch endpoints only when this is set; a blank
value disables Teams dispatch entirely (the endpoints deny every request).

### 2. Deploy the bot

Same opt-in `meeting-bot` compose service as Discord. `deploy.sh` (and the CI
deploy) enable it when **either** `DISCORD_BOT_TOKEN` or
`MEETING_BOT_DISPATCH_TOKEN` is present in `.env`:

```bash
$EDITOR .env                # set MEETING_BOT_DISPATCH_TOKEN (+ OPENAI_API_KEY)
./deploy.sh <version>
```

The bot image is based on `mcr.microsoft.com/playwright`, so Chromium ships with
it — no extra browser install on the host.

### 3. Use it

1. In DocuVault: **Inbox → Meeting transkribieren → Microsoft Teams**, paste the
   Teams meeting link, create the invite.
2. Within a poll cycle the bot joins the meeting as **DocuVault Notetaker** and
   waits in the lobby.
3. A participant admits it. It turns on live captions and transcribes live; the
   inbox shows status in real time.
4. When the meeting ends, the notes appear in the space inbox.

Live captions must be available in the meeting (the bot turns them on in its own
session). If no one admits the bot within `TEAMS_ADMIT_TIMEOUT_MS`, the invite is
failed cleanly.

---

## Configuration

Bot environment variables (`meeting-bot/.env`). At least one adapter credential
(`DISCORD_TOKEN` or `MEETING_BOT_DISPATCH_TOKEN`) must be set.

| Variable | Default | Purpose |
|----------|---------|---------|
| `DISCORD_TOKEN` | — | Discord bot token — enables the Discord adapter |
| `MEETING_BOT_DISPATCH_TOKEN` | — | Shared secret (matches backend) — enables the Teams adapter |
| `OPENAI_API_KEY` | — | Transcription (Discord) + note generation (both) — required |
| `DOCUVAULT_API_URL` | `http://localhost:7030/api` | DocuVault API base incl. `/api` |
| `TRANSCRIBE_MODEL` | `gpt-4o-transcribe` | Speech-to-text model (Discord path) |
| `NOTES_MODEL` | `gpt-5.5` | Meeting-note summarisation model |
| `SILENCE_MS` | `1200` | Silence that ends a speaking turn (Discord) |
| `MAX_MEETING_MINUTES` | `180` | Safety auto-stop |
| `TEAMS_BOT_NAME` | `DocuVault Notetaker` | Guest name shown in the Teams lobby |
| `TEAMS_POLL_MS` | `15000` | How often the bot polls for pending Teams invites |
| `MEETING_MAX_CONCURRENT_TEAMS` | `2` | Cap on simultaneous Teams meetings (each is a Chromium) |
| `TEAMS_HEADLESS` | `1` | Set `0` to watch Chromium while debugging |
| `TEAMS_ADMIT_TIMEOUT_MS` | `120000` | Lobby wait before the invite is failed |

Backend variable: `MEETING_BOT_DISPATCH_TOKEN` (config key
`app.meeting-bot.dispatch-token`) — must equal the bot's value.

---

## Privacy

The bot is visible and announces itself: it renames to `🔴 … REC` and posts a
"this meeting is being transcribed" message naming the target space when it
joins. Anyone who does not consent can leave the voice channel. Raw audio is
written to a temp directory and deleted right after transcription; only the
text transcript and the generated note are persisted (in the space inbox).

---

## Known limitations

**Discord**

- Voice receive is a community-supported part of `@discordjs/voice` — robust in
  practice but not officially guaranteed by Discord.
- A single uninterrupted speaking turn over ~4 minutes can exceed the OpenAI
  upload limit; natural pauses split turns well before that.
- One meeting per Discord server at a time.

**Teams**

- Transcript quality is Teams' own live-caption STT, not `gpt-4o-transcribe`.
- The bot reads Teams' **unofficial web caption DOM**; a Teams UI change can
  break caption scraping. The selectors are isolated in `teams/recorder.ts` and
  `teams/bot.ts` for quick fixes, and need calibration against a live meeting.
- A human must admit the bot from the lobby (anonymous-guest join).
- Live captions must be available; some tenant policies disable them.
- "Everyone left but didn't end the meeting" isn't detected — the bot records
  until the meeting is ended or the `MAX_MEETING_MINUTES` cap is hit.
- Each concurrent Teams meeting is a headless Chromium; scale with
  `MEETING_MAX_CONCURRENT_TEAMS`.
