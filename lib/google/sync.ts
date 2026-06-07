import { getConfig } from '@/lib/config';
import { upsertCalendarEvents, deleteEventsNotInCalendars } from '@/lib/db/events';
import { updateSyncStatus } from '@/lib/db/sync-status';
import { getValidAccessToken } from './oauth';
import { fetchCalendarEvents, normalizeEvent } from './calendar';

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DAYS_BACK = 30;
const DAYS_AHEAD = 60;

let running = false;

export async function syncCalendars(): Promise<void> {
  // Skip if a previous run is still going (slow/hung provider) so interval
  // ticks don't stack overlapping syncs.
  if (running) {
    console.warn('[sync] Calendar sync already in progress — skipping this tick');
    return;
  }
  running = true;
  try {
    let calendars: { id: string; name: string }[];
    let accessToken: string;

    try {
      calendars = getConfig().calendars;
      accessToken = await getValidAccessToken();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateSyncStatus('calendar', false, message);
      console.error('[sync] Calendar sync failed:', message);
      return;
    }

    // Forget calendars that have been removed from config.
    deleteEventsNotInCalendars(calendars.map((c) => c.id));

    const now = new Date();
    const timeMin = new Date(now.getTime() - DAYS_BACK * 86400000).toISOString();
    const timeMax = new Date(now.getTime() + DAYS_AHEAD * 86400000).toISOString();

    // Sync each calendar independently — one bad calendar (deleted, renamed,
    // permission revoked) must not block the others.
    const errors: string[] = [];
    let synced = 0;

    for (const cal of calendars) {
      try {
        const googleEvents = await fetchCalendarEvents(accessToken, cal.id, timeMin, timeMax);
        upsertCalendarEvents(
          cal.id,
          googleEvents.map((e) => normalizeEvent(cal.id, e))
        );
        synced += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${cal.name}: ${message}`);
      }
    }

    if (errors.length === 0) {
      updateSyncStatus('calendar', true);
      console.log(`[sync] Calendar sync complete — ${synced} calendar(s)`);
    } else if (synced > 0) {
      updateSyncStatus('calendar', true, `Partial sync — ${errors.join('; ')}`);
      console.error(`[sync] Calendar sync partial (${synced} ok):`, errors.join('; '));
    } else {
      updateSyncStatus('calendar', false, errors.join('; '));
      console.error('[sync] Calendar sync failed:', errors.join('; '));
    }
  } finally {
    running = false;
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startSyncScheduler(): void {
  if (intervalId) return; // already running

  // Run immediately, then every 5 minutes
  syncCalendars();
  intervalId = setInterval(syncCalendars, SYNC_INTERVAL_MS);
  console.log('[sync] Calendar sync scheduler started (every 5 min)');
}
