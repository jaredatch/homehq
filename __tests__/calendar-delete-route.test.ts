import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type Database from 'better-sqlite3';
import { getDb, _setDefaultDb } from '@/lib/db';
import { upsertEvent, getEvent } from '@/lib/db/events';
import { CalendarApiError } from '@/lib/google/calendar';

let mockConfig: Record<string, unknown> & { google: { calendarAccess: string } };
vi.mock('@/lib/config', () => ({
  getConfig: () => mockConfig,
  isCalendarWriteEnabled: (c?: { google?: { calendarAccess?: string } }) =>
    (c ?? mockConfig)?.google?.calendarAccess === 'readwrite',
}));

const mockGetValidAccessToken = vi.fn();
vi.mock('@/lib/google/oauth', () => ({
  getValidAccessToken: () => mockGetValidAccessToken(),
}));

const mockDeleteCalendarEvent = vi.fn();
vi.mock('@/lib/google/calendar', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/google/calendar')>();
  return {
    ...actual,
    deleteCalendarEvent: (...args: unknown[]) => mockDeleteCalendarEvent(...args),
  };
});

import { POST } from '@/app/api/calendar/delete/route';

describe('POST /api/calendar/delete', () => {
  let tmpDir: string;
  let db: Database.Database;

  const baseConfig = {
    calendars: [{ id: 'primary', name: 'Family', color: '#4285f4' }],
    weather: { latitude: 0, longitude: 0, temperatureUnit: 'fahrenheit' },
    display: { calendarWeeks: 2, showWeather: true },
    auth: { pin: '654321' },
    google: { calendarAccess: 'readwrite' },
  };

  const seed = (overrides: Record<string, unknown> = {}) =>
    upsertEvent({
      event_id: 'evt_1',
      calendar_id: 'primary',
      summary: 'Lunch',
      description: null,
      location: null,
      start_time: '2026-07-01T12:00:00-05:00',
      end_time: '2026-07-01T13:00:00-05:00',
      all_day: 0,
      recurring_event_id: null,
      ...overrides,
    });

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'homehq-delete-route-'));
    db = getDb(join(tmpDir, 'test.db'));
    _setDefaultDb(db);
    mockConfig = structuredClone(baseConfig);
    mockGetValidAccessToken.mockReset().mockResolvedValue('access_tok');
    mockDeleteCalendarEvent.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    _setDefaultDb(null);
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function post(body: unknown) {
    return POST(
      new Request('http://localhost/api/calendar/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }) as unknown as NextRequest
    );
  }

  it('403s and never calls Google when read-only', async () => {
    mockConfig.google.calendarAccess = 'readonly';
    seed();
    const res = await post({ eventId: 'evt_1', calendarId: 'primary' });
    expect(res.status).toBe(403);
    expect(mockDeleteCalendarEvent).not.toHaveBeenCalled();
  });

  it('deletes the event and drops it from the cache', async () => {
    seed();
    const res = await post({ eventId: 'evt_1', calendarId: 'primary' });
    expect(res.status).toBe(200);
    expect(mockDeleteCalendarEvent).toHaveBeenCalledWith('access_tok', 'primary', 'evt_1');
    expect(getEvent('evt_1', 'primary')).toBeUndefined();
  });

  it('409s on a recurring occurrence, without touching Google', async () => {
    seed({ event_id: 'evt_r', recurring_event_id: 'series' });
    const res = await post({ eventId: 'evt_r', calendarId: 'primary' });
    expect(res.status).toBe(409);
    expect(mockDeleteCalendarEvent).not.toHaveBeenCalled();
  });

  it('treats an already-gone cache row as success (no Google call)', async () => {
    const res = await post({ eventId: 'missing', calendarId: 'primary' });
    expect(res.status).toBe(200);
    expect(mockDeleteCalendarEvent).not.toHaveBeenCalled();
  });

  it('maps a Google 403 to a re-consent message', async () => {
    seed();
    mockDeleteCalendarEvent.mockRejectedValue(new CalendarApiError(403, 'forbidden'));
    const res = await post({ eventId: 'evt_1', calendarId: 'primary' });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/setup/);
    expect(getEvent('evt_1', 'primary')).toBeDefined(); // not removed on failure
  });

  it('400s on a missing eventId', async () => {
    const res = await post({ calendarId: 'primary' });
    expect(res.status).toBe(400);
  });

  it('401s when no valid token is available', async () => {
    seed();
    mockGetValidAccessToken.mockRejectedValue(new Error('reconnect at /setup'));
    const res = await post({ eventId: 'evt_1', calendarId: 'primary' });
    expect(res.status).toBe(401);
    expect(mockDeleteCalendarEvent).not.toHaveBeenCalled();
  });
});
