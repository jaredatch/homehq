import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getConfig } from '@/lib/config';
import { todoProjectIds } from '@/lib/config/boards';
import { todayInZone } from '@/components/calendar/calendar-utils';
import { closeTask, TodoistError } from '@/lib/todoist/client';
import { completeTodo, getTodo } from '@/lib/db/todos';

/**
 * Check a to-do off.
 *
 * Closes it on Todoist, then marks the cache row done immediately rather than
 * waiting up to a minute for the next sync — otherwise the row a kid just
 * ticked flickers back onto the panel, which reads as the tap not working.
 *
 * MARKS rather than deletes: a checked task stays where it was, struck through,
 * until the day rolls over (see migration 005). Todoist stops returning it, so
 * the local mark is the only record that it happened today.
 *
 * A recurring task advances to its next occurrence rather than ending; Todoist
 * handles that, and the next sync brings the new occurrence back under the same
 * id, which clears the mark.
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
  // close arbitrary tasks in the household's Todoist account.
  const todo = getTodo(id);
  if (!todo || !todoProjectIds(getConfig()).includes(todo.project_id)) {
    return NextResponse.json({ error: 'Unknown to-do' }, { status: 404 });
  }

  try {
    await closeTask(id);
  } catch (err) {
    const status = err instanceof TodoistError ? (err.status ?? 502) : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Todoist request failed' },
      { status: status === 404 ? 404 : 502 }
    );
  }

  // The board's local day, from the same config the column groups by — a
  // droplet running UTC must not file an 8pm Texas tick under tomorrow.
  completeTodo(id, todayInZone(getConfig().display.timezone));
  return NextResponse.json({ ok: true });
}
