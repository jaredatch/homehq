export interface CalendarConfig {
  id: string;
  name: string;
  color: string;
  /** Optional override for text drawn on `color` (e.g. white on a light pink
   * that auto-contrast would render black). Defaults to auto black/white. */
  textColor?: string;
  /** Sync this calendar, but keep it off any board that doesn't ask for it by
   * name — a personal board's private calendar, which must never surface on the
   * family wall. It still syncs, so a board that DOES list it has data. */
  hidden?: boolean;
}

export interface WeatherConfig {
  latitude: number;
  longitude: number;
  temperatureUnit: 'fahrenheit' | 'celsius';
}

export type WeatherIconSet = 'lucide' | 'meteocons' | 'weather-icons' | 'emoji';

export interface DisplayConfig {
  calendarWeeks: number;
  showWeather: boolean;
  /** Which day the grid's first column is. Defaults to "monday". */
  weekStartsOn?: 'monday' | 'sunday';
  /** Weather icon style. Defaults to "lucide" (self-hosted line-art SVGs that
   * render reliably on the Pi kiosk; "emoji" needs a color-emoji font there). */
  weatherIcons?: WeatherIconSet;
  /** Today's accent dot color (any CSS color). Defaults to blue-400 (#60a5fa). */
  todayColor?: string;
  /** IANA time zone for the clock + event times (e.g. "America/Chicago").
   * Defaults to the browser's local zone — set it to pin the display to one
   * zone regardless of the kiosk machine's OS clock. */
  timezone?: string;
  /** Seconds the "expand next week" view stays up before auto-reverting to the
   * default current-week view, so a transient peek never sticks on the
   * always-on kiosk. Defaults to 300 (5 min). Set to 0 to disable auto-revert. */
  expandResetSeconds?: number;
  /** Seconds the "Add event" modal stays open with no interaction before it
   * auto-closes (discarding input), so an abandoned form never sticks on the
   * always-on kiosk. Defaults to 120. Set to 0 to disable auto-close. */
  createFormResetSeconds?: number;
  /** Seconds month view stays up with no interaction before auto-reverting to
   * the week grid, so the wall never sits stuck on November. The timer resets
   * on any interaction (click, key), never mid-task. Defaults to 180. Set to 0
   * to disable auto-revert. */
  monthViewResetSeconds?: number;
  /** Seconds a per-person calendar filter stays applied with no interaction
   * before auto-clearing back to "show all", so the always-on wall is never
   * quietly narrowed to one person for days. The timer resets on any
   * interaction. Defaults to 300 (5 min). Set to 0 to disable auto-clear. */
  filterResetSeconds?: number;
  /** Personal boards only. Seconds a full-screen view (View Week, View Month)
   * stays up with no interaction before falling back to the three columns, so a
   * board left on next month isn't still there three days later. The timer
   * restarts on any touch. Defaults to 120. Set to 0 to disable auto-revert. */
  viewResetSeconds?: number;
}

export interface AuthConfig {
  pin: string;
}

export type CalendarAccess = 'readonly' | 'readwrite';

export interface GoogleConfig {
  /** Calendar access mode. "readonly" (the default) requests only the
   * calendar.readonly OAuth scope and disables event creation — the dashboard
   * behaves exactly as a read-only display. "readwrite" requests calendar.events
   * and turns on the "+ Add event" flow. Switching readonly → readwrite needs a
   * re-consent at /setup (the stored token keeps the old scope until then). */
  calendarAccess?: CalendarAccess;
  /** How many days *back* the calendar sync caches. Defaults to 60. */
  syncDaysBack?: number;
  /** How many days *ahead* the calendar sync caches. Defaults to 210 (~7 months).
   * This is the hard limit on how far month view can page before it starts
   * showing empty cells that aren't actually empty — the cache simply has no
   * rows past this horizon. Widen it before promising a longer look-ahead. */
  syncDaysAhead?: number;
}

export interface AppConfig {
  calendars: CalendarConfig[];
  weather: WeatherConfig;
  display: DisplayConfig;
  auth: AuthConfig;
  google?: GoogleConfig;
  /** Extra screens served off this same install, keyed by URL slug. Absent =
   * the family board alone, exactly as before. */
  boards?: Record<string, BoardConfig>;
}

/** How a board draws itself. "family" is the dense wall layout the app has
 * always had; "personal" is the touch-tuned single-person surface. */
export type BoardLayout = 'family' | 'personal';

export interface BoardTodosConfig {
  /** Todoist project whose tasks this board shows and writes to. */
  projectId: string;
}

/**
 * One configured screen. A board is an OVERRIDE LAYER over the top-level
 * config, never a replacement: anything omitted falls through to the values the
 * family board already uses. A config with no `boards` key behaves exactly as
 * it did before boards existed — that is the whole no-regression story.
 */
export interface BoardConfig {
  layout: BoardLayout;
  /** Shown in the personal board's header. Defaults to the board's slug. */
  name?: string;
  /** Optional hostname that maps to this board, so `kida.example.com/` serves
   * it without the `/b/<slug>` path. Unset hosts (the family board's) are
   * untouched by the rewrite. */
  host?: string;
  /** This board's own 6-digit PIN. A session created with it opens ONLY this
   * board, so the code a kid types on her panel isn't the code that opens the
   * kitchen wall. The top-level `auth.pin` always works as well, so a parent
   * is never locked out and a household with one PIN needs no change. */
  pin?: string;
  /** Accent color for this board (any CSS color). Personal layout only. */
  accent?: string;
  /** Which of the top-level calendars this board shows, by id. The order here
   * is the order they're drawn in, so a personal board can lead with its own
   * person. Omitted means all of them. */
  calendars?: string[];
  /** Which of the board's calendars count as this board's own person — her
   * family-visible calendar plus her private one. Drives the person picker's
   * default and the accent. Omitted means every calendar the board shows, i.e.
   * no one else to peek at and no picker. */
  ownCalendars?: string[];
  /** Calendars that stay in view no matter who the person picker is set to —
   * the family calendar, typically. A family dinner is her event too, so it
   * shouldn't vanish when the column is scoped to her. */
  alwaysShow?: string[];
  /** Which calendar a new event created on this board lands on by default.
   * Must be one of the board's calendars. */
  defaultCalendar?: string;
  /** Todoist binding. Omitted means this board shows no to-dos. */
  todos?: BoardTodosConfig;
  /** Per-board overrides of any display key. Merged over the top-level block. */
  display?: Partial<DisplayConfig>;
}
