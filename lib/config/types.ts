export interface CalendarConfig {
  id: string;
  name: string;
  color: string;
}

export interface WeatherConfig {
  latitude: number;
  longitude: number;
  temperatureUnit: 'fahrenheit' | 'celsius';
}

export interface DisplayConfig {
  calendarWeeks: number;
  showWeather: boolean;
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
