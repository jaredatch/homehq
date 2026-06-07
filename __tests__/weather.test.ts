import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, _setDefaultDb } from '@/lib/db';
import { getWeatherCache, saveWeatherCache } from '@/lib/db/weather';
import { buildForecastUrl, normalizeWeather, type OpenMeteoResponse } from '@/lib/weather/openmeteo';
import { describeWeather } from '@/lib/weather/wmo';
import { isWeatherStale, WEATHER_STALE_AFTER_MS } from '@/lib/weather/staleness';
import type Database from 'better-sqlite3';

const SAMPLE_RESPONSE: OpenMeteoResponse = {
  current: {
    time: '2026-06-07T14:30',
    temperature_2m: 82.4,
    apparent_temperature: 85.1,
    weather_code: 2,
    is_day: 1,
  },
  daily: {
    time: ['2026-06-07', '2026-06-08', '2026-06-09', '2026-06-10'],
    weather_code: [2, 61, 95, 0],
    temperature_2m_max: [88.2, 79.6, 75.0, 81.3],
    temperature_2m_min: [68.1, 65.4, 63.2, 64.8],
    precipitation_probability_max: [10, 80, null, 0],
  },
};

describe('normalizeWeather', () => {
  it('normalizes the Open-Meteo response shape', () => {
    const data = normalizeWeather(SAMPLE_RESPONSE);

    expect(data.current).toEqual({
      temperature: 82,
      apparentTemperature: 85,
      weatherCode: 2,
      isDay: true,
      time: '2026-06-07T14:30',
    });

    expect(data.forecast).toHaveLength(4);
    expect(data.forecast[0]).toEqual({
      date: '2026-06-07',
      weatherCode: 2,
      tempMax: 88,
      tempMin: 68,
      precipChance: 10,
    });
  });

  it('defaults null precipitation probability to 0', () => {
    const data = normalizeWeather(SAMPLE_RESPONSE);
    expect(data.forecast[2].precipChance).toBe(0);
  });
});

describe('buildForecastUrl', () => {
  it('includes location, unit, and forecast window', () => {
    const url = new URL(
      buildForecastUrl({ latitude: 30.27, longitude: -97.74, temperatureUnit: 'fahrenheit' })
    );
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('latitude')).toBe('30.27');
    expect(url.searchParams.get('longitude')).toBe('-97.74');
    expect(url.searchParams.get('temperature_unit')).toBe('fahrenheit');
    expect(url.searchParams.get('forecast_days')).toBe('4');
    expect(url.searchParams.get('timezone')).toBe('auto');
  });
});

describe('describeWeather', () => {
  it('maps common WMO codes', () => {
    expect(describeWeather(0).label).toBe('Clear');
    expect(describeWeather(3).label).toBe('Overcast');
    expect(describeWeather(61).label).toBe('Rain');
    expect(describeWeather(95).label).toBe('Thunderstorm');
  });

  it('uses a night icon for clear nights', () => {
    expect(describeWeather(0, true).icon).toBe('☀️');
    expect(describeWeather(0, false).icon).toBe('🌙');
  });

  it('falls back gracefully on unknown codes', () => {
    expect(describeWeather(42).label).toBe('Unknown');
  });
});

describe('isWeatherStale', () => {
  const now = new Date('2026-06-07T12:00:00Z').getTime();

  it('treats fresh data as not stale', () => {
    const fresh = new Date(now - 10 * 60 * 1000).toISOString();
    expect(isWeatherStale(fresh, now)).toBe(false);
  });

  it('treats data older than the threshold as stale', () => {
    const old = new Date(now - WEATHER_STALE_AFTER_MS - 1000).toISOString();
    expect(isWeatherStale(old, now)).toBe(true);
  });

  it('treats null or unparseable timestamps as stale', () => {
    expect(isWeatherStale(null, now)).toBe(true);
    expect(isWeatherStale('not-a-date', now)).toBe(true);
  });
});

describe('weather cache', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'homehq-weather-'));
    db = getDb(join(tmpDir, 'test.db'));
    _setDefaultDb(db);
  });

  afterEach(() => {
    _setDefaultDb(null);
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when nothing is cached', () => {
    expect(getWeatherCache()).toBeNull();
  });

  it('round-trips weather data', () => {
    const data = normalizeWeather(SAMPLE_RESPONSE);
    saveWeatherCache(data);

    const cached = getWeatherCache();
    expect(cached).not.toBeNull();
    expect(cached!.data).toEqual(data);
    expect(cached!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('overwrites the previous cache on save', () => {
    const data = normalizeWeather(SAMPLE_RESPONSE);
    saveWeatherCache(data);
    saveWeatherCache({
      ...data,
      current: { ...data.current, temperature: 50 },
    });

    const cached = getWeatherCache();
    expect(cached!.data.current.temperature).toBe(50);
  });
});
