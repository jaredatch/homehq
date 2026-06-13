#!/usr/bin/env bash
#
# Deploy HomeHQ to the kitchen droplet from your Mac:
#
#     ./scripts/deploy.sh
#
# Pulls latest on the droplet, reinstalls deps, rebuilds, and restarts the
# systemd service (passwordless restart via the homehq sudoers rule). The build
# runs on the droplet — that's what the 2 GB swap is for.
#
# Override via env if needed:
#     HOMEHQ_HOST=homehq@REDACTED_IP  HOMEHQ_KEY=~/.ssh/homehq_deploy
set -euo pipefail

HOST="${HOMEHQ_HOST:-homehq@REDACTED_IP}"
KEY="${HOMEHQ_KEY:-$HOME/.ssh/homehq_deploy}"

echo "[deploy] → $HOST"
ssh -i "$KEY" -o IdentitiesOnly=yes "$HOST" 'bash -s' <<'EOF'
set -euo pipefail
cd ~/homehq
echo "[deploy] git pull";  git pull --ff-only
echo "[deploy] npm ci";    npm ci --no-audit --no-fund
echo "[deploy] build";     npm run build
echo "[deploy] restart";   sudo systemctl restart homehq
EOF

# Health check from here
sleep 2
CODE=$(ssh -i "$KEY" -o IdentitiesOnly=yes "$HOST" \
  "curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/login")
echo "[deploy] /login -> $CODE"
[ "$CODE" = "200" ] && echo "[deploy] ✓ done" || { echo "[deploy] ✗ app unhealthy"; exit 1; }
