import { describe, it, expect } from 'vitest';
import { formatClockTime, formatClockDate } from '@/components/clock/Clock';

describe('clock formatting', () => {
  it('formats 12-hour time without seconds', () => {
    expect(formatClockTime(new Date(2026, 5, 7, 15, 45, 9))).toEqual({
      time: '3:45',
      ampm: 'PM',
    });
  });

  it('formats midnight and noon correctly', () => {
    expect(formatClockTime(new Date(2026, 5, 7, 0, 0, 0))).toEqual({
      time: '12:00',
      ampm: 'AM',
    });
    expect(formatClockTime(new Date(2026, 5, 7, 12, 0, 0))).toEqual({
      time: '12:00',
      ampm: 'PM',
    });
  });

  it('formats the date with weekday and month', () => {
    expect(formatClockDate(new Date(2026, 5, 7))).toBe('Sunday, June 7');
  });
});
