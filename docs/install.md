# DocuVault — Install Guide

Self-hosted DocuVault. ~10 minutes from a fresh server to a running install.

## What you need

- A Linux server (Ubuntu 22.04+ recommended) with:
  - Docker and `docker compose` v2 installed
  - Public ports `80` and `443` reachable
  - At least 4 GB RAM, 20 GB free disk
- A DNS name pointing at the server (e.g. `docuvault.example.com`).
- An SMTP relay you can send mail through (any provider — Postmark, Sendgrid,
  Postal, or your existing mail server). Without one the app runs but cannot
  send invitations, password resets, or notifications.

No account or registry login is needed: the images are public on
`ghcr.io/systaro/docuvault`, for `amd64` and `arm64` servers.

## 1. Get the install files

Clone the repository into a working directory on the server:

```bash
git clone --depth 1 https://github.com/Systaro/DocuVault.git /opt/docuvault
cd /opt/docuvault
```

Only `docker-compose.product.yml`, `.env.example.product`, `deploy.sh` and
`db/bootstrap.sql` are used; nothing is built on the server. Run every command
below from this directory.

## 2. Configure

```bash
cp .env.example.product .env
$EDITOR .env
```

Fill in every line marked **required** at minimum. Generate strong secrets
where indicated (`openssl rand -base64 48`). The fields that *must* be set:

- `PUBLIC_HOSTNAME` (e.g. `docuvault.example.com`)
- `LETSENCRYPT_EMAIL` (gets cert expiry notices)
- `DB_PASSWORD`, `JWT_SECRET`, `REDIS_PASSWORD`, `MINIO_ROOT_PASSWORD`

Strongly recommended: `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`
(your SMTP relay). Without them DocuVault runs, but sends no invitations,
password resets or notifications. You can also set them later under
Admin → Settings → Email.

You do **not** set an admin account in `.env`. The first admin is created in
the browser via the setup wizard the first time you visit your instance.

`PUBLIC_URL` (defaults to `https://$PUBLIC_HOSTNAME`) must be exactly the URL
people open in the browser. It is also the OAuth issuer for MCP clients, so a
mismatch (wrong scheme, extra path, a different hostname) stops Claude Code
and other MCP clients from connecting, while the web UI keeps working.

## 3. Install

```bash
./deploy.sh latest
```

`latest` is the newest release. Pin a version instead (`./deploy.sh v0.7.0`)
if you want upgrades to happen only when you ask for them; `edge` follows the
main branch and is not meant for production.

This will:

1. Pull the images for backend and frontend from `ghcr.io/systaro/docuvault`.
3. Run `db/bootstrap.sql` against a fresh postgres on first start.
4. Bring up nginx-proxy + acme-companion, which request a Let's Encrypt cert
   for `PUBLIC_HOSTNAME` automatically (this can take 30–90 seconds).
5. Poll the backend health endpoint until it reports OK.

If the health check fails, `deploy.sh` prints the last 80 lines of backend
logs and starts the exact images that ran before, even when both versions
share a tag such as `latest`. On a fresh install nothing ran before, so the
new containers stay up but unhealthy; see *Troubleshooting* below.

A rollback restores the images, not the database. If the failed version had
already migrated the schema, restore the postgres dump from the backup folder
the script prints.

## 4. Create the administrator (first-time setup)

Visit `https://<PUBLIC_HOSTNAME>`. On a fresh install the app redirects you
to `/setup`, where you create the first administrator account in the browser
(name, email, password). Once submitted, you're logged in and dropped on the
dashboard.

The setup endpoint stops working as soon as any user exists, so it cannot be
used to take over an existing install. Additional users are invited from the
admin panel.

Health endpoint (returns `{"status":"UP"}` once everything is ready):

```bash
curl https://<PUBLIC_HOSTNAME>/api/actuator/health
```

## 5. Upgrade

When a new version is released, update the install files and run the script
with the new version:

```bash
git pull
./deploy.sh latest
```

