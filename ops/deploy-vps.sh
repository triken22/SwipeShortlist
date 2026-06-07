#!/usr/bin/env bash
set -euo pipefail

APP_NAME="swipe-shortlist"
VPS="${VPS:-root@100.88.9.93}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/raumwerk_hetzner}"
REMOTE_REPO="/srv/codex/repos/${APP_NAME}"
REMOTE_DATA="/srv/codex/apps/${APP_NAME}/data"
REMOTE_ENV="/etc/codex/env.d/${APP_NAME}.env"

ssh -i "$SSH_KEY" "$VPS" "mkdir -p '$REMOTE_REPO' '$REMOTE_DATA' /etc/codex/env.d"
rsync -az --delete \
  --exclude '.git' \
  --exclude 'data' \
  --exclude 'node_modules' \
  -e "ssh -i $SSH_KEY" \
  ./ "$VPS:$REMOTE_REPO/"

ssh -i "$SSH_KEY" "$VPS" "cat > '$REMOTE_ENV' <<'ENV'
HOST=127.0.0.1
PORT=8092
NODE_ENV=production
SWIPE_DATA_DIR=/srv/codex/apps/swipe-shortlist/data
SWIPE_DB_PATH=/srv/codex/apps/swipe-shortlist/data/swipe-shortlist.sqlite
ENV
cp '$REMOTE_REPO/ops/swipe-shortlist.service' /etc/systemd/system/swipe-shortlist.service
systemctl daemon-reload
systemctl enable --now swipe-shortlist.service
systemctl restart swipe-shortlist.service
systemctl --no-pager --full status swipe-shortlist.service
curl -fsS http://127.0.0.1:8092/health"
