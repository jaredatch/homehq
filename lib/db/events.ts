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
      `INSERT INTO calendar_events (event_id, calendar_id, summary, description, location, start_time, end_time, all_day)
       VALUES (@event_id, @calendar_id, @summary, @description, @location, @start_time, @end_time, @all_day)`
    );
    for (const event of events) {
      insert.run(event);
    }
  })();
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
