#!/usr/bin/env bash
#
# Manage DNS for the HomeHQ domain in Cloudflare:
#
#     ./scripts/cf-dns.sh list                 # every A/AAAA/CNAME record in the zone
#     ./scripts/cf-dns.sh add kidb 203.0.113.7 # proxied A record for kidb.<zone>
#     ./scripts/cf-dns.sh add kidb             # same, reusing the IP an existing record points at
#
# A board needs a DNS record before its subdomain resolves; everything else
# (nginx, TLS) already handles unknown subdomains, so this is the one manual
# step per new screen. There's deliberately no `delete` — removing a record
# takes a screen off the network, and that should be a decision made in the
# dashboard where you can see what you're pointing at.
#
# Credentials come from a gitignored private/cloudflare.env:
#
#     CF_API_TOKEN=...        # Zone:DNS:Edit + Zone:Zone:Read, scoped to this zone
#     CF_ZONE=example.com     # the domain
#     CF_ZONE_ID=...          # optional; skips a lookup (Overview page, right column)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/private/cloudflare.env"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && source "$ENV_FILE"

if [ -z "${CF_API_TOKEN:-}" ]; then
  echo "[cf-dns] no CF_API_TOKEN — create $ENV_FILE (see the header of this script)" >&2
  exit 1
fi
if [ -z "${CF_ZONE:-}" ] && [ -z "${CF_ZONE_ID:-}" ]; then
  echo "[cf-dns] set CF_ZONE (and optionally CF_ZONE_ID) in $ENV_FILE" >&2
  exit 1
fi

API="https://api.cloudflare.com/client/v4"

cf() {
  local method="$1" path="$2" body="${3:-}"
  curl -sS -X "$method" "$API$path" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    ${body:+--data "$body"}
}

# Cloudflare answers 200 with success:false for most real errors, so every call
# has to look inside the body rather than trusting the status.
check() {
  python3 -c "
import json, sys
r = json.load(sys.stdin)
if not r.get('success'):
    msgs = '; '.join(e.get('message', str(e)) for e in (r.get('errors') or [])) or 'unknown error'
    sys.exit(f'[cf-dns] Cloudflare refused: {msgs}')
json.dump(r['result'], sys.stdout)
"
}

zone_id() {
  if [ -n "${CF_ZONE_ID:-}" ]; then
    echo "$CF_ZONE_ID"
    return
  fi
  # Needs Zone:Zone:Read on the token. Set CF_ZONE_ID instead if you'd rather
  # keep the token to DNS edit alone.
  cf GET "/zones?name=$CF_ZONE" | check | python3 -c "
import json, sys
zones = json.load(sys.stdin)
if not zones:
    sys.exit('[cf-dns] no zone named \"$CF_ZONE\" is visible to this token — check the scope, or set CF_ZONE_ID')
print(zones[0]['id'])
"
}

case "${1:-list}" in
  list)
    ZID="$(zone_id)"
    cf GET "/zones/$ZID/dns_records?per_page=200" | check | python3 -c "
import json, sys
rows = [r for r in json.load(sys.stdin) if r['type'] in ('A', 'AAAA', 'CNAME')]
if not rows:
    print('  (no address records)')
for r in sorted(rows, key=lambda r: r['name']):
    proxied = 'proxied' if r['proxied'] else 'DNS only'
    print(f\"  {r['name']:<34} {r['type']:<6} {r['content']:<24} {proxied}\")
"
    ;;

  add)
    NAME="${2:-}"
    [ -n "$NAME" ] || { echo "usage: $0 add <subdomain> [ip]" >&2; exit 1; }
    ZID="$(zone_id)"
    RECORDS="$(cf GET "/zones/$ZID/dns_records?per_page=200" | check)"

    IP="${3:-}"
    if [ -z "$IP" ]; then
      # Every board lives on the same droplet, so the common case is "the same
      # place everything else points" — and retyping an origin IP is how one
      # board ends up pointing somewhere else entirely.
      IP="$(echo "$RECORDS" | python3 -c "
import collections, json, sys
ips = collections.Counter(r['content'] for r in json.load(sys.stdin) if r['type'] == 'A')
if not ips:
    sys.exit('[cf-dns] no existing A record to copy an IP from — pass one explicitly')
if len(ips) > 1:
    sys.exit('[cf-dns] this zone points at more than one IP (' + ', '.join(sorted(ips)) + ') — pass one explicitly')
print(next(iter(ips)))
")"
      echo "[cf-dns] reusing $IP (the only IP this zone points at)"
    fi

    FQDN="$NAME.${CF_ZONE:-}"
    echo "$RECORDS" | python3 -c "
import json, sys
name = '$FQDN'
for r in json.load(sys.stdin):
    if r['name'] == name:
        sys.exit(f\"[cf-dns] {name} already exists ({r['type']} -> {r['content']}) — change it in the dashboard\")
"

    cf POST "/zones/$ZID/dns_records" \
      "$(python3 -c "
import json
print(json.dumps({
  'type': 'A',
  'name': '$NAME',
  'content': '$IP',
  # Proxied, like every other HomeHQ record: it's what keeps the origin IP off
  # public DNS and lets the edge terminate TLS for the subdomain.
  'proxied': True,
  'comment': 'HomeHQ board',
}))")" | check > /dev/null

    echo "[cf-dns] ✓ $FQDN -> $IP (proxied)"
    echo "[cf-dns] nginx and the origin cert already cover it; add the board to data/config.json with host: \"$FQDN\""
    ;;

  *)
    echo "usage: $0 [list|add <subdomain> [ip]]" >&2
    exit 1
    ;;
esac
