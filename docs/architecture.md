# Architecture

HomeHQ is a Next.js 16 (App Router) app with a SQLite cache in the middle. The browser never talks to Google, Open-Meteo, or Todoist; background jobs on the server do, and every screen reads whatever they last wrote.

```
Google Calendar ──(every 5 min)───┐
Open-Meteo ───────(every 30 min)──┼──► SQLite (data/homehq.db) ──► API routes ──► browser (polls)
Todoist ──────────(every 1 min)───┘
```

That shape buys three things: credentials stay server-side, the wall keeps showing the last good data through any outage, and rendering never waits on an external API.

## Server-side sync

The schedulers start once, from `instrumentation.ts`, when the server boots.

- **Calendar** (`lib/google/sync.ts`): every 5 minutes, for each calendar in `config.json`, fetch events in a window of 60 days back to 210 days ahead (`google.syncDaysBack` / `syncDaysAhead`), expand recurrences (`singleEvents: true`, so each row is one occurrence), normalise, and replace that calendar's rows wholesale (`upsertCalendarEvents`). The fetch paginates, so a wide window is safe. The window is also the hard limit on how far the UI can look: past it the cache has no rows and month view would show empty cells that aren't empty.
- **Weather** (`lib/weather/sync.ts`): every 30 minutes, fetch current conditions and the forecast for the configured lat/long from Open-Meteo (no API key) and cache the JSON.
- **Todoist** (`lib/todoist/sync.ts`): every minute, for each project a board names, pull open tasks into the `todos` table. It runs only when `TODOIST_API_KEY` is set and some board declares a project, so an install without to-dos never makes the call. A minute rather than five: a to-do ticked on a phone should be gone from the bedroom panel before anyone wonders whether it worked.

Each sync records success or failure in `sync_status`. The footer's sync indicator reads that and turns amber with the reason when the last attempt failed. Timestamps are ISO 8601 UTC with a `Z` suffix throughout; nothing a browser parses ever comes from SQLite's `datetime('now')`.

## API routes

All under `app/api/`. The dashboard polls the read routes; the write routes exist only when `google.calendarAccess` is `readwrite`.

