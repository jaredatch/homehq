import { getConfig } from '@/lib/config';
import { upsertCalendarEvents } from '@/lib/db/events';
import { updateSyncStatus } from '@/lib/db/sync-status';
import { getValidAccessToken } from './oauth';
import { fetchCalendarEvents, normalizeEvent } from './calendar';

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DAYS_BACK = 30;
const DAYS_AHEAD = 60;

export async function syncCalendars(): Promise<void> {
  try {
    const config = getConfig();
    const accessToken = await getValidAccessToken();

    const now = new Date();
    const timeMin = new Date(now.getTime() - DAYS_BACK * 86400000).toISOString();
    const timeMax = new Date(now.getTime() + DAYS_AHEAD * 86400000).toISOString();

    for (const cal of config.calendars) {
      const googleEvents = await fetchCalendarEvents(accessToken, cal.id, timeMin, timeMax);
      const rows = googleEvents.map((e) => normalizeEvent(cal.id, e));
      upsertCalendarEvents(cal.id, rows);
    }

    updateSyncStatus('calendar', true);
    console.log(`[sync] Calendar sync complete — ${config.calendars.length} calendar(s)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateSyncStatus('calendar', false, message);
    console.error('[sync] Calendar sync failed:', message);
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
