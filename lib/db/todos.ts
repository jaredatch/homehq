import { getDb } from './index';

export interface TodoRow {
  id: string;
  project_id: string;
  content: string;
  description: string | null;
  /** YYYY-MM-DD, or null for an undated task ("Anytime" on the board). */
  due_date: string | null;
  /** ISO 8601 instant when the task is due at a specific time, else null. */
  due_datetime: string | null;
  /** Todoist's own phrasing of the due rule ("every school day"). */
  due_string: string | null;
  is_recurring: number;
  /** 1 (normal) to 4 (urgent) — Todoist's API numbering, the reverse of their UI. */
  priority: number;
  parent_id: string | null;
  child_order: number;
  /** JSON array of label names, as stored. */
  labels: string;
  /** The LOCAL day (YYYY-MM-DD, board timezone) this was checked off on, or
   * null while it is open. A completed task stays on the board, dimmed, at the
   * bottom of its section until that day rolls over — see migration 005. */
  completed_on: string | null;
  updated_at: string;
}

export type TodoInput = Omit<TodoRow, 'updated_at' | 'completed_on'>;

const INSERT_COLUMNS = `(id, project_id, content, description, due_date, due_datetime, due_string,
                         is_recurring, priority, parent_id, child_order, labels, updated_at)`;
const INSERT_VALUES = `(@id, @project_id, @content, @description, @due_date, @due_datetime, @due_string,
                        @is_recurring, @priority, @parent_id, @child_order, @labels, @updated_at)`;

/** Every column an incoming task overwrites — completed_on included, and that
 * matters: Todoist only returns OPEN tasks, so anything in a sync payload is
 * open by definition. A recurring task checked off here comes back under the
 * same id with its next due date, and this is what un-checks it. */
const UPDATE_SET = `project_id = excluded.project_id,
         content = excluded.content,
         description = excluded.description,
         due_date = excluded.due_date,
         due_datetime = excluded.due_datetime,
         due_string = excluded.due_string,
         is_recurring = excluded.is_recurring,
         priority = excluded.priority,
         parent_id = excluded.parent_id,
         child_order = excluded.child_order,
         labels = excluded.labels,
         completed_on = NULL,
         updated_at = excluded.updated_at`;

/**
 * Replace everything cached for one project.
 *
 * Still a full replace, exactly like `upsertCalendarEvents` — it is the only way
 * a task deleted in Todoist actually leaves the board.
 *
 * With ONE exception: rows this install has marked completed are kept. Todoist's
 * task endpoint stops returning a closed task, so a plain replace would delete
 * the row a kid ticked ten seconds ago and the tick would look like it failed.
 * `purgeCompletedTodos` is what eventually clears them, on the day boundary.
 */
export function replaceProjectTodos(projectId: string, todos: TodoInput[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('DELETE FROM todos WHERE project_id = ? AND completed_on IS NULL').run(projectId);
    const insert = db.prepare(
      `INSERT INTO todos ${INSERT_COLUMNS} VALUES ${INSERT_VALUES}
       ON CONFLICT(id) DO UPDATE SET ${UPDATE_SET}`
    );
    for (const todo of todos) insert.run({ ...todo, updated_at: now });
  })();
}

/** Every cached task for a project, in Todoist's own manual order. */
export function getProjectTodos(projectId: string): TodoRow[] {
  return getDb()
    .prepare('SELECT * FROM todos WHERE project_id = ? ORDER BY child_order ASC, id ASC')
    .all(projectId) as TodoRow[];
}

export function getTodo(id: string): TodoRow | null {
  const row = getDb().prepare('SELECT * FROM todos WHERE id = ?').get(id) as TodoRow | undefined;
  return row ?? null;
}

/**
 * Mark one task done in the cache the moment it's checked off, without waiting
 * for the next sync — the tap has to feel instant on the panel.
 *
 * It stays in the list, struck through, in the section its due date puts it in,
 * so "I did that" is visible for the rest of the day and a mis-tap is one tap
 * to undo. `completedOn` is the board's LOCAL day, which is what the purge and
 * the grouping both compare against.
 */
export function completeTodo(id: string, completedOn: string): void {
  getDb().prepare('UPDATE todos SET completed_on = ? WHERE id = ?').run(completedOn, id);
}

/** Un-check a task locally, without a Todoist round trip. */
export function reopenTodo(id: string): void {
  getDb().prepare('UPDATE todos SET completed_on = NULL WHERE id = ?').run(id);
}

/**
 * Drop completed tasks from days that are over.
 *
 * A plain string compare against the board's own `today`, so this can never
 * disagree with the column about where the day boundary is. Called on every
 * read: the sweep is a single indexed delete on a family-sized table, and
 * hanging it off the read means a panel that has been asleep since Tuesday
 * comes back to a clean list rather than to Tuesday's ticked-off chores.
 */
export function purgeCompletedTodos(today: string): void {
  getDb()
    .prepare('DELETE FROM todos WHERE completed_on IS NOT NULL AND completed_on < ?')
    .run(today);
}

/** Write one task back into the cache — a fresh create, or a reopen that had to
 * re-read the task from Todoist. Either way it lands open. */
export function upsertTodo(todo: TodoInput): void {
  getDb()
    .prepare(
      `INSERT INTO todos ${INSERT_COLUMNS} VALUES ${INSERT_VALUES}
       ON CONFLICT(id) DO UPDATE SET ${UPDATE_SET}`
    )
    .run({ ...todo, updated_at: new Date().toISOString() });
}
