import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getConfig, isCalendarWriteEnabled } from '@/lib/config';
import { getValidAccessToken } from '@/lib/google/oauth';
import {
  createCalendarEvent,
  normalizeEvent,
  CalendarApiError,
  type CreateEventInput,
} from '@/lib/google/calendar';
import { upsertEvent } from '@/lib/db/events';
import { nextDay, parseTiming } from '@/lib/calendar/event-timing';

interface CreateRequestBody {
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

  // Defense in depth: even if the "+ Add event" button somehow renders, a
  // read-only deployment must never write.
  if (!isCalendarWriteEnabled(config)) {
    return NextResponse.json(
      { error: 'Event creation is disabled (google.calendarAccess is "readonly")' },
      { status: 403 }
    );
  }

  let body: CreateRequestBody;
  try {
    body = (await request.json()) as CreateRequestBody;
  } catch {
    return badRequest('Invalid JSON body');
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return badRequest('title is required');

  // Calendar must be explicitly chosen and known to config — no default, so an
  // event can never silently land on the wrong calendar.
  if (typeof body.calendarId !== 'string' || !body.calendarId) {
    return badRequest('calendarId is required');
  }
  const calendar = config.calendars.find((c) => c.id === body.calendarId);
  if (!calendar) return badRequest(`Unknown calendarId: ${body.calendarId}`);
  const calendarId = calendar.id;

  const parsed = parseTiming(body);
  if (!parsed.ok) return badRequest(parsed.error);
  const timing = parsed.timing;

  const location =
    typeof body.location === 'string' && body.location.trim() ? body.location.trim() : undefined;
  const description =
    typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : undefined;

  // Build start/end. Timed events carry the configured display zone so a naive
  // wall-clock time lands in the right zone regardless of the server's OS clock.
  const timeZone = config.display.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  let start: CreateEventInput['start'];
  let end: CreateEventInput['end'];

  if (timing.allDay) {
    start = { date: timing.date };
    end = { date: nextDay(timing.date) };
  } else {
    start = { dateTime: `${timing.date}T${timing.startTime}:00`, timeZone };
    end = { dateTime: `${timing.date}T${timing.endTime}:00`, timeZone };
  }

  const eventInput: CreateEventInput = { summary: title, description, location, start, end };

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 401 });
  }

  let created;
  try {
    created = await createCalendarEvent(accessToken, calendarId, eventInput);
  } catch (err) {
    if (err instanceof CalendarApiError) {
      // 401/403: the stored token lacks write scope (switched to readwrite but
      // not yet re-consented) or no write permission on that calendar.
      if (err.status === 401 || err.status === 403) {
        return NextResponse.json(
          { error: 'Google rejected the write — reconnect at /setup to grant write access' },
          { status: err.status }
        );
      }
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Confirmed by Google → write through to the cache so it appears on the next
  // dashboard poll without waiting for the 5-minute sync to catch up.
  const row = normalizeEvent(calendarId, created);
  upsertEvent(row);

  return NextResponse.json({ event: row }, { status: 201 });
}
