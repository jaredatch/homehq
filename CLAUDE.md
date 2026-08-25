# CLAUDE.md

Guidance for Claude Code (and other agents, via `AGENTS.md`) working in this repo.

## What this is

HomeHQ: a self-hosted family calendar dashboard for an always-on wall display (Raspberry Pi kiosk, 27" 4K panel). Next.js 16 App Router, TypeScript, plain CSS, SQLite via better-sqlite3, Google Calendar + Open-Meteo synced server-side into the DB. Live in production for one household; deployed with `./scripts/deploy.sh`.

The docs are the source of truth, not this file:

- `docs/architecture.md`: sync, cache, routes, auth, writes, shared-event linking, self-update, styling, DB
- `docs/calendar.md`: how the grid lays out, crops, and reverts, and every hard-won layout trap
- `docs/configuration.md`: every `config.json` / `.env` key
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

## Rules that are easy to break

1. **Wall-never-sticks.** Every transient UI state (month view, expand, filter, an open modal) is never persisted and auto-reverts after idle via a `display.*ResetSeconds` key. No new feature may leave the wall in a non-default state.
2. **Wall-default byte-for-byte.** A calendar change must leave the default week render pixel-identical for data that doesn't use it. Prove it with a normalised DOM geometry diff of `.cal-weeks` at 1920×1080 against a DB with none of the feature's data. "It's supposed to look different" is never a reason to skip the diff. That's why month view is a separate component and the filter's off state returns the same `events` reference.
3. **Never hit external APIs on render.** Browser reads the SQLite cache through API routes; only the schedulers in `instrumentation.ts` talk to Google/Open-Meteo.
4. **Tests never open `data/homehq.db`.** `getDb()` refuses the default path under Vitest; use a temp path + `_setDefaultDb()`.
5. **Timestamps are ISO 8601 UTC with `Z`.** Never SQLite's `datetime('now')` for anything a browser parses.
6. **`lib/calendar/event-links.ts` is the one definition of "same event."** Grids merge with it and update/delete resolve siblings with it. A read/write disagreement inserts a third copy.
7. **Plain CSS only.** Tokens in `styles/tokens.css`, per-area prefixed stylesheets, `rem` everywhere except inside `.mon-calendar` (`em`). No Tailwind, no CSS Modules. CSS is tab-indented, TS two-space.
8. **Font stack order.** Inter before the emoji face, or every digit on the wall becomes a keycap. `__tests__/emoji-font.test.ts` guards it.
9. **`isCalendarWriteEnabled()`** is the single gate for the OAuth scope, the write routes, the button, and click-to-edit.

## Layout traps (details in docs/calendar.md)

- `.cal-measure` must stay `overflow: hidden`; `.app-main` is `overflow: clip`.
- `.cal-band-label` must stay `display: inline` with symmetric vertical padding.
- `.cal-modal` is 27rem because three native date/time inputs need ~23.7rem; a squeezed date input clips its value. `.cal-field--date` never shrinks.
- Google's all-day `end.date` is exclusive; the UI shows the inclusive last day. Convert on both read and write.
- Month view has no measurement layer by design. If it seems to need one, the design drifted.
- `--cal-stripe-angle` is 135deg (45deg draws a backslash).

## Working with the maintainer

- Verify layout by measuring the DOM, not by looking at screenshots.
- Restart `npm run dev` after touching sync code; the scheduler module graph doesn't hot-reload.
- Keep public files generic. No household names, hostnames, IPs, or coordinates in tracked files, commit messages, or docs; those go in `private/`.
- `data/config.json`, `.env`, and `data/homehq.db` are gitignored and the DB holds the live OAuth token. Never commit a backup of it.
