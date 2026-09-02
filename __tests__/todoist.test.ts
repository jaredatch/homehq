import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { normalizeTask, type TodoistTask } from '@/lib/todoist/client';
import { getDb, _setDefaultDb } from '@/lib/db';
import {
  completeTodo,
  getProjectTodos,
  purgeCompletedTodos,
  reopenTodo,
  getTodo,
  replaceProjectTodos,
  upsertTodo,
} from '@/lib/db/todos';

function task(over: Partial<TodoistTask> = {}): TodoistTask {
  return {
    id: 't1',
    project_id: 'p1',
    content: 'Practice piano',
    ...over,
  };
}

describe('normalizeTask', () => {
  it('keeps an undated task undated rather than inventing a due date', () => {
    const row = normalizeTask(task());
    expect(row.due_date).toBeNull();
    expect(row.due_datetime).toBeNull();
    expect(row.is_recurring).toBe(0);
    expect(row.priority).toBe(1);
    expect(row.labels).toBe('[]');
  });

  it('reads an all-day due date straight off due.date', () => {
    const row = normalizeTask(task({ due: { date: '2026-09-04' } }));
    expect(row.due_date).toBe('2026-09-04');
    expect(row.due_datetime).toBeNull();
  });

  it('splits a timed task whose whole timestamp arrives in due.date', () => {
    // This is what v1 actually sends, verified live: a floating datetime in
    // `date`, with no `datetime` field at all. Reading `date` as the day would
    // file every timed task under "Later", where nobody would ever see it.
    const row = normalizeTask(task({ due: { date: '2026-08-28T16:00:00' } }));
    expect(row.due_date).toBe('2026-08-28');
    expect(row.due_datetime).toBe('2026-08-28T16:00:00');
  });

  it('still reads the older REST shape, where datetime is its own field', () => {
    const row = normalizeTask(
      task({ due: { date: '2026-09-04', datetime: '2026-09-04T14:00:00' } })
    );
    expect(row.due_date).toBe('2026-09-04');
    expect(row.due_datetime).toBe('2026-09-04T14:00:00');
  });

  it('converts a zone-pinned instant to the right local day', () => {
    // 9pm Chicago on the 4th is 02:00 UTC on the 5th. Slicing the string would
    // put an evening task on tomorrow — every evening.
    const row = normalizeTask(
      task({ due: { date: '2026-09-05T02:00:00Z', timezone: 'America/Chicago' } })
    );
    expect(row.due_date).toBe('2026-09-04');
  });

  it('falls back to the board zone when the task names none', () => {
    const row = normalizeTask(task({ due: { date: '2026-09-05T02:00:00Z' } }), 'America/Chicago');
    expect(row.due_date).toBe('2026-09-04');
  });

  it('carries recurrence, priority, and labels through', () => {
    const row = normalizeTask(
      task({
        due: { date: '2026-09-04', string: 'every school day', is_recurring: true },
        priority: 4,
        labels: ['school', 'evening'],
        child_order: 7,
        parent_id: 'parent-1',
        description: 'Chapter 4',
      })
    );
    expect(row.is_recurring).toBe(1);
    expect(row.due_string).toBe('every school day');
    expect(row.priority).toBe(4);
    expect(JSON.parse(row.labels)).toEqual(['school', 'evening']);
    expect(row.child_order).toBe(7);
    expect(row.parent_id).toBe('parent-1');
    expect(row.description).toBe('Chapter 4');
  });

  it('turns an empty description into null rather than an empty string', () => {
    expect(normalizeTask(task({ description: '' })).description).toBeNull();
  });
});

describe('todos cache', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'homehq-todos-'));
    db = getDb(join(tmpDir, 'test.db'));
    _setDefaultDb(db);
  });

  afterEach(() => {
    _setDefaultDb(null);
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores and reads back a project’s tasks in manual order', () => {
    replaceProjectTodos('p1', [
      normalizeTask(task({ id: 'b', child_order: 2 })),
      normalizeTask(task({ id: 'a', child_order: 1 })),
    ]);
    expect(getProjectTodos('p1').map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('stamps updated_at as ISO 8601 UTC with a Z', () => {
    // Never SQLite's datetime('now') — it omits the zone and a browser reads
    // the result as local time.
    replaceProjectTodos('p1', [normalizeTask(task())]);
    expect(getProjectTodos('p1')[0].updated_at).toMatch(/Z$/);
  });

  it('replaces a project wholesale, so a deleted task actually leaves', () => {
    replaceProjectTodos('p1', [normalizeTask(task({ id: 'gone' }))]);
    replaceProjectTodos('p1', [normalizeTask(task({ id: 'kept' }))]);
    expect(getProjectTodos('p1').map((t) => t.id)).toEqual(['kept']);
  });

  it('leaves other projects alone when one is replaced', () => {
    replaceProjectTodos('p1', [normalizeTask(task({ id: 'one', project_id: 'p1' }))]);
    replaceProjectTodos('p2', [normalizeTask(task({ id: 'two', project_id: 'p2' }))]);
    replaceProjectTodos('p1', []);
    expect(getProjectTodos('p1')).toEqual([]);
    expect(getProjectTodos('p2').map((t) => t.id)).toEqual(['two']);
  });

  it('marks one task done so a tap sticks instead of flickering back', () => {
    replaceProjectTodos('p1', [normalizeTask(task({ id: 'x' }))]);
    completeTodo('x', '2026-09-02');
    expect(getTodo('x')!.completed_on).toBe('2026-09-02');
  });

  it('reopens a task by clearing the mark', () => {
    replaceProjectTodos('p1', [normalizeTask(task({ id: 'x' }))]);
    completeTodo('x', '2026-09-02');
    reopenTodo('x');
    expect(getTodo('x')!.completed_on).toBeNull();
  });

  // Todoist stops returning a closed task, so a plain full replace would delete
  // the row a kid ticked ten seconds ago and the tick would look like it failed.
  it('keeps a completed task through a sync that no longer returns it', () => {
    replaceProjectTodos('p1', [normalizeTask(task({ id: 'x' }))]);
    completeTodo('x', '2026-09-02');
    replaceProjectTodos('p1', []);
    expect(getTodo('x')!.completed_on).toBe('2026-09-02');
  });

  // A recurring task checked off here comes back under the same id with its
  // next due date. Anything in a sync payload is open by definition.
  it('un-checks a completed task that comes back from Todoist', () => {
    replaceProjectTodos('p1', [normalizeTask(task({ id: 'x' }))]);
    completeTodo('x', '2026-09-02');
    replaceProjectTodos('p1', [normalizeTask(task({ id: 'x' }))]);
    expect(getTodo('x')!.completed_on).toBeNull();
  });

  it('purges completed tasks once their day is over, and only those', () => {
    replaceProjectTodos('p1', [
      normalizeTask(task({ id: 'yesterday' })),
      normalizeTask(task({ id: 'today' })),
      normalizeTask(task({ id: 'open' })),
    ]);
    completeTodo('yesterday', '2026-09-01');
    completeTodo('today', '2026-09-02');
    purgeCompletedTodos('2026-09-02');
    expect(
      getProjectTodos('p1')
        .map((t) => t.id)
        .sort()
    ).toEqual(['open', 'today']);
  });

  it('puts a task back on undo, and updates rather than duplicating', () => {
    const row = normalizeTask(task({ id: 'x' }));
    upsertTodo(row);
    upsertTodo({ ...row, content: 'Renamed' });
    const all = getProjectTodos('p1');
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('Renamed');
  });
});
