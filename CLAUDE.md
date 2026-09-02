# CLAUDE.md

Guidance for Claude Code (and other agents, via `AGENTS.md`) working in this repo.

## What this is

HomeHQ: a self-hosted family calendar dashboard for an always-on wall display (Raspberry Pi kiosk, 27" 4K panel). Next.js 16 App Router, TypeScript, plain CSS, SQLite via better-sqlite3, Google Calendar + Open-Meteo synced server-side into the DB. Live in production for one household; deployed with `./scripts/deploy.sh`.

One install serves any number of **boards** — configured screens off the same DB, sync, and OAuth. The **family board** is the kitchen wall (`/`). A **personal board** is one person's 10" touch panel: three columns, a drawn on-screen keyboard, writes scoped to their own calendars (`/b/<slug>`, or its own hostname).

The docs are the source of truth, not this file:

- `docs/architecture.md`: sync, cache, routes, auth, writes, shared-event linking, self-update, styling, DB
- `docs/calendar.md`: how the grid lays out, crops, and reverts, and every hard-won layout trap
- `docs/configuration.md`: every `config.json` / `.env` key, including the `boards` block
- `docs/deployment.md`, `docs/google-oauth-setup.md`: ops
- `BOOTSTRAP.md`: dev setup, commands, troubleshooting. `CONTRIBUTING.md`: PR expectations.
- `private/` (gitignored, maintainer-only): the live host, ops notes, the roadmap/punch list (`private/TODO.md`), feature plans, archived specs. Household names and the origin IP live only there.

## Commands

```bash
npm run dev            # http://localhost:3000 (DEV_AUTH_BYPASS=1 skips the PIN)
npm test               # Vitest
npm run lint
npm run format:check   # Prettier (npm run format to write)
npm run build
```

Pre-commit gate: all four of test, lint, format:check, build clean. CI runs the same.

If `DEV_AUTH_BYPASS=1` is set in your `.env`, plain `npm run dev` skips the PIN. Run with `DEV_AUTH_BYPASS=0` when you need to see the login screen itself.

## Rules that are easy to break

1. **Wall-never-sticks.** Every transient UI state (month view, expand, filter, an open modal) is never persisted and auto-reverts after idle via a `display.*ResetSeconds` key. No new feature may leave the wall in a non-default state.
2. **Wall-default byte-for-byte.** A calendar change must leave the default week render pixel-identical for data that doesn't use it. Prove it with a normalised DOM geometry diff of `.cal-weeks` at 1920×1080 against a DB with none of the feature's data. "It's supposed to look different" is never a reason to skip the diff. That's why month view is a separate component and the filter's off state returns the same `events` reference.
3. **Never hit external APIs on render.** Browser reads the SQLite cache through API routes; only the schedulers in `instrumentation.ts` talk to Google/Open-Meteo.
4. **Tests never open `data/homehq.db`.** `getDb()` refuses the default path under Vitest; use a temp path + `_setDefaultDb()`.
5. **Timestamps are ISO 8601 UTC with `Z`.** Never SQLite's `datetime('now')` for anything a browser parses.
6. **`lib/calendar/event-links.ts` is the one definition of "same event."** Grids merge with it and update/delete resolve siblings with it. A read/write disagreement inserts a third copy. Related: `display.titleIcons` rewrites a title only as it is DRAWN (`lib/calendar/title-rules.ts`, no match = the bare string, so the wall default is untouched). Never at sync, never in the DB, never in a modal or a tooltip — a rewritten `summary` would make the linking key disagree with itself.
7. **Plain CSS only.** Tokens in `styles/tokens.css`, per-area prefixed stylesheets, `rem` everywhere except inside `.mon-calendar` (`em`). No Tailwind, no CSS Modules. CSS is tab-indented, TS two-space.
8. **Font stack order.** Inter before the emoji face, or every digit on the wall becomes a keycap. `__tests__/emoji-font.test.ts` guards it.
9. **`isCalendarWriteEnabled()`** is the single gate for the OAuth scope, the write routes, the button, and click-to-edit.
10. **Boards only override.** A board replaces a top-level value and never supplies a base one, so a config with no `boards` key resolves to exactly the pre-boards values. Related: a `hidden` calendar syncs but reaches only a board that names it, and both grids are bounded by `scopeToCalendars` — the sync no longer fetches exactly what the wall draws, so an unbounded grid leaks. `GET /api/calendar` scopes the same way (`?board=<slug>`, `lib/calendar/board-scope.ts`), and takes the board from the SESSION stamp first so a panel can't widen itself by dropping the param. The family board is unscoped on purpose: `EventModal` resolves shared-event membership AND its lock from the list it was sent, so a subset would silently drop a person on save. A scoped response instead carries server-resolved `linkedCalendarIds` on every event — never let the personal board fall back to resolving links from the events it can see, or the tier-2/3 two-calendar cap makes the client disagree with the write routes.
11. **A session is stamped with the board that minted it; absence means "opens everything".** The household PIN mints an unstamped session on purpose — that's what keeps every cookie issued before per-board PINs working, and why the family case must never be stamped.
12. **The personal board owns its own chrome, and shares only presentational grids.** It renders `WeekRow` and `MonthWeek` unchanged (one definition of a week and a month house-wide) plus the shared measuring in `week-metrics.ts` / `month-metrics.ts`, and it shares the write _routes_. It never shares a form or a footer: bending `EventModal` or `CalendarFooter` around a second set of constraints is how the family board gets broken. And nothing there takes text focus: the drawn keyboard writes into a `div`, because an `<input>` invites a platform keyboard the Pi can't show.

## Layout traps (details in docs/calendar.md)

- `.cal-measure` must stay `overflow: hidden`; `.app-main` is `overflow: clip`.
- `.cal-band-label` must stay `display: inline` with symmetric vertical padding.
- `.cal-modal` is 27rem because three native date/time inputs need ~23.7rem; a squeezed date input clips its value. `.cal-field--date` never shrinks.
- Google's all-day `end.date` is exclusive; the UI shows the inclusive last day. Convert on both read and write.
- `eventDaySpan()` is the one definition of which days an event covers, and the band takes `bandEvents()` — all-day events **plus timed events crossing midnight**. Never feed a raw timed event to `computeWeekSegments`: a date is a string prefix of its own timestamp, so `"2026-09-01" < "2026-09-01T20:00:00-05:00"` is true and the bar lands a column late.
- A band bar's height must equal its `.cal-band-spacer` exactly or the overlay drifts off every reserved lane. A timed bar's times are scoped to `--timed` and positioned out of flow for that reason.
- Month view has no measurement layer by design. If it seems to need one, the design drifted.
- A day popover mounts in `.cal-grid` / `.mon-calendar`, never in `.cal-weeks` / `.mon-grid` — those are `overflow: clip` and hold the measuring. The wall and month view each own their popover and share only `popoverLayout()`; `.mon-pop` is `em` against month view's `clamp()` font size and is not portable.
- A grid's measuring is shared with the personal board; its **space policy is not**. The wall's anchor week, "expand next week", and the collapse rule live in `wall-layout.ts` (pure + unit-tested); a personal board just fills its one row.
- An icon drawn inside a title must be `display: inline-block`. `base.css` resets `img, svg, video, canvas` to `display: block` so icons don't pick up baseline whitespace, and a block inside a title takes a line of its own: `.cal-band-bar` grew from 29.5px to 47px against a 29.5px spacer and the whole all-day overlay slid off its lanes. `.cal-title-icon` is 1em at `vertical-align: -0.125em`, which fits inside the line box Inter already makes at every leading here. Verified equal to the spacer at 1920x1080 and at the wall's 43.2px root.
- `--cal-stripe-angle` is 135deg (45deg draws a backslash).
- The footer's top rule is an inset box-shadow, never a `border-top` — a border would take a pixel off `.cal-weeks` and move every week track. And never size a grid track to `availH` in px: it comes from `clientHeight` (a rounded integer), so the container's fractional remainder shows as a sub-pixel hairline. The last track takes `1fr`.

## Working with the maintainer

- Verify layout by measuring the DOM, not by looking at screenshots.
- Restart `npm run dev` after touching sync code; the scheduler module graph doesn't hot-reload.
- Keep public files generic. No household names, hostnames, IPs, or coordinates in tracked files, commit messages, or docs; those go in `private/`.
- `data/config.json`, `.env`, and `data/homehq.db` are gitignored and the DB holds the live OAuth token. Never commit a backup of it.
- `data/config.json` is cached for 60 seconds in-process. After editing it, restart dev — otherwise the change looks ignored and you debug the wrong thing.
- Config and DNS don't travel with `deploy.sh`. `./scripts/config-sync.sh [diff|push|env]` pushes `config.json` (backs up, restarts, health-checks, rolls back); `./scripts/cf-dns.sh [list|add]` manages the domain's records.
