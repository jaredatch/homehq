import type { CalendarEventRow } from '@/lib/db/events';
import { fetchWithTimeout } from '@/lib/http';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
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
  };
}
