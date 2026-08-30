'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { CalendarEvent } from './calendar-utils';

/**
 * The week grid's measurement layer, shared by the family board's wall grid and
 * the personal board's full-screen week.
 *
 * This is deliberately only the MEASURING half. How the measured heights are
 * then spent is a per-board policy and stays with each grid: the wall protects
 * the current week and lets "Expand next week" move that anchor, while a
 * personal board has one row and simply fills it. Sharing the policy would mean
 * one component carrying two sets of constraints, which is exactly what
 * CLAUDE.md rule 12 says not to do.
 *
 * What IS shared is the arithmetic that has to agree with what gets rendered —
 * how tall a stack of rows is, what an all-day band reserves, and how many rows
 * fit in a box. Two copies of that would drift, and the symptom would be a cell
 * cropping one event early with visible empty space under it.
 */

export interface GridMetrics {
  availH: number; // the grid's usable height
  headerH: number; // a day cell's date-header height
  rowGap: number; // inter-row gap between timed events
  rowPadV: number; // timed events container's top+bottom padding
  rowUnitPx: number; // representative single-line row height (floors a week)
  morePx: number; // height of the "+N more" line, reserved when cropping
  barH: number; // an all-day band bar's height
  barGap: number; // gap between band slots
  bandPadV: number; // band container's top+bottom padding
  // Real per-day timed-row heights, in render order, from the hidden measurement
  // layer. Variable (1- vs 2-line titles) — measuring each beats assuming a
  // uniform row, which used to under-fill cells ("+5 more" with room for 2 more).
  dayHeights: Record<string, number[]>;
}

// useLayoutEffect on the client (measure before paint, no flash); useEffect on
// the server, where it no-ops anyway — sidesteps the SSR warning.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Read the grid's usable height and chrome (header/band) from the visible grid,
 * plus the REAL per-day timed-row heights from the hidden measurement layer
 * (which always renders every event, so heights are never truncated by
 * cropping). Re-runs on resize and whenever the rendered events change.
 *
 * Returns null until the first measurement lands; a caller renders uncropped
 * (every event visible) until then, and the layer settles on the next frame.
 */
export function useWeekGridMetrics(
  gridRef: RefObject<HTMLDivElement | null>,
  measureRef: RefObject<HTMLDivElement | null>,
  days: string[],
  visibleEvents: CalendarEvent[],
  timezone: string | undefined
): GridMetrics | null {
  const [metrics, setMetrics] = useState<GridMetrics | null>(null);
  const sigRef = useRef<string>('');

  useIsoLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const measure = () => {
      const availH = grid.clientHeight;
      const headerEl = grid.querySelector('[data-day-header]') as HTMLElement | null;
      const headerH = headerEl?.getBoundingClientRect().height ?? 0;

      // All-day band metrics — only present when some week has all-day events.
      const bandEl = grid.querySelector('[data-band]') as HTMLElement | null;
      let barH = 0;
      let barGap = 0;
      let bandPadV = 0;
      if (bandEl) {
        const cs = getComputedStyle(bandEl);
        bandPadV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        barGap = parseFloat(cs.rowGap) || 0;
        const barEls = grid.querySelectorAll('[data-band-row]');
        for (let i = 0; i < barEls.length; i++) {
          barH = Math.max(barH, (barEls[i] as HTMLElement).getBoundingClientRect().height);
        }
      }

      // Per-day timed heights + the row gap / container padding / "+N more" line,
      // all from the hidden layer (full event stacks at the real column width).
      const layer = measureRef.current;
      const dayHeights: Record<string, number[]> = {};
      let rowGap = 0;
      let rowPadV = 0;
      let rowUnitPx = 0;
      let morePx = 0;
      if (layer) {
        const dayEls = layer.querySelectorAll('[data-measure-day]');
        let minRow = Infinity;
        for (let i = 0; i < dayEls.length; i++) {
          const el = dayEls[i] as HTMLElement;
          const date = el.getAttribute('data-measure-day') ?? '';
          const rows = el.querySelectorAll('[data-event-row]');
          const hs: number[] = [];
          for (let j = 0; j < rows.length; j++) {
            const h = Math.round((rows[j] as HTMLElement).getBoundingClientRect().height);
            hs.push(h);
            if (h > 0) minRow = Math.min(minRow, h);
          }
          dayHeights[date] = hs;
          if (rowGap === 0 && rows.length >= 2) {
            const r0 = (rows[0] as HTMLElement).getBoundingClientRect();
            const r1 = (rows[1] as HTMLElement).getBoundingClientRect();
            rowGap = Math.max(0, Math.round(r1.top - r0.top - r0.height));
          }
        }
        if (dayEls[0]) {
          const cs = getComputedStyle(dayEls[0] as HTMLElement);
          rowPadV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        }
        rowUnitPx = Number.isFinite(minRow) ? minRow : 0;
        const moreEl = layer.querySelector('[data-more-sample]') as HTMLElement | null;
        if (moreEl) morePx = Math.round(moreEl.getBoundingClientRect().height);
      }
      if (!morePx) morePx = 18;
      if (!rowPadV) rowPadV = 8;

      if (availH && headerH) {
        const sig = [
          Math.round(availH),
          Math.round(headerH),
          rowGap,
          Math.round(rowPadV),
          morePx,
          rowUnitPx,
          Math.round(barH),
          barGap,
          Math.round(bandPadV),
          JSON.stringify(dayHeights),
        ].join('|');
        if (sig !== sigRef.current) {
          sigRef.current = sig;
          setMetrics({
            availH,
            headerH,
            rowGap,
            rowPadV,
            rowUnitPx,
            morePx,
            barH,
            barGap,
            bandPadV,
            dayHeights,
          });
        }
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
    // gridRef/measureRef are stable useRef objects, so the real triggers are the
    // three below: a new day range, a new set of rendered events, or a zone
    // change that rewrites every time label (and so every row height).
  }, [gridRef, measureRef, days, visibleEvents, timezone]);

  return metrics;
}

/** Height a cell reserves at the top for `lanes` all-day band rows. Fed a
 * per-column lane count, not the per-week max — so a day no bar touches (0)
 * reserves nothing and hands that space back to its timed stack. */
export function bandHeightFor(m: GridMetrics, lanes: number): number {
  return lanes > 0 ? m.bandPadV + lanes * m.barH + (lanes - 1) * m.barGap : 0;
}

/** How tall a full, uncropped stack of `hs` rows renders. */
export function stackHeight(m: GridMetrics, hs: number[]): number {
  return hs.length
    ? m.rowPadV + hs.reduce((a, b) => a + b, 0) + (hs.length - 1) * m.rowGap
    : m.rowPadV;
}

/**
 * How many of `hs` fit in `innerPx` (a cell's height below its header and band).
 * When not all fit, a line is reserved for "+N more" so the count never sits on
 * top of a clipped row.
 */
export function fitCount(m: GridMetrics, hs: number[], innerPx: number): number {
  const avail = innerPx - m.rowPadV;
  if (avail <= 0 || hs.length === 0) return 0;
  let full = 0;
  for (let i = 0; i < hs.length; i++) full += hs[i] + (i > 0 ? m.rowGap : 0);
  if (full <= avail) return hs.length;
  let used = 0;
  let count = 0;
  for (let i = 0; i < hs.length; i++) {
    const add = hs[i] + (count > 0 ? m.rowGap : 0);
    if (used + add + m.rowGap + m.morePx <= avail) {
      used += add;
      count += 1;
    } else break;
  }
  return count;
}
