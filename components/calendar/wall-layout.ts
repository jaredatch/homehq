import { bandHeightFor, fitCount, stackHeight, type GridMetrics } from './week-metrics';

/**
 * The family board's space policy: how the wall spends the height that
 * `week-metrics.ts` measured.
 *
 * The measuring is shared with the personal board; this is emphatically NOT
 * (CLAUDE.md rule 12). A personal board has one row and simply fills it. The
 * wall has an anchor week, an "expand next week" peek, and the collapse rule
 * below — three constraints that only make sense on a 27" screen showing two
 * weeks at once.
 *
 * It lives here rather than inline in CalendarGrid because it is pure
 * arithmetic with a silent failure mode: get it wrong and a cell crops one
 * event early, or a week row is left holding a date header with nothing under
 * it, and you only see it on a real panel. Being a plain function makes it
 * assertable in `__tests__/wall-layout.test.ts`.
 */

export interface WallWeekLayout {
  /** How many week rows the grid renders, counting from the current week. */
  shownWeeks: number;
  /** `grid-template-rows` for `.cal-weeks` — one track per shown week. */
  gridRows: string;
  /** Timed events to show per day; `Infinity` means every one. */
  visibleByDay: Record<string, number>;
}

/**
 * Space policy, by priority:
 *
 *   1. the "protected" days of the ANCHOR week show every event, and their real
 *      content sets the anchor week's track height — up to the point where the
 *      other weeks would drop below a readable floor. Past that the anchor is
 *      capped and its protected days crop behind "+N more" too;
 *   2. every other week gets an even share of the remaining height;
 *   3. non-protected days of the anchor week crop to whatever's left in its
 *      track — lowest priority, so they never steal from the other weeks.
 *
 * The anchor is the current week by default (protected = today-onward). When
 * "Expand next week" is on, the anchor becomes next week — and because all of
 * next week is in the future, the SAME `date >= today` predicate protects the
 * whole row, while the current week falls to a remaining-height share that
 * crops behind "+N more".
 *
 * **Collapse.** In the default view, a trailing week is dropped entirely rather
 * than let the current week crop while a later one holds space it can barely
 * use. At the household's event volume the last week sits pinned at its
 * two-row floor showing almost nothing, while today and tomorrow hide events
 * behind "+N more" — the wrong trade for a screen whose whole job is "what is
 * happening now". Weeks are dropped from the far end, one at a time, and only
 * while the anchor is still capped, so the grid gives up no more than it has
 * to. It is a pure function of the measured metrics and the data, recomputed
 * every render: nothing to persist and nothing to revert (CLAUDE.md rule 1),
 * and it un-collapses on its own as soon as the week thins out.
 *
 * Not applied when expanded — "Expand next week" is an explicit request to see
 * next week, so it stays on screen no matter how full the current week is.
 */
export function planWallWeeks(
  metrics: GridMetrics,
  weeksOfDays: string[][],
  laneByWeek: number[][],
  today: string,
  expanded: boolean
): WallWeekLayout {
  const { availH, headerH, rowGap, rowPadV, rowUnitPx, dayHeights } = metrics;
  const totalWeeks = weeksOfDays.length;

  // Which week is maximized. Default = current week (0); "Expand next week"
  // moves the anchor to week 1 (guarded so it can't point past the grid).
  const anchorWeek = expanded ? Math.min(1, totalWeeks - 1) : 0;
  const anchorDays = weeksOfDays[anchorWeek] ?? [];
  const anchorLanes = laneByWeek[anchorWeek] ?? [];

  // Priority 1: busiest protected day sets the anchor week's height — its band
  // counts per-column, since a protected day's own all-day rows sit in its cell.
  let protectedPx = 0;
  anchorDays.forEach((date, col) => {
    if (date >= today) {
      protectedPx = Math.max(
        protectedPx,
        bandHeightFor(metrics, anchorLanes[col] ?? 0) + stackHeight(metrics, dayHeights[date] ?? [])
      );
    }
  });

  // Keep a week at least ~2 rows tall so it never collapses to a sliver.
  const floorPx = rowPadV + (rowUnitPx > 0 ? 2 * rowUnitPx + rowGap : 0);
  const wantedAnchorPx = Math.ceil(headerH + Math.max(protectedPx, floorPx) + 6);

  // What the anchor can have with `shown` weeks on screen: everything the
  // de-prioritized weeks don't need to stay legible. Every one of them keeps
  // that floor, in BOTH modes. This used to apply to expanded mode only, on the
  // theory that the protected current week could safely take up to the whole
  // screen. A school-year week (12-13 events a day) disproved it: the anchor
  // asked for more height than the grid had, next week was left holding a date
  // header with nothing under it, and the overflow pushed the footer clean off
  // the bottom edge.
  const maxAnchorFor = (shown: number) =>
    Math.max(0, availH - Math.max(0, shown - 1) * (headerH + floorPx));

  // Drop trailing weeks while the current week still can't show its protected
  // days in full. Terminates at one week: the current week is the point of the
  // board and is never the row that goes.
  let shownWeeks = totalWeeks;
  if (!expanded) {
    while (shownWeeks > 1 && wantedAnchorPx > maxAnchorFor(shownWeeks)) shownWeeks -= 1;
  }

  const otherWeeks = Math.max(0, shownWeeks - 1);
  // With no other week to feed, the anchor takes the whole grid: there is
  // nothing to hand leftover height back to, and a track sized to its content
  // would leave dead grid painted under the week.
  const anchorPx = otherWeeks > 0 ? Math.min(wantedAnchorPx, maxAnchorFor(shownWeeks)) : availH;
  // Did the anchor get everything it asked for? When it didn't, its protected
  // days can no longer show every event — and they have to crop behind
  // "+N more" like any other day, not be silently clipped by .cal-week's
  // overflow. Uncapped (the ordinary case) this stays false and nothing moves.
  const anchorCapped = anchorPx < wantedAnchorPx;
  const otherWeekPx = otherWeeks > 0 ? Math.max(0, availH - anchorPx) / otherWeeks : 0;

  // Per-day visible counts. Protected days (anchor week, today-onward) = all
  // (Infinity); every other day greedily packs into whatever its track leaves
  // below the header and that column's own band. Dropped weeks get no entry —
  // nothing renders them, so a count would be dead data.
  const visibleByDay: Record<string, number> = {};
  const shown = weeksOfDays.slice(0, shownWeeks);
  shown.forEach((weekDays, wi) => {
    const isAnchor = wi === anchorWeek;
    const trackPx = isAnchor ? anchorPx : otherWeekPx;
    const lanes = laneByWeek[wi] ?? [];
    weekDays.forEach((date, col) => {
      if (isAnchor && date >= today && !anchorCapped) {
        visibleByDay[date] = Infinity;
      } else {
        const inner = trackPx - headerH - bandHeightFor(metrics, lanes[col] ?? 0);
        visibleByDay[date] = fitCount(metrics, dayHeights[date] ?? [], inner);
      }
    });
  });

  return {
    shownWeeks,
    gridRows: shown
      .map((_, wi) => (wi === anchorWeek ? `${anchorPx}px` : 'minmax(0, 1fr)'))
      .join(' '),
    visibleByDay,
  };
}
