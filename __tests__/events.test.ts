import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, _setDefaultDb } from '@/lib/db';
import {
  upsertCalendarEvents,
  upsertEvent,
  getEvent,
  deleteEvent,
  getEventsInRange,
  deleteEventsNotInCalendars,
} from '@/lib/db/events';
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
    recurring_event_id: null,
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

  it('purges events for calendars no longer in config', () => {
    upsertCalendarEvents('primary', [makeEvent({ event_id: 'evt_1' })]);
    upsertCalendarEvents('work', [makeEvent({ event_id: 'evt_2', calendar_id: 'work' })]);
    upsertCalendarEvents('old', [makeEvent({ event_id: 'evt_3', calendar_id: 'old' })]);

    // Config now only has primary + work; 'old' was removed.
    deleteEventsNotInCalendars(['primary', 'work']);

    const events = getEventsInRange('2026-03-12', '2026-03-13');
    const ids = events.map((e) => e.calendar_id).sort();
    expect(ids).toEqual(['primary', 'work']);
  });

  it('purges everything when no calendars are configured', () => {
    upsertCalendarEvents('primary', [makeEvent({ event_id: 'evt_1' })]);
    deleteEventsNotInCalendars([]);
    expect(getEventsInRange('2026-03-12', '2026-03-13')).toHaveLength(0);
  });

  // Single-event write-through (event creation) — must NOT clear the calendar.
  it('upsertEvent adds one event without wiping the calendar (the cache-wipe trap)', () => {
    upsertCalendarEvents('primary', [
      makeEvent({ event_id: 'evt_1', summary: 'Existing A' }),
      makeEvent({ event_id: 'evt_2', summary: 'Existing B' }),
    ]);
    upsertEvent(makeEvent({ event_id: 'evt_new', summary: 'Freshly Created' }));
    const summaries = getEventsInRange('2026-03-12', '2026-03-13')
      .map((e) => e.summary)
      .sort();
    expect(summaries).toEqual(['Existing A', 'Existing B', 'Freshly Created']);
  });

  it('upsertEvent updates in place on an (event_id, calendar_id) conflict', () => {
    upsertEvent(makeEvent({ event_id: 'evt_1', summary: 'Before', location: null }));
    upsertEvent(makeEvent({ event_id: 'evt_1', summary: 'After', location: 'Room 2' }));
    const events = getEventsInRange('2026-03-12', '2026-03-13');
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe('After');
    expect(events[0].location).toBe('Room 2');
  });

  it('upsertEvent keys on calendar too — same event_id on two calendars coexists', () => {
    upsertEvent(makeEvent({ event_id: 'dup', calendar_id: 'primary', summary: 'On Primary' }));
    upsertEvent(makeEvent({ event_id: 'dup', calendar_id: 'work', summary: 'On Work' }));
    expect(getEventsInRange('2026-03-12', '2026-03-13')).toHaveLength(2);
  });

  it('round-trips recurring_event_id through upsert + read', () => {
    upsertCalendarEvents('primary', [makeEvent({ event_id: 'occ', recurring_event_id: 'series' })]);
    expect(getEvent('occ', 'primary')?.recurring_event_id).toBe('series');
  });

  it('getEvent returns one row by (event_id, calendar_id), or undefined', () => {
    upsertEvent(makeEvent({ event_id: 'find_me', summary: 'Here' }));
    expect(getEvent('find_me', 'primary')?.summary).toBe('Here');
    expect(getEvent('find_me', 'work')).toBeUndefined();
    expect(getEvent('nope', 'primary')).toBeUndefined();
  });

  it('deleteEvent removes only the targeted row (no-op if absent)', () => {
    upsertEvent(makeEvent({ event_id: 'keep' }));
    upsertEvent(makeEvent({ event_id: 'drop' }));
    deleteEvent('drop', 'primary');
    expect(getEvent('drop', 'primary')).toBeUndefined();
    expect(getEvent('keep', 'primary')).toBeDefined();
    expect(() => deleteEvent('already-gone', 'primary')).not.toThrow();
  });
});
