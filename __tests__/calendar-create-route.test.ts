import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type Database from 'better-sqlite3';
import { getDb, _setDefaultDb } from '@/lib/db';
import { getEventsInRange } from '@/lib/db/events';
import { CalendarApiError } from '@/lib/google/calendar';

// Controlled config (calendars + write mode + timezone). `mock`-prefixed so
// Vitest allows the reference inside the hoisted factory.
let mockConfig: Record<string, unknown> & {
  google: { calendarAccess: string };
  display: { timezone?: string };
};
vi.mock('@/lib/config', () => ({
  getConfig: () => mockConfig,
  isCalendarWriteEnabled: (c?: { google?: { calendarAccess?: string } }) =>
    (c ?? mockConfig)?.google?.calendarAccess === 'readwrite',
}));

const mockGetValidAccessToken = vi.fn();
vi.mock('@/lib/google/oauth', () => ({
  getValidAccessToken: () => mockGetValidAccessToken(),
}));

// Mock only createCalendarEvent; keep normalizeEvent + CalendarApiError real.
const mockCreateCalendarEvent = vi.fn();
vi.mock('@/lib/google/calendar', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/google/calendar')>();
  return {
    ...actual,
    createCalendarEvent: (...args: unknown[]) => mockCreateCalendarEvent(...args),
  };
});

import { POST } from '@/app/api/calendar/create/route';

describe('POST /api/calendar/create', () => {
  let tmpDir: string;
  let db: Database.Database;

  const baseConfig = {
    calendars: [
      { id: 'primary', name: 'Family', color: '#4285f4' },
      { id: 'work', name: 'Work', color: '#0f9d58' },
    ],
    weather: { latitude: 0, longitude: 0, temperatureUnit: 'fahrenheit' },
    display: { calendarWeeks: 2, showWeather: true, timezone: 'America/Chicago' },
    auth: { pin: '654321' },
    google: { calendarAccess: 'readwrite' },
  };

  const timedBody = {
    calendarId: 'primary',
    title: 'Dentist',
    allDay: false,
    date: '2026-07-01',
    startTime: '09:00',
    endTime: '10:00',
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'homehq-create-route-'));
    db = getDb(join(tmpDir, 'test.db'));
    _setDefaultDb(db);
    mockConfig = structuredClone(baseConfig);
    mockGetValidAccessToken.mockReset().mockResolvedValue('access_tok');
    mockCreateCalendarEvent.mockReset();
  });

  afterEach(() => {
    _setDefaultDb(null);
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function post(body: unknown) {
    return POST(
      new Request('http://localhost/api/calendar/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }) as unknown as NextRequest
    );
  }

  it('403s and never calls Google when the deployment is read-only', async () => {
    mockConfig.google.calendarAccess = 'readonly';
    const res = await post(timedBody);
    expect(res.status).toBe(403);
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });

  it('400s on a blank title', async () => {
    const res = await post({ ...timedBody, title: '   ' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/title/);
  });

  it('400s when no calendar is selected (no default)', async () => {
    const res = await post({
      title: 'Dentist',
      allDay: false,
      date: '2026-07-01',
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/calendarId/);
  });

  it('400s on an unknown calendar', async () => {
    const res = await post({ ...timedBody, calendarId: 'ghost' });
    expect(res.status).toBe(400);
  });

  it('400s on a malformed date', async () => {
    const res = await post({ ...timedBody, date: '07/01/2026' });
    expect(res.status).toBe(400);
  });

  it('400s when a timed event is missing times', async () => {
    const res = await post({
      calendarId: 'primary',
      title: 'Dentist',
      allDay: false,
      date: '2026-07-01',
    });
    expect(res.status).toBe(400);
  });

  it('400s when endTime is not after startTime', async () => {
    const res = await post({ ...timedBody, startTime: '10:00', endTime: '10:00' });
    expect(res.status).toBe(400);
  });

  it('400s on invalid JSON', async () => {
    const res = await post('not json');
    expect(res.status).toBe(400);
  });

  it('creates a timed event, stamps the configured zone, and write-throughs to the cache', async () => {
    mockCreateCalendarEvent.mockResolvedValue({
      id: 'goog_1',
      summary: 'Dentist',
      start: { dateTime: '2026-07-01T09:00:00-05:00' },
      end: { dateTime: '2026-07-01T10:00:00-05:00' },
    });

    const res = await post(timedBody);
    expect(res.status).toBe(201);

    // Google got a naive wall-clock time + the configured display zone.
    const [, calendarId, input] = mockCreateCalendarEvent.mock.calls[0];
    expect(calendarId).toBe('primary');
    expect(input.start).toEqual({ dateTime: '2026-07-01T09:00:00', timeZone: 'America/Chicago' });
    expect(input.end).toEqual({ dateTime: '2026-07-01T10:00:00', timeZone: 'America/Chicago' });

    // Confirmed-then-shown: in the cache immediately, no waiting for a sync.
    const cached = getEventsInRange('2026-07-01', '2026-07-02');
    expect(cached).toHaveLength(1);
    expect(cached[0].event_id).toBe('goog_1');
    expect(cached[0].summary).toBe('Dentist');
  });

  it('creates an all-day event with an exclusive end date', async () => {
    mockCreateCalendarEvent.mockImplementation(async (_tok, _cal, input) => ({
      id: 'goog_allday',
      summary: input.summary,
      start: input.start,
      end: input.end,
    }));

    const res = await post({
      calendarId: 'work',
      title: 'Holiday',
      allDay: true,
      date: '2026-07-04',
    });
    expect(res.status).toBe(201);

    const [, , input] = mockCreateCalendarEvent.mock.calls[0];
    expect(input.start).toEqual({ date: '2026-07-04' });
    expect(input.end).toEqual({ date: '2026-07-05' }); // Google all-day end is exclusive
  });

  it('creates a multi-day all-day event from an inclusive endDate', () => {
    mockCreateCalendarEvent.mockImplementation(async (_tok, _cal, input) => ({
      id: 'goog_trip',
      summary: input.summary,
      start: input.start,
      end: input.end,
    }));

    // "Lake LBJ, Aug 2 through Aug 8" — what the user picks is the LAST day.
    return post({
      calendarId: 'primary',
      title: 'Lake LBJ',
      allDay: true,
      date: '2026-08-02',
      endDate: '2026-08-08',
    }).then(async (res) => {
      expect(res.status).toBe(201);
      const [, , input] = mockCreateCalendarEvent.mock.calls[0];
      expect(input.start).toEqual({ date: '2026-08-02' });
      // Exclusive on Google: the day AFTER the last covered day.
      expect(input.end).toEqual({ date: '2026-08-09' });
    });
  });

  it('400s when the end date precedes the start, without touching Google', async () => {
    const res = await post({
      calendarId: 'primary',
      title: 'Backwards',
      allDay: true,
      date: '2026-08-08',
      endDate: '2026-08-02',
    });
    expect(res.status).toBe(400);
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });

  it('maps a Google 403 to a re-consent message', async () => {
    mockCreateCalendarEvent.mockRejectedValue(new CalendarApiError(403, 'forbidden'));
    const res = await post(timedBody);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/setup/);
  });

  it('401s when no valid token is available', async () => {
    mockGetValidAccessToken.mockRejectedValue(
      new Error('Google authorization revoked — reconnect at /setup')
    );
    const res = await post(timedBody);
    expect(res.status).toBe(401);
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });
});
