import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getConfig } from '@/lib/config';
import { todoProjectIds } from '@/lib/config/boards';
import { fetchTask, normalizeTask, reopenTask, TodoistError } from '@/lib/todoist/client';
import { upsertTodo } from '@/lib/db/todos';

/**
 * Undo a completion.
 *
 * Re-reads the task from Todoist afterwards rather than trusting a payload from
 * the browser: the cache row was deleted on complete, and one extra request on
 * a rare undo is cheaper than a route that lets a client write whatever it
 * likes into the cache.
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

  try {
    await reopenTask(id);
    const task = await fetchTask(id);
    // Only write it back if it belongs to a project this install serves.
    const config = getConfig();
    if (task && todoProjectIds(config).includes(task.project_id)) {
      upsertTodo(normalizeTask(task, config.display.timezone));
    }
  } catch (err) {
    const status = err instanceof TodoistError && err.status === 404 ? 404 : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Todoist request failed' },
      { status }
    );
  }

  return NextResponse.json({ ok: true });
}
