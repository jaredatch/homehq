import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type Database from 'better-sqlite3';
import { getDb, _setDefaultDb } from '@/lib/db';
import { upsertCalendarEvents } from '@/lib/db/events';
import { COOKIE_NAME, createSession } from '@/lib/auth/session';

/**
 * `GET /api/calendar` — who may read which calendars.
 *
 * The privacy rule this file exists to hold: a session minted by a personal
 * board's own PIN reads that board's calendars and nothing else, whatever the
 * query string says.
 */

const SECRET = 'test-secret-key-for-hmac-signing';

let mockConfig: Record<string, unknown>;
vi.mock('@/lib/config', () => ({
  getConfig: () => mockConfig,
  isCalendarWriteEnabled: () => true,
}));

// The route reads the session cookie through next/headers.
let mockCookie: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === COOKIE_NAME && mockCookie ? { name, value: mockCookie } : undefined,
  }),
}));

import { GET } from '@/app/api/calendar/route';

const baseConfig = {
  calendars: [
    { id: 'family', name: 'Family', color: '#4285f4' },
    { id: 'dad', name: 'Dad', color: '#0f9d58' },
    { id: 'maddie', name: 'Maddie', color: '#f472b6' },
    { id: 'maddie-room', name: 'Maddie private', color: '#f472b6', hidden: true },
  ],
  weather: { latitude: 0, longitude: 0, temperatureUnit: 'fahrenheit' },
  display: { calendarWeeks: 2, showWeather: true },
  auth: { pin: '654321' },
  google: { calendarAccess: 'readwrite' },
  boards: {
    maddie: {
      layout: 'personal',
      name: 'Maddie',
      calendars: ['maddie', 'maddie-room', 'family'],
      ownCalendars: ['maddie', 'maddie-room'],
      defaultCalendar: 'maddie-room',
      pin: '111111',
    },
  },
};

/** The route only ever reads `nextUrl.searchParams`, and a plain Request has no
 * `nextUrl` — a URL stands in for it exactly. */
function request(query: string): NextRequest {
  return { nextUrl: new URL(`http://localhost/api/calendar${query}`) } as unknown as NextRequest;
}

const RANGE = '?start=2026-09-01&end=2026-09-30';

function seed() {
  upsertCalendarEvents('dad', [
    {
      event_id: 'dad-1',
      calendar_id: 'dad',
      summary: 'Board meeting',
      description: 'Q3 numbers',
      location: 'Downtown',
      start_time: '2026-09-10T14:00:00Z',
      end_time: '2026-09-10T15:00:00Z',
      all_day: 0,
      recurring_event_id: null,
      group_id: null,
    },
    // The same event, shared with Maddie via a HomeHQ stamp.
    {
      event_id: 'shared-dad',
      calendar_id: 'dad',
      summary: 'Orthodontist',
      description: null,
      location: null,
      start_time: '2026-09-11T16:00:00Z',
      end_time: '2026-09-11T17:00:00Z',
      all_day: 0,
      recurring_event_id: null,
      group_id: 'g1',
    },
  ]);
  upsertCalendarEvents('maddie', [
    {
      event_id: 'shared-maddie',
      calendar_id: 'maddie',
      summary: 'Orthodontist',
      description: null,
      location: null,
      start_time: '2026-09-11T16:00:00Z',
      end_time: '2026-09-11T17:00:00Z',
      all_day: 0,
      recurring_event_id: null,
      group_id: 'g1',
    },
    {
      event_id: 'maddie-1',
      calendar_id: 'maddie',
      summary: 'Soccer',
      description: null,
      location: null,
      start_time: '2026-09-12T22:00:00Z',
      end_time: '2026-09-12T23:00:00Z',
      all_day: 0,
      recurring_event_id: null,
      group_id: null,
    },
  ]);
}

interface ApiEvent {
  calendar_id: string;
  summary: string;
  linkedCalendarIds?: string[];
}

describe('GET /api/calendar', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    mockConfig = structuredClone(baseConfig);
    mockCookie = undefined;
    process.env.COOKIE_SECRET = SECRET;
    // DEV_AUTH_BYPASS must be off, or the route never reads a session.
    delete process.env.DEV_AUTH_BYPASS;
    tmpDir = mkdtempSync(join(tmpdir(), 'homehq-cal-route-'));
    db = getDb(join(tmpDir, 'test.db'));
    _setDefaultDb(db);
    seed();
  });

  afterEach(() => {
    db.close();
    _setDefaultDb(null);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects a request with no range', async () => {
    mockCookie = await createSession(SECRET);
    const res = await GET(request(''));
    expect(res.status).toBe(400);
  });

  it('rejects a request with no session', async () => {
    const res = await GET(request(RANGE));
    expect(res.status).toBe(401);
  });

  it('returns the whole cache to a family session, untouched', async () => {
    mockCookie = await createSession(SECRET);
    const res = await GET(request(RANGE));
    const { events } = (await res.json()) as { events: ApiEvent[] };
    expect(events).toHaveLength(4);
    // The wall's response is what it always was — no server-side link stamp.
    for (const e of events) expect(e).not.toHaveProperty('linkedCalendarIds');
  });

  it('scopes a board-stamped session to that board, with no board param', async () => {
    mockCookie = await createSession(SECRET, 'maddie');
    const res = await GET(request(RANGE));
    const { events } = (await res.json()) as { events: ApiEvent[] };
    expect(events.map((e) => e.calendar_id).sort()).toEqual(['maddie', 'maddie']);
    // Dad's private event never leaves the server.
    expect(JSON.stringify(events)).not.toContain('Board meeting');
    expect(JSON.stringify(events)).not.toContain('Downtown');
  });

  it('refuses to widen a board session by naming another board', async () => {
    mockCookie = await createSession(SECRET, 'maddie');
    const res = await GET(request(`${RANGE}&board=family`));
    expect(res.status).toBe(403);
  });

  it('tells a scoped board about a sibling copy it cannot see', async () => {
    mockCookie = await createSession(SECRET, 'maddie');
    const res = await GET(request(RANGE));
    const { events } = (await res.json()) as { events: ApiEvent[] };
    const shared = events.find((e) => e.summary === 'Orthodontist')!;
    // This is what stops the board treating a shared event as editable.
    expect(new Set(shared.linkedCalendarIds)).toEqual(new Set(['maddie', 'dad']));
    const own = events.find((e) => e.summary === 'Soccer')!;
    expect(own.linkedCalendarIds).toEqual(['maddie']);
  });

  it('lets a family session peek at a board by naming it', async () => {
    mockCookie = await createSession(SECRET);
    const res = await GET(request(`${RANGE}&board=maddie`));
    const { events } = (await res.json()) as { events: ApiEvent[] };
    expect(events.every((e) => e.calendar_id === 'maddie')).toBe(true);
  });

  it('404s an unknown board rather than falling back to everything', async () => {
    mockCookie = await createSession(SECRET);
    const res = await GET(request(`${RANGE}&board=nobody`));
    expect(res.status).toBe(404);
  });

  it('still returns everything when the config names no boards', async () => {
    delete (mockConfig as { boards?: unknown }).boards;
    mockCookie = await createSession(SECRET);
    const res = await GET(request(RANGE));
    const { events } = (await res.json()) as { events: ApiEvent[] };
    expect(events).toHaveLength(4);
  });
});
