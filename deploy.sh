#!/usr/bin/env bash
# deploy.sh — install or upgrade a DocuVault instance.
#
# Runs ON the target host (the one where docker compose is). Does NOT SSH
# anywhere. To deploy to a remote host, run this script there.
#
# Usage:
#   ./deploy.sh <version>
#
#     <version>   Image tag to deploy. Examples:
#                   v1.2.3   a specific release
#                   v1.2     latest patch in 1.2.x
#                   latest   latest stable release
#                   edge     latest main-branch build (unstable)
#
# Required files in the working directory:
#   docker-compose.product.yml, or docker-compose.yml when there is no product
#   file (or set COMPOSE_FILE env var)
#   .env  (copy from .env.example.product and fill in values)
#
# The compose file must reference image tags via ${DOCUVAULT_VERSION},
# e.g.  image: ghcr.io/example/docuvault-backend:${DOCUVAULT_VERSION:-latest}
#
# Configurable env vars:
#   COMPOSE_FILE                compose file to use (default: docker-compose.product.yml
#                               if present, else docker-compose.yml)
#   HEALTH_URL                  URL to poll after restart (default: http://localhost:7030/api/actuator/health)
#   HEALTH_TIMEOUT              seconds to wait for health (default: 90)
#   BACKUP_RETAIN               number of recent backup folders to keep (default: 10)
#   DOCUVAULT_REGISTRY_HOST     image registry host (default: registry.git.systaro.de)
#   DOCUVAULT_REGISTRY_USER     deploy-token username for image pulls (optional;
#                               the public images on ghcr.io need no login)
#   DOCUVAULT_REGISTRY_TOKEN    deploy-token secret for image pulls (optional)
#
# Exits non-zero if the health check fails. On health failure, rolls back
# to the previous version (recorded in .docuvault-current-version) before
# exiting.

set -euo pipefail

# ---------------------------------------------------------------------------
# Args & config
# ---------------------------------------------------------------------------
VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  cat <<'USAGE' >&2
Usage: ./deploy.sh <version>
  ./deploy.sh v1.2.3
  ./deploy.sh latest
  ./deploy.sh edge
USAGE
  exit 1
fi

# A checkout of the repository has both files; the product one is the install.
if [ -z "${COMPOSE_FILE:-}" ]; then
  if [ -f docker-compose.product.yml ]; then COMPOSE_FILE=docker-compose.product.yml; else COMPOSE_FILE=docker-compose.yml; fi
fi
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
BACKUP_RETAIN="${BACKUP_RETAIN:-10}"
STATE_FILE=".docuvault-current-version"
SAFE_VERSION="${VERSION//\//_}"
BACKUP_DIR="./backups/$(date +%Y%m%d-%H%M%S)-pre-${SAFE_VERSION}"

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Error: $COMPOSE_FILE not found in $(pwd)" >&2
  exit 1
fi
if [ ! -f .env ]; then
  echo "Error: .env not found in $(pwd) (copy from .env.example)" >&2
  exit 1
fi
for cmd in docker curl tar; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Error: $cmd not found in PATH" >&2
    exit 1
  }
done

# Read values from .env without sourcing the file (sourcing is fragile).
# Strips both single and double quotes — `infisical export --format=dotenv`
# wraps values in single quotes, manual edits often use double.
env_get() {
  grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | sed "s/^['\"]//; s/['\"]\$//" || true
}
DB_USERNAME="$(env_get DB_USERNAME)"
DB_NAME="$(env_get DB_NAME)"
DB_USERNAME="${DB_USERNAME:-docuvault}"
DB_NAME="${DB_NAME:-docuvault}"

# Meeting-bot is opt-in: deploy.sh includes it whenever an adapter credential is
# set in .env — DISCORD_BOT_TOKEN (Discord) or MEETING_BOT_DISPATCH_TOKEN (Teams).
# Compose profile must match the one declared on the service.
SERVICES_TO_PULL="backend frontend"
COMPOSE_PROFILE_ARGS=""
if [ -n "$(env_get DISCORD_BOT_TOKEN)" ] || [ -n "$(env_get MEETING_BOT_DISPATCH_TOKEN)" ]; then
  SERVICES_TO_PULL="$SERVICES_TO_PULL meeting-bot"
  COMPOSE_PROFILE_ARGS="--profile meeting-bot"
  echo "==> meeting-bot enabled (Discord and/or Teams adapter present in .env)"
fi

REGISTRY_HOST="${DOCUVAULT_REGISTRY_HOST:-registry.git.systaro.de}"
REGISTRY_USER="${DOCUVAULT_REGISTRY_USER:-$(env_get DOCUVAULT_REGISTRY_USER)}"
REGISTRY_TOKEN="${DOCUVAULT_REGISTRY_TOKEN:-$(env_get DOCUVAULT_REGISTRY_TOKEN)}"

