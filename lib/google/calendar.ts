import type { CalendarEventRow } from '@/lib/db/events';
import { fetchWithTimeout } from '@/lib/http';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

/** A non-OK response from the Google Calendar API, carrying the HTTP status so
 * callers can map it (e.g. 403 → no write permission, 401 → re-consent). */
export class CalendarApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'CalendarApiError';
    this.status = status;
  }
}

interface GoogleEventPerson {
  email?: string;
  self?: boolean;
}

interface GoogleAttendee extends GoogleEventPerson {
  responseStatus?: string; // needsAction | declined | tentative | accepted
}

interface GoogleEvent {
  id: string;
  status?: string; // confirmed | tentative | cancelled
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: GoogleAttendee[];
  creator?: GoogleEventPerson;
  organizer?: GoogleEventPerson;
  // Present only on an expanded occurrence of a recurring series (the series'
  // event id). We store it so edit/delete can tell occurrences apart from one-offs.
  recurringEventId?: string;
}

interface GoogleEventsResponse {
  items?: GoogleEvent[];
  nextPageToken?: string;
}

export async function fetchCalendarEvents(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string
): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetchWithTimeout(
      `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Calendar API error for ${calendarId}: ${res.status} ${text}`);
    }

    const data: GoogleEventsResponse = await res.json();
    if (data.items) events.push(...data.items);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return events;
}

export interface CreateEventInput {
  summary: string;
  description?: string;
  location?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
}

/**
 * Create a single event on a calendar (Google events.insert). Returns the
 * created event resource — pass it through normalizeEvent() to cache it. Throws
 * CalendarApiError carrying the HTTP status on a non-OK response.
 */
export async function createCalendarEvent(
  accessToken: string,
  calendarId: string,
  event: CreateEventInput
): Promise<GoogleEvent> {
  const res = await fetchWithTimeout(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new CalendarApiError(
      res.status,
      `Calendar API create error for ${calendarId}: ${res.status} ${text}`
    );
  }

  return res.json();
}

/** A patch for events.patch. Same shape as a create, but start/end allow an
 * explicit `null` per subfield so we can CLEAR the sibling when toggling
 * all-day↔timed — patch semantics merge nested objects, so without this a timed
 * event switched to all-day would keep its stale `dateTime` alongside the new
 * `date` and Google would reject it. */
export interface PatchEventInput {
  summary?: string;
  description?: string | null;
  location?: string | null;
  start?: { date?: string | null; dateTime?: string | null; timeZone?: string | null };
  end?: { date?: string | null; dateTime?: string | null; timeZone?: string | null };
}

/**
 * Update an existing event (Google events.patch). Patch (not update/PUT) so
 * fields we don't send — attendees, reminders, recurrence — are preserved.
 * Returns the updated event resource for normalizeEvent(). Throws
 * CalendarApiError carrying the HTTP status.
 */
export async function patchCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  patch: PatchEventInput
): Promise<GoogleEvent> {
  const res = await fetchWithTimeout(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patch),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new CalendarApiError(
      res.status,
      `Calendar API patch error for ${calendarId}/${eventId}: ${res.status} ${text}`
    );
  }

  return res.json();
}

/**
 * Delete an event (Google events.delete). Idempotent: a 410 Gone (already
 * deleted, e.g. removed elsewhere) is treated as success so the cache can still
 * be cleaned up. Throws CalendarApiError on any other non-OK status.
 */
export async function deleteCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const res = await fetchWithTimeout(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  // 204 No Content = deleted; 410 Gone = already deleted (idempotent).
  if (res.ok || res.status === 410) return;

  const text = await res.text();
  throw new CalendarApiError(
    res.status,
    `Calendar API delete error for ${calendarId}/${eventId}: ${res.status} ${text}`
  );
}

/**
 * Whether to drop an event before it's cached. Removes:
 *  - cancelled occurrences (deleted instances of recurring events), and
 *  - calendar spam: invites the owner declined, plus un-answered (needsAction)
 *    invites from *other* people. Un-answered events the owner created or
 *    forwarded themselves are kept — that's a real plan, not spam.
 *
 * Google's `self` flag (and a matching `email`) is relative to the calendar this
 * copy lives on, so it pinpoints the owner regardless of which account holds the
 * OAuth token — what lets us tell "Sam's own forwarded meeting" from a stranger's
 * invite. Group calendars have no attendees, so they always pass through.
 */
export function shouldHideEvent(calendarId: string, event: GoogleEvent): boolean {
  if (event.status === 'cancelled') return true;

  const owner = event.attendees?.find((a) => a.self || a.email === calendarId);
  if (!owner) return false; // not invited (self-created or a group calendar)

  if (owner.responseStatus === 'declined') return true;

  if (owner.responseStatus === 'needsAction') {
    const ownerInitiated =
      event.creator?.self === true ||
      event.organizer?.self === true ||
      event.creator?.email === calendarId ||
      event.organizer?.email === calendarId;
    return !ownerInitiated;
  }

  return false; // accepted / tentative
}

export function normalizeEvent(
  calendarId: string,
  event: GoogleEvent
): Omit<CalendarEventRow, 'id' | 'updated_at'> {
  const allDay = !event.start.dateTime;
  return {
    event_id: event.id,
    calendar_id: calendarId,
    summary: event.summary ?? '',
    description: event.description ?? null,
    location: event.location ?? null,
    start_time: allDay ? event.start.date! : event.start.dateTime!,
    end_time: allDay ? event.end.date! : event.end.dateTime!,
    all_day: allDay ? 1 : 0,
    recurring_event_id: event.recurringEventId ?? null,
  };
}
