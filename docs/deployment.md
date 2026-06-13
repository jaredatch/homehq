# HomeHQ — Deployment Guide

Two pieces: a **server** (DigitalOcean droplet) running the Next.js app, and a **display
client** (Raspberry Pi) pointing Chromium at it in kiosk mode.

> **Current status (2026-06-13):** the kitchen droplet is **live at https://your-domain.com**
> (DigitalOcean `REDACTED_IP`, Cloudflare-proxied). Admin via `ssh ubuntu@REDACTED_IP`
> (root SSH is disabled); deploy with `./scripts/deploy.sh` from the Mac. The sections below are
> the reusable runbook — replicate them for future room droplets (`<room>.homehq.dev`).

## Server (DigitalOcean droplet)

### Requirements

- A 1 GB droplet ($6/mo Basic) is enough. Ubuntu LTS. **Add swap before the first build**
  (see Initial setup) — `next build` can run a 1 GB box out of memory without it.
- A domain (or subdomain) pointed at the droplet — required for SSL, which Google OAuth
  redirect URIs effectively require in production.
- Node.js 24 (current Active LTS — Node 20 reached end-of-life in April 2026). Install via
  [NodeSource](https://github.com/nodesource/distributions) or `nvm`.

### Initial setup

```bash
# On a 1 GB droplet, add 2 GB swap first — npm ci + next build can spike past 1 GB.
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
COOKIE_SECRET=<openssl rand -hex 32 — generate a NEW one for prod>
NEXT_PUBLIC_BASE_URL=https://your-domain.com
```

Add `https://your-domain.com/api/oauth/callback` to the OAuth client's authorized redirect
URIs in Google Cloud Console (you can keep the localhost one for dev).

### Hardening (applied to the live kitchen droplet)

Done beyond the basic setup above — replicate for future room droplets:

- **Swap:** 2 GB swapfile + `vm.swappiness=10`, persisted in `/etc/fstab` and `/etc/sysctl.d/99-homehq.conf`.
- **Users:** the app runs as an unprivileged **`homehq`** user; **`ubuntu`** is the admin / break-glass user. `homehq` has only a *narrow* `NOPASSWD` sudoers rule for `systemctl {restart,start,stop,status} homehq` (`/etc/sudoers.d/homehq`) — no general sudo.
- **SSH:** key-only (`PasswordAuthentication no`), **`PermitRootLogin no`**, `KbdInteractiveAuthentication no`, `X11Forwarding no` via `/etc/ssh/sshd_config.d/99-homehq-hardening.conf`. **Connect as `ssh ubuntu@<ip>` — root SSH is closed.** Validate any change with `sshd -t` before `systemctl reload ssh`, and keep a second session open.
- **Firewall:** `ufw` default-deny inbound, allowing only 22 / 80 / 443 (v4 + v6).
- **fail2ban:** sshd jail on the systemd/journald backend (Ubuntu 24.04 logs auth to the journal, not `/var/log/auth.log`, so `backend = systemd` in `/etc/fail2ban/jail.local` is required).
- **Auto-updates:** `unattended-upgrades` (security patches) — already enabled on the DO image; left on.
- **Keys:** a dedicated `homehq-deploy` key authorizes automation; the droplet holds a read-only **GitHub deploy key** for `git pull` of the private repo. Personal keys stay on `ubuntu`; the stale `openclaw-deploy-*` key was removed from `root` and `ubuntu`.

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
# straight to Node for a clean shutdown. Bind localhost — nginx fronts it.
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

The kitchen droplet sits behind **Cloudflare** (proxied / orange-cloud). TLS is terminated
twice: browsers get Cloudflare's edge cert automatically, and Cloudflare → origin uses a
**Cloudflare Origin CA certificate** on the droplet with SSL mode **Full (strict)**. No
Let's Encrypt/certbot — a proxied record fails the HTTP-01 challenge anyway, and an Origin CA
cert is valid 15 years with nothing to renew.

```bash
sudo apt install nginx        # no certbot needed when proxied through Cloudflare
```

**1. Origin cert.** Cloudflare → SSL/TLS → Origin Server → Create Certificate (the default
`*.homehq.dev, homehq.dev` covers every room subdomain with one cert). Save the two PEM blocks
to the droplet, then set SSL mode to **Full (strict)** in the Cloudflare dashboard:

```
/etc/ssl/cloudflare/homehq-origin.pem   # cert  (root, 644)
/etc/ssl/cloudflare/homehq-origin.key   # key   (root, 600)
```

**2. Real visitor IP.** Behind Cloudflare, `$remote_addr` is a Cloudflare edge IP — which would
collapse the PIN rate-limiter to a single key for everyone. Restore the true client IP from the
`CF-Connecting-IP` header, trusting **only** Cloudflare's published ranges (regenerate if CF
changes them):

