import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type Database from 'better-sqlite3';
import { getDb, _setDefaultDb } from '@/lib/db';
import { upsertEvent, getEvent } from '@/lib/db/events';
import { upsertTodo, getTodo } from '@/lib/db/todos';
import { normalizeTask } from '@/lib/todoist/client';
import { COOKIE_NAME, createSession } from '@/lib/auth/session';
import {
  boardMayUseProject,
  boardOwnsEvent,
  creatableCalendarIds,
  isWriteRestricted,
} from '@/lib/calendar/board-writes';
import { resolveBoard } from '@/lib/config/boards';

/**
 * What a session minted by a personal board's PIN may WRITE.
 *
 * The rule this file holds: a bedroom panel's session can add, change, or
 * delete only what that board's own form would let her, whatever the request
 * body names. Every rule here is the browser's `canEditEvent` / `eventTargets`
 * restated on the server, and the household PIN stays unrestricted.
 */

const SECRET = 'test-secret-key-for-hmac-signing';

let mockConfig: Record<string, unknown>;
vi.mock('@/lib/config', () => ({
  getConfig: () => mockConfig,
  isCalendarWriteEnabled: () => true,
}));

let mockCookie: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === COOKIE_NAME && mockCookie ? { name, value: mockCookie } : undefined,
  }),
}));

vi.mock('@/lib/google/oauth', () => ({
  getValidAccessToken: async () => 'token',
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

const mockCreateTask = vi.fn();
const mockCloseTask = vi.fn();
const mockReopenTask = vi.fn();
vi.mock('@/lib/todoist/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/todoist/client')>();
  return {
    ...actual,
    createTask: (...args: unknown[]) => mockCreateTask(...args),
    closeTask: (...args: unknown[]) => mockCloseTask(...args),
    reopenTask: (...args: unknown[]) => mockReopenTask(...args),
  };
});

import { POST as createEvent } from '@/app/api/calendar/create/route';
import { POST as updateEvent } from '@/app/api/calendar/update/route';
import { POST as deleteEvent } from '@/app/api/calendar/delete/route';
import { GET as listTodos } from '@/app/api/todos/route';
import { POST as createTodo } from '@/app/api/todos/create/route';
import { POST as completeTodo } from '@/app/api/todos/complete/route';
import { POST as reopenTodo } from '@/app/api/todos/reopen/route';

const baseConfig = {
  calendars: [
    { id: 'family', name: 'Family', color: '#4285f4' },
    { id: 'dad', name: 'Dad', color: '#0f9d58' },
    { id: 'maddie', name: 'Maddie', color: '#f472b6' },
    { id: 'maddie-room', name: 'Maddie private', color: '#f472b6', hidden: true },
    { id: 'eleanor', name: 'Eleanor', color: '#a78bfa' },
  ],
  weather: { latitude: 0, longitude: 0, temperatureUnit: 'fahrenheit' },
  display: { calendarWeeks: 2, showWeather: true, timezone: 'America/Chicago' },
  auth: { pin: '654321' },
  google: { calendarAccess: 'readwrite' },
  boards: {
    maddie: {
      layout: 'personal',
      name: 'Maddie',
      calendars: ['maddie', 'maddie-room', 'family', 'eleanor'],
      ownCalendars: ['maddie', 'maddie-room'],
      alwaysShow: ['family'],
      defaultCalendar: 'maddie-room',
      pin: '111111',
      todos: { projectId: 'p-maddie' },
    },
    eleanor: {
      layout: 'personal',
      name: 'Eleanor',
      calendars: ['eleanor', 'family'],
      ownCalendars: ['eleanor'],
      pin: '222222',
      todos: { projectId: 'p-eleanor' },
    },
    hall: {
      layout: 'family',
      name: 'Hall',
      pin: '333333',
    },
  },
};

function post(handler: (r: NextRequest) => Promise<Response>, path: string, body: unknown) {
  return handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  );
}

function get(handler: (r: NextRequest) => Promise<Response>, path: string) {
  return handler({ nextUrl: new URL(`http://localhost${path}`) } as unknown as NextRequest);
}

const event = (
  event_id: string,
  calendar_id: string,
  extra: Partial<{ group_id: string | null; summary: string }> = {}
) => ({
  event_id,
  calendar_id,
  summary: extra.summary ?? event_id,
  description: null,
  location: null,
  start_time: '2026-09-10T14:00:00Z',
  end_time: '2026-09-10T15:00:00Z',
  all_day: 0,
  recurring_event_id: null,
  group_id: extra.group_id ?? null,
});

const timed = {
  title: 'x',
  allDay: false,
  date: '2026-09-10',
  startTime: '09:00',
  endTime: '10:00',
};

const googleEvent = (id: string) => ({
  id,
  summary: 'x',
  start: { dateTime: '2026-09-10T09:00:00-05:00' },
  end: { dateTime: '2026-09-10T10:00:00-05:00' },
});

