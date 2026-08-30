import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { AppConfig } from './types';

const DEFAULT_CONFIG_PATH = resolve(process.cwd(), 'data/config.json');
const CACHE_TTL_MS = 60_000;

let cached: { config: AppConfig; loadedAt: number } | null = null;

const ICON_SETS = ['lucide', 'meteocons', 'weather-icons', 'emoji'];

/** Idle-timeout keys: every one is "seconds, non-negative, 0 disables". Each
 * carries its own verb because the message says what stops happening. */
const RESET_KEYS = [
  ['expandResetSeconds', 'auto-revert'],
  ['createFormResetSeconds', 'auto-close'],
  ['monthViewResetSeconds', 'auto-revert'],
  ['filterResetSeconds', 'auto-clear'],
  ['viewResetSeconds', 'auto-revert'],
] as const;

/**
 * Validate the OPTIONAL display keys. Shared by the top-level `display` block
 * and every board's partial override, so a board can't smuggle in a value the
 * wall would have rejected. `label` is the dotted path used in messages, which
 * keeps the top-level wording byte-identical to what it has always been.
 */
function validateDisplayKeys(d: Record<string, unknown>, label: string): void {
  if (d.weekStartsOn !== undefined && d.weekStartsOn !== 'monday' && d.weekStartsOn !== 'sunday') {
    throw new Error(`Config: ${label}.weekStartsOn must be "monday" or "sunday"`);
  }
  if (d.weatherIcons !== undefined && !ICON_SETS.includes(d.weatherIcons as string)) {
    throw new Error(`Config: ${label}.weatherIcons must be one of ${ICON_SETS.join(', ')}`);
  }
  if (d.todayColor !== undefined && typeof d.todayColor !== 'string') {
    throw new Error(`Config: ${label}.todayColor must be a CSS color string`);
  }
  for (const [key, verb] of RESET_KEYS) {
    const v = d[key];
    if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
      throw new Error(`Config: ${label}.${key} must be a non-negative number (0 disables ${verb})`);
    }
  }
  if (d.timezone !== undefined) {
    if (typeof d.timezone !== 'string') {
      throw new Error(`Config: ${label}.timezone must be an IANA time-zone string`);
    }
    // Reject typos early — a bad zone would otherwise throw at render time.
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: d.timezone });
    } catch {
      throw new Error(`Config: ${label}.timezone "${d.timezone}" is not a valid IANA time zone`);
    }
  }
}

/** Slugs become URL path segments (`/b/<slug>`), so keep them boring. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Validate the optional `boards` map. Everything here fails FAST rather than
 * degrading: a board pointing at a calendar id that doesn't exist would
 * otherwise render a convincingly empty screen in someone's bedroom, which is
 * far worse than refusing to boot.
 */
