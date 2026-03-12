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
  events: Omit<CalendarEventRow, 'id' | 'updated_at'>[],
): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM calendar_events WHERE calendar_id = ?').run(calendarId);
    const insert = db.prepare(
      `INSERT INTO calendar_events (event_id, calendar_id, summary, description, location, start_time, end_time, all_day)
       VALUES (@event_id, @calendar_id, @summary, @description, @location, @start_time, @end_time, @all_day)`,
    );
    for (const event of events) {
      insert.run(event);
    }
  })();
}

export function getEventsInRange(start: string, end: string): CalendarEventRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM calendar_events
       WHERE start_time < ? AND end_time > ?
       ORDER BY all_day DESC, start_time ASC`,
    )
    .all(end, start) as CalendarEventRow[];
}