describe('board-writes policy', () => {
  beforeEach(() => {
    mockConfig = structuredClone(baseConfig);
  });

  it('restricts only a personal board', () => {
    expect(isWriteRestricted(null)).toBe(false);
    expect(isWriteRestricted(resolveBoard('hall'))).toBe(false);
    expect(isWriteRestricted(resolveBoard('maddie'))).toBe(true);
  });

  it('lets a new event land on her own calendars or an always-shown one, mirroring eventTargets', () => {
    const allowed = creatableCalendarIds(resolveBoard('maddie')!);
    expect([...allowed].sort()).toEqual(['family', 'maddie', 'maddie-room']);
  });

  it('owns an event only when every copy is hers, mirroring canEditEvent', () => {
    const board = resolveBoard('maddie')!;
    expect(boardOwnsEvent(board, ['maddie'])).toBe(true);
    expect(boardOwnsEvent(board, ['maddie', 'maddie-room'])).toBe(true);
    expect(boardOwnsEvent(board, ['maddie', 'dad'])).toBe(false);
    expect(boardOwnsEvent(board, ['family'])).toBe(false);
    expect(boardOwnsEvent(board, [])).toBe(false);
  });

  it('ties a board to the one project it names', () => {
    const board = resolveBoard('maddie')!;
    expect(boardMayUseProject(board, 'p-maddie')).toBe(true);
    expect(boardMayUseProject(board, 'p-eleanor')).toBe(false);
    expect(boardMayUseProject(resolveBoard('hall')!, 'p-maddie')).toBe(false);
  });
});

