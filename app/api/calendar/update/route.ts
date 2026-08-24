import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getConfig, isCalendarWriteEnabled } from '@/lib/config';
import { getValidAccessToken } from '@/lib/google/oauth';
import {
  patchCalendarEvent,
  createCalendarEvent,
  deleteCalendarEvent,
  normalizeEvent,
  CalendarApiError,
  type PatchEventInput,
  type CreateEventInput,
} from '@/lib/google/calendar';
import {
  getEvent,
  getLinkCandidates,
  upsertEvent,
  deleteEvent,
  type CalendarEventRow,
} from '@/lib/db/events';
import { resolveLink } from '@/lib/calendar/event-links';
import { addUtcDays, allDaySpanDays, nextDay, parseTiming } from '@/lib/calendar/event-timing';
import {
  GROUP_PROPERTY_KEY,
  MAX_GROUP_CALENDARS,
  diffMembership,
  newGroupId,
  readCalendarIds,
} from '@/lib/calendar/event-groups';

interface UpdateRequestBody {
  eventId?: unknown;
  /** All-day only: inclusive last day. Omit to keep the existing span. */
  endDate?: unknown;
  /** The calendar whose copy the user opened — always the lookup key. */
  calendarId?: unknown;
  /** The full set of calendars the event should end up on. Omit to leave
   * membership untouched and edit the event's fields only. */
  calendarIds?: unknown;
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

/** Map a Google write failure onto a response, matching the single-write path. */
function writeFailure(err: unknown) {
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

  // Every cached copy of this event, by the SAME rule the grids merged the chip
  // with (lib/calendar/event-links.ts). Resolving it any other way is what turns
  // a merged chip into a data bug: the board would claim two calendars, this
  // route would see one, and saving would "add" the second — writing a THIRD
  // copy of an event that was never duplicated. An unlinked event resolves to a
  // set of one, so the rest of this route needs no special case for it.
  const link = resolveLink(getLinkCandidates(existing), existing);
  const siblings = link.members;
  const currentIds = siblings.map((s) => s.calendar_id);

  // A `google` link is ONE Google event resource that surfaces on two calendars
  // because someone was invited. Its membership is Google's guest list, which
  // this route has no honest way to edit — ticking another calendar here would
  // not add a guest, it would create a second, unrelated event. The UI locks the
  // picker; this is the defence in depth behind it.
  if (link.kind === 'google' && Array.isArray(body.calendarIds)) {
    const requested = readCalendarIds(body) ?? [];
    const same =
      requested.length === currentIds.length && requested.every((id) => currentIds.includes(id));
    if (!same) {
      return NextResponse.json(
        {
          error:
            'This event is shared through Google Calendar — change who it is for in Google Calendar.',
        },
        { status: 409 }
      );
    }
  }

  // Membership only changes when the client explicitly sends `calendarIds`. A
  // body carrying just the scalar `calendarId` is editing fields, not
  // membership — reading the anchor as the whole set would silently delete the
  // event's other copies.
  let nextIds = currentIds;
  if (Array.isArray(body.calendarIds)) {
    const requested = readCalendarIds(body);
    if (!requested) return badRequest('At least one calendar is required');
    if (requested.length > MAX_GROUP_CALENDARS) {
      return badRequest(`An event can span at most ${MAX_GROUP_CALENDARS} calendars`);
    }
    for (const id of requested) {
      if (!config.calendars.some((c) => c.id === id))
        return badRequest(`Unknown calendarId: ${id}`);
    }
    nextIds = requested;
  }

  const { kept, added, removed } = diffMembership(currentIds, nextIds);

  // Promotion: an ordinary event gaining a second calendar needs a stamp minted
  // and patched onto the original copy as well as set on the new one. Shrinking
  // back to one calendar leaves the stamp in place — a one-member group merges to
  // nothing and renders normally, and re-adding someone reforms the same group.
  // A `twin` pair (matched on title + times alone) gets stamped here, so the one
  // guess the board made becomes a recorded fact and never has to be guessed
  // again — this is what "adopt on save" means.
  //
  // A `google` link must NEVER be stamped. extendedProperties.private belongs to
  // the copy of the event that ONE calendar owns, so the stamp would land on the
  // patched copy alone; its sibling would keep a null group_id, tier 1 would then
  // see a group of one, and the pair would silently stop merging.
  const canStamp = link.kind !== 'google';
  const groupId = existing.group_id ?? (canStamp && nextIds.length > 1 ? newGroupId() : null);

  // null clears the field on Google (empty location/notes), and on start/end it
  // clears the sibling key so an all-day↔timed toggle never leaves both set.
  const location =
    typeof body.location === 'string' && body.location.trim() ? body.location.trim() : null;
  const description =
    typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

  let start: CreateEventInput['start'];
  let end: CreateEventInput['end'];
  const patch: PatchEventInput = { summary: title, location, description };

  if (timing.allDay) {
    start = { date: timing.date };
    if (timing.endDate) {
      // The client sent the span explicitly. endDate is the INCLUSIVE last day;
      // Google's end.date is exclusive, hence the +1.
      end = { date: nextDay(timing.endDate) };
    } else {
      // No endDate (pre-end-date client): preserve the span rather than silently
      // collapsing a multi-day event to one day. A timed→all-day switch has no
      // span to keep, so it becomes a single day.
      const spanDays = existing.all_day
        ? allDaySpanDays(existing.start_time, existing.end_time)
        : 1;
      end = { date: addUtcDays(timing.date, spanDays) };
    }
    patch.start = { ...start, dateTime: null, timeZone: null };
    patch.end = { ...end, dateTime: null, timeZone: null };
  } else {
    const timeZone = config.display.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    start = { dateTime: `${timing.date}T${timing.startTime}:00`, timeZone };
    end = { dateTime: `${timing.date}T${timing.endTime}:00`, timeZone };
    patch.start = { ...start, date: null };
    patch.end = { ...end, date: null };
  }

  if (groupId) {
    patch.extendedProperties = { private: { [GROUP_PROPERTY_KEY]: groupId } };
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
  const fail = (calendarId: string, err: unknown) => {
    if (!firstError) firstError = err;
    failures.push({ calendarId, error: err instanceof Error ? err.message : String(err) });
  };

  // Patch what stays, insert what was added, delete what was removed — deletes
  // LAST so a failure earlier in the sequence never leaves data destroyed.
  if (link.kind === 'google') {
    // One Google event resource, so exactly ONE patch: a second call addressed
    // through the sibling calendar would re-apply the same values to the same
    // event, and an attendee's copy may not even be writable.
    //
    // Both cache rows are then refreshed from that single confirmed response.
    // They are the same event by definition, so the values are identical — and
    // writing both is what keeps the merged chip merged, instead of leaving a
    // split pair on the wall until the next five-minute sync.
    try {
      const updated = await patchCalendarEvent(accessToken, calendarId, existing.event_id, patch);
      for (const sibling of siblings) {
        const row = normalizeEvent(sibling.calendar_id, updated);
        upsertEvent(row);
        rows.push(row);
      }
    } catch (err) {
      fail(calendarId, err);
    }
  } else {
    for (const sibling of siblings) {
      if (!kept.includes(sibling.calendar_id)) continue;
      try {
        const updated = await patchCalendarEvent(
          accessToken,
          sibling.calendar_id,
          sibling.event_id,
          patch
        );
        // Confirmed by Google → write through to the cache so the change shows on
        // the next poll without waiting for the 5-minute sync.
        const row = normalizeEvent(sibling.calendar_id, updated);
        upsertEvent(row);
        rows.push(row);
      } catch (err) {
        fail(sibling.calendar_id, err);
      }
    }
  }

  const addInput: CreateEventInput = { summary: title, start, end };
  if (location) addInput.location = location;
  if (description) addInput.description = description;
  if (groupId) addInput.extendedProperties = { private: { [GROUP_PROPERTY_KEY]: groupId } };

  for (const calendarId of added) {
    try {
      const created = await createCalendarEvent(accessToken, calendarId, addInput);
      const row = normalizeEvent(calendarId, created);
      upsertEvent(row);
      rows.push(row);
    } catch (err) {
      fail(calendarId, err);
    }
  }

  // Nothing was written — bail BEFORE deleting anything. Ordering the deletes
  // last only helps if we actually stop here: otherwise a failed patch would
  // still drop the other copy, destroying data the user could have retried.
  if (rows.length === 0) return writeFailure(firstError);

  for (const sibling of siblings) {
    if (!removed.includes(sibling.calendar_id)) continue;
    try {
      await deleteCalendarEvent(accessToken, sibling.calendar_id, sibling.event_id);
      deleteEvent(sibling.event_id, sibling.calendar_id);
    } catch (err) {
      fail(sibling.calendar_id, err);
    }
  }

  // Prefer the copy the user opened, but it may have just been unchecked (and so
  // deleted) — fall back to any surviving copy rather than a dead reference.
  const anchor = rows.find((r) => r.calendar_id === calendarId) ?? rows[0];

  return NextResponse.json(
    { event: anchor, events: rows, ...(failures.length ? { failures } : {}) },
    { status: 200 }
  );
}
