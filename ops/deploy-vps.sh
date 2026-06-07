#!/usr/bin/env bash
set -euo pipefail

APP_NAME="swipe-shortlist"
VPS="${VPS:-root@100.88.9.93}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/raumwerk_hetzner}"
NODE_VERSION="${NODE_VERSION:-v24.10.0}"
REMOTE_REPO="/srv/codex/repos/${APP_NAME}"
REMOTE_DATA="/srv/codex/apps/${APP_NAME}/data"
REMOTE_ENV="/etc/codex/env.d/${APP_NAME}.env"
REMOTE_NODE="/opt/codex/node-v24"

ssh -i "$SSH_KEY" "$VPS" "set -e
mkdir -p '$REMOTE_REPO' '$REMOTE_DATA' /etc/codex/env.d /opt/codex
if [ ! -x '$REMOTE_NODE/bin/node' ] || ! '$REMOTE_NODE/bin/node' -e 'process.exit(Number(process.versions.node.split(\".\")[0]) >= 24 ? 0 : 1)' >/dev/null 2>&1; then
  arch=\"\$(uname -m)\"
  case \"\$arch\" in
    x86_64) node_arch='x64' ;;
    aarch64|arm64) node_arch='arm64' ;;
    *) echo \"Unsupported architecture: \$arch\" >&2; exit 1 ;;
  esac
  tmp=\"\$(mktemp -d)\"
  curl -fsSL \"https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-\$node_arch.tar.xz\" -o \"\$tmp/node.tar.xz\"
  rm -rf '$REMOTE_NODE'
  tar -xJf \"\$tmp/node.tar.xz\" -C /opt/codex
  mv \"/opt/codex/node-$NODE_VERSION-linux-\$node_arch\" '$REMOTE_NODE'
  rm -rf \"\$tmp\"
fi
'$REMOTE_NODE/bin/node' -e 'import(\"node:sqlite\").then(() => console.log(process.version))'"
rsync -az --delete \
  --exclude '.git' \
  --exclude '.DS_Store' \
  --exclude '.playwright-cli' \
  --exclude '.playwright-mcp' \
  --exclude 'data' \
  --exclude 'node_modules' \
  --exclude 'playwright-report' \
  --exclude 'test-results' \
  -e "ssh -i $SSH_KEY" \
  ./ "$VPS:$REMOTE_REPO/"

ssh -i "$SSH_KEY" "$VPS" "cat > '$REMOTE_ENV' <<'ENV'
HOST=127.0.0.1
PORT=8092
NODE_ENV=production
PATH=/opt/codex/node-v24/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
SWIPE_DATA_DIR=/srv/codex/apps/swipe-shortlist/data
SWIPE_DB_PATH=/srv/codex/apps/swipe-shortlist/data/swipe-shortlist.sqlite
ENV
cp '$REMOTE_REPO/ops/swipe-shortlist.service' /etc/systemd/system/swipe-shortlist.service
systemctl daemon-reload
systemctl enable --now swipe-shortlist.service
systemctl restart swipe-shortlist.service
systemctl --no-pager --full status swipe-shortlist.service
for attempt in \$(seq 1 20); do
  if curl -fsS http://127.0.0.1:8092/health; then
    exit 0
  fi
  sleep 0.5
done
journalctl -u swipe-shortlist.service -n 80 --no-pager
exit 1"
