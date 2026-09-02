import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getConfig } from '@/lib/config';
import { todoProjectIds } from '@/lib/config/boards';
import { reopenTask, TodoistError } from '@/lib/todoist/client';
import { getTodo, reopenTodo } from '@/lib/db/todos';

/**
 * Undo a completion.
 *
 * The cache row is still there — completing only marks it (migration 005) — so
 * this clears the mark rather than re-reading the task from Todoist. That also
 * makes the undo instant, which matters: this is the correction for a mis-tap,
 * and a correction that takes a second reads as another thing gone wrong.
 */
export async function POST(request: NextRequest) {
  let id: unknown;
  try {
    ({ id } = (await request.json()) as { id?: unknown });
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  // Only tasks this install actually caches, so the route can't be used to
  // reopen arbitrary tasks in the household's Todoist account.
  const todo = getTodo(id);
  if (!todo || !todoProjectIds(getConfig()).includes(todo.project_id)) {
    return NextResponse.json({ error: 'Unknown to-do' }, { status: 404 });
  }

  try {
    await reopenTask(id);
    reopenTodo(id);
  } catch (err) {
    const status = err instanceof TodoistError && err.status === 404 ? 404 : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Todoist request failed' },
      { status }
    );
  }

  return NextResponse.json({ ok: true });
}