# HEALTH_URL default depends on whether this is a product install (nginx-proxy
# on host port 80, backend not directly exposed) or a dev compose (backend
# bound to host:7030). PUBLIC_HOSTNAME is set in product installs, so we use
# its presence to pick the right default.
PUBLIC_HOSTNAME_FROM_ENV="$(env_get PUBLIC_HOSTNAME)"
if [ -z "${HEALTH_URL:-}" ]; then
  if [ -n "$PUBLIC_HOSTNAME_FROM_ENV" ]; then
    HEALTH_URL="http://localhost/api/actuator/health"
    HEALTH_HOST_HEADER="${HEALTH_HOST_HEADER:-$PUBLIC_HOSTNAME_FROM_ENV}"
  else
    HEALTH_URL="http://localhost:7030/api/actuator/health"
  fi
fi
HEALTH_HOST_HEADER="${HEALTH_HOST_HEADER:-}"

PREV_VERSION="<none>"
[ -f "$STATE_FILE" ] && PREV_VERSION="$(cat "$STATE_FILE")"

cat <<INFO
==> DocuVault deploy
    Target version : $VERSION
    Previous       : $PREV_VERSION
    Compose file   : $COMPOSE_FILE
    Health URL     : $HEALTH_URL
    Backup folder  : $BACKUP_DIR
INFO

# ---------------------------------------------------------------------------
# 1. Backup
# ---------------------------------------------------------------------------
mkdir -p "$BACKUP_DIR"

if docker compose -f "$COMPOSE_FILE" ps --status running --services 2>/dev/null \
     | grep -q '^postgres$'; then
  echo "==> Backup: postgres dump"
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump -U "$DB_USERNAME" "$DB_NAME" > "$BACKUP_DIR/postgres.sql"
  # A dump that stopped half way still exits 0 on some errors; only a complete
  # one ends with this marker. Nothing has been changed yet, so stop here.
  if ! tail -n 5 "$BACKUP_DIR/postgres.sql" | grep -q 'PostgreSQL database dump complete'; then
    echo "!!! postgres dump is incomplete, aborting before anything changes" >&2
    exit 1
  fi
elif [ -n "$(docker compose -f "$COMPOSE_FILE" ps -a -q 2>/dev/null)" ]; then
  # The stack exists but its database is not running: an upgrade without a
  # dump is not allowed.
  echo "!!! postgres is not running, so no dump can be taken; start it or fix the stack first" >&2
  exit 1
else
  echo "==> Backup: no containers yet (fresh install), skipping dump"
fi

# Back up what the containers actually mount, named volume or host folder, so
# an install that keeps its data in bind mounts is covered too.
snapshot_mounts() {
  local svc="$1" cid
  # shellcheck disable=SC2086
  cid="$(docker compose $COMPOSE_PROFILE_ARGS -f "$COMPOSE_FILE" ps -q "$svc" 2>/dev/null | head -1)"
  [ -n "$cid" ] || return 0
  docker inspect -f '{{range .Mounts}}{{.Type}}|{{if eq .Type "volume"}}{{.Name}}{{else}}{{.Source}}{{end}}|{{.Destination}}{{"\n"}}{{end}}' "$cid" |
  while IFS='|' read -r type src dest; do
    [ -n "$src" ] || continue
    local name="${svc}$(printf '%s' "$dest" | tr '/' '_')"
    echo "==> Backup: $svc $dest ($type)"
    docker run --rm -v "$src:/data:ro" -v "$(pwd)/$BACKUP_DIR:/backup" \
      alpine tar czf "/backup/$name.tar.gz" -C /data .
  done
}
snapshot_mounts minio
snapshot_mounts backend
snapshot_mounts meeting-bot
# Raw postgres files only when there is no dump (a copy of a running database
# is not consistent, the dump is the real backup).
[ -f "$BACKUP_DIR/postgres.sql" ] || snapshot_mounts postgres

echo "$PREV_VERSION" > "$BACKUP_DIR/previous-version.txt"

# ---------------------------------------------------------------------------
# 2. Pull & restart with new version
# ---------------------------------------------------------------------------
# Remember the images that run now, by ID. A rollback restores exactly these,
# even when old and new version carry the same tag (latest, edge).
ROLLBACK_IMAGES=""
for svc in $SERVICES_TO_PULL; do
  # shellcheck disable=SC2086
  cid="$(docker compose $COMPOSE_PROFILE_ARGS -f "$COMPOSE_FILE" ps -q "$svc" 2>/dev/null | head -1)"
  [ -n "$cid" ] || continue
  ROLLBACK_IMAGES="$ROLLBACK_IMAGES $svc=$(docker inspect -f '{{.Image}}' "$cid")"
