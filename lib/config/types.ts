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

export interface DisplayConfig {
  calendarWeeks: number;
  showWeather: boolean;
  /** Which day the grid's first column is. Defaults to "monday". */
  weekStartsOn?: 'monday' | 'sunday';
}

export interface AuthConfig {
  pin: string;
}

export interface AppConfig {
  calendars: CalendarConfig[];
  weather: WeatherConfig;
  display: DisplayConfig;
  auth: AuthConfig;
}
