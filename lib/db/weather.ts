import { getDb } from './index';
import type { WeatherData } from '@/lib/weather/types';

export interface CachedWeather {
  data: WeatherData;
  /** ISO 8601 UTC */
  updatedAt: string;
}

export function saveWeatherCache(data: WeatherData): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO weather_cache (id, current_json, forecast_json, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       current_json = excluded.current_json,
       forecast_json = excluded.forecast_json,
       updated_at = excluded.updated_at`
  ).run(JSON.stringify(data.current), JSON.stringify(data.forecast), new Date().toISOString());
}

export function getWeatherCache(): CachedWeather | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM weather_cache WHERE id = 1').get() as
    | { current_json: string; forecast_json: string; updated_at: string }
    | undefined;
  if (!row) return null;

  try {
    return {
      data: {
        current: JSON.parse(row.current_json),
        forecast: JSON.parse(row.forecast_json),
      },
      updatedAt: row.updated_at,
    };
  } catch {
    return null; // corrupt cache — treat as empty, next sync rewrites it
  }
}
