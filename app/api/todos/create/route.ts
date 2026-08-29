import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getConfig } from '@/lib/config';
import { todoProjectIds } from '@/lib/config/boards';
import { createTask, normalizeTask, TodoistError } from '@/lib/todoist/client';
import { upsertTodo } from '@/lib/db/todos';

/**
 * Add a to-do.
 *
 * Creates it on Todoist, then writes the confirmed task straight into the cache
 * rather than waiting up to a minute for the next sync — the same write-through
 * event creation does, and for the same reason: a task that doesn't appear the
 * instant it's added reads as the button not working.
 */

/** Todoist's own content limit. Enforced here so an accidental paste comes back
 * as a 400 rather than a 400 from Todoist wearing a stack trace. */
const MAX_CONTENT = 500;

/** A bare calendar day, the only due shape the on-screen form can produce. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface CreateTodoBody {
  projectId?: unknown;
  content?: unknown;
  dueDate?: unknown;
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  let body: CreateTodoBody;
  try {
    body = (await request.json()) as CreateTodoBody;
  } catch {
    return badRequest('Invalid JSON body');
  }

  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  if (!projectId) return badRequest('projectId is required');
  // Only projects a board actually asked for — the same gate the read and
  // complete routes use, so this can't become a general Todoist write proxy
  // into the household's account.
  if (!todoProjectIds(getConfig()).includes(projectId)) {
    return NextResponse.json({ error: 'Unknown project' }, { status: 404 });
  }

  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) return badRequest('content is required');
  if (content.length > MAX_CONTENT) {
    return badRequest(`content must be ${MAX_CONTENT} characters or fewer`);
  }

  // Undated is a real answer, not a missing one: it lands in "Anytime", which
  // the board shows rather than hiding.
  let dueDate: string | undefined;
  if (body.dueDate != null && body.dueDate !== '') {
    if (typeof body.dueDate !== 'string' || !DATE_RE.test(body.dueDate)) {
      return badRequest('dueDate must be YYYY-MM-DD');
    }
    dueDate = body.dueDate;
  }

  try {
    const task = await createTask({ projectId, content, dueDate });
    const config = getConfig();
    const row = normalizeTask(task, config.display.timezone);
    upsertTodo(row);
    return NextResponse.json({ todo: row }, { status: 201 });
  } catch (err) {
    const status = err instanceof TodoistError ? (err.status ?? 502) : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Todoist request failed' },
      // Todoist's own 4xx would be misleading as-is (a 404 here means "no such
      // project" to a client that already passed that check), so anything that
      // isn't an auth problem surfaces as a bad gateway.
      { status: status === 401 || status === 403 ? status : 502 }
    );
  }
}
