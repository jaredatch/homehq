#!/usr/bin/env bash
#
# Compare or push data/config.json to the droplet:
#
#     ./scripts/config-sync.sh          # what differs (default)
#     ./scripts/config-sync.sh push     # back up, push, restart, verify, roll back on failure
#     ./scripts/config-sync.sh env      # which .env KEY NAMES the droplet is missing
#
# diff and env exit 1 when they find drift, so either can gate a deploy.
#
# config.json is gitignored, so scripts/deploy.sh can't carry it. With one
# board that was a hand-edit nobody minded; with a board per screen it's the
# thing most likely to drift and hardest to notice, because a wrong config
# renders a screen that merely looks empty.
#
# Deliberately does NOT touch .env. The droplet's differs from yours on
# purpose (NEXT_PUBLIC_BASE_URL, for one), and overwriting it would take the
# site down in a way that isn't obvious from here. `env` reports key names
# only and never a value.
#
# Target host/key resolve the same way as deploy.sh:
#   1. a gitignored env file at private/deploy.env (sourced automatically), or
#   2. env vars:  HOMEHQ_HOST=homehq@<droplet-ip>  HOMEHQ_KEY=~/.ssh/homehq_deploy
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/private/deploy.env"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && source "$ENV_FILE"

HOST="${HOMEHQ_HOST:-homehq@your-droplet-ip}"
KEY="${HOMEHQ_KEY:-$HOME/.ssh/homehq_deploy}"
LOCAL="$ROOT/data/config.json"
REMOTE_DIR="~/homehq"

if [ "$HOST" = "homehq@your-droplet-ip" ]; then
  echo "[config-sync] no target set — create private/deploy.env or export HOMEHQ_HOST" >&2
  exit 1
fi
[ -f "$LOCAL" ] || { echo "[config-sync] no $LOCAL to compare" >&2; exit 1; }

ssh_do() { ssh -i "$KEY" -o IdentitiesOnly=yes "$HOST" "$@"; }

# PINs are printed to a terminal and pasted into issues. Show whether one
# CHANGED without ever showing what it is.
redact() {
  python3 - "$1" <<'PY'
import json, sys
def walk(node):
    if isinstance(node, dict):
        return {k: ('<pin>' if k == 'pin' and isinstance(v, str) else walk(v)) for k, v in node.items()}
    if isinstance(node, list):
        return [walk(v) for v in node]
    return node
try:
    data = json.load(open(sys.argv[1]))
except Exception as err:
    print(f'INVALID JSON: {err}', file=sys.stderr)
    sys.exit(2)
print(json.dumps(walk(data), indent=2, sort_keys=True))
PY
}

# Every dotted path whose PIN differs between the two files, by comparison
# only — the values themselves never leave this function.
pin_changes() {
  python3 - "$1" "$2" <<'PY'
import json, sys
a, b = (json.load(open(p)) for p in sys.argv[1:3])
def pins(node, path='', out=None):
    out = {} if out is None else out
    if isinstance(node, dict):
        for k, v in node.items():
            if k == 'pin' and isinstance(v, str):
                out[f'{path}.pin'] = v
            else:
                pins(v, f'{path}.{k}', out)
    return out
pa, pb = pins(a), pins(b)
for key in sorted(set(pa) | set(pb)):
    if pa.get(key) != pb.get(key):
        print(f'  PIN differs at {key.lstrip(".")}')
PY
}

