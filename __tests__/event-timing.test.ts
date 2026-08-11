import { describe, it, expect } from 'vitest';
import { addUtcDays, allDaySpanDays, nextDay, parseTiming } from '@/lib/calendar/event-timing';

describe('event-timing helpers', () => {
  it('addUtcDays / nextDay do UTC date math without DST drift', () => {
    expect(nextDay('2026-07-04')).toBe('2026-07-05');
    expect(addUtcDays('2026-07-10', 3)).toBe('2026-07-13');
    // Spring-forward day in US zones — UTC math is unaffected.
    expect(nextDay('2026-03-08')).toBe('2026-03-09');
    expect(addUtcDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('allDaySpanDays measures the exclusive-end span (min 1)', () => {
    expect(allDaySpanDays('2026-07-01', '2026-07-02')).toBe(1); // single day
    expect(allDaySpanDays('2026-07-01', '2026-07-04')).toBe(3); // three days
    expect(allDaySpanDays('2026-07-01', '2026-07-01')).toBe(1); // degenerate → 1
  });

  it('parseTiming accepts a valid all-day body', () => {
    const r = parseTiming({ allDay: true, date: '2026-07-04' });
    expect(r).toEqual({ ok: true, timing: { allDay: true, date: '2026-07-04' } });
  });

  it('parseTiming accepts a valid timed body', () => {
    const r = parseTiming({
      allDay: false,
      date: '2026-07-04',
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(r.ok).toBe(true);
  });

  it('parseTiming carries an inclusive all-day endDate', () => {
    const r = parseTiming({ allDay: true, date: '2026-08-02', endDate: '2026-08-08' });
    expect(r).toEqual({
      ok: true,
      timing: { allDay: true, date: '2026-08-02', endDate: '2026-08-08' },
    });
  });

  it('parseTiming allows a one-day span (endDate === date, inclusive)', () => {
    const r = parseTiming({ allDay: true, date: '2026-08-02', endDate: '2026-08-02' });
    expect(r.ok).toBe(true);
  });

  it('parseTiming omits endDate when the client did not send one', () => {
    // Pre-end-date clients: the update route reads this as "keep the span".
    const r = parseTiming({ allDay: true, date: '2026-08-02' });
    expect(r.ok && 'endDate' in r.timing && r.timing.endDate).toBeFalsy();
  });

  it('parseTiming rejects an endDate before the start, or a malformed one', () => {
    expect(parseTiming({ allDay: true, date: '2026-08-02', endDate: '2026-08-01' }).ok).toBe(false);
    expect(parseTiming({ allDay: true, date: '2026-08-02', endDate: '08/08/2026' }).ok).toBe(false);
  });

  it('parseTiming ignores endDate on a timed event (same-day only for now)', () => {
    const r = parseTiming({
      allDay: false,
      date: '2026-08-02',
      endDate: '2026-08-05',
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(r.ok).toBe(true);
    expect(r.ok && 'endDate' in r.timing).toBe(false);
  });

  it('parseTiming rejects bad date, missing/inverted times', () => {
    expect(parseTiming({ date: '07/04/2026' }).ok).toBe(false);
    expect(parseTiming({ allDay: false, date: '2026-07-04' }).ok).toBe(false);
    expect(
      parseTiming({ allDay: false, date: '2026-07-04', startTime: '10:00', endTime: '10:00' }).ok
    ).toBe(false);
    expect(
      parseTiming({ allDay: false, date: '2026-07-04', startTime: '25:00', endTime: '26:00' }).ok
    ).toBe(false);
  });
});
