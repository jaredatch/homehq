import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getConfig } from '@/lib/config';
import { writableTodo } from '@/lib/todoist/writable-todo';
import { normalizeTask, TodoistError, updateTask } from '@/lib/todoist/client';
import { upsertTodo } from '@/lib/db/todos';

/**
 * Edit a to-do: fix its text, or move or clear its due date.
 *
 * Only what's sent changes. A body with `content` alone never touches the due
 * date, which is what keeps a typo fix from flattening a recurring task's rule.
 * `dueDate: null` clears the date; a YYYY-MM-DD sets it.
 *
 * Writes the confirmed task straight into the cache, the same write-through as
 * create, so the edit is on screen before the next sync.
 */

const MAX_CONTENT = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  let body: { id?: unknown; content?: unknown; dueDate?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest('Invalid JSON body');
  }

  const access = await writableTodo(body.id);
  if (!access.ok) return access.response;
  const { todo } = access;
  // A checked-off task is on its way out at the day boundary, and Todoist's
  // copy is closed. Untick it first.
  if (todo.completed_on) {
    return NextResponse.json({ error: 'Reopen the to-do before editing it' }, { status: 409 });
  }

  const changes: { content?: string; dueDate?: string | null } = {};

  if (body.content !== undefined) {
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) return badRequest('content cannot be blank');
    if (content.length > MAX_CONTENT) {
      return badRequest(`content must be ${MAX_CONTENT} characters or fewer`);
    }
    changes.content = content;
  }

  if (body.dueDate !== undefined) {
    if (body.dueDate === null) changes.dueDate = null;
    else if (typeof body.dueDate === 'string' && DATE_RE.test(body.dueDate)) {
      changes.dueDate = body.dueDate;
    } else return badRequest('dueDate must be YYYY-MM-DD or null');
  }

  if (changes.content === undefined && changes.dueDate === undefined) {
    return badRequest('Nothing to change');
  }

  try {
    const task = await updateTask(todo.id, changes);
    const row = normalizeTask(task, getConfig().display.timezone);
    upsertTodo(row);
    return NextResponse.json({ todo: row });
  } catch (err) {
    const status = err instanceof TodoistError ? (err.status ?? 502) : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Todoist request failed' },
      { status: status === 401 || status === 403 || status === 404 ? status : 502 }
    );
  }
}
