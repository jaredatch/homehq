# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is HomeHQ?

A self-hosted family dashboard web app replacing Dakboard. Displays family calendars, weather, and clock on a wall-mounted monitor via Raspberry Pi in kiosk mode. Built for a single household (5 family members).

## Key Documents

- `SPEC.md` — Product spec and source of truth for features/design
- `PLAN.md` — Implementation plan, MVP scope, build phases, and all technical decisions
- `BOOTSTRAP.md` — Setup, dev commands, and troubleshooting

These documents are kept in sync. SPEC.md is the product truth; PLAN.md is the implementation roadmap.

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
- **Server-side sync** — background jobs fetch from Google Calendar (every 5 min) and Open-Meteo (every 30 min), caching results in SQLite.
- **Client reads cache** — dashboard polls API routes that serve data from SQLite. Never hits external APIs on render.
- **Calendar cache window** — 30 days back, 60 days ahead.
- **Auth** — 6-digit PIN gate with signed cookie session. One shared PIN for all users.
- **Google OAuth** — offline access, refresh token stored in SQLite. One Google account for MVP. Bootstrap via `/setup` route.
- **Resilience** — always show cached data when APIs are down. "Last synced" indicator shows staleness. Never a blank screen.

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
app/
├── layout.tsx                    # Root layout (dark theme, fonts)
├── page.tsx                      # Main dashboard
├── login/page.tsx                # PIN entry
├── setup/page.tsx                # OAuth bootstrap (temporary)
└── api/
    ├── auth/                     # PIN validation, session
    ├── calendar/                 # Serve cached events from SQLite
    ├── oauth/                    # Google OAuth flow
    └── weather/                  # Serve cached weather from SQLite
components/
├── dashboard/                    # Top-level layout, top bar
├── calendar/                     # Grid, day columns, event items
├── clock/                        # Clock + date display
└── weather/                      # Current conditions + forecast
lib/
├── auth/                         # PIN checking, cookie/session
├── db/                           # SQLite setup, migrations, queries
├── google/                       # Google Calendar API client, sync
├── weather/                      # Open-Meteo client, sync
├── config/                       # Read/write data/config.json
└── time/                         # Date/time utilities
data/
├── config.example.json           # Committed template
└── homehq.db                     # Created at runtime (gitignored)
```

## MVP Scope (quick reference)

**In:** Calendar grid (read-only), clock, weather, PIN auth, SQLite cache, Open-Meteo, one Google account
**Out:** Event creation/editing, settings UI, multiple Google accounts, touch UX, widgets
