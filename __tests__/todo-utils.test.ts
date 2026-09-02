import { describe, it, expect } from 'vitest';
import {
  groupTodos,
  isTodoSyncBroken,
  sectionFor,
  SYNC_STALE_AFTER_MS,
  todoMeta,
  type Todo,
} from '@/components/board/todo-utils';

function todo(over: Partial<Todo> & { id: string }): Todo {
  return {
    project_id: 'p1',
    content: 'Thing',
    description: null,
    due_date: null,
    due_datetime: null,
    due_string: null,
    is_recurring: 0,
    priority: 1,
    parent_id: null,
    child_order: 0,
    labels: '[]',
    completed_on: null,
    ...over,
  };
}

const TODAY = '2026-08-28';

describe('sectionFor', () => {
  it('sorts a task by its due date relative to today', () => {
    expect(sectionFor(todo({ id: '1', due_date: '2026-08-20' }), TODAY)).toBe('pastDue');
    expect(sectionFor(todo({ id: '2', due_date: TODAY }), TODAY)).toBe('today');
    expect(sectionFor(todo({ id: '3', due_date: '2026-08-29' }), TODAY)).toBe('tomorrow');
    expect(sectionFor(todo({ id: '4', due_date: '2026-09-15' }), TODAY)).toBe('later');
  });

  it('puts an undated task in Anytime rather than dropping it', () => {
    // The common case in Todoist. A to-do that exists but is invisible is worse
    // than having no list at all.
    expect(sectionFor(todo({ id: '5' }), TODAY)).toBe('anytime');
  });
});

describe('completed tasks', () => {
  // Checking something off used to move it to a holding area at the top of the
  // column and then delete it a few seconds later. It now stays where it was.
  it('keeps a completed task in its own section, at the bottom', () => {
    const sections = groupTodos(
      [
        todo({ id: 'done', due_date: TODAY, completed_on: TODAY, child_order: 1 }),
        todo({ id: 'open', due_date: TODAY, child_order: 2 }),
      ],
      TODAY
    );
    expect(sections.map((s) => s.key)).toEqual(['today']);
    expect(sections[0].todos.map((t) => t.id)).toEqual(['open', 'done']);
  });

  it('sinks a completed undated task to the bottom of Anytime too', () => {
    const sections = groupTodos(
      [
        todo({ id: 'done', completed_on: TODAY, child_order: 1 }),
        todo({ id: 'open', child_order: 2 }),
      ],
      TODAY
    );
    expect(sections[0].todos.map((t) => t.id)).toEqual(['open', 'done']);
  });

  it('leaves an overdue task that got done in Past Due, not Today', () => {
    const sections = groupTodos(
      [todo({ id: 'late', due_date: '2026-08-20', completed_on: TODAY })],
      TODAY
    );
    expect(sections.map((s) => s.key)).toEqual(['pastDue']);
  });
});

describe('groupTodos', () => {
  it('orders the sections the way they are read', () => {
    const sections = groupTodos(
      [
        todo({ id: 'a' }),
        todo({ id: 'b', due_date: '2026-09-15' }),
        todo({ id: 'c', due_date: '2026-08-29' }),
        todo({ id: 'd', due_date: TODAY }),
        todo({ id: 'e', due_date: '2026-08-01' }),
      ],
      TODAY
    );
    expect(sections.map((s) => s.label)).toEqual([
      'Past Due',
      'Today',
      'Tomorrow',
      'Later',
      'Anytime',
    ]);
  });

  it('drops empty sections instead of showing five bare headings', () => {
    const sections = groupTodos([todo({ id: 'a', due_date: TODAY })], TODAY);
    expect(sections.map((s) => s.key)).toEqual(['today']);
  });

  it('returns nothing at all for an empty list', () => {
    expect(groupTodos([], TODAY)).toEqual([]);
  });

  it('reads oldest-first, so the most overdue thing is first', () => {
    const sections = groupTodos(
      [
        todo({ id: 'recent', due_date: '2026-08-27' }),
        todo({ id: 'ancient', due_date: '2026-08-01' }),
      ],
      TODAY
    );
    expect(sections[0].todos.map((t) => t.id)).toEqual(['ancient', 'recent']);
  });

  it('breaks a same-day tie by time, then priority, then manual order', () => {
    const sections = groupTodos(
      [
        todo({ id: 'low', due_date: TODAY, priority: 1, child_order: 2 }),
        todo({ id: 'urgent', due_date: TODAY, priority: 4, child_order: 3 }),
        todo({ id: 'manual-first', due_date: TODAY, priority: 1, child_order: 1 }),
        todo({ id: 'timed', due_date: TODAY, due_datetime: '2026-08-28T13:00:00Z' }),
      ],
      TODAY
    );
    expect(sections[0].todos.map((t) => t.id)).toEqual(['timed', 'urgent', 'manual-first', 'low']);
  });

  it('keeps Todoist’s manual order in Anytime, where there is nothing to sort by', () => {
    const sections = groupTodos(
      [
        todo({ id: 'third', child_order: 3 }),
        todo({ id: 'first', child_order: 1 }),
        todo({ id: 'second', child_order: 2 }),
      ],
      TODAY
    );
    expect(sections[0].todos.map((t) => t.id)).toEqual(['first', 'second', 'third']);
  });

  it('never draws a sub-task — that is Todoist structure, not a line on her list', () => {
    const sections = groupTodos(
      [
        todo({ id: 'parent', due_date: TODAY }),
        todo({ id: 'child', due_date: TODAY, parent_id: 'parent' }),
      ],
      TODAY
    );
    expect(sections[0].todos.map((t) => t.id)).toEqual(['parent']);
  });
});

describe('todoMeta', () => {
  const fmt = () => '4pm';

  it('is empty for a plain undated task', () => {
    expect(todoMeta(todo({ id: '1' }), fmt)).toBe('');
  });

  it('shows the time when there is one', () => {
    expect(todoMeta(todo({ id: '1', due_datetime: '2026-08-28T21:00:00Z' }), fmt)).toBe('4pm');
  });

  it('marks a repeating task so checking it off does not look like deleting it', () => {
    expect(todoMeta(todo({ id: '1', is_recurring: 1 }), fmt)).toBe('repeats');
    expect(
      todoMeta(todo({ id: '1', due_datetime: '2026-08-28T21:00:00Z', is_recurring: 1 }), fmt)
    ).toBe('4pm · repeats');
  });
});

describe('isTodoSyncBroken', () => {
  const NOW = Date.parse('2026-09-02T20:00:00Z');
  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  it('says nothing when the sync is fine', () => {
    expect(isTodoSyncBroken(null, ago(30_000), NOW)).toBe(false);
  });

  // The whole point: one bad tick with a recent success is a blip, and shouting
  // about it — then going quiet a minute later — makes the warning worthless.
  it('stays quiet through a single failed tick', () => {
    expect(isTodoSyncBroken('502 Bad Gateway', ago(60_000), NOW)).toBe(false);
  });

  it('speaks up once the failures have outlasted the window', () => {
    expect(isTodoSyncBroken('502 Bad Gateway', ago(SYNC_STALE_AFTER_MS + 1000), NOW)).toBe(true);
  });

  it('speaks up when it has never succeeded at all', () => {
    expect(isTodoSyncBroken('401 Unauthorized', null, NOW)).toBe(true);
    expect(isTodoSyncBroken('401 Unauthorized', 'not-a-date', NOW)).toBe(true);
  });
});
