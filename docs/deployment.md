# Deployment

Two pieces: a **server** (DigitalOcean droplet) running the Next.js app, and a **display
client** (Raspberry Pi) pointing Chromium at it in kiosk mode.

> Written generically. Replace `your-domain.com` and `<ip>` with your own; for multiple
> displays, give each a subdomain (`<room>.your-domain.com`). Any small VPS works; the steps
> assume Ubuntu on a DigitalOcean droplet because that's what this was tested on.

## Server (DigitalOcean droplet)

### Requirements

- A 1 GB droplet ($6/mo Basic) is enough. Ubuntu LTS. **Add swap before the first build**
  (see Initial setup); `next build` can run a 1 GB box out of memory without it.
- A domain (or subdomain) pointed at the droplet. You need it for SSL, which Google OAuth
  redirect URIs effectively require in production.
- Node.js 24 (current Active LTS; Node 20 reached end of life in April 2026). Install via
  [NodeSource](https://github.com/nodesource/distributions) or `nvm`.

### Initial setup

```bash
# On a 1 GB droplet, add 2 GB swap first: npm ci + next build can spike past 1 GB.
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# As a non-root user (e.g. `homehq`)
git clone <your-repo-url> ~/homehq
cd ~/homehq
npm ci

# Config + secrets
cp data/config.example.json data/config.json   # then edit: calendars, lat/long, PIN
cp .env.example .env                            # then edit (see below)

npm run build
```

`.env` for production:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
COOKIE_SECRET=<openssl rand -hex 32, a NEW one for prod>
NEXT_PUBLIC_BASE_URL=https://your-domain.com
```

Add `https://your-domain.com/api/oauth/callback` to the OAuth client's authorized redirect
URIs in Google Cloud Console (you can keep the localhost one for dev).

### Display options (`data/config.json`)

The `display` block holds optional presentation settings. All have defaults, so set only what
you want to change. The full list is in [configuration.md](configuration.md); the ones that
matter for a wall display:

- `timezone`: IANA zone (e.g. `"America/Chicago"`) for the clock and event times. The app
  formats via `Intl` in this zone, **independent of the host/kiosk OS clock**. Set it and the
  wall display is correct even if the Pi's system time zone is wrong. Omit to use the browser's
  local zone.
- `weatherIcons`: `"lucide"` (default; self-hosted line-art SVGs that render reliably on the
  Pi) · `"meteocons"` (color) · `"weather-icons"` · `"emoji"` (needs a color-emoji font like
  `fonts-noto-color-emoji` installed on the Pi).
- `todayColor`: accent color for today's marker dot (any CSS color; default blue).
- `weekStartsOn`: `"monday"` (default) or `"sunday"`.

### Hardening

Worth doing on any box that faces the internet, even behind Cloudflare:

- **Swap:** 2 GB swapfile + `vm.swappiness=10`, persisted in `/etc/fstab` and `/etc/sysctl.d/99-homehq.conf`.
- **Users:** the app runs as an unprivileged **`homehq`** user; **`ubuntu`** is the admin / break-glass user. `homehq` has only a _narrow_ `NOPASSWD` sudoers rule for `systemctl {restart,start,stop,status} homehq` (`/etc/sudoers.d/homehq`) and no general sudo.
- **SSH:** key-only (`PasswordAuthentication no`), **`PermitRootLogin no`**, `KbdInteractiveAuthentication no`, `X11Forwarding no` via `/etc/ssh/sshd_config.d/99-homehq-hardening.conf`. **Connect as `ssh ubuntu@<ip>`; root SSH is closed.** Validate any change with `sshd -t` before `systemctl reload ssh`, and keep a second session open.
- **Firewall:** `ufw` default-deny inbound, allowing only 22 / 80 / 443 (v4 + v6).
- **fail2ban:** sshd jail on the systemd/journald backend (Ubuntu 24.04 logs auth to the journal, not `/var/log/auth.log`, so `backend = systemd` in `/etc/fail2ban/jail.local` is required).
- **Auto-updates:** `unattended-upgrades` (security patches). Already enabled on the DO image; leave it on.
- **Keys:** a dedicated deploy key (`~/.ssh/homehq_deploy` on your machine) authorizes `scripts/deploy.sh` as `homehq`; personal keys stay on `ubuntu`. If your fork is private, the droplet also needs a read-only GitHub deploy key for `git pull`.

### systemd service

`/etc/systemd/system/homehq.service`:

```ini
[Unit]
Description=HomeHQ family dashboard
After=network.target

[Service]
Type=simple
User=homehq
Group=homehq
WorkingDirectory=/home/homehq/homehq
# Run the Next binary directly (not `npm run start`) so systemd delivers SIGTERM
# straight to Node for a clean shutdown. Bind localhost; nginx fronts it.
ExecStart=/home/homehq/homehq/node_modules/.bin/next start -H 127.0.0.1 -p 3000
Restart=always
RestartSec=5
Environment=NODE_ENV=production
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now homehq
sudo systemctl status homehq        # check it's running
journalctl -u homehq -f             # tail logs (sync output shows here)
```

### Nginx + TLS (Cloudflare-proxied)

This setup puts the droplet behind **Cloudflare** (proxied / orange-cloud), which hides the
origin IP and adds a WAF for free. TLS is terminated twice: browsers get Cloudflare's edge cert
automatically, and Cloudflare → origin uses a **Cloudflare Origin CA certificate** on the
droplet with SSL mode **Full (strict)**. No Let's Encrypt/certbot: a proxied record fails the
HTTP-01 challenge anyway, and an Origin CA cert is valid 15 years with nothing to renew. Not
using Cloudflare? See the end of this section.

```bash
sudo apt install nginx        # no certbot needed when proxied through Cloudflare
```

**1. Origin cert.** Cloudflare → SSL/TLS → Origin Server → Create Certificate (a wildcard like
`*.your-domain.com, your-domain.com` covers every room subdomain with one cert). Save the two PEM blocks
to the droplet, then set SSL mode to **Full (strict)** in the Cloudflare dashboard:

```
/etc/ssl/cloudflare/homehq-origin.pem   # cert  (root, 644)
/etc/ssl/cloudflare/homehq-origin.key   # key   (root, 600)
```

**2. Real visitor IP.** Behind Cloudflare, `$remote_addr` is a Cloudflare edge IP, which would
collapse the PIN rate-limiter to a single key for everyone. Restore the true client IP from the
`CF-Connecting-IP` header, trusting **only** Cloudflare's published ranges (regenerate if CF
changes them):

