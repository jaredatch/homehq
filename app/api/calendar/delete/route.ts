import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getConfig, isCalendarWriteEnabled } from '@/lib/config';
import { getValidAccessToken } from '@/lib/google/oauth';
import { deleteCalendarEvent, CalendarApiError } from '@/lib/google/calendar';
import { getEvent, getEventsByGroup, deleteEvent } from '@/lib/db/events';

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

  // Deleting a shared event removes every copy — the user is deleting the event,
  // not one person's view of it. (Dropping a single person is an *edit*: uncheck
  // that calendar and save, which deletes only their copy.) An ungrouped event is
  // a group of one, so this needs no special case.
  const targets = existing.group_id ? getEventsByGroup(existing.group_id) : [existing];

  const failures: { calendarId: string; error: string }[] = [];
  let firstError: unknown = null;
  let deleted = 0;

  for (const target of targets) {
    try {
      // 204/410 both resolve (deleteCalendarEvent treats already-gone as success).
      await deleteCalendarEvent(accessToken, target.calendar_id, target.event_id);
      // Gone on Google → drop it from the cache so it disappears on the next poll.
      deleteEvent(target.event_id, target.calendar_id);
      deleted++;
    } catch (err) {
      if (!firstError) firstError = err;
      failures.push({
        calendarId: target.calendar_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Nothing was deleted — report it as the failure it is.
  if (deleted === 0) {
    const err = firstError;
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

  // Partial: keep what went through and say what didn't. The board re-renders
  // from what actually exists on Google, so it always tells the truth.
  return NextResponse.json(
    { ok: true, deleted, ...(failures.length ? { failures } : {}) },
    { status: 200 }
  );
}