```bash
{ curl -fsSL https://www.cloudflare.com/ips-v4 | sed 's/^/set_real_ip_from /; s/$/;/'
  curl -fsSL https://www.cloudflare.com/ips-v6 | sed 's/^/set_real_ip_from /; s/$/;/'
  echo 'real_ip_header CF-Connecting-IP;'; } | sudo tee /etc/nginx/snippets/cloudflare-realip.conf
```

**3. Vhost** `/etc/nginx/sites-available/homehq` — port 80 redirects to 443; 443 proxies the app:

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
        # $proxy_add_x_forwarded_for — the PIN limiter keys on X-Real-IP and a client could
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

> The kitchen droplet skipped step 2: its OAuth refresh token was seeded by copying a
> consistent snapshot of the dev DB (`sqlite3 data/homehq.db ".backup seed.db"`, scp, drop in
> place) — same Google client, so the token works from the droplet and calendar synced
> immediately. Either path is fine; `/setup` is still there if the token is ever revoked.

### Updating

```bash
cd ~/homehq
git pull
npm ci
npm run build
sudo systemctl restart homehq
```

### Deploying updates with a script

`scripts/deploy.sh` does this — run `./scripts/deploy.sh` from your Mac (or ask Claude to
"deploy"). It SSHes in as `homehq`, pulls, `npm ci`, rebuilds on the droplet (that's what the
swap is for), restarts the service, and health-checks `/login`. Two prerequisites make it
non-interactive (both already in place on the kitchen droplet):

- **Passwordless restart** — so the deploy doesn't stall on a sudo password prompt. Add a
  narrow rule via `sudo visudo -f /etc/sudoers.d/homehq`:
  ```
  homehq ALL=(root) NOPASSWD: /usr/bin/systemctl restart homehq
  ```
  (Or run HomeHQ as a systemd **user service** and skip sudo entirely.)
- **Repo pull access on the droplet** — fine if the GitHub repo is public; if it's private,
  give the droplet a read-only deploy key.

This script is also the reusable core if you later want **GitHub Actions** deploys
(tag/release → CI runs the same script over SSH) — the workflow is just a trigger around it.
Start with the script; graduate to Actions only if you want deploys to run without your Mac,
gate them on tests, or hand deploy access to someone else.

### Backups

Everything worth backing up lives in three files:

```bash
sqlite3 data/homehq.db ".backup /path/to/backup/homehq.db"   # safe while running (WAL)
cp data/config.json .env /path/to/backup/
```

Losing `homehq.db` only costs the Google connection (reconnect at `/setup`) and cached
data — it rebuilds itself. Losing `.env` means re-creating credentials. Low stakes, but a
weekly cron backup is cheap.

## Display client (Raspberry Pi)

Raspberry Pi OS (64-bit, **with desktop**) + Chromium in kiosk mode.

### Hardware (this build)

- **Raspberry Pi 5** with the official **27 W USB-C PSU** (don't power it from the monitor —
  use the dedicated supply for stable peripherals).
