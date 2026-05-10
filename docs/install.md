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
- Registry credentials provided by Systaro (`DOCUVAULT_REGISTRY_USER` +
  `DOCUVAULT_REGISTRY_TOKEN`).

## 1. Get the install bundle

Extract the bundle into a working directory on the server:

```
/opt/docuvault/
├── docker-compose.product.yml
├── .env.example.product
├── deploy.sh
└── db/
    └── bootstrap.sql
```

`cd` into that directory before any commands below.

## 2. Configure

```bash
cp .env.example.product .env
$EDITOR .env
```

Fill in every line marked **required** at minimum. Generate strong secrets
where indicated (`openssl rand -base64 48`). The fields that *must* be set:

- `PUBLIC_HOSTNAME` (e.g. `docuvault.example.com`)
- `LETSENCRYPT_EMAIL` (gets cert expiry notices)
- `DOCUVAULT_REGISTRY_USER` + `DOCUVAULT_REGISTRY_TOKEN` (from Systaro)
- `DB_PASSWORD`, `JWT_SECRET`, `REDIS_PASSWORD`, `MINIO_ROOT_PASSWORD`
- `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD` (your SMTP relay)

You do **not** set an admin account in `.env`. The first admin is created in
the browser via the setup wizard the first time you visit your instance.

## 3. Install

```bash
./deploy.sh v0.1.0
```

This will:

1. Log in to `registry.git.systaro.de` using your token.
2. Pull the `v0.1.0` images for backend and frontend.
3. Run `db/bootstrap.sql` against a fresh postgres on first start.
4. Bring up nginx-proxy + acme-companion, which request a Let's Encrypt cert
   for `PUBLIC_HOSTNAME` automatically (this can take 30–90 seconds).
5. Poll the backend health endpoint until it reports OK.

If the health check fails, `deploy.sh` prints the last 80 lines of backend
logs and rolls back to the previous version. On a fresh install there is no
previous version, so the new container stays running but unhealthy — see
*Troubleshooting* below.

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

When a new version is released, run:

```bash
./deploy.sh v0.2.0
```

Same script. It backs up postgres + MinIO + repos before pulling, swaps the
images, polls health, and rolls back automatically if the new version fails
to start. Backups live under `./backups/` (last 10 retained by default).

## 6. Backup & restore

Backups are taken automatically before every `deploy.sh` run. Each backup is
a folder under `./backups/` containing:

- `postgres.sql` — full database dump
- `minio_data.tar.gz` — uploaded files (logos, etc.)
- `repos_data.tar.gz` — synced GitLab repos
- `previous-version.txt` — the version that was running before the upgrade

To restore postgres from a backup:

```bash
docker compose -f docker-compose.product.yml exec -T postgres \
  psql -U docuvault docuvault < backups/<TIMESTAMP>/postgres.sql
```

To roll back to the previous version manually:

```bash
./deploy.sh "$(cat backups/<TIMESTAMP>/previous-version.txt)"
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

**`docker login` fails.**
Confirm `DOCUVAULT_REGISTRY_USER` and `DOCUVAULT_REGISTRY_TOKEN` are set
correctly in `.env`. Test manually:

```bash
echo "$DOCUVAULT_REGISTRY_TOKEN" | docker login registry.git.systaro.de \
  -u "$DOCUVAULT_REGISTRY_USER" --password-stdin
```

**Email not sending.**
The SMTP relay probably rejects the `HELO` name. Set `MAIL_SMTP_LOCALHOST`
to your `PUBLIC_HOSTNAME` in `.env` and restart:

```bash
docker compose -f docker-compose.product.yml up -d backend
```

**Where do logs live.**
All container logs go through Docker:

```bash
docker compose -f docker-compose.product.yml logs <service> --tail=200 -f
```

Backend application logs are inside the backend container at `/app/logs/`
if you've enabled file logging via `LOGGING_FILE_NAME`.

## Support

- Bug reports / install help: antonia.engfors@systaro.de
- Status of your install: `docker compose -f docker-compose.product.yml ps`
