import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type Database from 'better-sqlite3';
import { getDb, _setDefaultDb } from '@/lib/db';
import { completeTodo, getTodo, upsertTodo } from '@/lib/db/todos';
import { normalizeTask, TodoistError } from '@/lib/todoist/client';

let mockConfig: Record<string, unknown>;
// The household path: an unstamped session. A sibling board's reach is held in
// board-writes-routes.test.ts.
vi.mock('@/lib/auth/request-board', () => ({
  requestBoard: async () => ({ ok: true, board: null }),
}));
vi.mock('@/lib/config', () => ({
  getConfig: () => mockConfig,
  isCalendarWriteEnabled: () => true,
}));

const mockUpdateTask = vi.fn();
const mockDeleteTask = vi.fn();
vi.mock('@/lib/todoist/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/todoist/client')>();
  return {
    ...actual,
    updateTask: (...args: unknown[]) => mockUpdateTask(...args),
    deleteTask: (...args: unknown[]) => mockDeleteTask(...args),
  };
});

import { POST as update } from '@/app/api/todos/update/route';
import { POST as remove } from '@/app/api/todos/delete/route';

const baseConfig = {
  calendars: [{ id: 'family@g', name: 'Family', color: '#4285f4' }],
  weather: { latitude: 0, longitude: 0, temperatureUnit: 'fahrenheit' },
  display: { calendarWeeks: 2, showWeather: true, timezone: 'America/Chicago' },
  auth: { pin: '654321' },
  boards: { kida: { layout: 'personal', name: 'Kid A', todos: { projectId: 'proj-a' } } },
};

function post(handler: (r: NextRequest) => Promise<Response>, body: unknown) {
  return handler(
    new Request('http://localhost/api/todos/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  );
}

describe('to-do edit and delete routes', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'homehq-todo-edit-'));
    db = getDb(join(tmpDir, 'test.db'));
    _setDefaultDb(db);
    mockConfig = structuredClone(baseConfig);
    mockUpdateTask.mockReset();
    mockDeleteTask.mockReset();
    upsertTodo(
      normalizeTask({
        id: 't1',
        project_id: 'proj-a',
        content: 'Pakc bag',
        due: { date: '2026-08-28' },
      })
    );
  });

  afterEach(() => {
    _setDefaultDb(null);
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('POST /api/todos/update', () => {
    it('sends only the text when only the text changed, and caches the result', async () => {
      // A text fix must never touch the due date — that's what keeps a
      // repeating task's rule intact.
      mockUpdateTask.mockResolvedValue({
        id: 't1',
        project_id: 'proj-a',
        content: 'Pack bag',
        due: { date: '2026-08-28' },
      });
      const res = await post(update, { id: 't1', content: '  Pack bag ' });
      expect(res.status).toBe(200);
      expect(mockUpdateTask).toHaveBeenCalledWith('t1', { content: 'Pack bag' });
      expect(getTodo('t1')?.content).toBe('Pack bag');
    });

    it('clears a due date with null', async () => {
      mockUpdateTask.mockResolvedValue({ id: 't1', project_id: 'proj-a', content: 'Pakc bag' });
      const res = await post(update, { id: 't1', dueDate: null });
      expect(res.status).toBe(200);
      expect(mockUpdateTask).toHaveBeenCalledWith('t1', { dueDate: null });
      expect(getTodo('t1')?.due_date).toBeNull();
    });

    it('rejects a blank text, a bad date, and an empty change', async () => {
      expect((await post(update, { id: 't1', content: '  ' })).status).toBe(400);
      expect((await post(update, { id: 't1', dueDate: '2026-08-28T16:00' })).status).toBe(400);
      expect((await post(update, { id: 't1' })).status).toBe(400);
      expect(mockUpdateTask).not.toHaveBeenCalled();
    });

    it('404s on a task this install does not cache', async () => {
      expect((await post(update, { id: 'elsewhere', content: 'x' })).status).toBe(404);
      expect(mockUpdateTask).not.toHaveBeenCalled();
    });

    it('refuses a checked-off task', async () => {
      completeTodo('t1', '2026-08-28');
      expect((await post(update, { id: 't1', content: 'x' })).status).toBe(409);
      expect(mockUpdateTask).not.toHaveBeenCalled();
    });

    it('leaves the cache alone when Todoist fails', async () => {
      mockUpdateTask.mockRejectedValue(new TodoistError('boom', 500));
      expect((await post(update, { id: 't1', content: 'Pack bag' })).status).toBe(502);
      expect(getTodo('t1')?.content).toBe('Pakc bag');
    });
  });

  describe('POST /api/todos/delete', () => {
    it('deletes on Todoist and drops the cache row', async () => {
      mockDeleteTask.mockResolvedValue(undefined);
      expect((await post(remove, { id: 't1' })).status).toBe(200);
      expect(mockDeleteTask).toHaveBeenCalledWith('t1');
      expect(getTodo('t1')).toBeNull();
    });

    it('treats a task already gone from Todoist as deleted', async () => {
      mockDeleteTask.mockRejectedValue(new TodoistError('not found', 404));
      expect((await post(remove, { id: 't1' })).status).toBe(200);
      expect(getTodo('t1')).toBeNull();
    });

    it('keeps the row when Todoist fails', async () => {
      mockDeleteTask.mockRejectedValue(new TodoistError('boom', 500));
      expect((await post(remove, { id: 't1' })).status).toBe(502);
      expect(getTodo('t1')).toBeTruthy();
    });

    it('404s on a task this install does not cache', async () => {
      expect((await post(remove, { id: 'elsewhere' })).status).toBe(404);
      expect(mockDeleteTask).not.toHaveBeenCalled();
    });
  });
});

describe('updateTask', () => {
  it('maps a cleared date to Todoist\'s "no date" and a set one to due_date', async () => {
    const { updateTask: realUpdate } =
      await vi.importActual<typeof import('@/lib/todoist/client')>('@/lib/todoist/client');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify({ id: 't1' }), { status: 200 }));
    process.env.TODOIST_API_KEY = 'k';
    try {
      await realUpdate('t1', { dueDate: null });
      await realUpdate('t1', { content: 'x', dueDate: '2026-09-01' });
      const bodies = fetchSpy.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
      expect(bodies).toEqual([{ due_string: 'no date' }, { content: 'x', due_date: '2026-09-01' }]);
    } finally {
      fetchSpy.mockRestore();
      delete process.env.TODOIST_API_KEY;
    }
  });
});
