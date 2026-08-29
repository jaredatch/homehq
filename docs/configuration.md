# Configuration

HomeHQ reads two files at startup. Both are gitignored.

| File               | Holds                                              | Start from                 |
| ------------------ | -------------------------------------------------- | -------------------------- |
| `.env`             | Secrets: Google OAuth credentials, cookie key      | `.env.example`             |
| `data/config.json` | Everything else: calendars, location, PIN, display | `data/config.example.json` |

Config is validated on load. A bad value fails fast with a message naming the field, so if the server won't start, read the first line of the error.

## `.env`

| Variable               | Required | Notes                                                                                                       |
| ---------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | yes      | From Google Cloud Console. See [google-oauth-setup.md](google-oauth-setup.md).                              |
| `GOOGLE_CLIENT_SECRET` | yes      | Same.                                                                                                       |
| `COOKIE_SECRET`        | yes      | Signs the session cookie. Generate with `openssl rand -hex 32`. Use a different one for prod.               |
| `NEXT_PUBLIC_BASE_URL` | yes      | The URL the app is served at. `http://localhost:3000` in dev, `https://your-domain` in prod.                |
| `TODOIST_API_KEY`      | no       | Personal API token from Todoist → Settings → Integrations → Developer. Only needed if a board shows to-dos. |
| `HOMEHQ_DEV_ORIGINS`   | no       | Dev only. Comma-separated hosts allowed to reach `next dev` from another machine.                           |
| `DEV_AUTH_BYPASS`      | no       | Dev only. `1` skips the PIN gate. Ignored in production builds (`proxy.ts`).                                |

The deploy scripts (`scripts/deploy.sh`, `scripts/kiosk-reload.sh`) read `HOMEHQ_HOST` and `HOMEHQ_KEY` from the environment or from a gitignored `private/deploy.env`. See [deployment.md](deployment.md).

## `data/config.json`

The shape is defined in `lib/config/types.ts` (`AppConfig`). Everything marked optional has a default, so a minimal config is just calendars, weather, and a PIN.

### `calendars`

An array. Order matters: it's the order of the footer legend and the tie-break when a shared event picks a colour.

| Field       | Required | Notes                                                                                                                                                                                           |
| ----------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | yes      | The Google Calendar ID. `primary` for the signed-in account's own calendar, otherwise see below.                                                                                                |
| `name`      | yes      | Label shown in the legend. Keep it short (a first name).                                                                                                                                        |
| `color`     | yes      | Any CSS colour. Used for the event chip, the all-day bar fill, and the legend swatch.                                                                                                           |
| `textColor` | no       | Overrides the automatic black/white text on the all-day bar fill. Handy for white text on a light pink.                                                                                         |
| `hidden`    | no       | Sync this calendar, but keep it off any board that doesn't name it in `boards.<slug>.calendars`. This is how a private per-person calendar reaches one screen without reaching the family wall. |

**Finding a calendar ID.** In Google Calendar on the web, open the calendar's settings (the three dots next to its name → Settings and sharing), scroll to _Integrate calendar_, and copy _Calendar ID_. Personal calendars look like an email address; shared ones look like `abc123@group.calendar.google.com`. Every calendar listed must be visible to the Google account you connect at `/setup`.

### `weather`

| Field             | Required | Notes                                     |
| ----------------- | -------- | ----------------------------------------- |
| `latitude`        | yes      | Decimal degrees. Right-click Google Maps. |
| `longitude`       | yes      |                                           |
| `temperatureUnit` | yes      | `fahrenheit` or `celsius`.                |

