export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startSyncScheduler } = await import('@/lib/google/sync');
    const { startWeatherScheduler } = await import('@/lib/weather/sync');
    startSyncScheduler();
    startWeatherScheduler();
  }
}
