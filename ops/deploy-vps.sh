#!/usr/bin/env bash
set -euo pipefail

APP_NAME="swipe-shortlist"
VPS="${VPS:-root@100.88.9.93}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/raumwerk_hetzner}"
SSH_STRICT="${SSH_STRICT:-accept-new}"
NODE_VERSION="${NODE_VERSION:-v24.10.0}"
ENABLE_PUBLIC_TUNNEL="${ENABLE_PUBLIC_TUNNEL:-0}"
DEPLOY_SHA="${DEPLOY_SHA:-$(git rev-parse --short=12 HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)}"

REMOTE_BASE="/srv/codex/repos/${APP_NAME}"
REMOTE_RELEASES="${REMOTE_BASE}/releases"
REMOTE_CURRENT="${REMOTE_BASE}/current"
REMOTE_RELEASE="${REMOTE_RELEASES}/${DEPLOY_SHA}"
REMOTE_APP="/srv/codex/apps/${APP_NAME}"
REMOTE_DATA="${REMOTE_APP}/data"
REMOTE_BACKUPS="${REMOTE_APP}/backups"
REMOTE_ENV="/etc/codex/env.d/${APP_NAME}.env"
REMOTE_NODE="/opt/codex/node-v24"

if [ ! -f "$SSH_KEY" ]; then
  echo "SSH key not found: $SSH_KEY" >&2
  exit 1
fi

SSH_OPTS=(-i "$SSH_KEY" -o IdentitiesOnly=yes -o "StrictHostKeyChecking=$SSH_STRICT")
RSYNC_SSH="ssh -i $SSH_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=$SSH_STRICT"

ssh "${SSH_OPTS[@]}" "$VPS" bash -s -- "$REMOTE_NODE" "$NODE_VERSION" <<'REMOTE'
set -euo pipefail
remote_node="$1"
node_version="$2"

mkdir -p /opt/codex
if [ ! -x "$remote_node/bin/node" ] || ! "$remote_node/bin/node" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' >/dev/null 2>&1; then
  arch="$(uname -m)"
  case "$arch" in
    x86_64) node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
  esac

  tmp="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/${node_version}/node-${node_version}-linux-${node_arch}.tar.xz" -o "$tmp/node.tar.xz"
  rm -rf "$remote_node"
  tar -xJf "$tmp/node.tar.xz" -C /opt/codex
  mv "/opt/codex/node-${node_version}-linux-${node_arch}" "$remote_node"
  rm -rf "$tmp"
fi

"$remote_node/bin/node" -e 'import("node:sqlite").then(() => console.log(process.version))'
REMOTE

ssh "${SSH_OPTS[@]}" "$VPS" "mkdir -p '$REMOTE_RELEASE' '$REMOTE_DATA' '$REMOTE_BACKUPS' /etc/codex/env.d"

rsync -az --delete --no-owner --no-group \
  --exclude ".git" \
  --exclude ".DS_Store" \
  --exclude ".playwright-cli" \
  --exclude ".playwright-mcp" \
  --exclude "data" \
  --exclude "node_modules" \
  --exclude "playwright-report" \
  --exclude "test-results" \
  -e "$RSYNC_SSH" \
  ./ "$VPS:$REMOTE_RELEASE/"

ssh "${SSH_OPTS[@]}" "$VPS" bash -s -- \
  "$APP_NAME" \
  "$REMOTE_RELEASE" \
  "$REMOTE_CURRENT" \
  "$REMOTE_DATA" \
  "$REMOTE_BACKUPS" \
  "$REMOTE_ENV" <<'REMOTE'
set -euo pipefail
app_name="$1"
remote_release="$2"
remote_current="$3"
remote_data="$4"
remote_backups="$5"
remote_env="$6"

previous="$(readlink -f "$remote_current" 2>/dev/null || true)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
database="$remote_data/${app_name}.sqlite"

mkdir -p "$remote_data" "$remote_backups" "$(dirname "$remote_env")"
if [ -f "$database" ]; then
  cp "$database" "$remote_backups/${app_name}-${timestamp}.sqlite"
fi

cat > "$remote_env" <<ENV
HOST=127.0.0.1
PORT=8092
NODE_ENV=production
PATH=/opt/codex/node-v24/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
SWIPE_DATA_DIR=$remote_data
SWIPE_DB_PATH=$database
ENV

chown -R root:root "$remote_release" "$remote_data" "$remote_backups"
ln -sfnT "$remote_release" "$remote_current"
cp "$remote_current/ops/swipe-shortlist.service" /etc/systemd/system/swipe-shortlist.service

rollback() {
  if [ -n "$previous" ] && [ -d "$previous" ]; then
    ln -sfnT "$previous" "$remote_current"
    systemctl restart swipe-shortlist.service || true
    echo "rolled_back_to=$previous" >&2
  fi
}

systemctl daemon-reload
systemctl enable swipe-shortlist.service
if ! systemctl restart swipe-shortlist.service; then
  rollback
  journalctl -u swipe-shortlist.service -n 80 --no-pager
  exit 1
fi

health_ok=0
for attempt in $(seq 1 30); do
  if health="$(curl -fsS http://127.0.0.1:8092/health 2>/dev/null)"; then
    printf '%s\n' "$health"
    health_ok=1
    break
  fi
  sleep 0.5
done

if [ "$health_ok" != "1" ]; then
  rollback
  journalctl -u swipe-shortlist.service -n 80 --no-pager
  exit 1
fi

if ss -ltnp | grep -Eq '(^|[[:space:]])(0\.0\.0\.0:8092|\[::\]:8092|:::8092)'; then
  rollback
  echo "Refusing deploy because service is publicly bound." >&2
  ss -ltnp | grep ':8092' >&2 || true
  exit 1
fi

if ! ss -ltnp | grep -q '127\.0\.0\.1:8092'; then
  rollback
  echo "Expected loopback listener 127.0.0.1:8092 was not found." >&2
  ss -ltnp | grep ':8092' >&2 || true
  exit 1
fi

test -w "$remote_data"
printf 'release=%s\n' "$remote_release"
REMOTE

if [ "$ENABLE_PUBLIC_TUNNEL" = "1" ]; then
  ssh "${SSH_OPTS[@]}" "$VPS" bash -s -- "$REMOTE_CURRENT" "$REMOTE_APP" <<'REMOTE'
set -euo pipefail
remote_current="$1"
remote_app="$2"

cp "$remote_current/ops/swipe-shortlist-tunnel.service" /etc/systemd/system/swipe-shortlist-tunnel.service
systemctl daemon-reload
systemctl enable --now swipe-shortlist-tunnel.service
sleep 8
url="$(journalctl -u swipe-shortlist-tunnel.service --no-pager | grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)"
if [ -n "$url" ]; then
  printf '%s\n' "$url" > "$remote_app/public-url.txt"
  printf 'public_url=%s\n' "$url"
else
  journalctl -u swipe-shortlist-tunnel.service -n 80 --no-pager
  exit 1
fi
REMOTE
fi
