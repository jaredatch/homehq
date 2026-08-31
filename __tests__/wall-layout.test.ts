import { describe, expect, it } from 'vitest';
import { planWallWeeks } from '@/components/calendar/wall-layout';
import type { GridMetrics } from '@/components/calendar/week-metrics';

/**
 * The family board's space policy — which week is maximized, which weeks stay
 * on screen at all, and how many events each day shows.
 *
 * The numbers below are the wall's REAL measurements, read off `.cal-weeks` at
 * 1920x1080 (the 27" 4K panel at device scale factor 2). Keeping them real is
 * the point: the arithmetic has a silent failure mode that only shows up on a
 * panel, so a test built on invented round numbers would pass while the wall
 * cropped a day early.
 */
const M: GridMetrics = {
  availH: 913,
  headerH: 42.16,
  rowGap: 8,
  rowPadV: 10.8,
  rowUnitPx: 59,
  morePx: 24,
  barH: 29.52,
  barGap: 1,
  bandPadV: 5.4,
  dayHeights: {},
};

const WEEK_0 = [
  '2026-08-31',
  '2026-09-01',
  '2026-09-02',
  '2026-09-03',
  '2026-09-04',
  '2026-09-05',
  '2026-09-06',
];
const WEEK_1 = [
  '2026-09-07',
  '2026-09-08',
  '2026-09-09',
  '2026-09-10',
  '2026-09-11',
  '2026-09-12',
  '2026-09-13',
];
const WEEK_2 = [
  '2026-09-14',
  '2026-09-15',
  '2026-09-16',
  '2026-09-17',
  '2026-09-18',
  '2026-09-19',
  '2026-09-20',
];
const MONDAY = '2026-08-31'; // start of WEEK_0, so every day of it is protected

const noLanes = (weeks: number) => Array.from({ length: weeks }, () => Array(7).fill(0));

/** Metrics whose busiest day carries `n` single-line events. */
function withBusiestDay(n: number, date = '2026-09-01', rest = 2): GridMetrics {
  const dayHeights: Record<string, number[]> = {};
  for (const d of [...WEEK_0, ...WEEK_1, ...WEEK_2]) {
    dayHeights[d] = Array(rest).fill(59);
  }
  dayHeights[date] = Array(n).fill(59);
  return { ...M, dayHeights };
}

describe('planWallWeeks — the ordinary two-week wall', () => {
  it('keeps both weeks when the current week fits', () => {
    // 9 events on the busiest protected day wants ~654px; two weeks allow 734.
    const layout = planWallWeeks(withBusiestDay(9), [WEEK_0, WEEK_1], noLanes(2), MONDAY, false);
    expect(layout.shownWeeks).toBe(2);
    expect(layout.gridRows.split(' ').length).toBeGreaterThan(1);
  });

  it('shows every event on a protected day it did not have to crop', () => {
    const layout = planWallWeeks(withBusiestDay(9), [WEEK_0, WEEK_1], noLanes(2), MONDAY, false);
    expect(layout.visibleByDay['2026-09-01']).toBe(Infinity);
  });

  it('still crops next week to its remaining share', () => {
    const layout = planWallWeeks(withBusiestDay(9), [WEEK_0, WEEK_1], noLanes(2), MONDAY, false);
    // Next week is not the anchor, so it packs into what is left — a finite
    // count, never Infinity.
    expect(layout.visibleByDay['2026-09-08']).toBeLessThan(Infinity);
  });
});

describe('planWallWeeks — collapse', () => {
  it('drops next week when the current week cannot show its protected days', () => {
    // 14 events wants ~989px; two weeks allow 734, one week allows 913.
    const layout = planWallWeeks(withBusiestDay(14), [WEEK_0, WEEK_1], noLanes(2), MONDAY, false);
    expect(layout.shownWeeks).toBe(1);
  });

  it('hands the whole grid to the surviving week as one filling track', () => {
    // Not `913px`. availH comes from clientHeight, a ROUNDED integer, so a
    // pinned track leaves the container's fractional remainder (~0.03px)
    // showing as a hairline of .cal-weeks' grey background under the row —
    // visible or not depending on where it landed on the device pixel grid.
    const layout = planWallWeeks(withBusiestDay(14), [WEEK_0, WEEK_1], noLanes(2), MONDAY, false);
    expect(layout.gridRows).toBe('minmax(0, 1fr)');
    expect(layout.gridRows).not.toMatch(/px/);
  });

  it('still pins the anchor in px while another week has to be fed', () => {
    // The px track is how the anchor reserves height AGAINST its neighbours;
    // it is only pointless when it is the sole row.
    const layout = planWallWeeks(withBusiestDay(9), [WEEK_0, WEEK_1], noLanes(2), MONDAY, false);
    expect(layout.gridRows).toMatch(/^\d+px minmax\(0, 1fr\)$/);
  });

  it('spends the reclaimed height on more events', () => {
    const busy = withBusiestDay(14);
    const collapsed = planWallWeeks(busy, [WEEK_0, WEEK_1], noLanes(2), MONDAY, false);
    // The same data with the collapse suppressed (expanded pins both weeks on
    // screen), as the "before" side of the comparison.
    const twoWeeks = planWallWeeks(busy, [WEEK_0, WEEK_1], noLanes(2), MONDAY, true);
    expect(collapsed.visibleByDay['2026-09-01']).toBeGreaterThan(
      twoWeeks.visibleByDay['2026-09-01']
    );
  });

  it('gives no capacity entry to a week it dropped', () => {
    const layout = planWallWeeks(withBusiestDay(14), [WEEK_0, WEEK_1], noLanes(2), MONDAY, false);
    for (const date of WEEK_1) expect(layout.visibleByDay[date]).toBeUndefined();
  });

  it('never drops the current week itself, however hopeless the fit', () => {
    // 40 events cannot fit in any arrangement; the board still shows the week.
    const layout = planWallWeeks(withBusiestDay(40), [WEEK_0, WEEK_1], noLanes(2), MONDAY, false);
    expect(layout.shownWeeks).toBe(1);
    expect(layout.visibleByDay['2026-09-01']).toBeGreaterThan(0);
    expect(layout.visibleByDay['2026-09-01']).toBeLessThan(Infinity);
  });

  it('drops only as many weeks as it has to', () => {
    // 9 events is too tall for a three-week grid (max 555) but fits a two-week
    // one (max 734), so exactly one week goes.
    const layout = planWallWeeks(
      withBusiestDay(9),
      [WEEK_0, WEEK_1, WEEK_2],
      noLanes(3),
      MONDAY,
      false
    );
    expect(layout.shownWeeks).toBe(2);
  });

  it('leaves an already-fitting week untouched — the default render is unmoved', () => {
    // The rule 2 guard: data that does not trigger the feature must produce
    // exactly what it did before the feature existed.
    const light = withBusiestDay(4);
    const layout = planWallWeeks(light, [WEEK_0, WEEK_1], noLanes(2), MONDAY, false);
    expect(layout.shownWeeks).toBe(2);
    expect(layout.visibleByDay['2026-09-01']).toBe(Infinity);
  });
});

