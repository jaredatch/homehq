# HomeHQ

HomeHQ is a self-hosted family dashboard for a wall-mounted display. It replaces Dakboard with a dense dark-theme calendar, clock, and weather dashboard backed by Google Calendar, Open-Meteo, and a local SQLite cache.

The project guide (for contributors and AI agents) is [CLAUDE.md](./CLAUDE.md). The implementation roadmap is [PLAN.md](./PLAN.md). Local setup and troubleshooting live in [BOOTSTRAP.md](./BOOTSTRAP.md). Production setup lives in [docs/deployment.md](./docs/deployment.md), and the Google Cloud walkthrough in [docs/google-oauth-setup.md](./docs/google-oauth-setup.md).

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Checks

```bash
npm test
npm run lint
npm run format:check
npm run build
```

## Runtime Data

- `data/config.json` contains human-edited household settings and is gitignored.
- `.env` contains secrets and is gitignored.
- `data/homehq.db` contains OAuth tokens and cached provider data and is gitignored.

Start by copying `data/config.example.json` to `data/config.json` and `.env.example` to `.env`, then follow [BOOTSTRAP.md](./BOOTSTRAP.md).
