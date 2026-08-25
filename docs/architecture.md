# Architecture

HomeHQ is a Next.js 16 (App Router) app with a SQLite cache in the middle. The browser never talks to Google or Open-Meteo; a pair of background jobs on the server do, and the dashboard reads whatever they last wrote.

```
Google Calendar ──(every 5 min)──┐
                                  ├──► SQLite (data/homehq.db) ──► API routes ──► browser (polls)
Open-Meteo ──────(every 30 min)──┘
```

That shape buys three things: credentials stay server-side, the wall keeps showing the last good data through any outage, and rendering never waits on an external API.

## Server-side sync

Both schedulers start once, from `instrumentation.ts`, when the server boots.

- **Calendar** (`lib/google/sync.ts`): every 5 minutes, for each calendar in `config.json`, fetch events in a window of 60 days back to 210 days ahead (`google.syncDaysBack` / `syncDaysAhead`), expand recurrences (`singleEvents: true`, so each row is one occurrence), normalise, and replace that calendar's rows wholesale (`upsertCalendarEvents`). The fetch paginates, so a wide window is safe. The window is also the hard limit on how far the UI can look: past it the cache has no rows and month view would show empty cells that aren't empty.
- **Weather** (`lib/weather/sync.ts`): every 30 minutes, fetch current conditions and the forecast for the configured lat/long from Open-Meteo (no API key) and cache the JSON.

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

`isCalendarWriteEnabled()` in `lib/config` is the single gate for the OAuth scope, the write routes, the "+ Add event" button, and click-to-edit.

### Writes are confirmed, then cached

Every write route calls Google first. On success it writes the confirmed result straight into SQLite (`upsertEvent`, a single-row upsert that doesn't touch the rest of the calendar, or `deleteEvent`), so the change shows on the next poll instead of waiting up to 5 minutes for the sync. On failure nothing is cached and the error goes back to the form.

Recurring occurrences are blocked from edit and delete, in the UI and again in the routes. Each cached row is one expanded occurrence, and patching one through the events API would detach it from its series in ways that surprise people. The `recurring_event_id` column flags them; the modal shows a "manage in Google Calendar" notice.

## Auth

A single six-digit PIN for the household, checked by `POST /api/auth`. Success sets an HMAC-SHA256 signed cookie (`lib/auth/session.ts`, Web Crypto). Sessions last 30 days and renew on use after 7, so an always-on kiosk never logs out. `proxy.ts` (the Next.js 16 name for middleware) gates every page and API route on that cookie.

PIN attempts are rate-limited per client IP in memory (`lib/auth/rate-limit.ts`). Behind a reverse proxy the limiter keys on `X-Real-IP`, which is why the nginx config in [deployment.md](deployment.md) is careful about which header it forwards.

`DEV_AUTH_BYPASS=1` skips the gate in development only; production builds ignore it.

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

## Database

SQLite via better-sqlite3, WAL mode, migrated on boot from `lib/db/migrations/`. Tables: `calendar_events` (cache), `weather_cache`, `oauth_tokens`, `sync_status`. The OAuth refresh token is the only thing in it that can't be regenerated by a sync.

Tests never touch the default path: `getDb()` refuses `data/homehq.db` under Vitest and tests open temp files via `_setDefaultDb()`. (That guard exists because a fixture once wiped a live refresh token.)

## Project layout

```
proxy.ts                 auth gate
instrumentation.ts       starts the two sync schedulers
app/
  page.tsx               the dashboard (TopBar + CalendarView)
  login/  setup/         PIN entry, Google connect
  api/                   routes listed above
components/
  calendar/              CalendarView, CalendarGrid, WeekRow, EventItem,
                         MonthGrid/MonthWeek/MonthDayPopover, CalendarFooter,
                         EventModal, CalendarPicker, *-utils.ts
  clock/  weather/  dashboard/
lib/
  auth/                  session cookie, rate limiter
  calendar/              event-links (what counts as one event), event-timing (form validation)
  config/                config.json loader + isCalendarWriteEnabled
  db/                    SQLite setup, migrations, queries
  google/                Calendar API client, OAuth, sync
  weather/               Open-Meteo client, WMO code map, sync, icon SVGs
  version.ts             build token
styles/                  tokens, base, per-area stylesheets
scripts/                 deploy.sh, kiosk-reload.sh, asset generators
data/                    config.json + homehq.db (gitignored), config.example.json
```
