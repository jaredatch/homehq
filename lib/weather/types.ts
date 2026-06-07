export interface CurrentWeather {
  /** Temperature in the configured unit */
  temperature: number;
  apparentTemperature: number;
  /** WMO weather interpretation code */
  weatherCode: number;
  isDay: boolean;
  /** Observation time (ISO 8601, location-local) */
  time: string;
}

export interface DailyForecast {
  /** YYYY-MM-DD in the location's timezone */
  date: string;
  weatherCode: number;
  tempMax: number;
  tempMin: number;
  /** Max precipitation probability for the day, 0–100 */
  precipChance: number;
}

export interface WeatherData {
  current: CurrentWeather;
  forecast: DailyForecast[];
}
