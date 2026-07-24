import { describe, expect, it } from 'vitest';
import {
  addMonths,
  isAdjacentMonth,
  monthGridDays,
  monthLabel,
  monthOf,
  monthRowCount,
  popoverLayout,
  shortMonthName,
  weekdayShortOf,
} from '@/components/calendar/month-utils';

describe('month row count', () => {
  it('uses only the weeks a month needs — 4, 5, or 6', () => {
    // Feb 2027 starts on a Monday and has 28 days → exactly 4 rows.
    expect(monthRowCount('2027-02', 'monday')).toBe(4);
    // July 2026 (Wed 1st, 31 days) fits in 5.
    expect(monthRowCount('2026-07', 'monday')).toBe(5);
    // Aug 2026 starts on a Saturday, 31 days → needs 6.
    expect(monthRowCount('2026-08', 'monday')).toBe(6);
    // October 2026's 6th week would be all November — dynamic count avoids it.
    expect(monthRowCount('2026-10', 'monday')).toBe(5);
  });

  it('depends on the week-start preference', () => {
    // Feb 2027: Monday-start gives 4 rows; Sunday-start pushes the 1st into a
    // leading week, needing 5.
    expect(monthRowCount('2027-02', 'monday')).toBe(4);
    expect(monthRowCount('2027-02', 'sunday')).toBe(5);
  });
});

describe('month grid days', () => {
  it('returns exactly rowCount * 7 days', () => {
    expect(monthGridDays('2027-02', 'monday')).toHaveLength(28);
    expect(monthGridDays('2026-07', 'monday')).toHaveLength(35);
    expect(monthGridDays('2026-08', 'monday')).toHaveLength(42);
  });

  it('starts at the week containing the 1st, honoring the week start', () => {
    // 2026-07-01 is a Wednesday.
    expect(monthGridDays('2026-07', 'monday')[0]).toBe('2026-06-29');
    expect(monthGridDays('2026-07', 'sunday')[0]).toBe('2026-06-28');
  });

  it('covers every day of the month, in order, with no gaps', () => {
    const days = monthGridDays('2026-07', 'monday');
    expect(days).toContain('2026-07-01');
    expect(days).toContain('2026-07-31');
    expect(days[days.length - 1]).toBe('2026-08-02'); // last cell of the 5th week
    for (let i = 1; i < days.length; i++) {
      const prev = new Date(`${days[i - 1]}T00:00:00Z`).getTime();
      const cur = new Date(`${days[i]}T00:00:00Z`).getTime();
      expect(cur - prev).toBe(86_400_000);
    }
  });

  it('trims a month that starts exactly on the week start to 4 rows', () => {
    // 2027-02-01 is a Monday and Feb has 28 days — no leading or trailing week.
    const days = monthGridDays('2027-02', 'monday');
    expect(days[0]).toBe('2027-02-01');
    expect(days[days.length - 1]).toBe('2027-02-28');
  });

  it('crosses a year boundary', () => {
    const days = monthGridDays('2026-12', 'monday');
    expect(days[0]).toBe('2026-11-30');
    expect(days).toContain('2027-01-01');
  });
});

describe('month helpers', () => {
  it('reads the month key off a day string', () => {
    expect(monthOf('2026-07-23')).toBe('2026-07');
  });

  it('flags leading and trailing cells as adjacent-month', () => {
    expect(isAdjacentMonth('2026-06-30', '2026-07')).toBe(true);
    expect(isAdjacentMonth('2026-07-01', '2026-07')).toBe(false);
    expect(isAdjacentMonth('2026-08-01', '2026-07')).toBe(true);
  });

  it('formats the grid title and the 1st-of-month prefix', () => {
    expect(monthLabel('2026-07')).toBe('July 2026');
    expect(monthLabel('2027-01')).toBe('January 2027');
    expect(shortMonthName('2026-08-01')).toBe('Aug');
  });

  it('steps months across year boundaries in both directions', () => {
    expect(addMonths('2026-07', 1)).toBe('2026-08');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-07', -12)).toBe('2025-07');
    expect(addMonths('2026-07', 7)).toBe('2027-02');
  });

  it('names the weekday of a day string', () => {
    expect(weekdayShortOf('2026-07-23')).toBe('Thu');
    expect(weekdayShortOf('2026-07-26')).toBe('Sun');
  });
});

describe('popover layout', () => {
  // A 4K-ish calendar region with 7 ~548px columns and 5 ~380px rows.
  const container = { width: 3840, height: 1900 };
  const cell = (col: number, row: number) => ({
    left: col * 548,
    top: row * 380,
    width: 548,
    height: 380,
  });

  it('centers over the cell, a bit wider, top near the cell top', () => {
    const box = popoverLayout(cell(3, 1), container);
    expect(box.width).toBeCloseTo(548 * 1.35);
    expect(box.left + box.width / 2).toBeCloseTo(3 * 548 + 548 / 2);
    expect(box.top).toBe(1 * 380 - 6);
    // Whatever's below the top edge is the growth budget; the list scrolls past it.
    expect(box.maxHeight).toBe(container.height - 8 - box.top);
  });

  it('clamps to the region edges for first- and last-column cells', () => {
    const first = popoverLayout(cell(0, 1), container);
    expect(first.left).toBe(8);
    const last = popoverLayout(cell(6, 1), container);
    expect(last.left + last.width).toBe(container.width - 8);
  });

  it('shifts a bottom-row popover up so it keeps at least half the region', () => {
    const box = popoverLayout(cell(2, 4), container);
    expect(box.maxHeight).toBeGreaterThanOrEqual(container.height / 2);
    expect(box.top + box.maxHeight).toBeLessThanOrEqual(container.height - 8);
  });

  it('never exceeds the region width, even for a huge cell', () => {
    const box = popoverLayout({ left: 0, top: 0, width: 3800, height: 380 }, container);
    expect(box.width).toBe(container.width - 16);
    expect(box.left).toBe(8);
  });

  it('pins the top row to the padding line', () => {
    const box = popoverLayout(cell(1, 0), container);
    expect(box.top).toBe(8); // cellTop - 6 would be negative
  });
});
