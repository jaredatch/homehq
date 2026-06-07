import { getConfig } from '@/lib/config';
import { saveWeatherCache } from '@/lib/db/weather';
import { updateSyncStatus } from '@/lib/db/sync-status';
import { fetchWeather } from './openmeteo';

const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

let running = false;

export async function syncWeather(): Promise<void> {
  if (running) {
    console.warn('[sync] Weather sync already in progress — skipping this tick');
    return;
  }
  running = true;
  try {
    const config = getConfig();
    if (!config.display.showWeather) return; // hidden — don't bother fetching

    const data = await fetchWeather(config.weather);
    saveWeatherCache(data);
    updateSyncStatus('weather', true);
    console.log('[sync] Weather sync complete');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateSyncStatus('weather', false, message);
    console.error('[sync] Weather sync failed:', message);
  } finally {
    running = false;
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startWeatherScheduler(): void {
  if (intervalId) return; // already running

  // Run immediately, then every 30 minutes
  syncWeather();
  intervalId = setInterval(syncWeather, SYNC_INTERVAL_MS);
  console.log('[sync] Weather sync scheduler started (every 30 min)');
}
