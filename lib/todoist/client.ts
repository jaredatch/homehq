import { fetchWithTimeout } from '@/lib/http';
import type { TodoInput } from '@/lib/db/todos';

/**
 * Todoist, the to-do source behind a personal board's middle column.
 *
 * The unified **v1** API. Todoist retired REST v2 and Sync v9 in early 2026, so
 * any snippet pointing at /rest/v2 or /sync/v9 is dead — and their migration
 * also renumbered every object id, which is why nothing here treats an id as
 * stable across that boundary.
 *
 * Auth is a personal API token (Todoist → Settings → Integrations → Developer),
 * read from TODOIST_API_KEY. One household account, one project per person; the
 * kids need no Todoist login of their own.
 */

const API_BASE = 'https://api.todoist.com/api/v1';

/** Todoist's task shape, narrowed to the fields the board actually stores. */
export interface TodoistTask {
  id: string;
  project_id: string;
  content: string;
  description?: string | null;
  checked?: boolean;
  priority?: number;
  parent_id?: string | null;
  child_order?: number;
  labels?: string[];
  due?: {
    date?: string;
    datetime?: string | null;
    string?: string | null;
    timezone?: string | null;
    is_recurring?: boolean;
  } | null;
}

export class TodoistError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'TodoistError';
  }
}

/** The configured token, or null when Todoist simply isn't set up. */
export function getTodoistToken(): string | null {
  return process.env.TODOIST_API_KEY?.trim() || null;
}

function requireToken(): string {
  const token = getTodoistToken();
  if (!token) {
    throw new TodoistError('TODOIST_API_KEY is not set — add it to .env to enable to-dos');
  }
  return token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireToken()}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    // 429 carries Retry-After. The scheduler simply skips the tick and tries
    // again a minute later, which is well inside any window Todoist asks for.
    const body = await res.text().catch(() => '');
    throw new TodoistError(
      `Todoist ${init.method ?? 'GET'} ${path} failed: ${res.status} ${body.slice(0, 200)}`,
      res.status
    );
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Every ACTIVE task in a project. Completed tasks are not returned, which is
 * what makes the cache's full-replace behave correctly: check something off and
 * it's simply gone next sync.
 *
 * Paginated by cursor. A kid's list will never need a second page, but a
 * silently truncated to-do list is the kind of bug nobody notices until
 * something is missed, so this follows the cursor to the end.
 */
export async function fetchProjectTasks(projectId: string): Promise<TodoistTask[]> {
  const tasks: TodoistTask[] = [];
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams({ project_id: projectId, limit: '200' });
    if (cursor) params.set('cursor', cursor);
    const page: { results?: TodoistTask[]; next_cursor?: string | null } = await request(
      `/tasks?${params.toString()}`
    );
    tasks.push(...(page.results ?? []));
    cursor = page.next_cursor ?? null;
  } while (cursor);

  return tasks;
}

/** One task by id. Used after an undo, to put the real row back in the cache. */
export async function fetchTask(id: string): Promise<TodoistTask | null> {
  try {
    return await request<TodoistTask>(`/tasks/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof TodoistError && err.status === 404) return null;
    throw err;
  }
}

export async function createTask(input: {
  projectId: string;
  content: string;
  dueDate?: string;
}): Promise<TodoistTask> {
  return request<TodoistTask>('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      project_id: input.projectId,
      content: input.content,
      // `due_date` takes a plain YYYY-MM-DD. Omitted entirely for an undated
      // task, which is the common case for a kid's list.
      ...(input.dueDate ? { due_date: input.dueDate } : {}),
    }),
  });
}

/** Check a task off. A recurring task advances to its next occurrence rather
 * than disappearing — Todoist handles that server-side. */
export async function closeTask(id: string): Promise<void> {
  await request<void>(`/tasks/${encodeURIComponent(id)}/close`, { method: 'POST' });
}

/** Undo a completion. */
export async function reopenTask(id: string): Promise<void> {
  await request<void>(`/tasks/${encodeURIComponent(id)}/reopen`, { method: 'POST' });
}

/**
 * The calendar day a due value falls on, as YYYY-MM-DD.
 *
 * Three shapes come back in `due.date`, and only the first is obvious:
 *   "2026-08-28"           — all day
 *   "2026-08-28T16:00:00"  — a FLOATING time, already local; slice it
 *   "2026-08-28T21:00:00Z" — a fixed instant, set when the task names a zone
 *
 * Only the last needs converting, and slicing it would put a 9pm task on the
 * wrong day for anyone west of UTC — which is the whole household.
 */
function dayOf(raw: string, taskZone: string | null | undefined, boardZone?: string): string {
  if (!raw.endsWith('Z')) return raw.slice(0, 10);
  const timeZone = taskZone || boardZone;
  // en-CA formats as YYYY-MM-DD, which is what every comparison here expects.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(raw));
}

/**
 * Todoist's task into the cache's row shape.
 *
 * `boardZone` is the display time zone from config. It only matters for a task
 * pinned to a specific zone; without it, a UTC instant would be bucketed by the
 * server's own day, and the droplet runs on UTC.
 */
export function normalizeTask(task: TodoistTask, boardZone?: string): TodoInput {
  const due = task.due ?? null;
  // v1 puts a timed task's whole timestamp in `date`; `datetime` is the older
  // REST shape and may not be sent at all. Take whichever is there.
  const raw = due?.datetime ?? due?.date ?? null;
  const dueDatetime = raw && raw.includes('T') ? raw : null;
  const dueDate = raw ? dayOf(raw, due?.timezone, boardZone) : null;

  return {
    id: task.id,
    project_id: task.project_id,
    content: task.content,
    description: task.description || null,
    due_date: dueDate,
    due_datetime: dueDatetime,
    due_string: due?.string || null,
    is_recurring: due?.is_recurring ? 1 : 0,
    priority: task.priority ?? 1,
    parent_id: task.parent_id ?? null,
    child_order: task.child_order ?? 0,
    labels: JSON.stringify(task.labels ?? []),
  };
}
