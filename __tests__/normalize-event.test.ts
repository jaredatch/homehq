import { describe, it, expect } from 'vitest';
import { normalizeEvent } from '@/lib/google/calendar';

describe('normalizeEvent', () => {
  it('normalizes a timed event', () => {
    const result = normalizeEvent('primary', {
      id: 'abc123',
      summary: 'Team standup',
      description: 'Daily sync',
      location: 'Zoom',
      start: { dateTime: '2026-03-12T09:00:00-04:00' },
      end: { dateTime: '2026-03-12T09:30:00-04:00' },
    });

    expect(result).toEqual({
      event_id: 'abc123',
      calendar_id: 'primary',
      summary: 'Team standup',
      description: 'Daily sync',
      location: 'Zoom',
      start_time: '2026-03-12T09:00:00-04:00',
      end_time: '2026-03-12T09:30:00-04:00',
      all_day: 0,
      recurring_event_id: null,
      group_id: null,
    });
  });

  it('normalizes an all-day event', () => {
    const result = normalizeEvent('work', {
      id: 'def456',
      summary: 'Company Holiday',
      start: { date: '2026-03-16' },
      end: { date: '2026-03-17' },
    });

    expect(result).toEqual({
      event_id: 'def456',
      calendar_id: 'work',
      summary: 'Company Holiday',
      description: null,
      location: null,
      start_time: '2026-03-16',
      end_time: '2026-03-17',
      all_day: 1,
      recurring_event_id: null,
      group_id: null,
    });
  });

  it('defaults summary to empty string when missing', () => {
    const result = normalizeEvent('primary', {
      id: 'no-title',
      start: { dateTime: '2026-03-12T10:00:00Z' },
      end: { dateTime: '2026-03-12T11:00:00Z' },
    });

    expect(result.summary).toBe('');
  });

  it('carries the recurring series id on an occurrence (null on one-offs)', () => {
    const occurrence = normalizeEvent('primary', {
      id: 'series_20260312',
      summary: 'Weekly 1:1',
      start: { dateTime: '2026-03-12T09:00:00-04:00' },
      end: { dateTime: '2026-03-12T09:30:00-04:00' },
      recurringEventId: 'series',
    });
    expect(occurrence.recurring_event_id).toBe('series');

    const oneOff = normalizeEvent('primary', {
      id: 'solo',
      start: { dateTime: '2026-03-12T10:00:00Z' },
      end: { dateTime: '2026-03-12T11:00:00Z' },
    });
    expect(oneOff.recurring_event_id).toBeNull();
  });
});
