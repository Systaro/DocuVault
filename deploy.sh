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
#   docker-compose.yml (or set COMPOSE_FILE env var)
#   .env  (copy from .env.example and fill in values)
#
# The compose file must reference image tags via ${DOCUVAULT_VERSION},
# e.g.  image: ghcr.io/example/docuvault-backend:${DOCUVAULT_VERSION:-latest}
#
# Configurable env vars:
#   COMPOSE_FILE                compose file to use (default: docker-compose.yml)
#   HEALTH_URL                  URL to poll after restart (default: http://localhost:7030/api/actuator/health)
#   HEALTH_TIMEOUT              seconds to wait for health (default: 90)
#   BACKUP_RETAIN               number of recent backup folders to keep (default: 10)
#   DOCUVAULT_REGISTRY_HOST     image registry host (default: registry.git.systaro.de)
#   DOCUVAULT_REGISTRY_USER     deploy-token username for image pulls (optional;
#                               only needed if docker is not already logged in)
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

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
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
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$(pwd)" | tr '[:upper:]' '[:lower:]')}"

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
else
  echo "==> Backup: postgres not running (fresh install?), skipping dump"
fi

snapshot_volume() {
  local short="$1"
  local volume="${PROJECT_NAME}_${short}"
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    echo "==> Backup: $volume"
    docker run --rm \
      -v "${volume}:/data:ro" \
      -v "$(pwd)/$BACKUP_DIR:/backup" \
      alpine tar czf "/backup/${short}.tar.gz" -C /data .
  fi
}
snapshot_volume minio_data
snapshot_volume repos_data
snapshot_volume postgres_data  # raw fallback in case pg_dump above was skipped

echo "$PREV_VERSION" > "$BACKUP_DIR/previous-version.txt"

# ---------------------------------------------------------------------------
# 2. Pull & restart with new version
# ---------------------------------------------------------------------------
if [ -n "$REGISTRY_USER" ] && [ -n "$REGISTRY_TOKEN" ]; then
  echo "==> docker login $REGISTRY_HOST as $REGISTRY_USER"
  echo "$REGISTRY_TOKEN" | docker login "$REGISTRY_HOST" \
    -u "$REGISTRY_USER" --password-stdin >/dev/null
fi

echo "==> Pulling images for $VERSION"
DOCUVAULT_VERSION="$VERSION" docker compose -f "$COMPOSE_FILE" pull backend frontend

echo "==> Restarting backend and frontend"
DOCUVAULT_VERSION="$VERSION" docker compose -f "$COMPOSE_FILE" up -d

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
    STATUS=$(curl -sS -o /dev/null -w "%{http_code}" -m 5 -H "Host: $HEALTH_HOST_HEADER" "$HEALTH_URL" 2>/dev/null || echo "000")
  else
    STATUS=$(curl -sS -o /dev/null -w "%{http_code}" -m 5 "$HEALTH_URL" 2>/dev/null || echo "000")
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

  if [ "$PREV_VERSION" != "<none>" ] && [ -n "$PREV_VERSION" ]; then
    echo "!!! Rolling back to $PREV_VERSION"
    DOCUVAULT_VERSION="$PREV_VERSION" docker compose -f "$COMPOSE_FILE" pull backend frontend
    DOCUVAULT_VERSION="$PREV_VERSION" docker compose -f "$COMPOSE_FILE" up -d backend frontend
    echo "!!! Rolled back to $PREV_VERSION"
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

# Prune old backups beyond retention (keep most recent BACKUP_RETAIN folders)
if [ -d ./backups ]; then
  # shellcheck disable=SC2012
  ls -1dt ./backups/*/ 2>/dev/null | tail -n +"$((BACKUP_RETAIN + 1))" | xargs -r rm -rf
fi

echo "==> Pruning dangling images"
docker image prune -f >/dev/null

echo "==> Deploy complete: $PREV_VERSION → $VERSION"
echo "    Backup: $BACKUP_DIR"
