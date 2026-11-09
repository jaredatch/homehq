import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { todoProjectIds } from '@/lib/config/boards';
import { requestBoard } from '@/lib/auth/request-board';
import { boardMayUseProject, isWriteRestricted } from '@/lib/calendar/board-writes';
import { getTodo, type TodoRow } from '@/lib/db/todos';

/**
 * The gate every route that writes to an EXISTING to-do goes through: complete,
 * reopen, update, delete.
 *
 * Only tasks this install actually caches, in a project some board asked for —
 * so none of these routes can reach an arbitrary task in the household's Todoist
 * account. And a personal board's session touches only its own project's tasks.
 * A sibling's task gets the same 404 an unknown one would.
 */
export async function writableTodo(
  id: unknown
): Promise<{ ok: true; todo: TodoRow } | { ok: false; response: NextResponse }> {
  if (typeof id !== 'string' || !id) {
    return { ok: false, response: NextResponse.json({ error: 'id is required' }, { status: 400 }) };
  }
  const unknown = {
    ok: false as const,
    response: NextResponse.json({ error: 'Unknown to-do' }, { status: 404 }),
  };

  const todo = getTodo(id);
  if (!todo || !todoProjectIds(getConfig()).includes(todo.project_id)) return unknown;

  const who = await requestBoard();
  if (!who.ok) {
    return { ok: false, response: NextResponse.json({ error: who.error }, { status: who.status }) };
  }
  if (isWriteRestricted(who.board) && !boardMayUseProject(who.board, todo.project_id)) {
    return unknown;
  }
  return { ok: true, todo };
}
