# HomeHQ — Deployment Guide

Two pieces: a **server** (DigitalOcean droplet) running the Next.js app, and a **display
client** (Raspberry Pi) pointing Chromium at it in kiosk mode.

## Server (DigitalOcean droplet)

### Requirements

- A 1 GB droplet ($6/mo Basic) is enough. Ubuntu LTS. **Add swap before the first build**
  (see Initial setup) — `next build` can run a 1 GB box out of memory without it.
- A domain (or subdomain) pointed at the droplet — required for SSL, which Google OAuth
  redirect URIs effectively require in production.
- Node.js 20+ (LTS). Install via [NodeSource](https://github.com/nodesource/distributions)
  or `nvm`.

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

### systemd service

`/etc/systemd/system/homehq.service`:

```ini
[Unit]
Description=HomeHQ family dashboard
After=network.target

[Service]
Type=simple
User=homehq
WorkingDirectory=/home/homehq/homehq
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now homehq
sudo systemctl status homehq        # check it's running
journalctl -u homehq -f             # tail logs (sync output shows here)
```

### Nginx + SSL

```bash
sudo apt install nginx certbot python3-certbot-nginx
```

`/etc/nginx/sites-available/homehq`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        # Set X-Real-IP to the true TCP peer. Do NOT use
        # $proxy_add_x_forwarded_for here — it appends to a client-supplied
        # X-Forwarded-For, which would let a client spoof the rate-limiter key
        # and brute-force the PIN. Overwrite, don't append.
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`X-Real-IP` matters — the PIN rate limiter keys on it, and nginx must set it
from `$remote_addr` so clients can't forge it.

```bash
sudo ln -s /etc/nginx/sites-available/homehq /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.com    # provisions SSL + auto-renewal
```

### First run

1. Visit `https://your-domain.com` → PIN screen. Enter your PIN.
2. Go to `https://your-domain.com/setup` → Connect Google Calendar.
3. Within ~5 minutes the calendar grid populates; weather appears within ~30 seconds.

### Updating

```bash
cd ~/homehq
git pull
npm ci
npm run build
sudo systemctl restart homehq
```

### Deploying updates with a script

Rather than SSHing in to run the steps above by hand each time, wrap them in a small
`scripts/deploy.sh` that runs the update over SSH from your Mac — you run it (`./scripts/deploy.sh`),
or have Claude run it on "deploy." The script just automates the Updating commands above;
the build stays on the droplet (that's what the swap is for). Two prerequisites make it
non-interactive:

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
  --disable-session-crashed-bubble https://your-domain.com &
```

On older X11-based images, use `~/.config/lxsession/LXDE-pi/autostart` instead:

```
@chromium-browser --kiosk --noerrdialogs --disable-infobars https://your-domain.com
```

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
