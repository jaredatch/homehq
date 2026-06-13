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
