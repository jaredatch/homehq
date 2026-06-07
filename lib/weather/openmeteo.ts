import type { WeatherConfig } from '@/lib/config/types';
import { fetchWithTimeout } from '@/lib/http';
import type { WeatherData } from './types';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const FORECAST_DAYS = 4;

export interface OpenMeteoResponse {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    weather_code: number;
    is_day: number;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
  };
}

export function buildForecastUrl(config: WeatherConfig): string {
  const params = new URLSearchParams({
    latitude: String(config.latitude),
    longitude: String(config.longitude),
    current: 'temperature_2m,apparent_temperature,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    temperature_unit: config.temperatureUnit,
    timezone: 'auto',
    forecast_days: String(FORECAST_DAYS),
  });
  return `${FORECAST_URL}?${params.toString()}`;
}

export function normalizeWeather(response: OpenMeteoResponse): WeatherData {
  const { current, daily } = response;

  return {
    current: {
      temperature: Math.round(current.temperature_2m),
      apparentTemperature: Math.round(current.apparent_temperature),
      weatherCode: current.weather_code,
      isDay: current.is_day === 1,
      time: current.time,
    },
    forecast: daily.time.map((date, i) => ({
      date,
      weatherCode: daily.weather_code[i],
      tempMax: Math.round(daily.temperature_2m_max[i]),
      tempMin: Math.round(daily.temperature_2m_min[i]),
      precipChance: daily.precipitation_probability_max[i] ?? 0,
    })),
  };
}

export async function fetchWeather(config: WeatherConfig): Promise<WeatherData> {
  const res = await fetchWithTimeout(buildForecastUrl(config));
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Open-Meteo error: ${res.status} ${text}`);
  }
  return normalizeWeather(await res.json());
}
