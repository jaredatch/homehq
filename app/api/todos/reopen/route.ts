import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { writableTodo } from '@/lib/todoist/writable-todo';
import { reopenTask, TodoistError } from '@/lib/todoist/client';
import { reopenTodo } from '@/lib/db/todos';

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

  const access = await writableTodo(id);
  if (!access.ok) return access.response;
  const todoId = access.todo.id;

  try {
    await reopenTask(todoId);
    reopenTodo(todoId);
  } catch (err) {
    const status = err instanceof TodoistError && err.status === 404 ? 404 : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Todoist request failed' },
      { status }
    );
  }

  return NextResponse.json({ ok: true });
}