```bash
{ curl -fsSL https://www.cloudflare.com/ips-v4 | sed 's/^/set_real_ip_from /; s/$/;/'
  curl -fsSL https://www.cloudflare.com/ips-v6 | sed 's/^/set_real_ip_from /; s/$/;/'
  echo 'real_ip_header CF-Connecting-IP;'; } | sudo tee /etc/nginx/snippets/cloudflare-realip.conf
```

**3. Vhost** `/etc/nginx/sites-available/homehq`. Port 80 redirects to 443; 443 proxies the app:

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 301 https://your-domain.com$request_uri;
}

server {
    listen 443 ssl http2 default_server;
    listen [::]:443 ssl http2 default_server;
    server_name your-domain.com;

    ssl_certificate     /etc/ssl/cloudflare/homehq-origin.pem;
    ssl_certificate_key /etc/ssl/cloudflare/homehq-origin.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    include /etc/nginx/snippets/cloudflare-realip.conf;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        # X-Real-IP = real visitor (real_ip restores it from CF-Connecting-IP). NEVER use
        # $proxy_add_x_forwarded_for: the PIN limiter keys on X-Real-IP and a client could
        # otherwise spoof it to dodge rate-limiting.
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/homehq /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

**Not using Cloudflare's proxy?** If you point DNS straight at the droplet (DNS-only /
grey-cloud), skip the Origin cert and use Let's Encrypt instead:
`sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d <host>` (HTTP-01
works because the record resolves to the droplet, and it auto-renews).

### First run

1. Visit `https://your-domain.com` → PIN screen. Enter your PIN.
2. Go to `https://your-domain.com/setup` → Connect Google Calendar.
3. Within ~5 minutes the calendar grid populates; weather appears within ~30 seconds.

> Shortcut: if you've already connected Google in dev with the same OAuth client, you can
> skip step 2 by copying a consistent snapshot of the dev DB to the droplet
> (`sqlite3 data/homehq.db ".backup seed.db"`, scp, drop in place). The refresh token works
> from either machine. `/setup` is still there if it's ever revoked.

### Updating

```bash
cd ~/homehq
git pull
npm ci
npm run build
git rev-parse --short HEAD > data/deploy-version   # so the kiosk auto-refreshes (see below)
sudo systemctl restart homehq
```

### Deploying updates with a script

