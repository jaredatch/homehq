import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getConfig, isCalendarWriteEnabled } from '@/lib/config';
import { getValidAccessToken } from '@/lib/google/oauth';
import { deleteCalendarEvent, CalendarApiError } from '@/lib/google/calendar';
import { getEvent, deleteEvent } from '@/lib/db/events';

interface DeleteRequestBody {
  eventId?: unknown;
  calendarId?: unknown;
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const config = getConfig();

  if (!isCalendarWriteEnabled(config)) {
    return NextResponse.json(
      { error: 'Event deletion is disabled (google.calendarAccess is "readonly")' },
      { status: 403 }
    );
  }

  let body: DeleteRequestBody;
  try {
    body = (await request.json()) as DeleteRequestBody;
  } catch {
    return badRequest('Invalid JSON body');
  }

  if (typeof body.eventId !== 'string' || !body.eventId) return badRequest('eventId is required');
  if (typeof body.calendarId !== 'string' || !body.calendarId) {
    return badRequest('calendarId is required');
  }
  const calendar = config.calendars.find((c) => c.id === body.calendarId);
  if (!calendar) return badRequest(`Unknown calendarId: ${body.calendarId}`);
  const calendarId = calendar.id;

  const existing = getEvent(body.eventId, calendarId);
  if (!existing) {
    // Already gone from our cache — nothing to do. Treat as success so a
    // double-click or a stale view doesn't surface a scary error.
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Deleting one occurrence of a recurring series isn't supported yet.
  if (existing.recurring_event_id) {
    return NextResponse.json(
      { error: 'This is a repeating event — delete it in Google Calendar.' },
      { status: 409 }
    );
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 401 });
  }

  try {
    // 204/410 both resolve (deleteCalendarEvent treats already-gone as success).
    await deleteCalendarEvent(accessToken, calendarId, body.eventId);
  } catch (err) {
    if (err instanceof CalendarApiError) {
      if (err.status === 401 || err.status === 403) {
        return NextResponse.json(
          { error: 'Google rejected the delete — reconnect at /setup to grant write access' },
          { status: err.status }
        );
      }
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Gone on Google → drop it from the cache so it disappears on the next poll.
  deleteEvent(body.eventId, calendarId);

  return NextResponse.json({ ok: true }, { status: 200 });
}
