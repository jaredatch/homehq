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
import { upsertEvent, type CalendarEventRow } from '@/lib/db/events';
import { nextDay, parseTiming } from '@/lib/calendar/event-timing';
import {
  GROUP_PROPERTY_KEY,
  MAX_GROUP_CALENDARS,
  newGroupId,
  readCalendarIds,
} from '@/lib/calendar/event-groups';

interface CreateRequestBody {
  /** One or more calendars. `calendarId` (scalar) is still accepted. */
  calendarIds?: unknown;
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

  // At least one calendar must be explicitly chosen and known to config — no
  // default, so an event can never silently land on the wrong calendar.
  const calendarIds = readCalendarIds(body);
  if (!calendarIds) return badRequest('calendarId is required');
  if (calendarIds.length > MAX_GROUP_CALENDARS) {
    return badRequest(`An event can span at most ${MAX_GROUP_CALENDARS} calendars`);
  }
  for (const id of calendarIds) {
    if (!config.calendars.some((c) => c.id === id)) return badRequest(`Unknown calendarId: ${id}`);
  }

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

  // Two or more calendars = a shared event: one real Google event per calendar,
  // all carrying the same stamp so the board can merge them back into one chip.
  // A single calendar stays exactly as it was — unstamped, one insert.
  const groupId = calendarIds.length > 1 ? newGroupId() : null;
  if (groupId) {
    eventInput.extendedProperties = { private: { [GROUP_PROPERTY_KEY]: groupId } };
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 401 });
  }

  const rows: Omit<CalendarEventRow, 'id' | 'updated_at'>[] = [];
  const failures: { calendarId: string; error: string }[] = [];
  let firstError: unknown = null;

  for (const calendarId of calendarIds) {
    try {
      const created = await createCalendarEvent(accessToken, calendarId, eventInput);
      // Confirmed by Google → write through to the cache so it appears on the
      // next dashboard poll without waiting for the 5-minute sync to catch up.
      const row = normalizeEvent(calendarId, created);
      upsertEvent(row);
      rows.push(row);
    } catch (err) {
      if (!firstError) firstError = err;
      failures.push({ calendarId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Nothing landed — report it as the failure it is, mapped like a single write.
  if (rows.length === 0) return writeFailure(firstError);

  // Some landed. Keep them and say what didn't: silently deleting a real calendar
  // event to fake a transaction is worse than a partial. A group left with one
  // surviving member merges to nothing and simply renders as a normal event.
  return NextResponse.json(
    { event: rows[0], events: rows, ...(failures.length ? { failures } : {}) },
    { status: 201 }
  );
}

/** Map a Google write failure onto a response, matching the single-write path. */
function writeFailure(err: unknown) {
  if (err instanceof CalendarApiError) {
    // 401/403: the stored token lacks write scope (switched to readwrite but not
    // yet re-consented) or no write permission on that calendar.
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