`scripts/deploy.sh` does this. Run `./scripts/deploy.sh` from your machine. It SSHes in as
`homehq`, pulls, `npm ci`, rebuilds on the droplet (that's what the swap is for), restarts the
service, and health-checks `/login`. It reads the target from `HOMEHQ_HOST` / `HOMEHQ_KEY`, or
from a gitignored `private/deploy.env` (see the script header). Two prerequisites make it
non-interactive:

- **Passwordless restart**, so the deploy doesn't stall on a sudo password prompt. Add a
  narrow rule via `sudo visudo -f /etc/sudoers.d/homehq`:
  ```
  homehq ALL=(root) NOPASSWD: /usr/bin/systemctl restart homehq
  ```
  (Or run HomeHQ as a systemd **user service** and skip sudo entirely.)
- **Repo pull access on the droplet.** HTTPS works for the public repo; a private fork needs a
  read-only deploy key.

This script is also the reusable core if you later want **GitHub Actions** deploys
(tag/release → CI runs the same script over SSH); the workflow is just a trigger around it.
Start with the script; graduate to Actions only if you want deploys to run without your machine,
gate them on tests, or hand deploy access to someone else.

### Refreshing the wall display

The dashboard is a single-page app, so a deploy ships new code to the server but a kiosk
that's already open keeps running the bundle it loaded at boot. To close that gap, `deploy.sh`
stamps the deployed commit into `data/deploy-version`, and the dashboard polls `/api/version`
once a minute and hard-reloads itself when that token changes. A normal deploy reaches the wall
on its own within a minute, without touching the Pi.

One catch the first time: a kiosk already running an _older_ build has no version check yet, so
it needs a single manual reload (or reboot) to pick up the self-updating bundle. Every deploy
after that is hands-off.

For a config-only change (you edited `data/config.json` but didn't redeploy code, so the
commit token didn't move), run `./scripts/kiosk-reload.sh` from your machine to bump the token by
hand and trigger the same refresh. (Config edits are also picked up by the server itself within
a minute; the reload is for the already-open browser.)

### Pushing config

`data/config.json` is gitignored, so `deploy.sh` can't carry it. With one screen that's a hand
edit over SSH. With a board per screen it's the file most likely to drift, and a wrong board
config renders a screen that merely looks empty.

`scripts/config-sync.sh` closes that gap. It reads the same `HOMEHQ_HOST` / `HOMEHQ_KEY` as
`deploy.sh`:

| Command                         | What it does                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `./scripts/config-sync.sh`      | Diffs your local config against the droplet's. PIN values are never printed, only whether one differs. Exits 1 on drift.                  |
| `./scripts/config-sync.sh push` | Backs up the remote config, pushes yours, restarts, and checks `/login`. If the app doesn't come back it restores the backup and exits 1. |
| `./scripts/config-sync.sh env`  | Compares `.env` key _names_ against `.env.example` so you can spot one you forgot to set. It never reads a value.                         |

`push` deliberately leaves `.env` alone. The droplet's differs from yours on purpose
(`NEXT_PUBLIC_BASE_URL`, for one), and overwriting it takes the site down in a way that isn't
obvious from your machine.

The validation is the app's own: config is checked on load, so a live request after the restart
is a real test of the file you just pushed. That's why a failure rolls back rather than leaving
you to notice later.

### Adding a screen

A new board is a `boards` block in `config.json` and a DNS record. Nginx and TLS already handle
unknown subdomains, so nothing on the droplet changes.

1. Add the board to your local `config.json` (see
   [configuration.md](configuration.md#boards)). Give it a `host`, its own `pin`, and the
   calendars it should see. A calendar marked `hidden` syncs but reaches only a board that names
   it, which is how a private room calendar stays off the kitchen wall.
2. Point the subdomain at the droplet: `./scripts/cf-dns.sh add kidb`, which reuses the IP an
   existing record points at, or pass one explicitly. `list` shows the zone. Credentials live in
   a gitignored `private/cloudflare.env` (a `Zone:DNS:Edit` + `Zone:Zone:Read` token, the zone
   name, and optionally the zone id). There is deliberately no `delete`: taking a screen off the
   network should be a decision made where you can see what you're pointing at.
3. `./scripts/config-sync.sh push`. It backs up, restarts, health-checks, and rolls back if the
   new config doesn't boot.
4. Point the screen at `https://<host>/` and enter that board's PIN once.

`/b/<slug>` works without any DNS at all, so a panel on the LAN can use
`http://homehq.local:3000/b/kidb` and skip steps 2 and 4's hostname entirely.

### Backups

Everything worth backing up lives in three files: `data/homehq.db` (the OAuth refresh token

- cached events), `data/config.json`, and `.env`. Losing the DB only costs the Google
  connection (reconnect at `/setup`) and cached data, which rebuilds itself; losing `.env` means
  re-creating credentials. Low stakes, but cheap to automate.

The DB runs in WAL mode, so never `cp homehq.db`: recent writes live in the `-wal` file and a
plain copy silently drops them. Use sqlite's online `.backup`, which folds the WAL into a
single consistent file while the app keeps running. Needs the `sqlite3` CLI (`apt install
sqlite3`).

A daily systemd timer handles it. `/home/homehq/backups/backup.sh` (owned `homehq`, mode 700):

```bash
#!/usr/bin/env bash
set -euo pipefail
APP_DIR="/home/homehq/homehq"; DATA_DIR="$APP_DIR/data"
BACKUP_DIR="/home/homehq/backups"; KEEP=7

ts="$(date +%Y%m%d-%H%M%S)"; work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
sqlite3 "$DATA_DIR/homehq.db" ".backup '$work/homehq.db'"
[ "$(sqlite3 "$work/homehq.db" 'PRAGMA integrity_check;')" = "ok" ] || { echo "integrity FAILED" >&2; exit 1; }
cp "$DATA_DIR/config.json" "$work/config.json"; cp "$APP_DIR/.env" "$work/.env"
archive="$BACKUP_DIR/homehq-backup-$ts.tar.gz"
tar -czf "$archive" -C "$work" homehq.db config.json .env; chmod 600 "$archive"
ls -1t "$BACKUP_DIR"/homehq-backup-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
```

`/etc/systemd/system/homehq-backup.service` (oneshot, runs as `homehq`):

```ini
[Unit]
Description=HomeHQ backup (online sqlite .backup + config.json + .env, keep last 7)
After=homehq.service

[Service]
Type=oneshot
User=homehq
Group=homehq
ExecStart=/home/homehq/backups/backup.sh
```

`/etc/systemd/system/homehq-backup.timer` (daily, catches up after downtime):

```ini
[Unit]
Description=Daily HomeHQ backup

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now homehq-backup.timer
sudo systemctl start homehq-backup.service       # run once now to verify
systemctl list-timers homehq-backup.timer        # confirm the next run
```

Each run bundles one timestamped `homehq-backup-<ts>.tar.gz` (mode 600) into
`/home/homehq/backups/` and prunes to the newest 7. Backups stay on the same droplet, which is fine
for the dominant failure mode (a bad write/migration); off-box copies are a future nicety.
To restore: `tar -xzf homehq-backup-<ts>.tar.gz`, stop `homehq`, drop the files back in
(clear any stale `homehq.db-wal`/`-shm` first), restart.

## Display client (Raspberry Pi)

Raspberry Pi OS (64-bit, **with desktop**) + Chromium in kiosk mode.

### Hardware

- A **Raspberry Pi 5** with the official **27 W USB-C PSU** (don't power it from the monitor;
  use the dedicated supply for stable peripherals). Older Pis work, but the Pi 5 drives 4K@60
  comfortably.
- A **micro-HDMI → HDMI** cable to your display. The Pi 5 outputs video only over its
  **micro-HDMI** ports (its USB-C port is power _in_, not video), so drive the panel over its
  HDMI input. A 27" 4K panel is what this UI is tuned for, but it scales to other sizes.
- A USB/Bluetooth **keyboard with trackpad** for the one-time PIN entry, any debugging, and
  adding events from the wall if you enable write access.

### Flashing the image

Use **Raspberry Pi Imager**. Choose _Raspberry Pi OS (64-bit)_. Before writing,
open the **settings (gear)** and pre-configure. This is what lets you finish from your machine
over SSH instead of fumbling at the monitor:

- **Hostname**, e.g. `homehq-kiosk` (gives you `homehq-kiosk.local` for SSH)
- **Enable SSH**
- **Username / password**
- **Wi-Fi**: your network + country code
- **Locale / timezone**: sets the OS clock. Note the _dashboard_ clock is driven by
  `display.timezone` in `config.json` (see Display options), so it stays correct even if the OS
  zone is wrong. That's how the kiosk clock is pinned.

First boot, then update:

```bash
sudo apt update && sudo apt full-upgrade -y
sudo reboot
```

### Dual Wi-Fi (two networks)

Bookworm manages Wi-Fi with **NetworkManager**, which auto-connects to whichever _saved_
network is in range, with no detection logic to write. The Imager seeds your first network; add a
second as another saved profile. You can add it **while out of range**; the profile just
waits until that network is reachable:

```bash
sudo nmcli connection add type wifi con-name home ssid "HOME_SSID" \
  wifi-sec.key-mgmt wpa-psk wifi-sec.psk "HOME_PASSWORD"
nmcli connection show          # verify both profiles are saved
```

Both stay saved; the Pi connects to whichever it sees at boot, so it "just works" when you
move it between locations. (If both were ever in range at once, break the tie with
`nmcli connection modify home connection.autoconnect-priority 10`.)

### Kiosk autostart

Point this at your **dev machine's server** while testing (see _Testing on the Pi_ below), then
swap the URL to your production domain once the droplet is live. That one line is the only
difference between a test setup and the wall.

For Raspberry Pi OS Bookworm+ (Wayland/labwc, the default on Pi 5), add to
`~/.config/labwc/autostart`. **Heads-up on the binary name:** it's `chromium-browser` on
Bookworm but **`chromium` on Debian 13 / trixie**. Call the wrong one and the kiosk fails
silently and you land on the bare desktop. This picks whichever exists:

```bash
CHROMIUM="$(command -v chromium-browser || command -v chromium)"
"$CHROMIUM" --kiosk --noerrdialogs --disable-infobars \
  --disable-session-crashed-bubble --force-device-scale-factor=2 https://your-domain.com &
```

On older X11-based images, use `~/.config/lxsession/LXDE-pi/autostart` instead (swap in
`chromium` if that's what your image ships):

```
@chromium-browser --kiosk --noerrdialogs --disable-infobars https://your-domain.com
```

### Display tuning on the 4K panel

A 27" 4K panel is 3840×2160 at ~163 PPI, and Raspberry Pi OS doesn't scale the
desktop the way macOS does, so at native resolution everything renders physically small.
**Keep the resolution at native 4K** (lowering it just blurs the image and fits fewer
events); size things up with scaling instead:

- **Dashboard size.** `--force-device-scale-factor` on the Chromium launch (above) scales
  the _page_ while keeping 4K crispness. `2` ≈ a 1920-wide layout; `1.5` is denser (more
  events, smaller text). Tune it on the wall; that's what the dev-server test loop is for.
- **Mouse cursor.** The scale factor does **not** affect the OS cursor, which is
  microscopic at 4K. Enlarge it by setting `XCURSOR_SIZE` in `~/.config/labwc/environment`,
  then reboot:
  ```
  XCURSOR_SIZE=48
  ```
  Bump to 64–96 to make it really obvious. This matters now that the dashboard is interactive
  (add / edit / delete events via the wall's trackpad when `calendarAccess` is `readwrite`). For a
  pure read-only display you may instead prefer to hide it.
- **Black desktop background.** Set the wallpaper to solid black (Appearance Settings →
  Desktop) so any flash during boot or before Chromium loads is black, not white, on the wall.

### Testing on the Pi before the server exists

You can demo the in-progress app on the real monitor _before_ the droplet is provisioned, with
no DigitalOcean, no domain, no PIN/OAuth setup required:

1. On your dev machine, run the dev server with the auth bypass enabled:

   ```bash
   DEV_AUTH_BYPASS=1 npm run dev
   ```

   `next dev` listens on all interfaces and prints a `Network: http://192.168.x.x:3000`
   line; that's the URL the Pi uses. Add the Pi's hostname or IP to `HOMEHQ_DEV_ORIGINS` in
   `.env` so hot-reload assets are allowed through, and open the port in your machine's
   firewall if the Pi can't connect. The bypass is ignored in production builds, so it can't
   leak past local dev (`proxy.ts`).

2. Point the kiosk Chromium at `http://<your-dev-machine-LAN-IP>:3000`.

The Pi now renders the live app at real size and distance with the real keyboard, while the
app is still being tweaked. When the droplet is up, change the autostart URL to
`https://your-domain.com`; nothing else about the Pi changes.

### Disable screen blanking

```bash
sudo raspi-config   # Display Options → Screen Blanking → Off
```

### First login on the kiosk

Enter the PIN once with a keyboard. The session cookie renews itself on use (sliding
renewal), so an always-on display stays logged in indefinitely.

### Recovery behaviors worth knowing

- **Server reboot / app restart:** the dashboard keeps polling and recovers on its own.
- **Google API outage or auth failure:** cached events keep displaying; the sync indicator
  (bottom-right) turns amber with the failure reason instead of blanking the screen.
- **Pi power loss:** it boots straight back into the kiosk.