| Route                  | Method | What                                                                   |
| ---------------------- | ------ | ---------------------------------------------------------------------- |
| `/api/calendar`        | GET    | Cached events                                                          |
| `/api/weather`         | GET    | Cached weather                                                         |
| `/api/version`         | GET    | The deployed build token (see [Kiosk self-update](#kiosk-self-update)) |
| `/api/auth`            | POST   | PIN → signed session cookie. Rate-limited.                             |
| `/api/oauth`           | GET    | Starts the Google OAuth flow (with a CSRF `state`)                     |
| `/api/oauth/callback`  | GET    | Stores the refresh token                                               |
| `/api/calendar/create` | POST   | Create a Google event (gated)                                          |
| `/api/calendar/update` | POST   | Edit via `events.patch` (gated; recurring occurrences 409)             |
| `/api/calendar/delete` | POST   | Delete (gated; recurring 409; idempotent)                              |
| `/api/todos`           | GET    | Cached to-dos for a board's project                                    |
| `/api/todos/create`    | POST   | Add a task to Todoist                                                  |
| `/api/todos/complete`  | POST   | Close a task                                                           |
| `/api/todos/reopen`    | POST   | Reopen one, for the tick that was a mis-tap                            |

`isCalendarWriteEnabled()` in `lib/config` is the single gate for the OAuth scope, the write routes, the "+ Add event" button, and click-to-edit.

### Writes are confirmed, then cached

Every write route calls Google first. On success it writes the confirmed result straight into SQLite (`upsertEvent`, a single-row upsert that doesn't touch the rest of the calendar, or `deleteEvent`), so the change shows on the next poll instead of waiting up to 5 minutes for the sync. On failure nothing is cached and the error goes back to the form.

Recurring occurrences are blocked from edit and delete, in the UI and again in the routes. Each cached row is one expanded occurrence, and patching one through the events API would detach it from its series in ways that surprise people. The `recurring_event_id` column flags them; the modal shows a "manage in Google Calendar" notice.

## Auth

A six-digit PIN checked by `POST /api/auth`. Success sets an HMAC-SHA256 signed cookie (`lib/auth/session.ts`, Web Crypto). Sessions last 30 days and renew on use after 7, so an always-on kiosk never logs out. `proxy.ts` (the Next.js 16 name for middleware) gates every page and API route on that cookie.

The household PIN from `auth.pin` opens everything. A board may also declare its own `pin`, and a session minted with it is stamped with that board and opens only that board: the code a kid types on her bedroom panel is not the code that opens the kitchen wall, and it reaches neither `/setup` nor the OAuth routes. `lib/auth/board-access.ts` enforces the stamp.

An unstamped session opens everything, and that is deliberate rather than an oversight. The household PIN mints one on purpose: it keeps every cookie issued before per-board PINs existed working, which is why the family board's own case must never be stamped.

PIN attempts are rate-limited per client IP in memory (`lib/auth/rate-limit.ts`). Behind a reverse proxy the limiter keys on `X-Real-IP`, which is why the nginx config in [deployment.md](deployment.md) is careful about which header it forwards.

`DEV_AUTH_BYPASS=1` skips the gate in development only; production builds ignore it.

## Boards

One install serves any number of screens off the same database, sync, and Google connection. A **board** is one configured screen.

The **family board** is the kitchen wall: the dense layout the app has always had, served at `/`, built straight from the top-level config. A **personal board** is one person's 10" touch panel, served at `/b/<slug>` or at its own hostname when it declares a `host`. Hostname resolution happens in the page rather than the proxy, because middleware runs on the Edge runtime and cannot read a config file off disk.

A board is an override layer, never a replacement. It can replace a top-level value and can never supply a base one, so a config with no `boards` key resolves to exactly the values the wall used before boards existed. That is enforced by the shape of the thing rather than by anyone remembering. `lib/config/boards.ts` resolves it.

- A calendar marked `hidden` still syncs but reaches only a board that names it, which is how a kid's private room calendar stays off the kitchen wall while still having data behind it.
- Both grids are bounded by `scopeToCalendars`. The sync no longer fetches exactly what the wall draws, so an unbounded grid would leak a hidden calendar onto it.

A personal board owns its own chrome and shares only the presentational grids. It renders `WeekRow` and `MonthWeek` unchanged, so there is one definition of a week and a month house-wide, and it shares the measuring modules and the write routes. It never shares a form or a footer: bending `EventModal` around a second set of constraints is how the family board gets broken. Nothing on it takes text focus either, because an `<input>` invites a platform keyboard the Pi cannot show. The drawn on-screen keyboard writes into a `div`.

Every key is in [configuration.md](configuration.md#boards); the layout side is in [calendar.md](calendar.md#what-a-personal-board-borrows-personalweek-personalmonth).

## Google OAuth

One Google account, connected once at `/setup`. The refresh token is stored in SQLite (`lib/db/tokens.ts`) and exchanged for access tokens as needed (`lib/google/oauth.ts`). The requested scope follows `google.calendarAccess`: `calendar.readonly` by default, `calendar.events` for read-write. Changing the mode means re-consenting at `/setup` so Google issues a token with the new scope.

The OAuth routes sit behind the PIN gate. The session cookie is `SameSite=Lax`, which survives Google's redirect back.

## Shared events and "one event shown twice"

A family has several ways to get one event onto two people's calendars, and each one used to render as two chips. `lib/calendar/event-links.ts` is the single definition of what counts as the same event, in three tiers from strongest evidence to weakest:

1. **Stamp.** HomeHQ's own shared events: one real Google event per calendar, each stamped with the same id in `extendedProperties.private.homehqGroup` and mirrored into the `group_id` column. Created deliberately, so this tier has no size cap.
2. **Google.** The same `event_id` on two calendars. Google returns one id for an invite because it really is one event resource with a guest.
3. **Twin.** Identical title, start, end, and all-day flag with different ids: the same thing typed in once per person. This is the only tier that guesses, so it's capped at two calendars, and location and notes are left out of the key on purpose (real pairs routinely have notes on one copy only).

A stronger tier claims its members before a weaker one runs, so a stamped pair can never be widened by a lookalike. The grids merge with this file and the update/delete routes resolve siblings with it. That sharing matters: if the read side and write side ever disagreed about membership, editing a shared event could insert a third copy.

What saving does per tier: a **twin** pair is adopted (both copies patched and stamped, so the guess becomes a fact). A **google** link is never stamped (the private property belongs to one calendar's copy; the sibling would keep a null `group_id` and the pair would stop merging) and gets exactly one patch, with both cache rows written from that one response. Its membership is locked in the modal and the route 409s if it changes, because ticking another calendar wouldn't add a guest, it would create an unrelated second event.

We looked at using Google's attendee/invite mechanism for shared events instead of per-calendar copies and rejected it: it still creates separate event resources (so the read side dedupes anyway), the guest copy lands asynchronously (breaking confirmed-then-cached), and it forces a fake organiser/guest hierarchy on what is really one household event.

## Resilience

The dashboard always shows cached data. If Google is down, auth breaks, or the droplet reboots, the last synced events stay on the wall and the footer indicator goes amber. There is no state that renders a blank screen.

## Kiosk self-update

The dashboard is a long-lived single-page app: a deploy ships new code, but a kiosk that has been open for a week keeps running the bundle it booted with. The page is stamped with a build token (`getDeployVersion` in `lib/version.ts` reads `data/deploy-version`), and `CalendarGrid` polls `/api/version` once a minute, hard-reloading when the token changes. `scripts/deploy.sh` stamps the git SHA on every deploy; `scripts/kiosk-reload.sh` writes a `manual-<epoch>` token to force a refresh after a config-only change.

It can't loop: the reloaded page is served with the new token as its baseline, and a fetch error never triggers a reload.

## Styling

Plain hand-authored CSS, no framework. Design tokens (palette, type scale, leading, weight) are CSS custom properties in `styles/tokens.css`. A reset and the root `clamp()` that scales the whole layout with viewport height live in `styles/base.css`. Each area has its own stylesheet with a class prefix (`cal-` week grid, `mon-` month view, `wx-` weather, `tb-`/`clk-` top bar and clock, `auth-` login), all `@import`ed from `app/globals.css`. Dynamic values (calendar colours, grid spans) stay inline.

Everything is sized in `rem` off that root `clamp()`, which is what makes one layout work on a 27" 4K panel and a laptop. The one deliberate exception is month view, which scales its own font-size in `em` so its rows can be denser. See [calendar.md](calendar.md).

CSS is tab-indented; TypeScript is two-space. Prettier enforces both.

## Fonts and icons on a Raspberry Pi

A stock Raspberry Pi OS image has no colour emoji font, so any emoji in an event title rendered as a box. Rather than install a font on every Pi, the app self-hosts Noto Color Emoji (COLRv1) under `public/fonts/emoji/`, split into Google Fonts' ten `unicode-range` slices so a page only downloads the slice it needs (an emoji-free page fetches nothing). `npm run emoji-font` regenerates the files and `styles/fonts.css`.

One trap: those subsets claim the digits `0-9` (keycap bases). The emoji face must come _after_ Inter in the font stack or every number on the wall becomes a keycap emoji. `__tests__/emoji-font.test.ts` asserts the order.

Weather icons are inline SVGs for the same reason (`lib/weather/weather-icon-svgs.ts`, regenerated by `npm run weather-icons`).

Event-title icons take a third approach. Font Awesome Free ships as a server dependency, and the board looks up only the handful of glyphs a config names, handing the browser their path data. The catalogue never reaches the client, and adding a rule is a config edit and a restart rather than a rebuild. Font Awesome's own SVG-replacement script would not work here: it rewrites `<i>` into `<svg>` after the document renders, and the week grid measures event rows before paint, so every cell's `+N more` would be computed against rows that had not grown their icons yet. See [configuration.md](configuration.md#event-title-icons).

## Database

SQLite via better-sqlite3, WAL mode, migrated on boot from `lib/db/migrations/`. Tables: `calendar_events`, `weather_cache`, `todos`, `sync_status` (all caches), plus `oauth_tokens`. The refresh token is the only thing in the database that a sync can't regenerate, which is what makes it the one row worth backing up.

Tests never touch the default path: `getDb()` refuses `data/homehq.db` under Vitest and tests open temp files via `_setDefaultDb()`. (That guard exists because a fixture once wiped a live refresh token.)

## Project layout

```
proxy.ts                 auth gate
instrumentation.ts       starts the two sync schedulers
app/
  page.tsx               whichever board this hostname resolves to
  b/[slug]/              a board by URL path
  login/  setup/         PIN entry, Google connect
  api/                   routes listed above
components/
  board/                 FamilyBoard, PersonalBoard + PersonalShell and its
                         columns, sheets, and on-screen keyboard
  calendar/              CalendarView, CalendarGrid, WeekRow, EventItem, EventTitle,
                         MonthGrid/MonthWeek/MonthDayPopover, CalendarFooter,
                         EventModal, CalendarPicker, *-utils.ts
  clock/  weather/  dashboard/
lib/
  auth/                  session cookie, rate limiter, per-board access
  calendar/              event-links (what counts as one event), event-timing (form
                         validation), title-rules + title-icons (title icons)
  config/                config.json loader, board resolution, isCalendarWriteEnabled
  db/                    SQLite setup, migrations, queries
  google/                Calendar API client, OAuth, sync
  todoist/               Todoist client and sync
  weather/               Open-Meteo client, WMO code map, sync, icon SVGs
  version.ts             build token
styles/                  tokens, base, per-area stylesheets
scripts/                 deploy.sh, kiosk-reload.sh, config-sync.sh, cf-dns.sh,
                         asset generators
data/                    config.json, homehq.db, icons/ (gitignored),
                         config.example.json
```