Same script. It backs up postgres, MinIO and the repositories before pulling,
swaps the images, polls health, and rolls back automatically if the new
version fails to start. Backups live under `./backups/` (last 10 retained by default).

## 6. Backup & restore

Backups are taken automatically before every `deploy.sh` run. Each backup is
a folder under `./backups/` containing:

- `postgres.sql`: full database dump. The deploy stops before changing
  anything if the dump is incomplete or postgres is not running.
- `minio_data.tar.gz`: uploaded files (logos, attachments)
- `backend_data_repos.tar.gz`: the Git repositories of all spaces
- `meeting-bot_data_recordings.tar.gz`: in-progress meeting recordings, if the
  bot runs
- `previous-version.txt` and `previous-images.txt`: what ran before the upgrade

Every mount of those containers is archived, whether it is a Docker volume or a
folder on the host.

To restore postgres from a backup:

```bash
docker compose -f docker-compose.product.yml exec -T postgres \
  psql -U docuvault docuvault < backups/<TIMESTAMP>/postgres.sql
```

To go back to an earlier release manually:

```bash
./deploy.sh v0.8.0
```

We recommend an off-server backup of the `./backups/` directory as well —
local backups don't help if the server itself is lost.

## Troubleshooting

**Let's Encrypt cert never appears.**
Verify ports 80 + 443 are publicly reachable and DNS resolves to this server:

```bash
docker logs docuvault-acme --tail=50
```

Common cause: the domain doesn't resolve to this server yet, or a firewall
is blocking port 80 (Let's Encrypt uses HTTP-01 challenge).

**Health check fails with HTTP 502.**
Backend probably crashed on startup. Look at:

```bash
docker compose -f docker-compose.product.yml logs backend --tail=100
```

Most common causes: bad `JWT_SECRET` (too short), wrong `DB_PASSWORD`, or
postgres not yet ready (deploy.sh waits, but may need longer with slow disk).

**Pulling images fails.**
The public images need no login. If `deploy.sh` still tries one, remove
`DOCUVAULT_REGISTRY_USER` and `DOCUVAULT_REGISTRY_TOKEN` from `.env`. When you
pull from your own registry (`DOCUVAULT_IMAGE_PREFIX`), test the login by hand:

```bash
echo "$DOCUVAULT_REGISTRY_TOKEN" | docker login "$DOCUVAULT_REGISTRY_HOST" \
  -u "$DOCUVAULT_REGISTRY_USER" --password-stdin
```

**Email not sending.**
The SMTP relay probably rejects the `HELO` name. Set `MAIL_SMTP_LOCALHOST`
to your `PUBLIC_HOSTNAME` in `.env` and restart:

```bash
docker compose -f docker-compose.product.yml up -d backend
```

**MCP client cannot connect (OAuth discovery fails, "authentication failed").**
The client fetches `https://<host>/.well-known/oauth-protected-resource` and
`/.well-known/oauth-authorization-server` from the *site root*. The frontend
container answers both by forwarding them to the backend, so this works out
of the box with the bundled nginx-proxy. With your own reverse proxy, make
sure every path (not only `/api/`) reaches the frontend container, and that
`PUBLIC_URL` in `.env` equals the URL the client is configured with. Check:

```bash
curl -s https://<host>/.well-known/oauth-authorization-server
```

A JSON document with `authorization_endpoint`, `token_endpoint` and
`registration_endpoint` means discovery works; an HTML page means the request
never reached the backend.

**Where do logs live.**
All container logs go through Docker:

```bash
docker compose -f docker-compose.product.yml logs <service> --tail=200 -f
```

Backend application logs are inside the backend container at `/app/logs/`
if you've enabled file logging via `LOGGING_FILE_NAME`.

## Support

- Bug reports / install help: open an issue at https://github.com/Systaro/DocuVault/issues
- Security disclosure: see [SECURITY.md](../SECURITY.md)
- Status of your install: `docker compose -f docker-compose.product.yml ps`
