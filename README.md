# HomeHQ

A self-hosted family calendar for a wall-mounted display. Google Calendar in, a dense dark-theme dashboard out, running on a Raspberry Pi in the kitchen.

[![CI](https://github.com/jaredatch/homehq/actions/workflows/ci.yml/badge.svg)](https://github.com/jaredatch/homehq/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node 24](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)

![The HomeHQ dashboard: two weeks of colour-coded family events under a clock and weather bar](docs/images/dashboard.png)

## Why

We ran Dakboard on the kitchen wall for years. It's fine, but on a busy school week it crops half the day behind "+6 more" and there's no way to get them back. HomeHQ started as "fit more events on the screen" and grew into the calendar we actually wanted: one that reads from across the room, that the kids can glance at, and that a parent can add a dentist appointment to without pulling out a phone.

It's built for one household on one Google account, and that's the whole scope. There's no multi-tenant anything and no widget system.

## What it does

- **Two weeks at a glance**, full width, with all-day events as spanning bars and timed events stacked beneath. The grid measures every event's real height and packs each day with as many as fit.
- **Expand next week** when you need the detail, and it snaps back on its own.
- **Month view** for scrubbing ahead (a school email listing fall-break dates, seven months out), with a day popover, keyboard paging, and the same auto-revert.
- **Add, edit, and delete events** from the wall, straight into Google Calendar. This is opt-in; the default is a read-only display.
- **One event on two people's calendars** shows as a single two-colour chip, whether HomeHQ created it, Google linked it as an invite, or someone typed it in twice.
- **Per-person filter** from the legend. Click a name to see just their week.
- **Clock and weather** in a slim top bar. Weather from Open-Meteo, no API key needed.
- **Made for an always-on screen.** Every transient state reverts after idle. Cached data stays up through any outage. A deploy refreshes the kiosk by itself.
- **Renders on a bare Raspberry Pi.** Self-hosted emoji font and SVG weather icons, because a stock Pi image has neither.

Auth is a single six-digit PIN for the household, behind a signed cookie that renews itself so the kiosk never logs out.

## How it works

Next.js 16 with a SQLite cache in the middle. Two background jobs pull from Google Calendar (every 5 min) and Open-Meteo (every 30 min) into `data/homehq.db`; the dashboard polls API routes that read from that cache. The browser never talks to Google, credentials never leave the server, and a Google outage just means the wall keeps showing what it had.

Details in [docs/architecture.md](docs/architecture.md). The calendar layout has its own write-up in [docs/calendar.md](docs/calendar.md).

<details>
<summary>Month view</summary>

![Month view: a six-row August grid with colour-coded chips and "N more" overflow buttons](docs/images/month-view.png)

</details>

## Quick start

You need Node 24 and a Google Cloud project with the Calendar API enabled ([walkthrough](docs/google-oauth-setup.md), about ten minutes).

```bash
git clone https://github.com/jaredatch/homehq.git
cd homehq
npm install

cp .env.example .env                              # add Google client ID/secret, a cookie secret
cp data/config.example.json data/config.json      # calendars, lat/long, PIN

npm run dev
```

Open [http://localhost:3000](http://localhost:3000), enter your PIN, then visit `/setup` to connect Google. Events show up within a few minutes; weather within a minute.

Every config key is documented in [docs/configuration.md](docs/configuration.md). Local development and troubleshooting are in [BOOTSTRAP.md](BOOTSTRAP.md).

## Running it on a wall

[docs/deployment.md](docs/deployment.md) covers the whole thing: a $6 VPS behind nginx (with or without Cloudflare), a systemd unit, daily backups, and a Raspberry Pi in Chromium kiosk mode driving a 4K panel. It's written generically; our own instance is one droplet and a Pi 5.

## Docs

| Doc                                                      | What's in it                                          |
| -------------------------------------------------------- | ----------------------------------------------------- |
| [docs/configuration.md](docs/configuration.md)           | Every `config.json` and `.env` key, with defaults     |
| [docs/google-oauth-setup.md](docs/google-oauth-setup.md) | Google Cloud project, consent screen, credentials     |
| [docs/deployment.md](docs/deployment.md)                 | Server, TLS, backups, Raspberry Pi kiosk              |
| [docs/architecture.md](docs/architecture.md)             | Sync, cache, auth, writes, shared events, self-update |
| [docs/calendar.md](docs/calendar.md)                     | How the grid lays out, crops, and reverts, and why    |
| [BOOTSTRAP.md](BOOTSTRAP.md)                             | Dev setup, commands, troubleshooting                  |
| [CONTRIBUTING.md](CONTRIBUTING.md)                       | How to send a change                                  |

## Contributing

Bug reports and small, focused pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; the calendar grid has a couple of invariants that are easy to break by accident.

## License

[MIT](LICENSE). The bundled Noto Color Emoji font is under the [SIL Open Font License](public/fonts/emoji/LICENSE.txt).