describe('write routes under a board-stamped session', () => {
  let tmpDir: string;
  let db: Database.Database;

  const signInAs = async (board?: string) => {
    mockCookie = await createSession(SECRET, board);
  };

  beforeEach(async () => {
    mockConfig = structuredClone(baseConfig);
    mockCookie = undefined;
    process.env.COOKIE_SECRET = SECRET;
    delete process.env.DEV_AUTH_BYPASS;
    tmpDir = mkdtempSync(join(tmpdir(), 'homehq-board-writes-'));
    db = getDb(join(tmpDir, 'test.db'));
    _setDefaultDb(db);
    vi.clearAllMocks();

    upsertEvent(event('own-1', 'maddie'));
    upsertEvent(event('dad-1', 'dad'));
    upsertEvent(event('fam-1', 'family'));
    // One event shared between Dad and Maddie through a HomeHQ stamp.
    upsertEvent(event('shared-dad', 'dad', { group_id: 'g1', summary: 'Ortho' }));
    upsertEvent(event('shared-maddie', 'maddie', { group_id: 'g1', summary: 'Ortho' }));

    upsertTodo(normalizeTask({ id: 't-m', project_id: 'p-maddie', content: 'Pack' }));
    upsertTodo(normalizeTask({ id: 't-e', project_id: 'p-eleanor', content: 'Read' }));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.COOKIE_SECRET;
  });

  describe('create', () => {
    it('lands on her own calendar', async () => {
      await signInAs('maddie');
      mockCreate.mockResolvedValue(googleEvent('g-new'));
      const res = await post(createEvent, '/api/calendar/create', {
        ...timed,
        calendarId: 'maddie-room',
      });
      expect(res.status).toBe(201);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('lands on the always-shown family calendar, which is her "Family" target', async () => {
      await signInAs('maddie');
      mockCreate.mockResolvedValue(googleEvent('g-new'));
      const res = await post(createEvent, '/api/calendar/create', {
        ...timed,
        calendarId: 'family',
      });
      expect(res.status).toBe(201);
    });

    it("refuses a parent's calendar, and never reaches Google", async () => {
      await signInAs('maddie');
      const res = await post(createEvent, '/api/calendar/create', { ...timed, calendarId: 'dad' });
      expect(res.status).toBe(403);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('refuses a sibling calendar the board merely draws', async () => {
      await signInAs('maddie');
      const res = await post(createEvent, '/api/calendar/create', {
        ...timed,
        calendarId: 'eleanor',
      });
      expect(res.status).toBe(403);
    });

    it('refuses a shared event when either half is out of bounds', async () => {
      await signInAs('maddie');
      const res = await post(createEvent, '/api/calendar/create', {
        ...timed,
        calendarIds: ['maddie', 'dad'],
      });
      expect(res.status).toBe(403);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const edit = (eventId: string, calendarId: string, extra: Record<string, unknown> = {}) =>
      post(updateEvent, '/api/calendar/update', {
        eventId,
        calendarId,
        ...timed,
        title: 'Changed',
        ...extra,
      });

    it('changes her own event', async () => {
      await signInAs('maddie');
      mockPatch.mockResolvedValue({ ...googleEvent('own-1'), summary: 'Changed' });
      const res = await edit('own-1', 'maddie');
      expect(res.status).toBe(200);
      expect(getEvent('own-1', 'maddie')?.summary).toBe('Changed');
    });

    it("refuses a parent's event", async () => {
      await signInAs('maddie');
      const res = await edit('dad-1', 'dad');
      expect(res.status).toBe(403);
      expect(mockPatch).not.toHaveBeenCalled();
    });

    it('refuses a family event even though she can create one there', async () => {
      await signInAs('maddie');
      const res = await edit('fam-1', 'family');
      expect(res.status).toBe(403);
    });

    it("refuses a shared event through her own copy, because a parent's copy is theirs", async () => {
      await signInAs('maddie');
      const res = await edit('shared-maddie', 'maddie');
      expect(res.status).toBe(403);
      expect(mockPatch).not.toHaveBeenCalled();
    });

    it("refuses moving her own event onto a parent's calendar", async () => {
      await signInAs('maddie');
      const res = await edit('own-1', 'maddie', { calendarIds: ['maddie', 'dad'] });
      expect(res.status).toBe(403);
      expect(mockPatch).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    const del = (eventId: string, calendarId: string) =>
      post(deleteEvent, '/api/calendar/delete', { eventId, calendarId });

    it('deletes her own event', async () => {
      await signInAs('maddie');
      mockDelete.mockResolvedValue(undefined);
      const res = await del('own-1', 'maddie');
      expect(res.status).toBe(200);
      expect(getEvent('own-1', 'maddie')).toBeFalsy();
    });

    it("refuses a parent's event", async () => {
      await signInAs('maddie');
      const res = await del('dad-1', 'dad');
      expect(res.status).toBe(403);
      expect(mockDelete).not.toHaveBeenCalled();
      expect(getEvent('dad-1', 'dad')).toBeTruthy();
    });

    it('refuses a shared event through her own copy, since deleting it removes every copy', async () => {
      await signInAs('maddie');
      const res = await del('shared-maddie', 'maddie');
      expect(res.status).toBe(403);
      expect(mockDelete).not.toHaveBeenCalled();
      expect(getEvent('shared-dad', 'dad')).toBeTruthy();
    });
  });

  describe('to-dos', () => {
    it('reads and writes her own project', async () => {
      await signInAs('maddie');
      expect((await get(listTodos, '/api/todos?projectId=p-maddie')).status).toBe(200);

      mockCreateTask.mockResolvedValue({ id: 't-new', project_id: 'p-maddie', content: 'Go' });
      const created = await post(createTodo, '/api/todos/create', {
        projectId: 'p-maddie',
        content: 'Go',
      });
      expect(created.status).toBe(201);

      mockCloseTask.mockResolvedValue(undefined);
      expect((await post(completeTodo, '/api/todos/complete', { id: 't-m' })).status).toBe(200);
      mockReopenTask.mockResolvedValue(undefined);
      expect((await post(reopenTodo, '/api/todos/reopen', { id: 't-m' })).status).toBe(200);
    });

    it("cannot see or touch a sibling's project, and gets the same 404 an unknown one would", async () => {
      await signInAs('maddie');
      expect((await get(listTodos, '/api/todos?projectId=p-eleanor')).status).toBe(404);

      const created = await post(createTodo, '/api/todos/create', {
        projectId: 'p-eleanor',
        content: 'Go',
      });
      expect(created.status).toBe(404);
      expect(mockCreateTask).not.toHaveBeenCalled();

      expect((await post(completeTodo, '/api/todos/complete', { id: 't-e' })).status).toBe(404);
      expect(mockCloseTask).not.toHaveBeenCalled();
      expect(getTodo('t-e')?.completed_on).toBeNull();

      expect((await post(reopenTodo, '/api/todos/reopen', { id: 't-e' })).status).toBe(404);
      expect(mockReopenTask).not.toHaveBeenCalled();
    });
  });

  describe('who is unrestricted', () => {
    it('the household PIN writes anywhere, as it always has', async () => {
      await signInAs();
      mockCreate.mockResolvedValue(googleEvent('g-new'));
      const res = await post(createEvent, '/api/calendar/create', { ...timed, calendarId: 'dad' });
      expect(res.status).toBe(201);
      expect((await get(listTodos, '/api/todos?projectId=p-eleanor')).status).toBe(200);
    });

    it('a family-layout board with its own PIN writes anywhere, as its form edits membership', async () => {
      await signInAs('hall');
      mockCreate.mockResolvedValue(googleEvent('g-new'));
      const res = await post(createEvent, '/api/calendar/create', { ...timed, calendarId: 'dad' });
      expect(res.status).toBe(201);
    });

    it('the dev bypass is unrestricted, and never reads a cookie', async () => {
      process.env.DEV_AUTH_BYPASS = '1';
      mockCreate.mockResolvedValue(googleEvent('g-new'));
      const res = await post(createEvent, '/api/calendar/create', { ...timed, calendarId: 'dad' });
      expect(res.status).toBe(201);
      delete process.env.DEV_AUTH_BYPASS;
    });
  });

  describe('who is refused outright', () => {
    it('no session at all is a 401, not a household write', async () => {
      const res = await post(createEvent, '/api/calendar/create', {
        ...timed,
        calendarId: 'maddie',
      });
      expect(res.status).toBe(401);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('a stamp naming a board the config no longer has is refused, not widened', async () => {
      await signInAs('maddie');
      delete (mockConfig.boards as Record<string, unknown>).maddie;
      const res = await post(createEvent, '/api/calendar/create', {
        ...timed,
        calendarId: 'maddie',
      });
      expect(res.status).toBe(403);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });
});
