import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, _setDefaultDb } from '@/lib/db';
import { upsertCalendarEvents, getEventsInRange } from '@/lib/db/events';
import type Database from 'better-sqlite3';

describe('calendar event queries', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'homehq-events-'));
    db = getDb(join(tmpDir, 'test.db'));
    _setDefaultDb(db);
  });

  afterEach(() => {
    _setDefaultDb(null);
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeEvent = (overrides = {}) => ({
    event_id: 'evt_1',
    calendar_id: 'primary',
    summary: 'Test Event',
    description: null,
    location: null,
    start_time: '2026-03-12T10:00:00-04:00',
    end_time: '2026-03-12T11:00:00-04:00',
    all_day: 0,
    ...overrides,
  });

  it('inserts and retrieves events', () => {
    upsertCalendarEvents('primary', [makeEvent()]);
    const events = getEventsInRange('2026-03-12', '2026-03-13');
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe('Test Event');
  });

  it('replaces all events for a calendar on upsert', () => {
    upsertCalendarEvents('primary', [
      makeEvent({ event_id: 'evt_1' }),
      makeEvent({ event_id: 'evt_2', summary: 'Old Event' }),
    ]);
    upsertCalendarEvents('primary', [makeEvent({ event_id: 'evt_3', summary: 'New Event' })]);
    const events = getEventsInRange('2026-03-12', '2026-03-13');
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe('New Event');
  });

  it('does not affect other calendars on upsert', () => {
    upsertCalendarEvents('primary', [makeEvent({ event_id: 'evt_1' })]);
    upsertCalendarEvents('work', [
      makeEvent({ event_id: 'evt_2', calendar_id: 'work', summary: 'Work Event' }),
    ]);
    upsertCalendarEvents('primary', []); // clear primary
    const events = getEventsInRange('2026-03-12', '2026-03-13');
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe('Work Event');
  });

  it('filters events by date range', () => {
    upsertCalendarEvents('primary', [
      makeEvent({
        event_id: 'evt_1',
        start_time: '2026-03-10T10:00:00Z',
        end_time: '2026-03-10T11:00:00Z',
      }),
      makeEvent({
        event_id: 'evt_2',
        start_time: '2026-03-12T10:00:00Z',
        end_time: '2026-03-12T11:00:00Z',
      }),
      makeEvent({
        event_id: 'evt_3',
        start_time: '2026-03-15T10:00:00Z',
        end_time: '2026-03-15T11:00:00Z',
      }),
    ]);
    const events = getEventsInRange('2026-03-11', '2026-03-13');
    expect(events).toHaveLength(1);
    expect(events[0].event_id).toBe('evt_2');
  });

  it('sorts all-day events before timed events, then by start_time', () => {
    upsertCalendarEvents('primary', [
      makeEvent({
        event_id: 'evt_1',
        start_time: '2026-03-12T14:00:00Z',
        end_time: '2026-03-12T15:00:00Z',
        all_day: 0,
      }),
      makeEvent({
        event_id: 'evt_2',
        start_time: '2026-03-12',
        end_time: '2026-03-13',
        all_day: 1,
        summary: 'All Day',
      }),
      makeEvent({
        event_id: 'evt_3',
        start_time: '2026-03-12T09:00:00Z',
        end_time: '2026-03-12T10:00:00Z',
        all_day: 0,
        summary: 'Morning',
      }),
    ]);
    const events = getEventsInRange('2026-03-12', '2026-03-13');
    expect(events[0].summary).toBe('All Day');
    expect(events[1].summary).toBe('Morning');
    expect(events[2].event_id).toBe('evt_1');
  });
});
