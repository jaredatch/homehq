# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is HomeHQ?

A self-hosted family dashboard web app replacing Dakboard. Displays family calendars, weather, and clock on a wall-mounted monitor via Raspberry Pi in kiosk mode. Built for a single household (5 family members).

**Status:** live in production on a DigitalOcean droplet behind Cloudflare, PIN-gated. Deploy with `./scripts/deploy.sh`. Generic runbook in `docs/deployment.md`. The live host/IP, SSH access, and ops specifics live in `private/ops/droplet.md` (gitignored, maintainer-only).

## Key Documents

- `PLAN.md` — Implementation plan, MVP scope, build phases, roadmap, and all technical decisions
- `private/TODO.md` — running punch list (System/Ops + Web App); maintainer-local (gitignored — carries live ops + household specifics), complements PLAN.md's roadmap
- `BOOTSTRAP.md` — Setup, dev commands, and troubleshooting
- `docs/deployment.md` — DO droplet + Raspberry Pi kiosk deployment
- `docs/review-2026-06-07.md` — Deep review findings and decisions from the project restart
- `docs/archive/SPEC.md` — original product spec (historical; superseded by this guide + PLAN.md)

This guide (CLAUDE.md) and PLAN.md are the living source of truth; SPEC.md is archived.
`AGENTS.md` is a thin pointer to this file so Codex/other agents read the same guidance.

## Tech Stack

- **Framework:** Next.js 16 (App Router) + TypeScript + Tailwind CSS v4
- **Runtime data:** SQLite via better-sqlite3 (`data/homehq.db`)
- **Config:** JSON file (`data/config.json`) for human-edited, non-secret settings
- **Secrets:** `.env` (Google OAuth credentials, cookie signing key)
- **Package manager:** npm
- **Testing:** Vitest (light testing — critical paths only)
- **Weather API:** Open-Meteo (free, no API key)
- **Calendar API:** Google Calendar via OAuth 2.0

## Architecture

- **API routes as proxies** — browser never talks to Google/Open-Meteo directly. Credentials stay server-side.
- **Server-side sync** — background jobs fetch from Google Calendar (every 5 min) and Open-Meteo (every 30 min), caching results in SQLite. Started from `instrumentation.ts`.
- **Client reads cache** — dashboard polls API routes that serve data from SQLite. Never hits external APIs on render.
- **Calendar cache window** — 30 days back, 60 days ahead.
- **Calendar layout** — one `WeekRow` per week. All-day events lay out as horizontal **spanning bars** in a shared per-week band (`computeWeekSegments` packs overlaps into slots, Google-calendar style); single-day all-day events sit in that same band. Timed events render per day below the band via `EventItem`. `CalendarGrid` measures header/row/band heights and sizes the grid so the **current week is protected** (shows everything) while past days + later weeks crop with `+N more`. Past-only all-day bars and past timed events dim to 40%.
- **Per-calendar text color** — `config.json` calendars accept an optional `textColor` to override auto black/white on the all-day bar fill (e.g. white on a light pink).
- **Auth** — 6-digit PIN gate with HMAC-SHA256 signed cookie session. One shared PIN for all users. Auth gate is `proxy.ts` (Next.js 16 proxy convention, replaces middleware). PIN attempts are rate-limited (`lib/auth/rate-limit.ts`); sessions expire after 30 days but renew on use after 7 (kiosk never logs out).
- **Google OAuth** — offline access, refresh token stored in SQLite. One Google account for MVP. Bootstrap via `/setup` route. Flow carries a CSRF `state` param; OAuth routes sit *behind* the auth gate (SameSite=Lax survives Google's redirect).
- **Resilience** — always show cached data when APIs are down. "Last synced" indicator shows staleness and turns amber on sync failures. Never a blank screen.
- **Timestamps** — sync/cache timestamps are stored as ISO 8601 UTC with the `Z` suffix. Never use SQLite's `datetime('now')` for anything a browser will parse.
- **Test isolation** — `getDb()` refuses the default DB path under Vitest (fixture data once destroyed the live refresh token). Tests use temp paths + `_setDefaultDb()`.

## UI Priorities (in order)

1. Fit as many events as possible — primary Dakboard pain point
2. Clean technical foundation
3. Roughly resemble Dakboard where helpful

**Design constraints:** Dark theme only. High contrast for 6-10 feet on 24-27" monitor. Aggressive title truncation. Minimal chrome — content density is king. Top bar layout (clock + weather) gives calendar full width.

## Build Commands

```bash
npm run dev          # Development server
npm run build        # Production build
npm run start        # Production server
npm test             # Run tests (Vitest)
```

## Data Boundaries

| What                  | Where                     | Examples                                                    |
| --------------------- | ------------------------- | ----------------------------------------------------------- |
| Human-edited settings | `data/config.json`        | Calendar names/colors, weather lat/long, display prefs, PIN |
| Secrets               | `.env`                    | Google OAuth client ID/secret, cookie signing key           |
| Runtime/cache data    | `data/homehq.db` (SQLite) | OAuth refresh token, cached calendar events, cached weather |

`data/config.json` is gitignored (user-specific). `data/config.example.json` is committed as a template.

## Project Structure

```
proxy.ts                              # Auth gate (Next.js 16 proxy, replaces middleware)
instrumentation.ts                    # Starts calendar + weather sync schedulers
app/
├── layout.tsx                        # Root layout (dark theme, fonts)
├── global-error.tsx                  # Error boundary
├── page.tsx                          # Main dashboard (TopBar + calendar area)
├── login/page.tsx                    # PIN entry
├── setup/page.tsx                    # OAuth bootstrap (temporary)
└── api/
    ├── auth/route.ts                 # POST: PIN validation → signed cookie (rate-limited)
    ├── calendar/route.ts             # Serve cached events from SQLite
    ├── oauth/                        # Google OAuth flow (with CSRF state)
    └── weather/route.ts              # Serve cached weather from SQLite
components/
├── dashboard/TopBar.tsx              # Top bar (clock left, weather right)
├── calendar/                         # CalendarGrid (measures/sizes), WeekRow (bg + headers + all-day band + timed), EventItem (timed only), utils
├── clock/Clock.tsx                   # Live clock + date (useSyncExternalStore)
└── weather/WeatherPanel.tsx          # Current conditions + per-day forecast tiles
lib/
├── auth/session.ts                   # HMAC-SHA256 session create/verify (Web Crypto)
├── auth/rate-limit.ts                # In-memory failure rate limiter (PIN endpoint)
├── db/                               # SQLite setup, migrations, queries
├── google/                           # Google Calendar API client, sync
├── weather/                          # Open-Meteo client, WMO codes, sync
└── config/                           # Read data/config.json
data/
├── config.example.json               # Committed template
└── homehq.db                         # Created at runtime (gitignored)
docs/
├── google-oauth-setup.md             # Google Cloud OAuth setup guide
├── deployment.md                     # Droplet + Pi kiosk deployment
└── review-2026-06-07.md              # Project-restart review findings
```

## MVP Scope (quick reference)

**In:** Calendar grid (read-only), clock, weather, PIN auth, SQLite cache, Open-Meteo, one Google account
**Out:** Event creation/editing, settings UI, multiple Google accounts, touch UX, widgets
