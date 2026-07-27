# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is HomeHQ?

A self-hosted family dashboard web app replacing Dakboard. Displays family calendars, weather, and clock on a wall-mounted monitor via Raspberry Pi in kiosk mode. Built for a single household (5 family members).

**Status:** live in production on a DigitalOcean droplet behind Cloudflare, PIN-gated. Deploy with `./scripts/deploy.sh`. Generic runbook in `docs/deployment.md`. The live host/IP, SSH access, and ops specifics live in `private/ops/droplet.md` (gitignored, maintainer-only).

## Key Documents

- `private/TODO.md` — running punch list (System/Ops + Web App) **plus the post-MVP roadmap**; maintainer-local (gitignored — carries live ops + household specifics)
- `BOOTSTRAP.md` — Setup, dev commands, and troubleshooting
- `docs/deployment.md` — DO droplet + Raspberry Pi kiosk deployment
- `docs/google-oauth-setup.md` — Google Cloud OAuth walkthrough

This guide (CLAUDE.md), together with the code, is the living source of truth. (Historical docs — the original spec, the implementation plan (`PLAN.md`, archived once the MVP shipped), the project-restart review, and the setup handoff — live in `private/archive/`, gitignored.)
`AGENTS.md` is a thin pointer to this file so Codex/other agents read the same guidance.

## Tech Stack

- **Framework:** Next.js 16 (App Router) + TypeScript
- **Styling:** plain hand-authored CSS — design tokens (CSS custom properties) + per-area stylesheets under `styles/`, imported via `app/globals.css`. No CSS framework.
- **Runtime data:** SQLite via better-sqlite3 (`data/homehq.db`)
- **Config:** JSON file (`data/config.json`) for human-edited, non-secret settings
- **Secrets:** `.env` (Google OAuth credentials, cookie signing key)
- **Package manager:** npm
- **Testing:** Vitest (light testing — critical paths only)
- **Weather API:** Open-Meteo (free, no API key)
- **Calendar API:** Google Calendar via OAuth 2.0

## Architecture

Two invariants govern the calendar UI — most bullets below lean on them:

- **Wall-never-sticks** — every transient UI state (month `viewMode`, the expand toggle, the per-person filter, an open `EventModal`) is **never persisted** and **auto-reverts / auto-closes after idle**, so the always-on wall always boots to the default view and a walk-away peek never lingers. Each feature sets its own timeout via a `display.*ResetSeconds` key (`0` disables); timers restart on any capture-phase interaction, so they never fire mid-task.
- **Wall-default byte-for-byte** — a new calendar feature must leave the _default_ wall render pixel-identical; prove it with a normalized 4K DOM diff of the week grid. This is why month view is a **separate component** and the filter's off state returns the **same `events` reference** — never a second mode bolted onto the delicate `CalendarGrid`.

