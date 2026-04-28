import { describe, expect, it } from 'vitest';
import {
  assignEventsToDays,
  formatEventTimeRange,
  generateRollingDays,
  timeAgo,
  type CalendarEvent,
} from '@/components/calendar/calendar-utils';

const makeEvent = (overrides: Partial<CalendarEvent>): CalendarEvent => ({
  id: 1,
  event_id: 'event-1',
  calendar_id: 'primary',
  summary: 'Test Event',
  description: null,
  location: null,
  start_time: '2026-04-29T09:00:00',
  end_time: '2026-04-29T10:00:00',
  all_day: 0,
  updated_at: '2026-04-29T08:00:00',
  ...overrides,
});

describe('calendar rendering helpers', () => {
  it('generates a rolling day window from the selected start date', () => {
    expect(generateRollingDays('2026-04-29', 5)).toEqual([
      '2026-04-29',
      '2026-04-30',
      '2026-05-01',
      '2026-05-02',
      '2026-05-03',
    ]);
  });

  it('assigns Google all-day events through the exclusive end date', () => {
    const days = generateRollingDays('2026-04-29', 5);
    const event = makeEvent({
      event_id: 'all-day',
      start_time: '2026-04-30',
      end_time: '2026-05-02',
      all_day: 1,
    });

    const mapped = assignEventsToDays([event], days);

    expect(mapped.get('2026-04-29')!.allDay).toHaveLength(0);
    expect(mapped.get('2026-04-30')!.allDay).toEqual([event]);
    expect(mapped.get('2026-05-01')!.allDay).toEqual([event]);
    expect(mapped.get('2026-05-02')!.allDay).toHaveLength(0);
  });

  it('assigns timed events to the local date in their start timestamp', () => {
    const days = generateRollingDays('2026-04-29', 3);
    const event = makeEvent({
      event_id: 'timed',
      start_time: '2026-04-30T16:30:00',
      end_time: '2026-04-30T17:15:00',
    });

    const mapped = assignEventsToDays([event], days);

    expect(mapped.get('2026-04-29')!.timed).toHaveLength(0);
    expect(mapped.get('2026-04-30')!.timed).toEqual([event]);
  });

  it('formats compact timed event ranges', () => {
    expect(formatEventTimeRange('2026-04-29T15:30:00', '2026-04-29T16:00:00')).toBe('3:30p-4p');
  });

  it('formats sync age labels', () => {
    const now = new Date('2026-04-29T12:00:00Z').getTime();
    expect(timeAgo('2026-04-29T11:55:00Z', now)).toBe('5m ago');
    expect(timeAgo('2026-04-29T09:00:00Z', now)).toBe('3h ago');
  });
});
