#!/usr/bin/env bash
#
# Force the wall kiosk to hard-refresh — without touching the Pi:
#
#     ./scripts/kiosk-reload.sh
#
# Bumps the build token the dashboard polls (lib/version.ts); the kiosk reloads
# itself within one poll interval (~60s). Use this after a config-only change
# (config.json) that doesn't rebuild — code deploys already bump the token, so
# scripts/deploy.sh refreshes the wall on its own.
#
# Target host/key resolve the same way as deploy.sh:
#   1. a gitignored env file at private/deploy.env (sourced automatically), or
#   2. env vars:  HOMEHQ_HOST=homehq@<droplet-ip>  HOMEHQ_KEY=~/.ssh/homehq_deploy
set -euo pipefail

ENV_FILE="$(dirname "$0")/../private/deploy.env"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && source "$ENV_FILE"

HOST="${HOMEHQ_HOST:-homehq@your-droplet-ip}"
KEY="${HOMEHQ_KEY:-$HOME/.ssh/homehq_deploy}"

if [ "$HOST" = "homehq@your-droplet-ip" ]; then
  echo "[kiosk-reload] no target set — create private/deploy.env or export HOMEHQ_HOST" >&2
  exit 1
fi

echo "[kiosk-reload] → $HOST"
ssh -i "$KEY" -o IdentitiesOnly=yes "$HOST" \
  'echo "manual-$(date +%s)" > ~/homehq/data/deploy-version && echo "[kiosk-reload] bumped to $(cat ~/homehq/data/deploy-version)"'
echo "[kiosk-reload] ✓ kiosk will refresh within ~60s"
