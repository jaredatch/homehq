export interface CalendarConfig {
  id: string;
  name: string;
  color: string;
  /** Optional override for text drawn on `color` (e.g. white on a light pink
   * that auto-contrast would render black). Defaults to auto black/white. */
  textColor?: string;
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
}