case "${1:-diff}" in
  diff)
    echo "[config-sync] $HOST"
    REMOTE_FILE="$(mktemp)"
    trap 'rm -f "$REMOTE_FILE" "$REMOTE_FILE.norm" "$LOCAL.norm"' EXIT
    ssh_do "cat $REMOTE_DIR/data/config.json" > "$REMOTE_FILE"

    redact "$REMOTE_FILE" > "$REMOTE_FILE.norm"
    redact "$LOCAL" > "$LOCAL.norm"

    DRIFT=0
    diff -u --label droplet "$REMOTE_FILE.norm" --label local "$LOCAL.norm" || DRIFT=1
    PINS="$(pin_changes "$REMOTE_FILE" "$LOCAL")"
    if [ -n "$PINS" ]; then
      echo "$PINS"
      DRIFT=1
    fi
    [ "$DRIFT" = 0 ] && echo "[config-sync] identical"
    exit "$DRIFT"
    ;;

  push)
    # Fail here rather than on the droplet: the app refuses to boot on the
    # template PIN, and finding that out after the service has restarted means
    # every screen in the house is down while you work out why.
    python3 -c "
import json, sys
c = json.load(open('$LOCAL'))
bad = [n for n, p in [('auth', c['auth']['pin'])] + [(f'boards.{s}', b['pin']) for s, b in (c.get('boards') or {}).items() if 'pin' in b] if p == '123456']
if bad:
    sys.exit('[config-sync] refusing: template PIN 123456 still set at ' + ', '.join(bad))
" || exit 1

    STAMP="$(date +%Y%m%d-%H%M%S)"
    echo "[config-sync] → $HOST (backup config.json.bak-$STAMP)"
    scp -i "$KEY" -o IdentitiesOnly=yes "$LOCAL" "$HOST:$REMOTE_DIR/data/config.json.new"

    ssh_do "bash -s" <<EOF
set -euo pipefail
cd $REMOTE_DIR/data
cp config.json config.json.bak-$STAMP
mv config.json.new config.json
sudo systemctl restart homehq
EOF

    # The app validates config on first read, so a live request IS the check.
    # /login reads it too (it resolves which board a hostname belongs to).
    echo "[config-sync] verifying"
    CODE=000
    for _ in $(seq 1 10); do
      CODE=$(ssh_do "curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/login" || echo 000)
      [ "$CODE" = "200" ] && break
      sleep 1
    done

    if [ "$CODE" != "200" ]; then
      echo "[config-sync] ✗ app unhealthy ($CODE) — rolling back" >&2
      ssh_do "cd $REMOTE_DIR/data && mv config.json.bak-$STAMP config.json && sudo systemctl restart homehq"
      echo "[config-sync] rolled back. Check: ssh $HOST 'journalctl -u homehq -n 40'" >&2
      exit 1
    fi

    # Code deploys bump this themselves; a config-only change wouldn't, and a
    # kiosk open for days would keep showing the old settings.
    ssh_do "echo config-$STAMP > $REMOTE_DIR/data/deploy-version"
    echo "[config-sync] ✓ pushed — screens refresh within ~60s"
    ;;

  env)
    echo "[config-sync] .env key names on $HOST (values never read)"
    REMOTE_KEYS="$(ssh_do "grep -oE '^[A-Z_]+=' $REMOTE_DIR/.env 2>/dev/null | tr -d '='" | sort)"
    EXAMPLE_KEYS="$(grep -oE '^[A-Z_]+=' "$ROOT/.env.example" | tr -d '=' | sort)"

    MISSING="$(comm -13 <(echo "$REMOTE_KEYS") <(echo "$EXAMPLE_KEYS"))"
    EXTRA="$(comm -23 <(echo "$REMOTE_KEYS") <(echo "$EXAMPLE_KEYS"))"

    if [ -n "$MISSING" ]; then
      echo "  in .env.example but NOT on the droplet:"
      echo "$MISSING" | sed 's/^/    /'
    fi
    if [ -n "$EXTRA" ]; then
      # Not a problem in itself — the droplet legitimately carries keys the
      # example doesn't, and every optional key is fine to leave unset.
      echo "  on the droplet but not in .env.example:"
      echo "$EXTRA" | sed 's/^/    /'
    fi
    if [ -z "$MISSING$EXTRA" ]; then
      echo "  same keys on both sides"
      exit 0
    fi
    exit 1
    ;;

  *)
    echo "usage: $0 [diff|push|env]" >&2
    exit 1
    ;;
esac
