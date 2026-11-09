import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { writableTodo } from '@/lib/todoist/writable-todo';
import { deleteTask, TodoistError } from '@/lib/todoist/client';
import { deleteTodo } from '@/lib/db/todos';

/**
 * Delete a to-do — for one added by mistake, which is a different thing from
 * one that got done. Removes it from Todoist, then from the cache at once.
 *
 * A 404 from Todoist means it's already gone there (deleted on a phone, say),
 * so the cache row goes too and the board gets what it asked for.
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
    await deleteTask(todoId);
  } catch (err) {
    if (!(err instanceof TodoistError && err.status === 404)) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Todoist request failed' },
        { status: 502 }
      );
    }
  }

  deleteTodo(todoId);
  return NextResponse.json({ ok: true });
}
