import { NextResponse } from 'next/server';
import { getWeatherCache } from '@/lib/db/weather';
import { getSyncStatus } from '@/lib/db/sync-status';

export function GET() {
  const cache = getWeatherCache();
  const syncStatus = getSyncStatus('weather');

  return NextResponse.json({
    weather: cache
      ? { current: cache.data.current, forecast: cache.data.forecast, updatedAt: cache.updatedAt }
      : null,
    sync: {
      lastSuccess: syncStatus?.last_success ?? null,
      lastAttempt: syncStatus?.last_attempt ?? null,
      lastError: syncStatus?.last_error ?? null,
    },
  });
}
