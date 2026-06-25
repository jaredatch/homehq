import { describe, expect, it } from 'vitest';
import {
  assignEventsToDays,
  computeWeekSegments,
  formatEventTimeRange,
  formatSyncLabel,
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
  recurring_event_id: null,
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

  it('formats timed all-day spans as one bar across the days covered', () => {
    // Mon 2026-04-27 … Sun 2026-05-03
    const week = generateRollingDays('2026-04-27', 7);
    const allDay = (overrides: Partial<CalendarEvent>) => makeEvent({ all_day: 1, ...overrides });

    // Single-day all-day event (end is exclusive next day) → span 1.
    const single = computeWeekSegments(
      [allDay({ event_id: 's', start_time: '2026-04-29', end_time: '2026-04-30' })],
      week
    );
    expect(single.slotCount).toBe(1);
    expect(single.segments[0]).toMatchObject({
      startCol: 2,
      span: 1,
      slot: 0,
      continuesLeft: false,
      continuesRight: false,
    });

    // Multi-day event fully inside the week → spans the covered columns.
    const multi = computeWeekSegments(
      [allDay({ event_id: 'm', start_time: '2026-04-28', end_time: '2026-04-30' })],
      week
    );
    expect(multi.segments[0]).toMatchObject({ startCol: 1, span: 2, continuesLeft: false });
  });

  it('clips all-day spans to the week and flags continuation', () => {
    const week = generateRollingDays('2026-04-27', 7);
    const allDay = (overrides: Partial<CalendarEvent>) => makeEvent({ all_day: 1, ...overrides });

    // Starts before the week, ends Wed → clipped left, two columns.
    const left = computeWeekSegments(
      [allDay({ event_id: 'l', start_time: '2026-04-25', end_time: '2026-04-29' })],
      week
    );
    expect(left.segments[0]).toMatchObject({ startCol: 0, span: 2, continuesLeft: true });

    // Starts Sat, runs past Sunday → clipped right.
    const right = computeWeekSegments(
      [allDay({ event_id: 'r', start_time: '2026-05-02', end_time: '2026-05-05' })],
      week
    );
    expect(right.segments[0]).toMatchObject({ startCol: 5, span: 2, continuesRight: true });
  });

  it('stacks overlapping all-day events into separate slots', () => {
    const week = generateRollingDays('2026-04-27', 7);
    const allDay = (overrides: Partial<CalendarEvent>) => makeEvent({ all_day: 1, ...overrides });

    const { slotCount, segments } = computeWeekSegments(
      [
        allDay({ event_id: 'a', start_time: '2026-04-27', end_time: '2026-04-30' }),
        allDay({ event_id: 'b', start_time: '2026-04-29', end_time: '2026-05-01' }),
      ],
      week
    );
    expect(slotCount).toBe(2);
    expect(new Set(segments.map((s) => s.slot)).size).toBe(2);
  });

  it('reserves band lanes per column for pass-through and empty lower slots', () => {
    // Mon 2026-04-27 … Sun 2026-05-03
    const week = generateRollingDays('2026-04-27', 7);
    const allDay = (overrides: Partial<CalendarEvent>) => makeEvent({ all_day: 1, ...overrides });

    // X: Mon–Wed in slot 0. Z: Tue–Fri starts later, overlaps X on Tue/Wed so it
    // packs into slot 1. Tue/Wed reserve both lanes (pass-through); Thu/Fri reserve
    // 2 as well — slot 0 is empty there but must stay reserved so Z keeps its row.
    const { laneByColumn } = computeWeekSegments(
      [
        allDay({ event_id: 'x', start_time: '2026-04-27', end_time: '2026-04-30' }),
        allDay({ event_id: 'z', start_time: '2026-04-28', end_time: '2026-05-02' }),
      ],
      week
    );
    expect(laneByColumn).toEqual([1, 2, 2, 2, 2, 0, 0]);
  });

  it('reserves no lanes on days outside an all-day span', () => {
    const week = generateRollingDays('2026-04-27', 7);
    const { laneByColumn } = computeWeekSegments(
      [makeEvent({ all_day: 1, start_time: '2026-04-29', end_time: '2026-04-30' })],
      week
    );
    // Only Wed (col 2) holds the single-day bar; every other day stays at the top.
    expect(laneByColumn).toEqual([0, 0, 1, 0, 0, 0, 0]);
  });

  it('formats timed event ranges with spaced dash and shared meridiem', () => {
    expect(formatEventTimeRange('2026-04-29T15:30:00', '2026-04-29T16:00:00')).toBe('3:30 – 4pm');
  });

  it('keeps both meridiems when the range crosses noon', () => {
    expect(formatEventTimeRange('2026-04-29T11:30:00', '2026-04-29T13:00:00')).toBe(
      '11:30am – 1pm'
    );
  });

  it('formats sync age labels', () => {
    const now = new Date('2026-04-29T12:00:00Z').getTime();
    expect(timeAgo('2026-04-29T11:55:00Z', now)).toBe('5m ago');
    expect(timeAgo('2026-04-29T09:00:00Z', now)).toBe('3h ago');
  });

  it('shows normal sync label when healthy', () => {
    const now = new Date('2026-04-29T12:00:00Z').getTime();
    const label = formatSyncLabel(
      { lastSuccess: '2026-04-29T11:55:00Z', lastAttempt: '2026-04-29T11:55:00Z', lastError: null },
      now
    );
    expect(label).toEqual({ text: 'Synced 5m ago', isError: false });
  });

  it('surfaces sync errors with last-success age', () => {
    const now = new Date('2026-04-29T12:00:00Z').getTime();
    const label = formatSyncLabel(
      {
        lastSuccess: '2026-04-29T09:00:00Z',
        lastAttempt: '2026-04-29T11:55:00Z',
        lastError: 'Calendar API error: 500',
      },
      now
    );
    expect(label.isError).toBe(true);
    expect(label.text).toBe('Sync failing — last sync 3h ago');
  });

  it('surfaces a reconnect hint when authorization is revoked', () => {
    const label = formatSyncLabel({
      lastSuccess: null,
      lastAttempt: '2026-04-29T11:55:00Z',
      lastError: 'Google authorization revoked — reconnect at /setup',
    });
    expect(label.isError).toBe(true);
    expect(label.text).toBe('Sync failing — reconnect Google at /setup');
  });

  it('shows not-yet-synced before the first sync', () => {
    const label = formatSyncLabel({ lastSuccess: null, lastAttempt: null, lastError: null });
    expect(label).toEqual({ text: 'Not yet synced', isError: false });
  });
});
