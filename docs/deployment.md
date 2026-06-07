# HomeHQ — Deployment Guide

Two pieces: a **server** (DigitalOcean droplet) running the Next.js app, and a **display
client** (Raspberry Pi) pointing Chromium at it in kiosk mode.

## Server (DigitalOcean droplet)

### Requirements

- Smallest droplet is fine (1 GB RAM). Ubuntu LTS.
- A domain (or subdomain) pointed at the droplet — required for SSL, which Google OAuth
  redirect URIs effectively require in production.
- Node.js 20+ (LTS). Install via [NodeSource](https://github.com/nodesource/distributions)
  or `nvm`.

### Initial setup

```bash
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

Raspberry Pi OS (with desktop) + Chromium in kiosk mode.

### Kiosk autostart

For Raspberry Pi OS Bookworm+ (Wayland/labwc), add to `~/.config/labwc/autostart`:

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  --disable-session-crashed-bubble https://your-domain.com &
```

On older X11-based images, use `~/.config/lxsession/LXDE-pi/autostart` instead:

```
@chromium-browser --kiosk --noerrdialogs --disable-infobars https://your-domain.com
```

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
