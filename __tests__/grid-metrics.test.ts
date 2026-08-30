import { describe, expect, it } from 'vitest';
import {
  bandHeightFor,
  fitCount,
  stackHeight,
  type GridMetrics,
} from '@/components/calendar/week-metrics';
import { monthCapacityByDay, type MonthMetrics } from '@/components/calendar/month-metrics';
import type { AllDaySegment, CalendarEvent } from '@/components/calendar/calendar-utils';

/**
 * The packing arithmetic behind both grids' "+N more".
 *
 * It used to be closures inside CalendarGrid and MonthGrid, reachable only by
 * driving a browser. Phase 5 gave each a second caller (the personal board's
 * full-screen week and month), which is exactly when a shared rule needs a test
 * of its own: the failure mode is silent and only visible on a real panel — a
 * cell cropping one event early with a row of empty space under it, or one too
 * many and a chip clipped in half by the cell's overflow.
 */

const metrics: GridMetrics = {
  availH: 600,
  headerH: 30,
  rowGap: 6,
  rowPadV: 8,
  rowUnitPx: 44,
  morePx: 18,
  barH: 20,
  barGap: 2,
  bandPadV: 4,
  dayHeights: {},
};

describe('bandHeightFor', () => {
  it('reserves nothing for a day no all-day bar touches', () => {
    // The whole point of the per-column lane count: a day with no band spends
    // that space on its own events instead of holding a uniform placeholder.
    expect(bandHeightFor(metrics, 0)).toBe(0);
  });

  it('reserves padding plus one bar for a single lane', () => {
    expect(bandHeightFor(metrics, 1)).toBe(4 + 20);
  });

  it('adds a gap between stacked lanes, never after the last', () => {
    expect(bandHeightFor(metrics, 3)).toBe(4 + 3 * 20 + 2 * 2);
  });
});

describe('stackHeight', () => {
  it('is the container padding alone when a day is empty', () => {
    expect(stackHeight(metrics, [])).toBe(8);
  });

  it('sums the rows with a gap between each, never a trailing one', () => {
    expect(stackHeight(metrics, [44, 44, 60])).toBe(8 + 148 + 2 * 6);
  });
});

describe('fitCount', () => {
  it('shows everything when the whole stack fits', () => {
    // 3 rows = 8 pad + 44*3 + 6*2 = 152; ask for plenty.
    expect(fitCount(metrics, [44, 44, 44], 300)).toBe(3);
  });

  it('shows everything at exactly the height it needs', () => {
    // A boundary worth pinning: off by one here is a needless "+1 more".
    expect(fitCount(metrics, [44, 44, 44], 8 + 44 * 3 + 6 * 2)).toBe(3);
  });

  it('reserves a line for "+N more" as soon as it has to crop', () => {
    // 4 rows need 8 + 44*4 + 6*3 = 202, which 190 can't hold. The 4th is
    // dropped and its row goes to the count instead of a half-drawn event.
    const got = fitCount(metrics, [44, 44, 44, 44], 190);
    expect(got).toBeLessThan(4);
    // What shows plus the "+N more" line has to actually fit.
    expect(8 + got * 44 + (got - 1) * 6 + 6 + 18).toBeLessThanOrEqual(190);
  });

  it('shows nothing rather than a clipped row when the cell is too short', () => {
    expect(fitCount(metrics, [44, 44], 8)).toBe(0);
    expect(fitCount(metrics, [44], -50)).toBe(0);
  });

  it('handles an empty day without claiming a "+N more" line', () => {
    expect(fitCount(metrics, [], 300)).toBe(0);
  });

  it('packs variable row heights greedily, not by a uniform assumption', () => {
    // A two-line title next to single-line ones. Assuming a uniform row is the
    // bug this replaced: it under-filled cells ("+5 more" with room for 2 more).
    // 8 + 30 + 6 + 30 + 6 + 30 = 110, plus 6 + 18 for the count = 134 ≤ 140.
    expect(fitCount(metrics, [30, 30, 30, 70, 70], 140)).toBe(3);
  });
});

describe('monthCapacityByDay', () => {
  const m: MonthMetrics = {
    cellH: 100,
    chipH: 18,
    chipGap: 2,
    moreH: 16,
    barH: 14,
    barGap: 2,
    bandPadV: 4,
  };

  const week = ['2026-08-24', '2026-08-25', '2026-08-26'];
  const segments = (laneByColumn: number[]) => [
    { segments: [] as AllDaySegment[], slotCount: 0, laneByColumn },
  ];
  const timed = (counts: number[]) =>
    new Map(
      week.map((d, i) => [
        d,
        Array.from({ length: counts[i] }, (_, j) => ({ event_id: `${d}-${j}` }) as CalendarEvent),
      ])
    );

  it('shows every chip when they all fit', () => {
    // 100px holds floor((100 + 2) / 20) = 5 chips.
    const out = monthCapacityByDay(m, [week], segments([0, 0, 0]), timed([3, 5, 0]));
    expect(out['2026-08-24']).toBe(3);
    expect(out['2026-08-25']).toBe(5);
    expect(out['2026-08-26']).toBe(0);
  });

  it('gives up a chip to the "N more" line when it crops', () => {
    // 8 chips don't fit in 5 slots, so the count takes a row: floor((100 - 16 -
    // 2 + 2) / 20) = 4.
    const out = monthCapacityByDay(m, [week], segments([0, 0, 0]), timed([8, 0, 0]));
    expect(out['2026-08-24']).toBe(4);
  });

  it('charges an all-day band only to the columns it actually covers', () => {
    // Column 0 loses 4 + 14 = 18px to one band lane; column 1 loses nothing.
    const out = monthCapacityByDay(m, [week], segments([1, 0, 0]), timed([9, 9, 0]));
    expect(out['2026-08-24']).toBeLessThan(out['2026-08-25']);
  });

  it('shows nothing rather than a clipped chip in a cell with no room', () => {
    const tiny: MonthMetrics = { ...m, cellH: 10 };
    const out = monthCapacityByDay(tiny, [week], segments([2, 0, 0]), timed([4, 0, 0]));
    expect(out['2026-08-24']).toBe(0);
  });
});