- **API routes as proxies** — browser never talks to Google/Open-Meteo directly. Credentials stay server-side.
- **Server-side sync** — background jobs fetch from Google Calendar (every 5 min) and Open-Meteo (every 30 min), caching results in SQLite. Started from `instrumentation.ts`.
- **Client reads cache** — dashboard polls API routes that serve data from SQLite. Never hits external APIs on render.
- **Calendar cache window** — 60 days back, 210 days ahead (~7 months) by default; override with `google.syncDaysBack` / `google.syncDaysAhead`. The window is a **hard limit on how far the UI can look** — past it the cache holds no rows, so a far-future view would render empty cells that aren't actually empty. Sized for the month-view case (a spring email listing fall-break dates is ~7 months out). Widening is safe: `fetchCalendarEvents` paginates (`maxResults: 2500` + `pageToken`), and the sync's `upsertCalendarEvents` replaces each calendar's rows wholesale.
- **Calendar layout** — one `WeekRow` per week. All-day events lay out as horizontal **spanning bars** in an all-day band (`computeWeekSegments` packs overlaps into slots, Google-calendar style); single-day all-day events sit in that same band. The band is an **absolute spanning overlay**, and each day reserves only the band rows (lanes) that actually touch it: `computeWeekSegments` returns a per-column `laneByColumn` counting bars that **pass through** a column, not just ones that start there (or a spanning bar would collide with that day's timed events). A day no all-day event covers reserves nothing and starts its timed stack at the top — so there's **no per-week placeholder gap** (the old shared-band row reserved its full height in every column). Per-column reservation is rendered with invisible self-sizing spacer bars, which the overlay's real bars line up against. Timed events render per day below the band via `EventItem`. Past-only all-day bars and past timed events dim to 40%.
- **`+N more` cropping** — `CalendarGrid` renders a **hidden measurement layer** (full, uncropped event stacks at the real column width) so it reads each day's **actual** per-event heights (1- vs 2-line titles) instead of assuming a uniform row, then greedy-packs each cell — a cell shows as many events as truly fit. That measurement layer is `position:absolute; inset:0` **and must stay `overflow:hidden`** (`.cal-measure`) — its uncropped stacks are taller than the grid box, and with overflow visible that spillover became scrollable overflow on `.cal-weeks`/`.app-main`, which a focus/scroll-anchoring nudge could strand the whole grid scrolled-down (header clipped). Clipping doesn't affect `getBoundingClientRect`, so measurements are unchanged; `.app-main` is `overflow:clip` (never a scroll container) as a backstop. Each cell's available height subtracts **only its own column's band reservation** (`bandHeightFor(laneByColumn[col])`, per-column — not the week's max), so days under no all-day bar spend the reclaimed room on extra events. Track sizing + crop honor a strict priority around an **anchor week** (the current week by default): (1) the anchor week's **protected** days — those `>= today` — show every event and set the anchor week's track height; (2) every other week gets an even share of the remaining height (maximized); (3) the anchor week's non-protected days (e.g. past days of the current week) crop last. See **Expand next week** for how the anchor moves.
- **Expand next week** — a footer toggle (trailing the shared footer's left group — it's the wall view's own extra) and clickable `+N more` buttons flip the layout's _anchor week_ from the current week to next week: next week then shows every event while the current week falls to the remaining-height share and crops behind `+N more`. Because all of next week is in the future, the same `date >= today` predicate protects its whole row, so **default behavior is byte-for-byte unchanged**. Clicking a **next-week** `+N more` expands; a **current-week** `+N more` (or the toggle) returns to normal; both controls share one ephemeral `expanded` state. It **auto-reverts** to the current week after `config.display.expandResetSeconds` (default 300; wall-never-sticks) — the timer starts on expand, clears on collapse, restarts on re-expand.
- **Month view (v1.2)** — a second, **sit-down** view of the calendar area: a Google-Calendar-style month grid for scrubbing months ahead (`CalendarView` + `MonthGrid`/`MonthWeek`/`MonthDayPopover`, `month-utils.ts`, `styles/month.css`). `CalendarView` owns an ephemeral `viewMode` (`'week'` default, **never persisted** — wall-never-sticks); the footer's **View Month / View Upcoming** buttons switch (one grid mounted at a time, so month view always re-enters on the current month), Esc exits, and `display.monthViewResetSeconds` (default 180) **auto-reverts** after idleness. Built as a **separate component** (wall-default byte-for-byte — never a second mode on the delicate `CalendarGrid`). Reuses `computeWeekSegments`, `assignEventsToDays`, the color map, and `EventModal`. **No measurement layer, by design**: chips are uniform single lines, so `+N more` capacity is arithmetic over a handful of unit heights read from three hidden sample boxes (`.mon-sample`, clipped inside `.mon-grid`) — if it ever seems to need per-event measuring, the design has drifted. **The scale break is scoped to `.mon-calendar` only** (`font-size: clamp(12px, 1vh, 22px)`, everything inside in `em`) — the ONLY opt-out from root rem scaling in the app; the month header stays rem-based persistent chrome. Rows are dynamic (4–6, `monthRowCount`). **Interactions**: "N more" opens a floating **day popover** (rendered outside `.mon-grid` so the capacity samples never see it; a long day scrolls _inside_ the popover list — the page never scrolls); clicking any event (chip, bar, or popover row) opens `EventModal` in edit mode; create via a **hover-revealed per-day "+"** (a deliberate target — full days stay addable, no accidental opens) or the footer's **+ Add event** (pre-fills today in the current month, else the viewed month's 1st — `monthCreateDate`). All writes gated on `isCalendarWriteEnabled` exactly like the wall (readonly: events inert, no "+"; the popover still works — it's a read surface). **Esc peels one layer at a time**: modal → popover → view. Keyboard: ←/→ page months, T = today. An open `EventModal` does **not** hold the auto-revert (its own shorter idle timer closes abandoned forms first; wall-never-sticks wins).
- **Calendar footer** — one shared `CalendarFooter` component (rem-based persistent chrome, like the top bar) renders the bottom bar in **both** views so the controls hold identical positions: **legend / per-person filter** (a chevron toggles collapse — that preference persists via localStorage through `useSyncExternalStore`, carries across views) | view switcher (`View Month`/`View Upcoming`) | `+ Add event` (readwrite only), with view-specific extras trailing (the wall's expand toggle); on the **right**, the sync indicator and a **manual reload button** (`window.location.reload()` — an always-there, no-confirm escape hatch to hard-refresh the long-lived SPA without kiosk shortcuts, for when something gets weird and nobody's on-site; it also picks up the latest deploy, like the self-update poll). Month view passes a `rule` modifier for its top divider.
- **Per-person filter** — the footer legend doubles as a calendar filter: clicking a name **isolates** it (empty = show all, so the first click solos; then additive — struck-through = hidden), and **"✕ Show all"** clears. State lives in a small in-memory store (`components/calendar/calendar-filter.ts`, mirroring the legend-collapse store's `useSyncExternalStore` shape) shared by the footer, both grids, and `CalendarView` — so it **carries across the week↔month switch** (CalendarView stays mounted) but is **never persisted** (wall-never-sticks). Both grids derive `visibleEvents` via the shared `filterEvents()`, which returns the **same `events` reference when empty** (wall-default byte-for-byte). `CalendarView` **auto-reverts** to "show all" after idle (`display.filterResetSeconds`, default 300). Selecting every calendar (or emptying the set) collapses back to the canonical "show all". Filtering is a read action, so it behaves identically in readonly deployments. Pure logic (`nextFilter`/`filterEvents`) is unit-tested without a renderer.
- **Per-calendar text color** — `config.json` calendars accept an optional `textColor` to override auto black/white on the all-day bar fill (e.g. white on a light pink).
- **Styling** — plain hand-authored CSS, no framework (migrated off Tailwind v4). Design tokens (palette + type/leading/weight/tracking scale, as CSS custom properties) live in `styles/tokens.css`; a deliberate reset + the root `clamp()` wall-scaling in `styles/base.css`; per-area semantic stylesheets with prefixed class names (`cal-` calendar, `mon-` month view, `wx-` weather, `tb-`/`clk-` topbar/clock, `auth-` auth), all `@import`ed by `app/globals.css`. Components carry semantic class names; dynamic values (calendar colors, today-dot color, grid spans) stay inline `style={}`. The rem-based sizing + root `clamp()` are what make the layout scale on the 4K wall — keep them intact. CSS is **tab**-indented (Prettier `*.css` override); TS/TSX stays 2-space. Next's built-in CSS pipeline handles `@import`/nesting/autoprefix (no PostCSS config).
- **Weather icons** — config-driven via `display.weatherIcons` (`lucide` default · `meteocons` · `weather-icons` · `emoji`). `lib/weather/wmo.ts` maps WMO codes → semantic _glyphs_; `WeatherIcon` renders the chosen set. Non-emoji sets are **self-hosted inline SVGs** in `lib/weather/weather-icon-svgs.ts` (regenerated by `scripts/fetch-weather-icons.mjs` from Iconify; sized to 1em so font-size scales them) — they render on the Pi where emoji can't (no color-emoji font).
- **Display time zone** — optional `display.timezone` (IANA). Clock + event times format via `Intl` in that zone (`zonedParts` in `calendar-utils.ts`), so the kiosk shows one fixed zone regardless of the machine's OS clock. Unset = browser-local.
- **Event creation + edit/delete (v1.1 · v1.1.x, opt-in)** — full write access to Google Calendar (create, edit, delete), gated by `config.google.calendarAccess` (`readonly` **default** | `readwrite`). Read-only deployments are unchanged: only the `calendar.readonly` scope is requested, the `+ Add event` UI is hidden, events are **inert** (not clickable), and the write routes (`POST /api/calendar/create` · `/update` · `/delete`) 403. In `readwrite`, the OAuth scope becomes `calendar.events` (re-consent at `/setup` to upgrade an existing token); a footer **"+ Add event"** button and **clicking any event** open `EventModal` (one component, `mode: 'create' | 'edit'`). All three write routes are **confirmed-then-cached**: call Google → on success `normalizeEvent` + `upsertEvent` (a single-event upsert that does **not** wipe the calendar, unlike the sync's `upsertCalendarEvents`), or `deleteEvent` for a delete, write straight into SQLite so the change shows on the next poll without waiting for the 5-min sync. **Edit** reuses the modal pre-filled (calendar is fixed — no cross-calendar move), saves via Google `events.patch` (null-clears the start/end sibling so an all-day↔timed toggle is clean; a multi-day all-day span is preserved on a date-only edit). **Delete** is a named confirm step (shows title + when). **Recurring occurrences are blocked** (edit + delete) with a "manage in Google Calendar" notice — the sync expands recurrences (`singleEvents:true`), so each row is one occurrence; a `recurring_event_id` column (migration `002`, carried by `normalizeEvent`) flags them, and the routes 409 on a recurring row as defense in depth. Shared field validation lives in `lib/calendar/event-timing.ts` (`parseTiming` + UTC date math). Fields: title · calendar (**create-only picker, no default — must be chosen**) · date · start/end or all-day · location · notes. The modal auto-closes after `config.display.createFormResetSeconds` idle (default 120; wall-never-sticks). `isCalendarWriteEnabled()` (in `lib/config`) is the single gate for the scope, the routes, the button, and click-to-edit.
- **Auth** — 6-digit PIN gate with HMAC-SHA256 signed cookie session. One shared PIN for all users. Auth gate is `proxy.ts` (Next.js 16 proxy convention, replaces middleware). PIN attempts are rate-limited (`lib/auth/rate-limit.ts`); sessions expire after 30 days but renew on use after 7 (kiosk never logs out).
- **Google OAuth** — offline access, refresh token stored in SQLite. One Google account. **Scope is config-driven** — `calendar.readonly` by default, `calendar.events` when `google.calendarAccess` is `readwrite` (see Event creation); switching modes needs a re-consent at `/setup`. Bootstrap via `/setup` route. Flow carries a CSRF `state` param; OAuth routes sit _behind_ the auth gate (SameSite=Lax survives Google's redirect).
- **Resilience** — always show cached data when APIs are down. "Last synced" indicator shows staleness and turns amber on sync failures. Never a blank screen.
- **Kiosk self-update** — the dashboard is a long-lived SPA, so a deploy ships new code to the droplet but the Pi keeps running the bundle it booted with until a hard reload. To close that gap, the page is stamped with a build token (`getDeployVersion` in `lib/version.ts` reads `data/deploy-version`) and `CalendarGrid` polls `GET /api/version`, hard-reloading when the token differs from the one it loaded with. `deploy.sh` stamps the git SHA on every deploy (so deploys auto-refresh the wall within a poll interval); `scripts/kiosk-reload.sh` writes a `manual-<epoch>` token to force a refresh after a config-only change (which doesn't rebuild). Loop-proof by design: the reloaded page is re-served with the new token as its baseline, and it never reloads on a fetch error — so a token change triggers exactly one reload per client.
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
npm run lint         # ESLint
npm run format:check # Prettier check (npm run format to write)
```

Pre-commit gate: `npm test`, `npm run lint`, `npm run format:check`, and `npm run build` all clean. (CSS is tab-indented, TS/TSX 2-space — Prettier enforces both.)

## Data Boundaries

| What                  | Where                     | Examples                                                                                                    |
| --------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Human-edited settings | `data/config.json`        | Calendar names/colors, weather lat/long, display prefs, PIN, calendar access mode (`google.calendarAccess`) |
| Secrets               | `.env`                    | Google OAuth client ID/secret, cookie signing key                                                           |
| Runtime/cache data    | `data/homehq.db` (SQLite) | OAuth refresh token, cached calendar events, cached weather                                                 |

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
├── setup/page.tsx                    # OAuth bootstrap + readwrite scope re-consent
└── api/
    ├── auth/route.ts                 # POST: PIN validation → signed cookie (rate-limited)
    ├── calendar/route.ts             # Serve cached events from SQLite
    ├── calendar/create/route.ts      # POST: create a Google event (gated; confirmed-then-cached)
    ├── calendar/update/route.ts       # POST: edit a Google event via events.patch (gated; recurring 409)
    ├── calendar/delete/route.ts       # POST: delete a Google event (gated; recurring 409; idempotent)
    ├── oauth/                        # Google OAuth flow (with CSRF state)
    ├── version/route.ts              # Serve deployed build token (kiosk self-update poll)
    └── weather/route.ts              # Serve cached weather from SQLite
components/
├── dashboard/TopBar.tsx              # Top bar (clock left, weather right)
├── calendar/                         # CalendarView (week/month switch + auto-revert), CalendarGrid (wall: measures/sizes), WeekRow, EventItem, MonthGrid/MonthWeek/MonthDayPopover (month view), CalendarFooter (shared bottom bar), EventModal (create + edit + delete), utils (calendar-utils, month-utils)
├── clock/Clock.tsx                   # Live clock + date (useSyncExternalStore, zone-aware)
└── weather/                          # WeatherPanel (conditions + forecast tiles), WeatherIcon (renders the chosen set)
lib/
├── auth/session.ts                   # HMAC-SHA256 session create/verify (Web Crypto)
├── auth/rate-limit.ts                # In-memory failure rate limiter (PIN endpoint)
├── db/                               # SQLite setup, migrations, queries
├── calendar/event-timing.ts          # Shared create/edit field validation + UTC date math
├── google/                           # Google Calendar API client (read + create/patch/delete), OAuth, sync
├── weather/                          # Open-Meteo client, WMO→glyph map, sync, self-hosted icon SVGs
├── config/                           # Read data/config.json (+ isCalendarWriteEnabled)
└── version.ts                        # Deployed build token (data/deploy-version) for kiosk self-update
scripts/
├── deploy.sh                         # SSH deploy (git pull → ci → build → stamp version → restart)
├── kiosk-reload.sh                   # Force the wall kiosk to hard-refresh (bumps the build token)
└── fetch-weather-icons.mjs           # Regenerates lib/weather/weather-icon-svgs.ts (npm run weather-icons)
data/
├── config.example.json               # Committed template
└── homehq.db                         # Created at runtime (gitignored)
docs/
├── google-oauth-setup.md             # Google Cloud OAuth setup guide
└── deployment.md                     # Droplet + Pi kiosk deployment
```

## MVP Scope (quick reference)

**In:** Calendar grid, clock, weather, PIN auth, SQLite cache, Open-Meteo, one Google account
**v1.1 · v1.1.x (opt-in via `google.calendarAccess: readwrite`):** event **create, edit, delete** (recurring series managed in Google Calendar, not here)
**v1.2:** **month view** — footer-toggled sit-down month grid (nav + keyboard, day popover, click-to-edit, hover-`+` create, auto-revert), shared footer across views
**v1.2.x:** **per-person calendar filter** (footer legend → click-to-isolate, cross-view, auto-revert) + a footer **manual reload button**
**Out:** Settings UI, multiple Google accounts, touch UX, widgets, editing recurring series
