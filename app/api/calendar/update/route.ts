import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getConfig, isCalendarWriteEnabled } from '@/lib/config';
import { getValidAccessToken } from '@/lib/google/oauth';
import {
  patchCalendarEvent,
  normalizeEvent,
  CalendarApiError,
  type PatchEventInput,
} from '@/lib/google/calendar';
import { getEvent, upsertEvent } from '@/lib/db/events';
import { addUtcDays, allDaySpanDays, parseTiming } from '@/lib/calendar/event-timing';

interface UpdateRequestBody {
  eventId?: unknown;
  calendarId?: unknown;
  title?: unknown;
  allDay?: unknown;
  date?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  location?: unknown;
  notes?: unknown;
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const config = getConfig();

  // Defense in depth: a read-only deployment must never write, even if the
  // edit UI somehow renders.
  if (!isCalendarWriteEnabled(config)) {
    return NextResponse.json(
      { error: 'Event editing is disabled (google.calendarAccess is "readonly")' },
      { status: 403 }
    );
  }

  let body: UpdateRequestBody;
  try {
    body = (await request.json()) as UpdateRequestBody;
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

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return badRequest('title is required');

  // The event must be in our cache (it's how the user clicked it) — gives us its
  // recurring/all-day shape and confirms it still exists before touching Google.
  const existing = getEvent(body.eventId, calendarId);
  if (!existing) {
    return NextResponse.json(
      { error: 'Event not found — it may have already changed. Refresh and try again.' },
      { status: 404 }
    );
  }

  // Editing a recurring series isn't supported yet — change it in Google Calendar.
  if (existing.recurring_event_id) {
    return NextResponse.json(
      { error: 'This is a repeating event — edit it in Google Calendar.' },
      { status: 409 }
    );
  }

  const parsed = parseTiming(body);
  if (!parsed.ok) return badRequest(parsed.error);
  const timing = parsed.timing;

  // null clears the field on Google (empty location/notes), and on start/end it
  // clears the sibling key so an all-day↔timed toggle never leaves both set.
  const location =
    typeof body.location === 'string' && body.location.trim() ? body.location.trim() : null;
  const description =
    typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

  const patch: PatchEventInput = { summary: title, location, description };

  if (timing.allDay) {
    // Preserve a multi-day span on a date-only edit: an all-day event that stays
    // all-day keeps its original length; a timed→all-day switch becomes one day.
    const spanDays = existing.all_day ? allDaySpanDays(existing.start_time, existing.end_time) : 1;
    patch.start = { date: timing.date, dateTime: null, timeZone: null };
    patch.end = { date: addUtcDays(timing.date, spanDays), dateTime: null, timeZone: null };
  } else {
    const timeZone = config.display.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    patch.start = { dateTime: `${timing.date}T${timing.startTime}:00`, timeZone, date: null };
    patch.end = { dateTime: `${timing.date}T${timing.endTime}:00`, timeZone, date: null };
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 401 });
  }

  let updated;
  try {
    updated = await patchCalendarEvent(accessToken, calendarId, body.eventId, patch);
  } catch (err) {
    if (err instanceof CalendarApiError) {
      if (err.status === 401 || err.status === 403) {
        return NextResponse.json(
          { error: 'Google rejected the write — reconnect at /setup to grant write access' },
          { status: err.status }
        );
      }
      // Gone on Google's side (deleted elsewhere) — tell the client to refresh.
      if (err.status === 404 || err.status === 410) {
        return NextResponse.json(
          { error: 'This event no longer exists on Google — refresh and try again.' },
          { status: 404 }
        );
      }
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Confirmed by Google → write through to the cache so the change shows on the
  // next poll without waiting for the 5-minute sync.
  const row = normalizeEvent(calendarId, updated);
  upsertEvent(row);

  return NextResponse.json({ event: row }, { status: 200 });
}
