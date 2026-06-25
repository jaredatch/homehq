import { getDb } from './index';

export interface CalendarEventRow {
  id: number;
  event_id: string;
  calendar_id: string;
  summary: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  all_day: number;
  /** Google's series id when this row is an occurrence of a recurring event;
   * NULL for one-off events. Gates edit/delete (recurring is blocked for now). */
  recurring_event_id: string | null;
  updated_at: string;
}

export function upsertCalendarEvents(
  calendarId: string,
  events: Omit<CalendarEventRow, 'id' | 'updated_at'>[]
): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM calendar_events WHERE calendar_id = ?').run(calendarId);
    const insert = db.prepare(
      `INSERT INTO calendar_events (event_id, calendar_id, summary, description, location, start_time, end_time, all_day, recurring_event_id)
       VALUES (@event_id, @calendar_id, @summary, @description, @location, @start_time, @end_time, @all_day, @recurring_event_id)`
    );
    for (const event of events) {
      insert.run(event);
    }
  })();
}

/**
 * Upsert a SINGLE event without touching the calendar's other cached rows.
 * Unlike upsertCalendarEvents (which clears the whole calendar first), this is a
 * conflict-keyed upsert on (event_id, calendar_id) — used to write a freshly
 * created event straight into the cache so it shows before the next full sync.
 */
export function upsertEvent(event: Omit<CalendarEventRow, 'id' | 'updated_at'>): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO calendar_events (event_id, calendar_id, summary, description, location, start_time, end_time, all_day, recurring_event_id)
     VALUES (@event_id, @calendar_id, @summary, @description, @location, @start_time, @end_time, @all_day, @recurring_event_id)
     ON CONFLICT(event_id, calendar_id) DO UPDATE SET
       summary = excluded.summary,
       description = excluded.description,
       location = excluded.location,
       start_time = excluded.start_time,
       end_time = excluded.end_time,
       all_day = excluded.all_day,
       recurring_event_id = excluded.recurring_event_id,
       updated_at = datetime('now')`
  ).run(event);
}

/** One cached event by its (event_id, calendar_id) key, or undefined. Edit/delete
 * use this to confirm the event exists and to read its recurring/all-day shape
 * server-side before touching Google. */
export function getEvent(eventId: string, calendarId: string): CalendarEventRow | undefined {
  const db = getDb();
  return db
    .prepare('SELECT * FROM calendar_events WHERE event_id = ? AND calendar_id = ?')
    .get(eventId, calendarId) as CalendarEventRow | undefined;
}

/** Remove a single cached event after it's deleted on Google, so it disappears
 * before the next full sync. No-op if the row is already gone. */
export function deleteEvent(eventId: string, calendarId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM calendar_events WHERE event_id = ? AND calendar_id = ?').run(
    eventId,
    calendarId
  );
}

/**
 * Drop cached events for any calendar no longer listed in config. Without
 * this, removing a calendar from data/config.json leaves its events on the
 * dashboard forever — sync only ever replaces calendars it still knows about.
 */
export function deleteEventsNotInCalendars(calendarIds: string[]): void {
  const db = getDb();
  if (calendarIds.length === 0) {
    db.prepare('DELETE FROM calendar_events').run();
    return;
  }
  const placeholders = calendarIds.map(() => '?').join(', ');
  db.prepare(`DELETE FROM calendar_events WHERE calendar_id NOT IN (${placeholders})`).run(
    ...calendarIds
  );
}

export function getEventsInRange(start: string, end: string): CalendarEventRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM calendar_events
       WHERE start_time < ? AND end_time > ?
       ORDER BY all_day DESC, start_time ASC`
    )
    .all(end, start) as CalendarEventRow[];
}