done
echo "$ROLLBACK_IMAGES" > "$BACKUP_DIR/previous-images.txt"

if [ -n "$REGISTRY_USER" ] && [ -n "$REGISTRY_TOKEN" ]; then
  echo "==> docker login $REGISTRY_HOST as $REGISTRY_USER"
  echo "$REGISTRY_TOKEN" | docker login "$REGISTRY_HOST" \
    -u "$REGISTRY_USER" --password-stdin >/dev/null
fi

echo "==> Pulling images for $VERSION"
# shellcheck disable=SC2086  # word-split COMPOSE_PROFILE_ARGS and SERVICES_TO_PULL intentionally
DOCUVAULT_VERSION="$VERSION" docker compose $COMPOSE_PROFILE_ARGS -f "$COMPOSE_FILE" pull $SERVICES_TO_PULL

echo "==> Restarting services"
# shellcheck disable=SC2086
DOCUVAULT_VERSION="$VERSION" docker compose $COMPOSE_PROFILE_ARGS -f "$COMPOSE_FILE" up -d

# ---------------------------------------------------------------------------
# 3. Health check (with rollback on failure)
# ---------------------------------------------------------------------------
echo "==> Polling $HEALTH_URL (up to ${HEALTH_TIMEOUT}s)"
DEADLINE=$(( $(date +%s) + HEALTH_TIMEOUT ))
ATTEMPT=0
HEALTHY=false
while true; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ -n "$HEALTH_HOST_HEADER" ]; then
    # -L: nginx-proxy answers plain http with a redirect to https once the cert exists.
    STATUS=$(curl -sSL -o /dev/null -w "%{http_code}" -m 5 -H "Host: $HEALTH_HOST_HEADER" "$HEALTH_URL" 2>/dev/null || echo "000")
  else
    STATUS=$(curl -sSL -o /dev/null -w "%{http_code}" -m 5 "$HEALTH_URL" 2>/dev/null || echo "000")
  fi
  echo "    attempt $ATTEMPT: HTTP $STATUS"
  if [ "$STATUS" = "200" ]; then
    HEALTHY=true
    break
  fi
  [ "$(date +%s)" -ge "$DEADLINE" ] && break
  sleep 3
done

if ! $HEALTHY; then
  echo "!!! Health check FAILED after ${HEALTH_TIMEOUT}s (last status: $STATUS)"
  echo "!!! Backend logs (last 80 lines):"
  docker compose -f "$COMPOSE_FILE" logs backend --tail=80 || true

  if [ -n "${ROLLBACK_IMAGES// /}" ]; then
    echo "!!! Rolling back to the images that ran before ($PREV_VERSION)"
    # The old images are re-tagged as :rollback under the image names the
    # compose file uses now, so this also works when they came from another
    # registry or carried the same tag as the failed version.
    for pair in $ROLLBACK_IMAGES; do
      svc="${pair%%=*}"
      # shellcheck disable=SC2086
      ref="$(docker inspect -f '{{.Config.Image}}' "$(docker compose $COMPOSE_PROFILE_ARGS -f "$COMPOSE_FILE" ps -a -q "$svc" | head -1)")"
      docker tag "${pair#*=}" "${ref%:*}:rollback"
    done
    # shellcheck disable=SC2086
    DOCUVAULT_VERSION=rollback docker compose $COMPOSE_PROFILE_ARGS -f "$COMPOSE_FILE" up -d --pull never $SERVICES_TO_PULL
    echo "!!! Rolled back: the images of $PREV_VERSION run as :rollback. Deploy a fixed version with ./deploy.sh <version>."
  else
    echo "!!! No previous version recorded — manual recovery required."
  fi
  echo "!!! Backups remain in $BACKUP_DIR"
  echo "!!! Restore postgres with:"
  echo "    docker compose -f $COMPOSE_FILE exec -T postgres psql -U $DB_USERNAME $DB_NAME < $BACKUP_DIR/postgres.sql"
  exit 1
fi

# ---------------------------------------------------------------------------
# 4. Persist new version + cleanup
# ---------------------------------------------------------------------------
echo "$VERSION" > "$STATE_FILE"

# Prune old backups beyond retention (keep the most recent BACKUP_RETAIN).
# Only folders this script created (<timestamp>-pre-<version>) are touched;
# anything else in ./backups was put there by hand and stays.
if [ -d ./backups ]; then
  # shellcheck disable=SC2012
  ls -1dt ./backups/[0-9]*-pre-*/ 2>/dev/null | tail -n +"$((BACKUP_RETAIN + 1))" | xargs -r rm -rf
fi

echo "==> Pruning dangling images"
docker image prune -f >/dev/null

echo "==> Deploy complete: $PREV_VERSION → $VERSION"
echo "    Backup: $BACKUP_DIR"
