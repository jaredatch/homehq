import { describe, it, expect } from 'vitest';
import {
  carryEnd,
  formatClock12,
  formatDuration,
  formatPickedDate,
  fromClock12,
  fromMinutes,
  pickerDays,
  toClock12,
  toMinutes,
} from '@/components/board/picker-utils';

describe('12-hour faces over 24-hour values', () => {
  it('reads midnight and noon as 12, not 0', () => {
    expect(toClock12('00:30')).toEqual({ hour: 12, minute: 30, pm: false });
    expect(toClock12('12:00')).toEqual({ hour: 12, minute: 0, pm: true });
    expect(toClock12('17:05')).toEqual({ hour: 5, minute: 5, pm: true });
  });

  it('writes 12 AM as midnight and 12 PM as noon', () => {
    expect(fromClock12({ hour: 12, minute: 0, pm: false })).toBe('00:00');
    expect(fromClock12({ hour: 12, minute: 15, pm: true })).toBe('12:15');
    expect(fromClock12({ hour: 7, minute: 50, pm: false })).toBe('07:50');
  });

  it('round-trips every minute of the day', () => {
    for (let t = 0; t < 24 * 60; t++) {
      const hhmm = fromMinutes(t);
      expect(fromClock12(toClock12(hhmm))).toBe(hhmm);
    }
  });

  it('draws a field value with its minutes and meridiem, whatever the device locale', () => {
    expect(formatClock12('17:00')).toBe('5:00 PM');
    expect(formatClock12('00:05')).toBe('12:05 AM');
    expect(formatClock12('23:59')).toBe('11:59 PM');
  });
});

describe('minutes', () => {
  it('converts both ways and clamps to one day', () => {
    expect(toMinutes('17:05')).toBe(1025);
    expect(fromMinutes(1025)).toBe('17:05');
    expect(fromMinutes(-10)).toBe('00:00');
    expect(fromMinutes(24 * 60 + 30)).toBe('23:59');
  });

  it('says how long an event runs', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1 hr');
    expect(formatDuration(90)).toBe('1 hr 30 min');
    expect(formatDuration(0)).toBe('');
  });
});

describe('carryEnd', () => {
  it('keeps the length when the start moves', () => {
    expect(carryEnd('17:00', '19:00', '18:00')).toBe('20:00');
    expect(carryEnd('17:00', '16:30', '18:30')).toBe('18:00');
  });

  it('falls back to an hour when there was no length to keep', () => {
    expect(carryEnd('17:00', '19:00', '17:00')).toBe('20:00');
    expect(carryEnd('17:00', '19:00', '16:00')).toBe('20:00');
  });

  it('stops at the end of the day rather than wrapping into tomorrow', () => {
    expect(carryEnd('17:00', '23:30', '18:00')).toBe('23:59');
  });
});

describe('formatPickedDate', () => {
  it('is weekday and short date this year', () => {
    expect(formatPickedDate('2026-09-22', '2026-09-22')).toBe('Tue, Sep 22');
  });

  it('adds the year once it is not this one', () => {
    expect(formatPickedDate('2027-01-05', '2026-09-22')).toBe('Tue, Jan 5, 2027');
  });
});

describe('pickerDays', () => {
  it('is always six weeks, so the grid never changes height between months', () => {
    // February 2027 fits in four Monday-start weeks; September 2026 needs five.
    expect(pickerDays('2027-02', 'monday')).toHaveLength(42);
    expect(pickerDays('2026-09', 'monday')).toHaveLength(42);
  });

  it('starts on the week containing the 1st', () => {
    const monday = pickerDays('2026-09', 'monday');
    expect(monday[0]).toBe('2026-08-31');
    expect(monday).toContain('2026-09-30');
    expect(pickerDays('2026-09', 'sunday')[0]).toBe('2026-08-30');
  });
});
