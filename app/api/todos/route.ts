import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getConfig } from '@/lib/config';
import { todoProjectIds } from '@/lib/config/boards';
import { getProjectTodos, purgeCompletedTodos } from '@/lib/db/todos';
import { getSyncStatus } from '@/lib/db/sync-status';
import { todayInZone } from '@/components/calendar/calendar-utils';

/**
 * Cached to-dos for one project. Reads only from SQLite — the browser never
 * talks to Todoist (CLAUDE.md rule 3), so the column paints instantly and keeps
 * painting through a Todoist outage.
 */
export function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json({ error: 'projectId query param required' }, { status: 400 });
  }

  // Only projects a board actually asked for. Nothing secret is behind this —
  // the cache holds nothing else — but a route that answers for any id invites
  // someone to treat it as a Todoist proxy, which it is not.
  if (!todoProjectIds(getConfig()).includes(projectId)) {
    return NextResponse.json({ error: 'Unknown project' }, { status: 404 });
  }

  // Yesterday's ticked-off chores go here, not on the board. Cheap, indexed,
  // and hung off the read so a panel that slept through the night wakes up to a
  // clean list without waiting for a sync tick.
  purgeCompletedTodos(todayInZone(getConfig().display.timezone));

  const syncStatus = getSyncStatus('todos');

  return NextResponse.json({
    todos: getProjectTodos(projectId),
    sync: {
      lastSuccess: syncStatus?.last_success ?? null,
      lastAttempt: syncStatus?.last_attempt ?? null,
      lastError: syncStatus?.last_error ?? null,
    },
  });
}
