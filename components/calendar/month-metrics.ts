'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { AllDaySegment, CalendarEvent } from './calendar-utils';

/**
 * Month view's unit heights and the capacity arithmetic built on them, shared by
 * the family board's month grid and the personal board's full-screen month.
 *
 * Unlike the week grid, this is NOT a per-event measurement layer: it is a
 * handful of constants read once from three hidden sample elements. Chips are
 * uniform single lines, so how many fit in a cell is arithmetic. If this ever
 * starts wanting per-event heights, the design has drifted — month view is
 * tractable precisely because it refuses that problem (CLAUDE.md).
 */

export interface MonthMetrics {
  cellH: number; // a day cell's content height (everything below the date header)
  chipH: number; // one timed chip
  chipGap: number; // gap between chips in a stack
  moreH: number; // the "N more" line, reserved whenever a cell crops
  barH: number; // one all-day band bar
  barGap: number; // gap between band slots
  bandPadV: number; // band container's top + bottom padding
}

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Read the unit heights from the hidden samples inside `gridRef`.
 *
 * Every cell is the same size (fixed rows, each 1fr), so one cell body is
 * representative — and because the cell clips its content, its height never
 * depends on how many chips it holds. That breaks any
 * measure→relayout→measure loop before it can start.
 */
export function useMonthGridMetrics(
  gridRef: RefObject<HTMLDivElement | null>,
  days: string[]
): MonthMetrics | null {
  const [metrics, setMetrics] = useState<MonthMetrics | null>(null);
  const sigRef = useRef<string>('');

  useIsoLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const measure = () => {
      const body = grid.querySelector('[data-mon-body]') as HTMLElement | null;
      const chip = grid.querySelector('[data-mon-sample-chip]') as HTMLElement | null;
      const more = grid.querySelector('[data-mon-sample-more]') as HTMLElement | null;
      const stack = grid.querySelector('[data-mon-sample-stack]') as HTMLElement | null;
      const bandBox = grid.querySelector('[data-mon-sample-band]') as HTMLElement | null;
      const bar = grid.querySelector('[data-mon-sample-bar]') as HTMLElement | null;
      if (!body || !chip || !more || !stack || !bandBox || !bar) return;

      const stackCs = getComputedStyle(stack);
      const bandCs = getComputedStyle(bandBox);

      const next: MonthMetrics = {
        cellH: body.clientHeight,
        chipH: chip.getBoundingClientRect().height,
        chipGap: parseFloat(stackCs.rowGap) || 0,
        moreH: more.getBoundingClientRect().height,
        barH: bar.getBoundingClientRect().height,
        barGap: parseFloat(bandCs.rowGap) || 0,
        bandPadV: parseFloat(bandCs.paddingTop) + parseFloat(bandCs.paddingBottom),
      };
      if (!next.cellH || !next.chipH) return;

      const sig = Object.values(next)
        .map((v) => Math.round(v * 100))
        .join('|');
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setMetrics(next);
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
    // gridRef is a stable useRef object; a new day range is the real trigger.
  }, [gridRef, days]);

  return metrics;
}

/**
 * How many chips each day shows.
 *
 * Pure arithmetic: a cell's usable height minus its OWN column's band
 * reservation (per-column, like the wall — a day no all-day bar touches
 * reserves nothing and spends the room on chips), divided by the uniform chip
 * row. When anything is cropped, a line is reserved for "N more" so the count
 * never sits on top of a clipped chip.
 */
export function monthCapacityByDay(
  metrics: MonthMetrics,
  weeksOfDays: string[][],
  weekSegments: { segments: AllDaySegment[]; slotCount: number; laneByColumn: number[] }[],
  timedByDay: Map<string, CalendarEvent[]>
): Record<string, number> {
  const { cellH, chipH, chipGap, moreH, barH, barGap, bandPadV } = metrics;

  const bandHeightFor = (lanes: number) =>
    lanes > 0 ? bandPadV + lanes * barH + (lanes - 1) * barGap : 0;

  // n chips occupy n*chipH + (n-1)*chipGap, so n ≤ (avail + chipGap) / (chipH + chipGap).
  const packed = (avail: number) => Math.floor((avail + chipGap) / (chipH + chipGap));

  const out: Record<string, number> = {};
  weeksOfDays.forEach((weekDays, wi) => {
    const lanes = weekSegments[wi].laneByColumn;
    weekDays.forEach((date, col) => {
      const total = (timedByDay.get(date) ?? []).length;
      const avail = cellH - bandHeightFor(lanes[col] ?? 0);
      if (total === 0 || avail <= 0) {
        out[date] = 0;
        return;
      }
      if (packed(avail) >= total) {
        out[date] = total;
        return;
      }
      // Cropping — give the "N more" line its own row plus the gap above it.
      out[date] = Math.max(0, Math.min(total, packed(avail - moreH - chipGap)));
    });
  });
  return out;
}
