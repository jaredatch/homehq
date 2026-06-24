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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:mm, 24-hour

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

/** Add one calendar day to a YYYY-MM-DD string (UTC date math, no DST drift).
 * Google's all-day `end.date` is exclusive, so a single-day all-day event ends
 * on the following day. */
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
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

  if (typeof body.date !== 'string' || !DATE_RE.test(body.date)) {
    return badRequest('date is required (YYYY-MM-DD)');
  }
  const date = body.date;

  const allDay = body.allDay === true;

  const location =
    typeof body.location === 'string' && body.location.trim() ? body.location.trim() : undefined;
  const description =
    typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : undefined;

  // Build start/end. Timed events carry the configured display zone so a naive
  // wall-clock time lands in the right zone regardless of the server's OS clock.
  const timeZone = config.display.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  let start: CreateEventInput['start'];
  let end: CreateEventInput['end'];

  if (allDay) {
    start = { date };
    end = { date: nextDay(date) };
  } else {
    if (typeof body.startTime !== 'string' || !TIME_RE.test(body.startTime)) {
      return badRequest('startTime is required for a timed event (HH:mm)');
    }
    if (typeof body.endTime !== 'string' || !TIME_RE.test(body.endTime)) {
      return badRequest('endTime is required for a timed event (HH:mm)');
    }
    // Zero-padded HH:mm compares correctly as strings.
    if (body.endTime <= body.startTime) {
      return badRequest('endTime must be after startTime');
    }
    start = { dateTime: `${date}T${body.startTime}:00`, timeZone };
    end = { dateTime: `${date}T${body.endTime}:00`, timeZone };
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
