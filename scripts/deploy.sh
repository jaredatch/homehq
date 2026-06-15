#!/usr/bin/env bash
#
# Deploy HomeHQ to your droplet from your Mac:
#
#     ./scripts/deploy.sh
#
# Pulls latest on the droplet, reinstalls deps, rebuilds, and restarts the
# systemd service (passwordless restart via the homehq sudoers rule). The build
# runs on the droplet — that's what the swap is for.
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

echo "[deploy] → $HOST"
ssh -i "$KEY" -o IdentitiesOnly=yes "$HOST" 'bash -s' <<'EOF'
set -euo pipefail
cd ~/homehq
echo "[deploy] git pull";  git pull --ff-only
echo "[deploy] npm ci";    npm ci --no-audit --no-fund
echo "[deploy] build";     npm run build
# Stamp the build token the kiosk polls — a changed SHA hard-reloads the wall
# display within a poll interval, so deploys take effect without touching the Pi.
echo "[deploy] stamp";     git rev-parse --short HEAD > data/deploy-version
echo "[deploy] restart";   sudo systemctl restart homehq
EOF

# Health check from here
sleep 2
CODE=$(ssh -i "$KEY" -o IdentitiesOnly=yes "$HOST" \
  "curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/login")
echo "[deploy] /login -> $CODE"
[ "$CODE" = "200" ] && echo "[deploy] ✓ done" || { echo "[deploy] ✗ app unhealthy"; exit 1; }
