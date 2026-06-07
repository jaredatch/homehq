// Weather syncs every 30 min. If the cached data is older than ~3 missed
// cycles, the sync is effectively dead and the panel should say so rather
// than show stale numbers as if they were current.
export const WEATHER_STALE_AFTER_MS = 95 * 60 * 1000;

export function isWeatherStale(updatedAt: string | null, now = Date.now()): boolean {
  if (!updatedAt) return true;
  const ts = new Date(updatedAt).getTime();
  if (Number.isNaN(ts)) return true;
  return now - ts > WEATHER_STALE_AFTER_MS;
}