describe('planWallWeeks — anchorWeek', () => {
  // The "+N more" click rule reads this: clicking a week that IS the anchor
  // opens the day popover (there is no height left to win), and clicking any
  // other week moves the anchor there, as the button always did. Getting the
  // anchor wrong would silently restore the dead click.
  it('is the current week by default', () => {
    expect(
      planWallWeeks(withBusiestDay(4), [WEEK_0, WEEK_1], noLanes(2), MONDAY, false).anchorWeek
    ).toBe(0);
  });

  it('is still the current week when the grid has collapsed to it', () => {
    expect(
      planWallWeeks(withBusiestDay(14), [WEEK_0, WEEK_1], noLanes(2), MONDAY, false).anchorWeek
    ).toBe(0);
  });

  it('moves to next week while expanded', () => {
    expect(
      planWallWeeks(withBusiestDay(4), [WEEK_0, WEEK_1], noLanes(2), MONDAY, true).anchorWeek
    ).toBe(1);
  });

  it('cannot point past a one-week grid', () => {
    expect(planWallWeeks(withBusiestDay(4), [WEEK_0], noLanes(1), MONDAY, true).anchorWeek).toBe(0);
  });
});

describe('planWallWeeks — expand next week', () => {
  it('keeps next week on screen no matter how full the current week is', () => {
    // An explicit request to see next week outranks the collapse rule.
    const layout = planWallWeeks(withBusiestDay(14), [WEEK_0, WEEK_1], noLanes(2), MONDAY, true);
    expect(layout.shownWeeks).toBe(2);
  });

  it('moves the anchor so all of next week shows', () => {
    const layout = planWallWeeks(withBusiestDay(3), [WEEK_0, WEEK_1], noLanes(2), MONDAY, true);
    expect(layout.visibleByDay['2026-09-08']).toBe(Infinity);
    expect(layout.visibleByDay['2026-09-01']).toBeLessThan(Infinity);
  });
});

describe('planWallWeeks — protected days', () => {
  it('protects today onward, and crops the days already past', () => {
    const wednesday = '2026-09-02';
    const layout = planWallWeeks(withBusiestDay(9), [WEEK_0, WEEK_1], noLanes(2), wednesday, false);
    expect(layout.visibleByDay[wednesday]).toBe(Infinity);
    // Monday and Tuesday are behind us — lowest priority, so they crop.
    expect(layout.visibleByDay['2026-08-31']).toBeLessThan(Infinity);
  });

  it('sizes the week off a protected day, not a busier one already past', () => {
    // The busiest day is Monday, but today is Wednesday — Monday must not drag
    // the whole week taller (or, now, collapse next week off the screen).
    const layout = planWallWeeks(
      withBusiestDay(20, '2026-08-31'),
      [WEEK_0, WEEK_1],
      noLanes(2),
      '2026-09-02',
      false
    );
    expect(layout.shownWeeks).toBe(2);
  });
});

describe('planWallWeeks — all-day band', () => {
  it('counts a protected day’s own band rows against its height', () => {
    // Same events either way; the day under two all-day bars needs more room,
    // which is enough to tip this week over the two-week allowance.
    const lanes = noLanes(2);
    lanes[0][1] = 3;
    const bare = planWallWeeks(withBusiestDay(9), [WEEK_0, WEEK_1], noLanes(2), MONDAY, false);
    const banded = planWallWeeks(withBusiestDay(9), [WEEK_0, WEEK_1], lanes, MONDAY, false);
    expect(bare.shownWeeks).toBe(2);
    expect(banded.shownWeeks).toBe(1);
  });
});
