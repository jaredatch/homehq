import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfig, reloadConfig } from '@/lib/config';

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
});
