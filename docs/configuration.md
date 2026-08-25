# Configuration

HomeHQ reads two files at startup. Both are gitignored.

| File               | Holds                                              | Start from                 |
| ------------------ | -------------------------------------------------- | -------------------------- |
| `.env`             | Secrets: Google OAuth credentials, cookie key      | `.env.example`             |
| `data/config.json` | Everything else: calendars, location, PIN, display | `data/config.example.json` |

Config is validated on load. A bad value fails fast with a message naming the field, so if the server won't start, read the first line of the error.

## `.env`

| Variable               | Required | Notes                                                                                         |
| ---------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | yes      | From Google Cloud Console. See [google-oauth-setup.md](google-oauth-setup.md).                |
| `GOOGLE_CLIENT_SECRET` | yes      | Same.                                                                                         |
| `COOKIE_SECRET`        | yes      | Signs the session cookie. Generate with `openssl rand -hex 32`. Use a different one for prod. |
| `NEXT_PUBLIC_BASE_URL` | yes      | The URL the app is served at. `http://localhost:3000` in dev, `https://your-domain` in prod.  |
| `HOMEHQ_DEV_ORIGINS`   | no       | Dev only. Comma-separated hosts allowed to reach `next dev` from another machine.             |
| `DEV_AUTH_BYPASS`      | no       | Dev only. `1` skips the PIN gate. Ignored in production builds (`proxy.ts`).                  |

The deploy scripts (`scripts/deploy.sh`, `scripts/kiosk-reload.sh`) read `HOMEHQ_HOST` and `HOMEHQ_KEY` from the environment or from a gitignored `private/deploy.env`. See [deployment.md](deployment.md).

## `data/config.json`

The shape is defined in `lib/config/types.ts` (`AppConfig`). Everything marked optional has a default, so a minimal config is just calendars, weather, and a PIN.

### `calendars`

An array. Order matters: it's the order of the footer legend and the tie-break when a shared event picks a colour.

| Field       | Required | Notes                                                                                                   |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `id`        | yes      | The Google Calendar ID. `primary` for the signed-in account's own calendar, otherwise see below.        |
| `name`      | yes      | Label shown in the legend. Keep it short (a first name).                                                |
| `color`     | yes      | Any CSS colour. Used for the event chip, the all-day bar fill, and the legend swatch.                   |
| `textColor` | no       | Overrides the automatic black/white text on the all-day bar fill. Handy for white text on a light pink. |

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

| Field | Notes                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `pin` | Exactly six digits, as a string (`"482913"`). One PIN for the household. The app refuses to start in production with the example `123456`. |

### `google`

| Field            | Default    | Notes                                                                                                                                                                                                                     |
| ---------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calendarAccess` | `readonly` | `readonly` shows events. `readwrite` adds create, edit, and delete from the dashboard. Switching to `readwrite` needs a re-consent at `/setup` because the OAuth scope changes (`calendar.readonly` → `calendar.events`). |
| `syncDaysBack`   | `60`       | How far back the sync caches events.                                                                                                                                                                                      |
| `syncDaysAhead`  | `210`      | How far ahead. This is the hard limit on how far month view can page before it shows empty cells that aren't really empty. Widen it if you want a longer look-ahead; the sync paginates, so large windows are fine.       |

## Weather icons

Four sets, chosen by `display.weatherIcons`:

- `lucide` (default). Line-art SVGs. Render everywhere, including a bare Raspberry Pi.
- `meteocons`. Colour SVGs.
- `weather-icons`. The classic Erik Flowers set, SVG.
- `emoji`. Uses the self-hosted emoji font, so it also works on the Pi.

The SVG sets are inlined in `lib/weather/weather-icon-svgs.ts`, regenerated from Iconify with `npm run weather-icons`. WMO weather codes map to icons in `lib/weather/wmo.ts`.

## Applying a change

`config.json` is re-read within a minute (`getConfig` caches it briefly), so most edits show up on the next poll without a restart. Two exceptions: `.env` is read at boot, and a change to `google.calendarAccess` needs a re-consent at `/setup`. On a wall kiosk that has been open for days, run `scripts/kiosk-reload.sh` to force a refresh after a config-only change.
