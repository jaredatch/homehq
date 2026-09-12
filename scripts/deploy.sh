#!/usr/bin/env bash
#
# Deploy HomeHQ to your droplet from your Mac:
#
#     ./scripts/deploy.sh
#
# Builds the new version BESIDE the live tree, swaps it in with two renames,
# restarts, health-checks, and only then tells the kiosks to reload. Rolls the
# swap back if the new build doesn't come up.
#
# Why beside, not in place: `npm ci` and `next build` take a minute on a 1 GB
# droplet, and the running server reads `.next/` and `node_modules/` lazily.
# Rebuilding under it used to leave a ~60 s window where any page load got a
# bare "Internal Server Error" — and a kiosk that lands on that page is stuck,
# because the error page carries none of the JS that would reload it. Building
# in `~/homehq-build` and renaming the results in leaves the live tree intact
# until the swap, which takes milliseconds.
#
# The build runs on the droplet — that's what the swap partition is for.
#
# Set the target host/key one of two ways:
#   1. a gitignored env file at private/deploy.env (sourced automatically), or
#   2. env vars:  HOMEHQ_HOST=homehq@<droplet-ip>  HOMEHQ_KEY=~/.ssh/homehq_deploy
set -euo pipefail

# Local, gitignored overrides keep the origin IP out of the tracked script.
ENV_FILE="$(dirname "$0")/../private/deploy.env"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && source "$ENV_FILE"

HOST="${HOMEHQ_HOST:-homehq@your-droplet-ip}"
KEY="${HOMEHQ_KEY:-$HOME/.ssh/homehq_deploy}"

if [ "$HOST" = "homehq@your-droplet-ip" ]; then
  echo "[deploy] no target set — create private/deploy.env or export HOMEHQ_HOST (see header)" >&2
  exit 1
fi

ssh_do() { ssh -i "$KEY" -o IdentitiesOnly=yes "$HOST" "$@"; }

health() {
  ssh_do "curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/login" || echo 000
}

# /login reads config and resolves the board for the hostname, so a 200 there
# means the app booted, read its config, and is answering.
wait_healthy() {
  local code=000
  for _ in $(seq 1 20); do
    code="$(health)"
    [ "$code" = "200" ] && break
    sleep 1
  done
  echo "$code"
}

echo "[deploy] → $HOST"
ssh_do 'bash -s' <<'EOF'
set -euo pipefail
LIVE="$HOME/homehq"
BUILD="$HOME/homehq-build"

cd "$LIVE"
# Say which branch, every time. The droplet doesn't always sit on master —
# a feature branch can run in production for a while before it merges — and
# a silent pull is how you deploy the wrong one without noticing.
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "[deploy] branch:  $BRANCH"

# ---- 1. build beside the live tree -----------------------------------------
if [ ! -d "$BUILD/.git" ]; then
  echo "[deploy] first run: cloning a build tree at $BUILD"
  git clone -q "$(git remote get-url origin)" "$BUILD"
fi
cd "$BUILD"
echo "[deploy] git fetch"; git fetch -q origin
git checkout -q -B "$BRANCH" "origin/$BRANCH"
# Build-time inputs live in the live tree: NEXT_PUBLIC_* is inlined from .env
# at build, and data/ is whatever the build might read (config.json). Symlinks,
# so there is exactly one copy of each.
ln -sfn "$LIVE/.env" .env
ln -sfn "$LIVE/data" data
echo "[deploy] npm ci";    npm ci --no-audit --no-fund
echo "[deploy] build";     npm run build
NEW_SHA="$(git rev-parse --short HEAD)"

# ---- 2. swap ----------------------------------------------------------------
cd "$LIVE"
# The source tree follows so `git log` on the box tells the truth. The running
# server never reads source files, only .next/ and node_modules/.
echo "[deploy] git pull";  git pull -q --ff-only
LIVE_SHA="$(git rev-parse --short HEAD)"
if [ "$LIVE_SHA" != "$NEW_SHA" ]; then
  echo "[deploy] ✗ live tree is at $LIVE_SHA but the build is $NEW_SHA — not swapping" >&2
  exit 1
fi
rm -rf .next.prev node_modules.prev
mv .next .next.prev
mv "$BUILD/.next" .next
mv node_modules node_modules.prev
mv "$BUILD/node_modules" node_modules
echo "[deploy] swapped in $NEW_SHA"
echo "[deploy] restart";   sudo systemctl restart homehq
EOF

CODE="$(wait_healthy)"
echo "[deploy] /login -> $CODE"

if [ "$CODE" != "200" ]; then
  echo "[deploy] ✗ app unhealthy — rolling back to the previous build" >&2
  ssh_do 'bash -s' <<'EOF'
set -euo pipefail
cd "$HOME/homehq"
# Park the failed build where the next run will overwrite it, for a post-mortem.
rm -rf "$HOME/homehq-build/.next" "$HOME/homehq-build/node_modules"
mv .next "$HOME/homehq-build/.next"
mv node_modules "$HOME/homehq-build/node_modules"
mv .next.prev .next
mv node_modules.prev node_modules
sudo systemctl restart homehq
EOF
  CODE="$(wait_healthy)"
  echo "[deploy] rolled back, /login -> $CODE. Source tree is ahead of the running build;" >&2
  echo "[deploy] check: ssh $HOST 'journalctl -u homehq -n 40'" >&2
  exit 1
fi

# Only now does the kiosk learn there's a new build. Every board polls
# /api/version once a minute and hard-reloads when the token changes — so the
# token must not move until the server it will reload into is known good.
# Keeping the previous build's compile cache warm makes the next build faster.
ssh_do 'bash -s' <<'EOF'
set -euo pipefail
cd "$HOME/homehq"
git rev-parse --short HEAD > data/deploy-version
mkdir -p "$HOME/homehq-build/.next"
[ -d .next.prev/cache ] && mv .next.prev/cache "$HOME/homehq-build/.next/cache"
rm -rf .next.prev node_modules.prev
echo "[deploy] stamp $(cat data/deploy-version)"
EOF
echo "[deploy] ✓ done — screens refresh within ~60s"
