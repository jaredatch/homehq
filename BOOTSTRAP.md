# Development guide

Local setup, the commands you'll use, and the handful of things that trip people up.

## Setup

Node 24 (current LTS) and npm.

```bash
npm install
cp .env.example .env                          # Google OAuth credentials + cookie secret
cp data/config.example.json data/config.json  # calendars, location, PIN
npm run dev                                   # http://localhost:3000
```

`.env` needs a Google client ID and secret ([docs/google-oauth-setup.md](docs/google-oauth-setup.md)) and a `COOKIE_SECRET` (`openssl rand -hex 32`). Every key in both files is described in [docs/configuration.md](docs/configuration.md).

Enter your PIN at the login screen, then go to `/setup` to connect Google. The first calendar sync runs on boot and every 5 minutes after.

To skip the PIN while developing, run `DEV_AUTH_BYPASS=1 npm run dev`. Production builds ignore it.

## Commands

```bash
npm run dev            # dev server with hot reload
npm run build          # production build
npm run start          # serve the production build
npm test               # Vitest, one pass
npm run test:watch     # Vitest in watch mode
npm run lint           # ESLint
npm run format         # Prettier, write
npm run format:check   # Prettier, check only
npm run weather-icons  # regenerate lib/weather/weather-icon-svgs.ts from Iconify
npm run emoji-font     # regenerate public/fonts/emoji/ and styles/fonts.css
```

Before committing: `npm test`, `npm run lint`, `npm run format:check`, and `npm run build` all clean. CI runs the same four.

## Testing

Vitest, deliberately light: the pure logic (layout packing, event linking, date math, filter), the DB layer, the auth pieces, and the write routes with Google mocked. UI components aren't rendered in tests; layout changes are verified against a real browser instead (see [docs/calendar.md](docs/calendar.md#checking-a-layout-change)).

Tests never open `data/homehq.db`. `getDb()` refuses the default path under Vitest, so a test that needs a database opens a temp file and calls `_setDefaultDb()`. Keep it that way; a fixture once wiped a live OAuth token.

## Working on the layout

The target is a 27" 4K panel at device scale factor 2, so a 1920×1080 browser viewport is the real layout. Everything is sized in `rem` off a root `clamp()` in `styles/base.css`; keep new CSS in `rem` (or `em` inside month view) so it scales with the wall.

To see the app on the actual display before the server exists, point a Pi's Chromium at your machine's dev server. `next dev` prints a `Network:` URL; add the Pi's hostname or IP to `HOMEHQ_DEV_ORIGINS` in `.env` so hot-reload assets are allowed through. [docs/deployment.md](docs/deployment.md#testing-on-the-pi-before-the-server-exists) has the details.

## Runtime data

Everything in `data/` except the example config is gitignored.

| File                       | Created by     | Notes                                          |
| -------------------------- | -------------- | ---------------------------------------------- |
| `data/config.json`         | you            | Copy from the example                          |
| `data/config.example.json` | committed      | The template; edit your copy, not this         |
| `data/homehq.db`           | app at runtime | SQLite, WAL mode, migrated on first run        |
| `data/deploy-version`      | deploy script  | Build token the kiosk polls (see architecture) |

## Troubleshooting

**Config errors on startup.** The app validates `config.json` on load and the error names the field. Common ones: file missing (copy the example), PIN not a six-digit string, `display.weatherIcons` not one of the four sets, `display.timezone` not a valid IANA zone. In production the example PIN `123456` is refused outright.

**`next build` fails with `useContext` or `<Html>` errors.** `NODE_ENV=development` is set in your shell profile. Next sets it itself; remove yours (`echo $NODE_ENV` to check) and open a new terminal.

**A long-running dev server keeps overwriting data.** Restart `npm run dev` after changing anything the background sync touches (`lib/google/sync.ts`, `normalizeEvent`, the DB write helpers). The sync schedulers start once, from `instrumentation.ts`, and Next's hot reload never re-instantiates that module graph. So a server left running overnight keeps executing yesterday's sync code against today's database every 5 minutes. It looks like a product bug: writes through the (hot-reloaded, current) API routes land correctly, then the next sync quietly reverts them. The tell is a row whose `updated_at` matches `sync_status.last_success` and a new column that's empty.

**Sync indicator says "Sync failing".** If it adds "reconnect Google at `/setup`", the refresh token is gone: revoked, or (for an External Google app still in Testing) expired after seven days ([why, and the fix](docs/google-oauth-setup.md#4b-external-apps-only-publish-to-production)). Otherwise the full error is in the server log (`[sync]` lines in the dev console, or `journalctl -u homehq` in production).

**Emoji render as boxes on the Pi.** They shouldn't; the app ships its own emoji font. If they do, check that `styles/fonts.css` lists Inter before the emoji face and that `public/fonts/emoji/` has all ten slices. `npm test` covers both.
