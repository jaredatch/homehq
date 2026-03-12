import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getEventsInRange } from '@/lib/db/events';
import { getSyncStatus } from '@/lib/db/sync-status';

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const start = params.get('start');
  const end = params.get('end');

  if (!start || !end) {
    return NextResponse.json(
      { error: 'start and end query params required (ISO 8601)' },
      { status: 400 },
    );
  }

  const events = getEventsInRange(start, end);
  const syncStatus = getSyncStatus('calendar');

  return NextResponse.json({
    events,
    sync: {
      lastSuccess: syncStatus?.last_success ?? null,
      lastAttempt: syncStatus?.last_attempt ?? null,
      lastError: syncStatus?.last_error ?? null,
    },
  });
}
