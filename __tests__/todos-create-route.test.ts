import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type Database from 'better-sqlite3';
import { getDb, _setDefaultDb } from '@/lib/db';
import { getProjectTodos } from '@/lib/db/todos';
import { TodoistError } from '@/lib/todoist/client';

// Controlled config: one board bound to one Todoist project. `mock`-prefixed so
// Vitest allows the reference inside the hoisted factory.
let mockConfig: Record<string, unknown> & { display: { timezone?: string } };
vi.mock('@/lib/config', () => ({
  getConfig: () => mockConfig,
  isCalendarWriteEnabled: () => true,
}));

// Mock only the network call; normalizeTask and TodoistError stay real, since
// the row this route writes is exactly what the sync loop would have written.
const mockCreateTask = vi.fn();
vi.mock('@/lib/todoist/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/todoist/client')>();
  return {
    ...actual,
    createTask: (...args: unknown[]) => mockCreateTask(...args),
  };
});

import { POST } from '@/app/api/todos/create/route';

describe('POST /api/todos/create', () => {
  let tmpDir: string;
  let db: Database.Database;

  const baseConfig = {
    calendars: [{ id: 'family@g', name: 'Family', color: '#4285f4' }],
    weather: { latitude: 0, longitude: 0, temperatureUnit: 'fahrenheit' },
    display: { calendarWeeks: 2, showWeather: true, timezone: 'America/Chicago' },
    auth: { pin: '654321' },
    boards: {
      kida: { layout: 'personal', name: 'Kid A', todos: { projectId: 'proj-a' } },
    },
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'homehq-todo-create-'));
    db = getDb(join(tmpDir, 'test.db'));
    _setDefaultDb(db);
    mockConfig = structuredClone(baseConfig);
    mockCreateTask.mockReset();
  });

  afterEach(() => {
    _setDefaultDb(null);
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function post(body: unknown) {
    return POST(
      new Request('http://localhost/api/todos/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }) as unknown as NextRequest
    );
  }

  it('creates the task and writes it straight into the cache', async () => {
    // Write-through, not "wait for the next sync": a to-do that takes up to a
    // minute to appear reads as the button not working.
    mockCreateTask.mockResolvedValue({
      id: 't-new',
      project_id: 'proj-a',
      content: 'Pack backpack',
      due: { date: '2026-08-28' },
    });

    const res = await post({
      projectId: 'proj-a',
      content: 'Pack backpack',
      dueDate: '2026-08-28',
    });
    expect(res.status).toBe(201);

    const cached = getProjectTodos('proj-a');
    expect(cached).toHaveLength(1);
    expect(cached[0].content).toBe('Pack backpack');
    expect(cached[0].due_date).toBe('2026-08-28');
  });

  it('passes an undated task through undated', async () => {
    // Undated is a real answer — it lands in "Anytime", which the board shows.
    mockCreateTask.mockResolvedValue({ id: 't2', project_id: 'proj-a', content: 'Read' });
    const res = await post({ projectId: 'proj-a', content: 'Read' });
    expect(res.status).toBe(201);
    expect(mockCreateTask).toHaveBeenCalledWith({
      projectId: 'proj-a',
      content: 'Read',
      dueDate: undefined,
    });
    expect(getProjectTodos('proj-a')[0].due_date).toBeNull();
  });

  it('trims the content and rejects a blank one', async () => {
    const res = await post({ projectId: 'proj-a', content: '   ' });
    expect(res.status).toBe(400);
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('404s on a project no board asked for', async () => {
    // The gate that stops this becoming a general write proxy into the
    // household's Todoist account.
    const res = await post({ projectId: 'someone-elses', content: 'Hi' });
    expect(res.status).toBe(404);
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('400s on a due date that is not a plain calendar day', async () => {
    const res = await post({
      projectId: 'proj-a',
      content: 'Thing',
      dueDate: '2026-08-28T16:00:00',
    });
    expect(res.status).toBe(400);
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('400s on an over-long content', async () => {
    const res = await post({ projectId: 'proj-a', content: 'x'.repeat(501) });
    expect(res.status).toBe(400);
  });

  it('400s on a malformed body', async () => {
    const res = await post('not json');
    expect(res.status).toBe(400);
  });

  it('reports a Todoist failure as a bad gateway and caches nothing', async () => {
    mockCreateTask.mockRejectedValue(new TodoistError('boom', 500));
    const res = await post({ projectId: 'proj-a', content: 'Thing' });
    expect(res.status).toBe(502);
    expect(getProjectTodos('proj-a')).toHaveLength(0);
  });

  it('passes an auth failure through as itself', async () => {
    // A bad token is worth distinguishing: it means the install needs a new
    // TODOIST_API_KEY, not that Todoist is having a bad day.
    mockCreateTask.mockRejectedValue(new TodoistError('unauthorized', 401));
    const res = await post({ projectId: 'proj-a', content: 'Thing' });
    expect(res.status).toBe(401);
  });
});