- **micro-HDMI → HDMI** cable to the **Dell S2725QC** (27" 4K). The Pi 5 outputs video only
  over its **micro-HDMI** ports; its USB-C port is power *in*, not video. The monitor's USB-C
  is for a laptop source, so drive the panel via the monitor's **HDMI** input. The Pi 5
  handles 4K@60 fine — that's the wall resolution the UI is designed for.
- A USB/Bluetooth **keyboard with trackpad** for the one-time PIN entry and any debugging.

### Flashing the image

Use **Raspberry Pi Imager** on your Mac. Choose *Raspberry Pi OS (64-bit)*. Before writing,
open the **settings (gear)** and pre-configure — this is what lets you finish from your Mac
over SSH instead of fumbling at the monitor:

- **Hostname** — e.g. `homehq-kiosk` (gives you `homehq-kiosk.local` for SSH)
- **Enable SSH**
- **Username / password**
- **Wi-Fi** — your **office** network + country code
- **Locale / timezone**

First boot, then update:

```bash
sudo apt update && sudo apt full-upgrade -y
sudo reboot
```

### Dual Wi-Fi (office + home)

Bookworm manages Wi-Fi with **NetworkManager**, which auto-connects to whichever *saved*
network is in range — no detection logic to write. The Imager seeds the office network; add
home as a second saved profile. You can add it **at the office while out of range** — the
profile just waits until home is reachable:

```bash
sudo nmcli connection add type wifi con-name home ssid "HOME_SSID" \
  wifi-sec.key-mgmt wpa-psk wifi-sec.psk "HOME_PASSWORD"
nmcli connection show          # verify both profiles are saved
```

Both stay saved; the Pi connects to whichever it sees at boot, so it "just works" when you
carry it from office to kitchen. (If both were ever in range at once, break the tie with
`nmcli connection modify home connection.autoconnect-priority 10`.)

### Kiosk autostart

Point this at your **Mac's dev server** during office testing (see *Testing on the Pi*
below), then swap the URL to your production domain once the droplet is live — that one line
is the only difference between office and kitchen.

For Raspberry Pi OS Bookworm+ (Wayland/labwc — the default on Pi 5), add to
`~/.config/labwc/autostart`:

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  --disable-session-crashed-bubble --force-device-scale-factor=2 https://your-domain.com &
```

On older X11-based images, use `~/.config/lxsession/LXDE-pi/autostart` instead:

```
@chromium-browser --kiosk --noerrdialogs --disable-infobars https://your-domain.com
```

### Display tuning on the 4K panel

The Dell is 3840×2160 on a 27" panel (~163 PPI), and Raspberry Pi OS doesn't scale the
desktop the way macOS does — so at native resolution everything renders physically small.
**Keep the resolution at native 4K** (lowering it just blurs the image and fits fewer
events); size things up with scaling instead:

- **Dashboard size** — `--force-device-scale-factor` on the Chromium launch (above) scales
  the *page* while keeping 4K crispness. `2` ≈ a 1920-wide layout; `1.5` is denser (more
  events, smaller text). Tune it on the wall — that's what the dev-server test loop is for.
- **Mouse cursor** — the scale factor does **not** affect the OS cursor, which is
  microscopic at 4K. Enlarge it by setting `XCURSOR_SIZE` in `~/.config/labwc/environment`,
  then reboot:
  ```
  XCURSOR_SIZE=48
  ```
  Bump to 64–96 to make it really obvious. This matters once the dashboard gains interactive
  features (tabs, mouse) — for a pure read-only display you may instead prefer to hide it.
- **Black desktop background** — set the wallpaper to solid black (Appearance Settings →
  Desktop) so any flash during boot or before Chromium loads is black, not white, on the wall.

### Testing on the Pi before the server exists

You can demo the in-progress app on the real monitor *before* the droplet is provisioned —
no DigitalOcean, no domain, no PIN/OAuth setup required:

1. On your Mac, run the dev server with the auth bypass enabled:

   ```bash
   DEV_AUTH_BYPASS=1 npm run dev
   ```

   `next dev` listens on all interfaces and prints a `Network: http://192.168.x.x:3000`
   line — that's the URL the Pi uses. (If the Pi can't reach it, allow the incoming
   connection in macOS firewall.) The bypass is ignored in production builds, so it can't
   leak past local dev (`proxy.ts`).

2. Point the kiosk Chromium at `http://<your-Mac-LAN-IP>:3000`.

The Pi now renders the live app at real size and distance with the real keyboard, while the
app is still being tweaked. When the droplet is up, change the autostart URL to
`https://your-domain.com` — nothing else about the Pi changes.

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
