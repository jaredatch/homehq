import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfig, reloadConfig, isCalendarWriteEnabled } from '@/lib/config';

describe('config loader', () => {
  let tmpDir: string;

  const validConfig = {
    calendars: [{ id: 'primary', name: 'Family', color: '#4285f4' }],
    weather: { latitude: 40.7128, longitude: -74.006, temperatureUnit: 'fahrenheit' },
    display: { calendarWeeks: 2, showWeather: true },
    auth: { pin: '123456' },
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'homehq-config-'));
    reloadConfig();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads a valid config file', () => {
    const path = join(tmpDir, 'config.json');
    writeFileSync(path, JSON.stringify(validConfig));
    const config = getConfig(path);
    expect(config.calendars).toHaveLength(1);
    expect(config.calendars[0].name).toBe('Family');
    expect(config.weather.latitude).toBe(40.7128);
    expect(config.auth.pin).toBe('123456');
  });

  it('throws on missing file', () => {
    expect(() => getConfig(join(tmpDir, 'nonexistent.json'))).toThrow('Config file not found');
  });

  it('throws on invalid JSON', () => {
    const path = join(tmpDir, 'bad.json');
    writeFileSync(path, 'not json');
    expect(() => getConfig(path)).toThrow('not valid JSON');
  });

  it('throws on missing calendars', () => {
    const path = join(tmpDir, 'config.json');
    const bad = { ...validConfig, calendars: 'nope' };
    writeFileSync(path, JSON.stringify(bad));
    expect(() => getConfig(path)).toThrow('"calendars" must be an array');
  });

  it('throws on invalid PIN', () => {
    const path = join(tmpDir, 'config.json');
    const bad = { ...validConfig, auth: { pin: '12' } };
    writeFileSync(path, JSON.stringify(bad));
    expect(() => getConfig(path)).toThrow('6-digit string');
  });

  it('rejects the default PIN in production', () => {
    const path = join(tmpDir, 'config.json');
    writeFileSync(path, JSON.stringify(validConfig)); // pin: '123456'
    const prev = process.env.NODE_ENV;
    try {
      // @ts-expect-error — NODE_ENV is normally readonly in types
      process.env.NODE_ENV = 'production';
      reloadConfig();
      expect(() => getConfig(path)).toThrow('still the default');
    } finally {
      // @ts-expect-error — restore
      process.env.NODE_ENV = prev;
      reloadConfig();
    }
  });

  it('throws on missing weather fields', () => {
    const path = join(tmpDir, 'config.json');
    const bad = { ...validConfig, weather: { latitude: 40 } };
    writeFileSync(path, JSON.stringify(bad));
    expect(() => getConfig(path)).toThrow('numeric latitude and longitude');
  });

  it('caches config on repeated reads of default path', () => {
    // This test just verifies the caching code path doesn't break
    const path = join(tmpDir, 'config.json');
    writeFileSync(path, JSON.stringify(validConfig));
    const config1 = getConfig(path);
    const config2 = getConfig(path);
    expect(config1).toEqual(config2);
  });

  // google.calendarAccess — the read-only/read-write gate for event creation.
  const writeConfig = (access?: unknown) => ({
    ...validConfig,
    ...(access === undefined ? {} : { google: { calendarAccess: access } }),
  });

  it('defaults to read-only (write disabled) when google is absent', () => {
    const path = join(tmpDir, 'config.json');
    writeFileSync(path, JSON.stringify(writeConfig()));
    expect(isCalendarWriteEnabled(getConfig(path))).toBe(false);
  });

  it('reports write enabled only for "readwrite"', () => {
    const path = join(tmpDir, 'config.json');
    writeFileSync(path, JSON.stringify(writeConfig('readwrite')));
    expect(isCalendarWriteEnabled(getConfig(path))).toBe(true);
  });

  it('treats explicit "readonly" as write disabled', () => {
    const path = join(tmpDir, 'config.json');
    writeFileSync(path, JSON.stringify(writeConfig('readonly')));
    expect(isCalendarWriteEnabled(getConfig(path))).toBe(false);
  });

  it('throws on an invalid google.calendarAccess value', () => {
    const path = join(tmpDir, 'config.json');
    writeFileSync(path, JSON.stringify(writeConfig('write')));
    expect(() => getConfig(path)).toThrow('google.calendarAccess must be');
  });

  it('throws when google is not an object', () => {
    const path = join(tmpDir, 'config.json');
    writeFileSync(path, JSON.stringify({ ...validConfig, google: 'nope' }));
    expect(() => getConfig(path)).toThrow('"google" must be an object');
  });

  // google.syncDaysBack / syncDaysAhead — the calendar cache window. These bound
  // how far the UI can look, so a bad value must fail loudly rather than quietly
  // shrink the horizon.
  const windowConfig = (google: unknown) => ({ ...validConfig, google });

  it('accepts a custom sync window', () => {
    const path = join(tmpDir, 'config.json');
    writeFileSync(path, JSON.stringify(windowConfig({ syncDaysBack: 30, syncDaysAhead: 365 })));
    const config = getConfig(path);
    expect(config.google?.syncDaysBack).toBe(30);
    expect(config.google?.syncDaysAhead).toBe(365);
  });

  it('leaves the sync window undefined when unset (sync applies its defaults)', () => {
    const path = join(tmpDir, 'config.json');
    writeFileSync(path, JSON.stringify(windowConfig({ calendarAccess: 'readonly' })));
    const config = getConfig(path);
    expect(config.google?.syncDaysBack).toBeUndefined();
    expect(config.google?.syncDaysAhead).toBeUndefined();
  });

  it('throws on a non-numeric sync window', () => {
    const path = join(tmpDir, 'config.json');
    writeFileSync(path, JSON.stringify(windowConfig({ syncDaysAhead: '210' })));
    expect(() => getConfig(path)).toThrow('google.syncDaysAhead must be a non-negative number');
  });

  it('throws on a negative sync window', () => {
    const path = join(tmpDir, 'config.json');
    writeFileSync(path, JSON.stringify(windowConfig({ syncDaysBack: -1 })));
    expect(() => getConfig(path)).toThrow('google.syncDaysBack must be a non-negative number');
  });
});
