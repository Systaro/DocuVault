#!/usr/bin/env bash
set -euo pipefail

SERVER="root@docuvault.systaro.de"
REMOTE_DIR="/data/docuvault"

echo "Deploying DocuVault to production..."

ssh "$SERVER" "cd $REMOTE_DIR && git pull && docker compose build --no-cache && docker compose up -d"

echo "Deployment complete."
