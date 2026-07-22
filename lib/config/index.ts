import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { AppConfig } from './types';

const DEFAULT_CONFIG_PATH = resolve(process.cwd(), 'data/config.json');
const CACHE_TTL_MS = 60_000;

let cached: { config: AppConfig; loadedAt: number } | null = null;

function validate(data: unknown): AppConfig {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Config must be a JSON object');
  }

  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.calendars)) {
    throw new Error('Config: "calendars" must be an array');
  }
  for (const cal of obj.calendars) {
    if (typeof cal !== 'object' || cal === null) {
      throw new Error('Config: each calendar must be an object');
    }
    const c = cal as Record<string, unknown>;
    if (typeof c.id !== 'string' || typeof c.name !== 'string' || typeof c.color !== 'string') {
      throw new Error('Config: each calendar must have string id, name, and color');
    }
  }

  if (typeof obj.weather !== 'object' || obj.weather === null) {
    throw new Error('Config: "weather" must be an object');
  }
  const w = obj.weather as Record<string, unknown>;
  if (typeof w.latitude !== 'number' || typeof w.longitude !== 'number') {
    throw new Error('Config: weather must have numeric latitude and longitude');
  }
  if (w.temperatureUnit !== 'fahrenheit' && w.temperatureUnit !== 'celsius') {
    throw new Error('Config: weather.temperatureUnit must be "fahrenheit" or "celsius"');
  }

  if (typeof obj.display !== 'object' || obj.display === null) {
    throw new Error('Config: "display" must be an object');
  }
  const d = obj.display as Record<string, unknown>;
  if (typeof d.calendarWeeks !== 'number' || typeof d.showWeather !== 'boolean') {
    throw new Error('Config: display must have numeric calendarWeeks and boolean showWeather');
  }
  if (d.weekStartsOn !== undefined && d.weekStartsOn !== 'monday' && d.weekStartsOn !== 'sunday') {
    throw new Error('Config: display.weekStartsOn must be "monday" or "sunday"');
  }
  const ICON_SETS = ['lucide', 'meteocons', 'weather-icons', 'emoji'];
  if (d.weatherIcons !== undefined && !ICON_SETS.includes(d.weatherIcons as string)) {
    throw new Error(`Config: display.weatherIcons must be one of ${ICON_SETS.join(', ')}`);
  }
  if (d.todayColor !== undefined && typeof d.todayColor !== 'string') {
    throw new Error('Config: display.todayColor must be a CSS color string');
  }
  if (
    d.expandResetSeconds !== undefined &&
    (typeof d.expandResetSeconds !== 'number' ||
      !Number.isFinite(d.expandResetSeconds) ||
      d.expandResetSeconds < 0)
  ) {
    throw new Error(
      'Config: display.expandResetSeconds must be a non-negative number (0 disables auto-revert)'
    );
  }
  if (
    d.createFormResetSeconds !== undefined &&
    (typeof d.createFormResetSeconds !== 'number' ||
      !Number.isFinite(d.createFormResetSeconds) ||
      d.createFormResetSeconds < 0)
  ) {
    throw new Error(
      'Config: display.createFormResetSeconds must be a non-negative number (0 disables auto-close)'
    );
  }
  if (d.timezone !== undefined) {
    if (typeof d.timezone !== 'string') {
      throw new Error('Config: display.timezone must be an IANA time-zone string');
    }
    // Reject typos early — a bad zone would otherwise throw at render time.
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: d.timezone });
    } catch {
      throw new Error(`Config: display.timezone "${d.timezone}" is not a valid IANA time zone`);
    }
  }

  if (typeof obj.auth !== 'object' || obj.auth === null) {
    throw new Error('Config: "auth" must be an object');
  }
  const a = obj.auth as Record<string, unknown>;
  if (typeof a.pin !== 'string' || !/^\d{6}$/.test(a.pin)) {
    throw new Error('Config: auth.pin must be a 6-digit string');
  }
  // Fail fast in production rather than ship the template PIN to a public
  // droplet — a forgotten default is an instant auth bypass.
  if (process.env.NODE_ENV === 'production' && a.pin === '123456') {
    throw new Error(
      'Config: auth.pin is still the default "123456" — set a real PIN in data/config.json before deploying'
    );
  }

  if (obj.google !== undefined) {
    if (typeof obj.google !== 'object' || obj.google === null) {
      throw new Error('Config: "google" must be an object');
    }
    const g = obj.google as Record<string, unknown>;
    if (
      g.calendarAccess !== undefined &&
      g.calendarAccess !== 'readonly' &&
      g.calendarAccess !== 'readwrite'
    ) {
      throw new Error('Config: google.calendarAccess must be "readonly" or "readwrite"');
    }
    for (const key of ['syncDaysBack', 'syncDaysAhead'] as const) {
      const v = g[key];
      if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
        throw new Error(`Config: google.${key} must be a non-negative number of days`);
      }
    }
  }

  return data as AppConfig;
}

export function getConfig(configPath?: string): AppConfig {
  const path = configPath ?? DEFAULT_CONFIG_PATH;
  const isDefault = !configPath;

  if (isDefault && cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.config;
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    throw new Error(`Config file not found: ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Config file is not valid JSON: ${path}`);
  }

  const config = validate(parsed);

  if (isDefault) {
    cached = { config, loadedAt: Date.now() };
  }

  return config;
}

export function reloadConfig(): void {
  cached = null;
}

/** Whether event creation is enabled — i.e. google.calendarAccess is "readwrite".
 * Gates the OAuth scope (calendar.events vs calendar.readonly), the create API
 * route, and the "+ Add event" button. Defaults to false (read-only). */
export function isCalendarWriteEnabled(config?: AppConfig): boolean {
  return (config ?? getConfig()).google?.calendarAccess === 'readwrite';
}
