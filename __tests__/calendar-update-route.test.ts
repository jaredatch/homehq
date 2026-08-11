import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type Database from 'better-sqlite3';
import { getDb, _setDefaultDb } from '@/lib/db';
import { upsertEvent, getEventsInRange } from '@/lib/db/events';
import { CalendarApiError } from '@/lib/google/calendar';

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

const mockPatchCalendarEvent = vi.fn();
vi.mock('@/lib/google/calendar', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/google/calendar')>();
  return {
    ...actual,
    patchCalendarEvent: (...args: unknown[]) => mockPatchCalendarEvent(...args),
  };
});

import { POST } from '@/app/api/calendar/update/route';

describe('POST /api/calendar/update', () => {
  let tmpDir: string;
  let db: Database.Database;

  const baseConfig = {
    calendars: [{ id: 'primary', name: 'Family', color: '#4285f4' }],
    weather: { latitude: 0, longitude: 0, temperatureUnit: 'fahrenheit' },
    display: { calendarWeeks: 2, showWeather: true, timezone: 'America/Chicago' },
    auth: { pin: '654321' },
    google: { calendarAccess: 'readwrite' },
  };

  const seedTimed = () =>
    upsertEvent({
      event_id: 'evt_timed',
      calendar_id: 'primary',
      summary: 'Old title',
      description: null,
      location: null,
      start_time: '2026-07-01T09:00:00-05:00',
      end_time: '2026-07-01T10:00:00-05:00',
      all_day: 0,
      recurring_event_id: null,
      group_id: null,
    });

  const editBody = {
    eventId: 'evt_timed',
    calendarId: 'primary',
    title: 'New title',
    allDay: false,
    date: '2026-07-01',
    startTime: '11:00',
    endTime: '12:00',
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'homehq-update-route-'));
    db = getDb(join(tmpDir, 'test.db'));
    _setDefaultDb(db);
    mockConfig = structuredClone(baseConfig);
    mockGetValidAccessToken.mockReset().mockResolvedValue('access_tok');
    mockPatchCalendarEvent.mockReset();
  });

  afterEach(() => {
    _setDefaultDb(null);
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function post(body: unknown) {
    return POST(
      new Request('http://localhost/api/calendar/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }) as unknown as NextRequest
    );
  }

  it('403s and never calls Google when read-only', async () => {
    mockConfig.google.calendarAccess = 'readonly';
    seedTimed();
    const res = await post(editBody);
    expect(res.status).toBe(403);
    expect(mockPatchCalendarEvent).not.toHaveBeenCalled();
  });

  it('404s when the event is not in the cache', async () => {
    const res = await post({ ...editBody, eventId: 'ghost' });
    expect(res.status).toBe(404);
    expect(mockPatchCalendarEvent).not.toHaveBeenCalled();
  });

  it('409s on a recurring occurrence, without touching Google', async () => {
    upsertEvent({
      event_id: 'evt_recurring',
      calendar_id: 'primary',
      summary: 'Weekly 1:1',
      description: null,
      location: null,
      start_time: '2026-07-01T09:00:00-05:00',
      end_time: '2026-07-01T09:30:00-05:00',
      all_day: 0,
      recurring_event_id: 'series',
      group_id: null,
    });
    const res = await post({ ...editBody, eventId: 'evt_recurring' });
    expect(res.status).toBe(409);
    expect(mockPatchCalendarEvent).not.toHaveBeenCalled();
  });

  it('400s on a blank title and on bad times', async () => {
    seedTimed();
    expect((await post({ ...editBody, title: '  ' })).status).toBe(400);
    expect((await post({ ...editBody, startTime: '12:00', endTime: '11:00' })).status).toBe(400);
  });

  it('patches a timed event with the configured zone and writes through to cache', async () => {
    seedTimed();
    mockPatchCalendarEvent.mockResolvedValue({
      id: 'evt_timed',
      summary: 'New title',
      start: { dateTime: '2026-07-01T11:00:00-05:00' },
      end: { dateTime: '2026-07-01T12:00:00-05:00' },
    });

    const res = await post(editBody);
    expect(res.status).toBe(200);

    const [, calendarId, eventId, patch] = mockPatchCalendarEvent.mock.calls[0];
    expect(calendarId).toBe('primary');
    expect(eventId).toBe('evt_timed');
    expect(patch.start).toEqual({
      dateTime: '2026-07-01T11:00:00',
      timeZone: 'America/Chicago',
      date: null,
    });
    expect(patch.end).toEqual({
      dateTime: '2026-07-01T12:00:00',
      timeZone: 'America/Chicago',
      date: null,
    });

    const cached = getEventsInRange('2026-07-01', '2026-07-02');
    expect(cached[0].summary).toBe('New title');
  });

  it('preserves a multi-day all-day span on a date-only edit', async () => {
    // A 3-day all-day event (end is exclusive).
    upsertEvent({
      event_id: 'evt_trip',
      calendar_id: 'primary',
      summary: 'Trip',
      description: null,
      location: null,
      start_time: '2026-07-01',
      end_time: '2026-07-04',
      all_day: 1,
      recurring_event_id: null,
      group_id: null,
    });
    mockPatchCalendarEvent.mockImplementation(async (_t, _c, _e, patch) => ({
      id: 'evt_trip',
      summary: patch.summary,
      start: patch.start,
      end: patch.end,
    }));

    const res = await post({
      eventId: 'evt_trip',
      calendarId: 'primary',
      title: 'Trip',
      allDay: true,
      date: '2026-07-10',
    });
    expect(res.status).toBe(200);

    const [, , , patch] = mockPatchCalendarEvent.mock.calls[0];
    expect(patch.start).toEqual({ date: '2026-07-10', dateTime: null, timeZone: null });
    expect(patch.end).toEqual({ date: '2026-07-13', dateTime: null, timeZone: null }); // span of 3 kept
  });

  it('maps a Google 403 to a re-consent message', async () => {
    seedTimed();
    mockPatchCalendarEvent.mockRejectedValue(new CalendarApiError(403, 'forbidden'));
    const res = await post(editBody);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/setup/);
  });

  it('404s when Google reports the event is gone', async () => {
    seedTimed();
    mockPatchCalendarEvent.mockRejectedValue(new CalendarApiError(410, 'gone'));
    const res = await post(editBody);
    expect(res.status).toBe(404);
  });

  it('401s when no valid token is available', async () => {
    seedTimed();
    mockGetValidAccessToken.mockRejectedValue(new Error('reconnect at /setup'));
    const res = await post(editBody);
    expect(res.status).toBe(401);
    expect(mockPatchCalendarEvent).not.toHaveBeenCalled();
  });
});
