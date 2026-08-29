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
  updated_at: string;
}

export type TodoInput = Omit<TodoRow, 'updated_at'>;

/**
 * Replace everything cached for one project.
 *
 * Full replace rather than a merge, exactly like `upsertCalendarEvents`: it is
 * the only way a task deleted or completed in Todoist actually leaves the
 * board. A family-sized list makes the cost irrelevant.
 */
export function replaceProjectTodos(projectId: string, todos: TodoInput[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('DELETE FROM todos WHERE project_id = ?').run(projectId);
    const insert = db.prepare(
      `INSERT INTO todos (id, project_id, content, description, due_date, due_datetime, due_string,
                          is_recurring, priority, parent_id, child_order, labels, updated_at)
       VALUES (@id, @project_id, @content, @description, @due_date, @due_datetime, @due_string,
               @is_recurring, @priority, @parent_id, @child_order, @labels, @updated_at)`
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
 * Drop one task from the cache the moment it's completed, without waiting for
 * the next sync — the tap has to feel instant on the panel. Mirrors the way a
 * freshly created event is written straight into the event cache.
 */
export function deleteTodo(id: string): void {
  getDb().prepare('DELETE FROM todos WHERE id = ?').run(id);
}

/** Write one task back into the cache — used to undo a completion locally. */
export function upsertTodo(todo: TodoInput): void {
  getDb()
    .prepare(
      `INSERT INTO todos (id, project_id, content, description, due_date, due_datetime, due_string,
                          is_recurring, priority, parent_id, child_order, labels, updated_at)
       VALUES (@id, @project_id, @content, @description, @due_date, @due_datetime, @due_string,
               @is_recurring, @priority, @parent_id, @child_order, @labels, @updated_at)
       ON CONFLICT(id) DO UPDATE SET
         project_id = excluded.project_id,
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
         updated_at = excluded.updated_at`
    )
    .run({ ...todo, updated_at: new Date().toISOString() });
}
