# HomeHQ — Bootstrap & Development Guide

## Prerequisites

- Node.js 24 (current Active LTS)
- npm

## Initial Setup

```bash
# Install dependencies
npm install

# Create config from template
cp data/config.example.json data/config.json

# Create .env from template
cp .env.example .env
# Then edit .env with your actual secrets (see below)
```

### Environment Variables (`.env`)

| Variable               | Description                               | Required |
| ---------------------- | ----------------------------------------- | -------- |
| `GOOGLE_CLIENT_ID`     | Google OAuth client ID                    | Yes      |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret                | Yes      |
| `COOKIE_SECRET`        | Secret for signing session cookies        | Yes      |
| `NEXT_PUBLIC_BASE_URL` | App URL (default `http://localhost:3000`) | Yes      |

### Config (`data/config.json`)

Edit to match your household — calendar IDs, weather location, PIN. See `data/config.example.json` for the expected shape.

Optional `display` settings (all default sensibly; the example file lists them):

- `timezone` — IANA zone (e.g. `"America/Chicago"`) for the clock + event times, independent of the machine's OS clock. Omit for browser-local.
- `weatherIcons` — `lucide` (default) · `meteocons` · `weather-icons` · `emoji`.
- `todayColor` — today's marker dot color (any CSS color; default blue).
- `weekStartsOn` — `monday` (default) or `sunday`.

Calendar write access is opt-in via `google.calendarAccess`: `readonly` (default — display only,
`calendar.readonly` scope) or `readwrite` (enables create / edit / delete from the dashboard,
`calendar.events` scope). Switching to `readwrite` requires re-running OAuth at `/setup` so Google
re-issues a token with the wider scope — see `docs/google-oauth-setup.md`.

## Development

```bash
npm run dev              # Start dev server (http://localhost:3000)
```

## Build & Run (Production)

```bash
npm run build            # Production build
npm run start            # Start production server
```

## Testing

```bash
npm test                 # Run all tests (Vitest, single pass)
npm run test:watch       # Run tests in watch mode
```

## Linting & Formatting

```bash
npm run lint             # ESLint check
npm run format:check     # Prettier check (no changes)
npm run format           # Prettier auto-fix
```

## Data Files

All runtime data lives in `data/` (gitignored except the example config):

| File                       | Created by     | Notes                                 |
| -------------------------- | -------------- | ------------------------------------- |
| `data/config.json`         | You (manual)   | Copy from example template            |
| `data/config.example.json` | Committed      | Template — do not edit in place       |
| `data/homehq.db`           | App at runtime | SQLite DB, auto-migrated on first run |

## Troubleshooting

### `next build` fails with `useContext` / `<Html>` errors

Make sure `NODE_ENV` is **not** set to `development` in your shell profile. Next.js sets it automatically. Check with:

```bash
echo $NODE_ENV
```

If set, remove it from `~/.zshrc` (or equivalent) and open a new terminal.

### Config errors on startup

The app validates `data/config.json` on load. Common issues:

- File missing — copy from `data/config.example.json`
- Invalid PIN — must be exactly 6 digits (as a string, e.g. `"123456"`)
- Missing fields — compare against the example template
- Invalid `display.weatherIcons` — must be one of `lucide`, `meteocons`, `weather-icons`, `emoji`
- Invalid `display.timezone` — must be a valid IANA zone (e.g. `America/Chicago`)

### A long-running `npm run dev` keeps syncing stale data

**Restart the dev server after changing anything the background sync touches** —
`lib/google/sync.ts`, `normalizeEvent`, or the DB write helpers.

The sync schedulers start **once**, from `instrumentation.ts`, when the server boots. Next's dev
hot-reload swaps route handlers and client code, but it never re-instantiates that module graph, so
a server you left running yesterday keeps executing yesterday's sync code — against today's
database, every 5 minutes.

It fails in a way that looks like a product bug rather than a stale process: writes made through the
(hot-reloaded, current) API routes land correctly, then the next background sync quietly overwrites
them with what the old code produces. When shared events shipped, a day-old dev server kept blanking
every `group_id` five minutes after each event was created — the events were correct on Google the
whole time.

Tell-tale: a row's `updated_at` matches `sync_status.last_success` and the new column is empty.
Restarting the server and letting one sync run repopulates it.