Weather comes from [Open-Meteo](https://open-meteo.com/), which needs no API key.

### `display`

| Field                    | Default   | Notes                                                                                                                                                    |
| ------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calendarWeeks`          | required  | How many week rows the wall view shows. 2 fits a 27" panel well.                                                                                         |
| `showWeather`            | required  | `false` hides the weather panel in the top bar.                                                                                                          |
| `weekStartsOn`           | `monday`  | or `sunday`.                                                                                                                                             |
| `timezone`               | browser   | IANA zone (`America/Chicago`). Pins the clock and all event times to one zone regardless of the kiosk's OS clock. Leave unset to use the browser's zone. |
| `weatherIcons`           | `lucide`  | `lucide` · `meteocons` · `weather-icons` · `emoji`. The first three are self-hosted SVGs. See [Weather icons](#weather-icons).                           |
| `todayColor`             | `#60a5fa` | Colour of today's marker dot.                                                                                                                            |
| `expandResetSeconds`     | `300`     | How long "expand next week" stays up before the wall snaps back. `0` disables.                                                                           |
| `createFormResetSeconds` | `120`     | How long an idle event form stays open before it closes itself. `0` disables.                                                                            |
| `monthViewResetSeconds`  | `180`     | How long month view stays up when idle before reverting to the week grid. `0` disables.                                                                  |
| `filterResetSeconds`     | `300`     | How long a per-person filter stays applied when idle before showing everyone again. `0` disables.                                                        |

The four `*ResetSeconds` keys exist because the display is always on and nobody is there to put it back. Every transient state (month view, the filter, an open form, the expanded week) reverts on its own. The timers restart on any interaction, so they never fire while someone is mid-task.

### `auth`

| Field | Notes                                                                                                                                                                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pin` | Exactly six digits, as a string (`"482913"`). The household PIN, and a master key: it opens every board. The app refuses to start in production with the example `123456`. A board can also carry its own PIN, which opens only that board. See [`boards`](#boards). |

### `google`

| Field            | Default    | Notes                                                                                                                                                                                                                     |
| ---------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calendarAccess` | `readonly` | `readonly` shows events. `readwrite` adds create, edit, and delete from the dashboard. Switching to `readwrite` needs a re-consent at `/setup` because the OAuth scope changes (`calendar.readonly` → `calendar.events`). |
| `syncDaysBack`   | `60`       | How far back the sync caches events.                                                                                                                                                                                      |
| `syncDaysAhead`  | `210`      | How far ahead. This is the hard limit on how far month view can page before it shows empty cells that aren't really empty. Widen it if you want a longer look-ahead; the sync paginates, so large windows are fine.       |

### `boards`

One HomeHQ install can drive more than one screen: the kitchen wall, plus a touch panel in a kid's room. `boards` is an optional map keyed by URL slug.

A board is a set of overrides on top of the config you already have. Anything it doesn't name falls through to the top-level value, so a config with no `boards` key behaves exactly as it did before boards existed.

| Field             | Required | Notes                                                                                                                                                                                                   |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layout`          | yes      | `family` is the dense wall grid. `personal` is the three-column touch surface: agenda, to-dos, clock and weather.                                                                                       |
| `name`            | no       | Shown in the header and on the PIN screen. Defaults to the slug.                                                                                                                                        |
| `host`            | no       | A hostname that serves this board at `/`, so a kiosk URL needs no path. Unclaimed hosts fall through to the family board.                                                                               |
| `pin`             | no       | Six digits. Opens only this board. Without it, the household PIN is the only way in.                                                                                                                    |
| `accent`          | no       | Any CSS colour. Defaults to the colour of this board's own calendar.                                                                                                                                    |
| `calendars`       | no       | Which calendar ids this board draws, in draw order. Omitted means all of them except the `hidden` ones.                                                                                                 |
| `ownCalendars`    | no       | Which of those belong to this board's person. Sets the person picker's default and the accent, and decides which events this board can edit. Omitted means all of them, which leaves nobody to peek at. |
| `alwaysShow`      | no       | Calendars that stay in view whoever the picker is set to. Usually the family calendar, since a family dinner is this person's evening too.                                                              |
| `defaultCalendar` | no       | Where a new event lands by default. On a personal board that's the private calendar, and the create form offers a choice between "Just me" and "Family".                                                |
| `todos`           | no       | `{ "projectId": "..." }`. The Todoist project this board's to-do column reads and writes. Needs `TODOIST_API_KEY`.                                                                                      |
| `display`         | no       | Any subset of the `display` block, merged over the top level. Lets one board have its own idle timings or hide weather.                                                                                 |

Ids in `calendars`, `ownCalendars`, `alwaysShow`, and `defaultCalendar` are all checked at startup. A typo fails the boot rather than rendering a convincingly empty screen in someone's bedroom.

```jsonc
"boards": {
  "kida": {
    "layout": "personal",
    "name": "Kid A",
    "host": "kida.example.com",
    "pin": "246810",
    "calendars": ["family@group.calendar.google.com", "kida@group.calendar.google.com", "kida-room@group.calendar.google.com"],
    "ownCalendars": ["kida@group.calendar.google.com", "kida-room@group.calendar.google.com"],
    "alwaysShow": ["family@group.calendar.google.com"],
    "defaultCalendar": "kida-room@group.calendar.google.com",
    "todos": { "projectId": "6hP9HWrf5fXR56JJ" }
  }
}
```

**Reaching a board.** `/b/<slug>` always works, so a kiosk with no DNS of its own can point at `http://homehq.local:3000/b/kida`. Subdomains are a convenience on top: give a board a `host` and that hostname serves it at `/`.

**PINs.** The household PIN opens everything, so a parent is never locked out. A board's own PIN opens only that board, and it can't reach `/setup` or the OAuth routes. Each hostname holds its own session cookie, so every screen is signed in once and stays that way.

## Weather icons

Four sets, chosen by `display.weatherIcons`:

- `lucide` (default). Line-art SVGs. Render everywhere, including a bare Raspberry Pi.
- `meteocons`. Colour SVGs.
- `weather-icons`. The classic Erik Flowers set, SVG.
- `emoji`. Uses the self-hosted emoji font, so it also works on the Pi.

The SVG sets are inlined in `lib/weather/weather-icon-svgs.ts`, regenerated from Iconify with `npm run weather-icons`. WMO weather codes map to icons in `lib/weather/wmo.ts`.

## Applying a change

`config.json` is re-read within a minute (`getConfig` caches it briefly), so most edits show up on the next poll without a restart. Two exceptions: `.env` is read at boot, and a change to `google.calendarAccess` needs a re-consent at `/setup`. On a wall kiosk that has been open for days, run `scripts/kiosk-reload.sh` to force a refresh after a config-only change.
