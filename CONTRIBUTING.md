# Contributing

Thanks for looking. HomeHQ is a small project built for one household, so the bar for a change is "does this make the wall better without making it fragile". Bug reports, small fixes, and focused features are welcome. Big new directions (other calendar providers, a settings UI, multi-tenant anything) are probably better as a fork; see the README's [Not on the roadmap](README.md#not-on-the-roadmap).

## Before you open a PR

Setup and commands are in [BOOTSTRAP.md](BOOTSTRAP.md). The gate is:

```bash
npm test && npm run lint && npm run format:check && npm run build
```

CI runs the same. Prettier is the formatter (CSS tab-indented, TypeScript two-space); run `npm run format` rather than fighting it.

## What a good change looks like

- One thing per PR, with a commit message that says why, not just what. The history here is written that way on purpose.
- If it touches the calendar grid, read [docs/calendar.md](docs/calendar.md) first. Two rules matter more than anything else: nothing transient may persist or stay up after idle, and the default week render must be byte-for-byte unchanged for data that doesn't use your feature. Say in the PR how you checked the second one (a DOM geometry diff at 1920×1080, not a screenshot).
- New config keys get a default, a line in `lib/config/types.ts`, validation in `lib/config/index.ts`, a row in [docs/configuration.md](docs/configuration.md), and an entry in `data/config.example.json`.
- Tests for pure logic. Don't add a component test harness; the project deliberately doesn't render components in Vitest.
- No new CSS frameworks, no CSS Modules, no Tailwind. Plain stylesheets under `styles/` with the area prefix.
- Keep it working on a Raspberry Pi: no fonts or icons that assume a desktop OS is installed.

## Reporting a bug

Open an issue with what you expected, what happened, and your `config.json` with the calendar IDs and PIN removed. For layout bugs, the viewport size and device scale factor help a lot.

## Security

If you find something security-relevant (the PIN gate, the OAuth flow, the session cookie), use GitHub's private vulnerability reporting on this repo rather than a public issue.
