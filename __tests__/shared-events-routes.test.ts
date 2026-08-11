/**
 * Shared events across the three write routes: an event that applies to two
 * people is one REAL Google event per calendar, all stamped with the same group
 * id. These tests cover the fan-out; the existing single-calendar route tests
 * stay untouched on purpose — they're the evidence that path didn't change.
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type Database from 'better-sqlite3';
import { getDb, _setDefaultDb } from '@/lib/db';
import { upsertEvent, getEvent, getEventsInRange } from '@/lib/db/events';
import { CalendarApiError } from '@/lib/google/calendar';
import { GROUP_PROPERTY_KEY } from '@/lib/calendar/event-groups';

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

const mockCreate = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();
vi.mock('@/lib/google/calendar', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/google/calendar')>();
  return {
    ...actual,
    createCalendarEvent: (...args: unknown[]) => mockCreate(...args),
    patchCalendarEvent: (...args: unknown[]) => mockPatch(...args),
    deleteCalendarEvent: (...args: unknown[]) => mockDelete(...args),
  };
});

import { POST as createPOST } from '@/app/api/calendar/create/route';
import { POST as updatePOST } from '@/app/api/calendar/update/route';
import { POST as deletePOST } from '@/app/api/calendar/delete/route';

describe('shared events (multi-calendar)', () => {
  let tmpDir: string;
  let db: Database.Database;

  const baseConfig = {
    calendars: [
      { id: 'maddie', name: 'Maddie', color: '#F274DE' },
      { id: 'eleanor', name: 'Eleanor', color: '#A874F2' },
      { id: 'family', name: 'Family', color: '#F5F394' },
    ],
    weather: { latitude: 0, longitude: 0, temperatureUnit: 'fahrenheit' },
    display: { calendarWeeks: 2, showWeather: true, timezone: 'America/Chicago' },
    auth: { pin: '654321' },
    google: { calendarAccess: 'readwrite' },
  };

  /** Google echoes an insert back, with a per-calendar event id. */
  const echoCreate = async (_tok: string, calendarId: string, input: Record<string, unknown>) => ({
    id: `goog_${calendarId}`,
    summary: input.summary,
    start: input.start,
    end: input.end,
    extendedProperties: input.extendedProperties,
  });

  /** Google echoes a patch back. Note the arg order: (token, calendarId, eventId, patch). */
  const echoPatch = async (
    _tok: string,
    _calendarId: string,
    eventId: string,
    patch: Record<string, unknown>
  ) => ({
    id: eventId,
    summary: patch.summary,
    start: patch.start,
    end: patch.end,
    extendedProperties: patch.extendedProperties,
  });

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'homehq-shared-events-'));
    db = getDb(join(tmpDir, 'test.db'));
    _setDefaultDb(db);
    mockConfig = structuredClone(baseConfig);
    mockGetValidAccessToken.mockReset().mockResolvedValue('access_tok');
    mockCreate.mockReset().mockImplementation(echoCreate);
    mockPatch.mockReset().mockImplementation(echoPatch);
    mockDelete.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    _setDefaultDb(null);
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Widened to Response: the three routes have different success payloads.
  type RouteHandler = (request: NextRequest) => Promise<Response>;

  const post = (route: RouteHandler, path: string, body: unknown) =>
    route(
      new Request(`http://localhost/api/calendar/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }) as unknown as NextRequest
    );

  const create = (body: unknown) => post(createPOST, 'create', body);
  const update = (body: unknown) => post(updatePOST, 'update', body);
  const remove = (body: unknown) => post(deletePOST, 'delete', body);

  const noSchoolBody = {
    calendarIds: ['maddie', 'eleanor'],
    title: 'No school',
    allDay: true,
    date: '2026-09-04',
  };

  /** Seed a shared event already present on both girls' calendars. */
  const seedShared = (groupId = 'grp_1') => {
    for (const calendarId of ['maddie', 'eleanor']) {
      upsertEvent({
        event_id: `goog_${calendarId}`,
        calendar_id: calendarId,
        summary: 'Recital',
        description: null,
        location: null,
        start_time: '2026-09-04T18:00:00-05:00',
        end_time: '2026-09-04T19:00:00-05:00',
        all_day: 0,
        recurring_event_id: null,
        group_id: groupId,
      });
    }
  };

  const editBody = {
    eventId: 'goog_maddie',
    calendarId: 'maddie',
    title: 'Recital',
    allDay: false,
    date: '2026-09-04',
    startTime: '18:00',
    endTime: '19:00',
  };

  // ---------------------------------------------------------------- create

  describe('create', () => {
    it('writes one real event per calendar, all carrying the same stamp', async () => {
      const res = await create(noSchoolBody);
      expect(res.status).toBe(201);

      expect(mockCreate).toHaveBeenCalledTimes(2);
      const [[, calA, inputA], [, calB, inputB]] = mockCreate.mock.calls;
      expect([calA, calB]).toEqual(['maddie', 'eleanor']);

      const groupA = inputA.extendedProperties.private[GROUP_PROPERTY_KEY];
      const groupB = inputB.extendedProperties.private[GROUP_PROPERTY_KEY];
      expect(groupA).toBeTruthy();
      expect(groupA).toBe(groupB);

      // Both copies cached immediately, both stamped — ready for the grid to merge.
      const cached = getEventsInRange('2026-09-04', '2026-09-05');
      expect(cached).toHaveLength(2);
      expect(cached.map((e) => e.calendar_id).sort()).toEqual(['eleanor', 'maddie']);
      expect(new Set(cached.map((e) => e.group_id))).toEqual(new Set([groupA]));
    });

    it('leaves a single-calendar event completely unstamped', async () => {
      const res = await create({ ...noSchoolBody, calendarIds: ['family'] });
      expect(res.status).toBe(201);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate.mock.calls[0][2].extendedProperties).toBeUndefined();

      const cached = getEventsInRange('2026-09-04', '2026-09-05');
      expect(cached).toHaveLength(1);
      expect(cached[0].group_id).toBeNull();
    });

    it('still accepts the original scalar calendarId', async () => {
      const res = await create({
        calendarId: 'family',
        title: 'No school',
        allDay: true,
        date: '2026-09-04',
      });
      expect(res.status).toBe(201);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(getEventsInRange('2026-09-04', '2026-09-05')[0].group_id).toBeNull();
    });

    it('collapses a duplicate calendar rather than double-booking it', async () => {
      const res = await create({ ...noSchoolBody, calendarIds: ['maddie', 'maddie'] });
      expect(res.status).toBe(201);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(getEventsInRange('2026-09-04', '2026-09-05')).toHaveLength(1);
    });

    it('400s past the calendar cap, without touching Google', async () => {
      const res = await create({
        ...noSchoolBody,
        calendarIds: ['maddie', 'eleanor', 'family'],
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/at most 2 calendars/);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('400s when any calendar is unknown, without touching Google', async () => {
      const res = await create({ ...noSchoolBody, calendarIds: ['maddie', 'ghost'] });
      expect(res.status).toBe(400);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('keeps what landed and reports what did not (no rollback)', async () => {
      mockCreate.mockImplementation(async (tok: string, calendarId: string, input) => {
        if (calendarId === 'eleanor') throw new CalendarApiError(500, 'boom');
        return echoCreate(tok, calendarId, input);
      });

      const res = await create(noSchoolBody);
      expect(res.status).toBe(201);

      const payload = await res.json();
      expect(payload.events).toHaveLength(1);
      expect(payload.failures).toEqual([
        { calendarId: 'eleanor', error: expect.stringContaining('boom') },
      ]);

      // Maddie's real event is NOT deleted to fake a transaction.
      const cached = getEventsInRange('2026-09-04', '2026-09-05');
      expect(cached).toHaveLength(1);
      expect(cached[0].calendar_id).toBe('maddie');
    });

    it('reports a failure when nothing landed at all', async () => {
      mockCreate.mockRejectedValue(new CalendarApiError(403, 'forbidden'));
      const res = await create(noSchoolBody);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/setup/);
      expect(getEventsInRange('2026-09-04', '2026-09-05')).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------- update

  describe('update', () => {
    it('fans an edit out to every copy', async () => {
      seedShared();
      const res = await update({ ...editBody, title: 'Recital (moved)' });
      expect(res.status).toBe(200);

      expect(mockPatch).toHaveBeenCalledTimes(2);
      expect(mockPatch.mock.calls.map((c) => c[1]).sort()).toEqual(['eleanor', 'maddie']);
      expect(mockDelete).not.toHaveBeenCalled();

      const cached = getEventsInRange('2026-09-04', '2026-09-05');
      expect(cached).toHaveLength(2);
      expect(cached.every((e) => e.summary === 'Recital (moved)')).toBe(true);
    });

    it('unchecking one person deletes only their copy — the other survives', async () => {
      seedShared();
      const res = await update({ ...editBody, calendarIds: ['eleanor'] });
      expect(res.status).toBe(200);

      // Eleanor's copy patched, Maddie's deleted. Nothing else touched.
      expect(mockPatch).toHaveBeenCalledTimes(1);
      expect(mockPatch.mock.calls[0][1]).toBe('eleanor');
      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockDelete.mock.calls[0].slice(1)).toEqual(['maddie', 'goog_maddie']);

      expect(getEvent('goog_maddie', 'maddie')).toBeUndefined();
      expect(getEvent('goog_eleanor', 'eleanor')).toBeDefined();
    });

    it('promotes an ordinary event by stamping the original and inserting the new copy', async () => {
      upsertEvent({
        event_id: 'goog_maddie',
        calendar_id: 'maddie',
        summary: 'Recital',
        description: null,
        location: null,
        start_time: '2026-09-04T18:00:00-05:00',
        end_time: '2026-09-04T19:00:00-05:00',
        all_day: 0,
        recurring_event_id: null,
        group_id: null,
      });

      const res = await update({ ...editBody, calendarIds: ['maddie', 'eleanor'] });
      expect(res.status).toBe(200);

      // The original is patched WITH a freshly minted stamp...
      expect(mockPatch).toHaveBeenCalledTimes(1);
      const minted = mockPatch.mock.calls[0][3].extendedProperties.private[GROUP_PROPERTY_KEY];
      expect(minted).toBeTruthy();

      // ...and the new copy is inserted carrying the same one.
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate.mock.calls[0][1]).toBe('eleanor');
      expect(mockCreate.mock.calls[0][2].extendedProperties.private[GROUP_PROPERTY_KEY]).toBe(
        minted
      );

      const cached = getEventsInRange('2026-09-04', '2026-09-05');
      expect(cached).toHaveLength(2);
      expect(new Set(cached.map((e) => e.group_id))).toEqual(new Set([minted]));
    });

    it('leaves membership alone when the body omits calendarIds', async () => {
      seedShared();
      // The pre-Phase-2 modal sends only the scalar anchor. Reading that as the
      // whole set would silently delete the event's other copy.
      const res = await update(editBody);
      expect(res.status).toBe(200);
      expect(mockPatch).toHaveBeenCalledTimes(2);
      expect(mockDelete).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
      expect(getEventsInRange('2026-09-04', '2026-09-05')).toHaveLength(2);
    });

    it('moves an event between calendars (full swap — no calendar kept)', async () => {
      upsertEvent({
        event_id: 'goog_maddie',
        calendar_id: 'maddie',
        summary: 'Recital',
        description: null,
        location: null,
        start_time: '2026-09-04T18:00:00-05:00',
        end_time: '2026-09-04T19:00:00-05:00',
        all_day: 0,
        recurring_event_id: null,
        group_id: null,
      });

      const res = await update({ ...editBody, calendarIds: ['eleanor'] });
      expect(res.status).toBe(200);

      // Nothing to patch: insert on Eleanor, then drop Maddie's copy.
      expect(mockPatch).not.toHaveBeenCalled();
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate.mock.calls[0][1]).toBe('eleanor');
      expect(mockDelete).toHaveBeenCalledTimes(1);

      expect(getEvent('goog_maddie', 'maddie')).toBeUndefined();
      expect(getEvent('goog_eleanor', 'eleanor')).toBeDefined();
      // A single-calendar result stays unstamped.
      expect(getEvent('goog_eleanor', 'eleanor')?.group_id).toBeNull();
    });

    it('400s on an empty calendar list, without touching Google', async () => {
      seedShared();
      const res = await update({ ...editBody, calendarIds: [] });
      expect(res.status).toBe(400);
      expect(mockPatch).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('400s past the calendar cap, without touching Google', async () => {
      seedShared();
      const res = await update({
        ...editBody,
        calendarIds: ['maddie', 'eleanor', 'family'],
      });
      expect(res.status).toBe(400);
      expect(mockPatch).not.toHaveBeenCalled();
    });

    it('deletes last, so a failed patch never destroys the other copy', async () => {
      seedShared();
      mockPatch.mockRejectedValue(new CalendarApiError(500, 'boom'));

      const res = await update({ ...editBody, calendarIds: ['eleanor'] });
      expect(res.status).toBe(502);

      // Nothing was written, so Maddie's copy is still there to retry against.
      expect(mockDelete).not.toHaveBeenCalled();
      expect(getEvent('goog_maddie', 'maddie')).toBeDefined();
    });
  });

  // ---------------------------------------------------------------- delete

  describe('delete', () => {
    it('removes every copy of a shared event', async () => {
      seedShared();
      const res = await remove({ eventId: 'goog_maddie', calendarId: 'maddie' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, deleted: 2 });

      expect(mockDelete).toHaveBeenCalledTimes(2);
      expect(getEventsInRange('2026-09-04', '2026-09-05')).toHaveLength(0);
    });

    it('keeps what went through and reports what did not', async () => {
      seedShared();
      mockDelete.mockImplementation(async (_tok: string, calendarId: string) => {
        if (calendarId === 'eleanor') throw new CalendarApiError(500, 'boom');
      });

      const res = await remove({ eventId: 'goog_maddie', calendarId: 'maddie' });
      expect(res.status).toBe(200);
      const payload = await res.json();
      expect(payload.deleted).toBe(1);
      expect(payload.failures).toHaveLength(1);

      expect(getEvent('goog_maddie', 'maddie')).toBeUndefined();
      expect(getEvent('goog_eleanor', 'eleanor')).toBeDefined();
    });

    it('reports a failure when nothing could be deleted', async () => {
      seedShared();
      mockDelete.mockRejectedValue(new CalendarApiError(403, 'forbidden'));
      const res = await remove({ eventId: 'goog_maddie', calendarId: 'maddie' });
      expect(res.status).toBe(403);
      expect(getEventsInRange('2026-09-04', '2026-09-05')).toHaveLength(2);
    });
  });
});