function validateBoards(obj: Record<string, unknown>, calendarIds: Set<string>): void {
  if (obj.boards === undefined) return;
  if (typeof obj.boards !== 'object' || obj.boards === null || Array.isArray(obj.boards)) {
    throw new Error('Config: "boards" must be an object keyed by board slug');
  }

  const hosts = new Map<string, string>();

  for (const [slug, value] of Object.entries(obj.boards as Record<string, unknown>)) {
    const at = `boards.${slug}`;

    if (!SLUG_RE.test(slug)) {
      throw new Error(
        `Config: board slug "${slug}" must be lowercase letters, digits, and dashes (it becomes a URL path)`
      );
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`Config: ${at} must be an object`);
    }
    const b = value as Record<string, unknown>;

    if (b.layout !== 'family' && b.layout !== 'personal') {
      throw new Error(`Config: ${at}.layout must be "family" or "personal"`);
    }
    if (b.pin !== undefined) {
      if (typeof b.pin !== 'string' || !/^\d{6}$/.test(b.pin)) {
        throw new Error(`Config: ${at}.pin must be a 6-digit string`);
      }
      // Same fail-fast the top-level PIN gets: a board shipped with the
      // template PIN is an unlocked screen, and a bedroom panel is the one
      // most likely to be set up in a hurry and forgotten.
      if (process.env.NODE_ENV === 'production' && b.pin === '123456') {
        throw new Error(
          `Config: ${at}.pin is still the default "123456" — set a real PIN before deploying`
        );
      }
    }

    for (const key of ['name', 'accent', 'host', 'defaultCalendar'] as const) {
      if (b[key] !== undefined && typeof b[key] !== 'string') {
        throw new Error(`Config: ${at}.${key} must be a string`);
      }
    }

    if (typeof b.host === 'string') {
      const host = b.host.toLowerCase();
      const owner = hosts.get(host);
      if (owner) {
        throw new Error(
          `Config: host "${b.host}" is claimed by both boards "${owner}" and "${slug}"`
        );
      }
      hosts.set(host, slug);
    }

    if (b.calendars !== undefined) {
      if (!Array.isArray(b.calendars)) {
        throw new Error(`Config: ${at}.calendars must be an array of calendar ids`);
      }
      for (const id of b.calendars) {
        if (typeof id !== 'string') {
          throw new Error(`Config: ${at}.calendars must be an array of calendar ids`);
        }
        if (!calendarIds.has(id)) {
          throw new Error(`Config: ${at}.calendars references unknown calendar id "${id}"`);
        }
      }
    }

    // Everything below must name a calendar the board actually shows, or the
    // board boots looking fine and silently does the wrong thing.
    const visible = Array.isArray(b.calendars) ? new Set(b.calendars as string[]) : calendarIds;

    for (const key of ['ownCalendars', 'alwaysShow'] as const) {
      if (b[key] === undefined) continue;
      if (!Array.isArray(b[key])) {
        throw new Error(`Config: ${at}.${key} must be an array of calendar ids`);
      }
      for (const id of b[key] as unknown[]) {
        if (typeof id !== 'string' || !visible.has(id)) {
          throw new Error(
            `Config: ${at}.${key} must list calendar ids this board shows (got ${JSON.stringify(id)})`
          );
        }
      }
    }

    if (typeof b.defaultCalendar === 'string' && !visible.has(b.defaultCalendar)) {
      throw new Error(
        `Config: ${at}.defaultCalendar "${b.defaultCalendar}" is not one of this board's calendars`
      );
    }

    if (b.todos !== undefined) {
      if (typeof b.todos !== 'object' || b.todos === null || Array.isArray(b.todos)) {
        throw new Error(`Config: ${at}.todos must be an object`);
      }
      const t = b.todos as Record<string, unknown>;
      if (typeof t.projectId !== 'string' || t.projectId === '') {
        throw new Error(`Config: ${at}.todos.projectId must be a non-empty Todoist project id`);
      }
    }

    if (b.display !== undefined) {
      if (typeof b.display !== 'object' || b.display === null || Array.isArray(b.display)) {
        throw new Error(`Config: ${at}.display must be an object`);
      }
      const d = b.display as Record<string, unknown>;
      // Every key is optional here — a board overrides only what it changes —
      // but the two the top level requires must still be the right type.
      if (d.calendarWeeks !== undefined && typeof d.calendarWeeks !== 'number') {
        throw new Error(`Config: ${at}.display.calendarWeeks must be a number`);
      }
      if (d.showWeather !== undefined && typeof d.showWeather !== 'boolean') {
        throw new Error(`Config: ${at}.display.showWeather must be a boolean`);
      }
      validateDisplayKeys(d, `${at}.display`);
    }
  }
}

function validate(data: unknown): AppConfig {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Config must be a JSON object');
  }

  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.calendars)) {
    throw new Error('Config: "calendars" must be an array');
  }
  const calendarIds = new Set<string>();
  for (const cal of obj.calendars) {
    if (typeof cal !== 'object' || cal === null) {
      throw new Error('Config: each calendar must be an object');
    }
    const c = cal as Record<string, unknown>;
    if (typeof c.id !== 'string' || typeof c.name !== 'string' || typeof c.color !== 'string') {
      throw new Error('Config: each calendar must have string id, name, and color');
    }
    if (c.hidden !== undefined && typeof c.hidden !== 'boolean') {
      throw new Error('Config: calendar.hidden must be a boolean');
    }
    calendarIds.add(c.id);
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
  validateDisplayKeys(d, 'display');

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

  validateBoards(obj, calendarIds);

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
