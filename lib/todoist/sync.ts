import { getConfig } from '@/lib/config';
import { todoProjectIds } from '@/lib/config/boards';
import { replaceProjectTodos } from '@/lib/db/todos';
import { updateSyncStatus } from '@/lib/db/sync-status';
import { fetchProjectTasks, getTodoistToken, normalizeTask } from './client';

const SYNC_INTERVAL_MS = 60 * 1000; // 1 minute

let running = false;

/**
 * Pull every board's Todoist project into the cache.
 *
 * A minute is deliberate: checking something off on a phone should reach the
 * bedroom panel while the kid is still in the room. Even with several projects
 * that's a few hundred requests an hour against a 1000-per-15-minutes limit —
 * nowhere near it.
 *
 * One failing project does not sink the others: each is caught on its own and
 * the tick reports partial success, so a mistyped project id in one board can't
 * blank the other board's list.
 */
export async function syncTodos(): Promise<void> {
  if (running) {
    console.warn('[sync] Todoist sync already in progress — skipping this tick');
    return;
  }
  running = true;
  try {
    if (!getTodoistToken()) return; // not configured — nothing to do, and not an error
    const config = getConfig();
    const projectIds = todoProjectIds(config);
    if (projectIds.length === 0) return; // no board asks for to-dos

    const failures: string[] = [];
    let synced = 0;

    for (const projectId of projectIds) {
      try {
        const tasks = await fetchProjectTasks(projectId);
        // Sub-tasks are Todoist structure, not a line on a kid's list.
        const top = tasks.filter((t) => !t.parent_id);
        // The display zone decides which day a zone-pinned task belongs to;
        // without it the droplet would bucket by UTC.
        const zone = config.display.timezone;
        replaceProjectTodos(
          projectId,
          top.map((t) => normalizeTask(t, zone))
        );
        synced++;
      } catch (err) {
        failures.push(`${projectId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (synced === 0 && failures.length > 0) {
      updateSyncStatus('todos', false, failures.join('; '));
      console.error('[sync] Todoist sync failed:', failures.join('; '));
      return;
    }

    updateSyncStatus('todos', true, failures.length ? failures.join('; ') : undefined);
    console.log(
      `[sync] Todoist sync complete — ${synced} project(s)` +
        (failures.length ? `, ${failures.length} failed` : '')
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateSyncStatus('todos', false, message);
    console.error('[sync] Todoist sync failed:', message);
  } finally {
    running = false;
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startTodoScheduler(): void {
  if (intervalId) return; // already running

  syncTodos();
  intervalId = setInterval(syncTodos, SYNC_INTERVAL_MS);
  console.log('[sync] Todoist sync scheduler started (every 1 min)');
}
