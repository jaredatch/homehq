'use client';

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react';
import WeekRow from './WeekRow';
import EventItem from './EventItem';
import {
  assignEventsToDays,
  chunkWeeks,
  computeWeekSegments,
  formatLocalDate,
  formatSyncLabel,
  generateRollingDays,
  startOfWeek,
  todayInZone,
  weekdayLabels,
  type CalendarEvent,
  type SyncStatus,
  type WeekStart,
} from './calendar-utils';

interface CalendarGridProps {
  calendars: { id: string; name: string; color: string; textColor?: string }[];
  weeks: number;
  weekStartsOn: WeekStart;
  /** IANA zone for "today" + event times. Undefined = browser-local. */
  timezone?: string;
  /** Today's accent dot color (any CSS color). */
  todayColor: string;
}

const POLL_INTERVAL_MS = 60_000;

// useLayoutEffect on the client (measure before paint, no flash); useEffect on
// the server, where it no-ops anyway — sidesteps the SSR warning.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

interface GridMetrics {
  availH: number; // calendar grid's usable height
  headerH: number; // a day cell's date-header height
  rowGap: number; // inter-row gap between timed events (space-y-1.5)
  rowPadV: number; // timed events container's top+bottom padding
  rowUnitPx: number; // representative single-line row height (floors the current week)
  morePx: number; // height of the "+N more" line, reserved when cropping
  barH: number; // an all-day band bar's height
  barGap: number; // gap between band slots
  bandPadV: number; // band container's top+bottom padding
  // Real per-day timed-row heights, in render order, from the hidden measurement
  // layer. Variable (1- vs 2-line titles) — measuring each beats assuming a
  // uniform row, which used to under-fill cells ("+5 more" with room for 2 more).
  dayHeights: Record<string, number[]>;
}

export default function CalendarGrid({
  calendars,
  weeks,
  weekStartsOn,
  timezone,
  todayColor,
}: CalendarGridProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [sync, setSync] = useState<SyncStatus>({
    lastSuccess: null,
    lastAttempt: null,
    lastError: null,
  });
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState(() => todayInZone(timezone));
  const gridRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const sigRef = useRef<string>('');
  const [metrics, setMetrics] = useState<GridMetrics | null>(null);

  // Footer calendar legend — on by default while the family learns the colors,
  // collapsible to a faint dot cluster once it's just noise. Choice persists.
  const [showLegend, setShowLegend] = useState(true);
  useEffect(() => {
    const stored = localStorage.getItem('homehq:legend');
    if (stored !== null) setShowLegend(stored === '1');
  }, []);
  const toggleLegend = useCallback(() => {
    setShowLegend((prev) => {
      const next = !prev;
      localStorage.setItem('homehq:legend', next ? '1' : '0');
      return next;
    });
  }, []);

  const totalDays = weeks * 7;

  const colorMap = useMemo(
    () => new Map(calendars.map((c) => [c.id, { color: c.color, textColor: c.textColor }])),
    [calendars]
  );

  const fetchEvents = useCallback(async () => {
    // Update today on each poll (handles midnight rollover)
    const currentToday = todayInZone(timezone);
    setToday(currentToday);

    // The grid is anchored to the start of the week, which can be a few days
    // before today — fetch from there so past days in the current week populate.
    const start = startOfWeek(currentToday, weekStartsOn);
    const [sy, sm, sd] = start.split('-').map(Number);
    const endDate = new Date(sy, sm - 1, sd);
    endDate.setDate(endDate.getDate() + totalDays);
    const end = formatLocalDate(endDate);

    try {
      const res = await fetch(`/api/calendar?start=${start}&end=${end}`);
      if (!res.ok) return;
      const data = await res.json();
      setEvents(data.events);
      setSync(data.sync);
    } catch {
      // Keep existing data — resilience first
    } finally {
      setLoading(false);
    }
  }, [totalDays, weekStartsOn, timezone]);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  const days = useMemo(
    () => generateRollingDays(startOfWeek(today, weekStartsOn), totalDays),
    [today, totalDays, weekStartsOn]
  );
  const weeksOfDays = useMemo(() => chunkWeeks(days), [days]);
  const dayEventsMap = useMemo(() => assignEventsToDays(events, days), [events, days]);

  // Timed events keyed by start day; all-day events are laid out separately as
  // spanning bars in each week's band.
  const timedByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const day of days) map.set(day, dayEventsMap.get(day)?.timed ?? []);
    return map;
  }, [days, dayEventsMap]);

  const allDayEvents = useMemo(() => events.filter((e) => e.all_day), [events]);
  const weekSegments = useMemo(
    () => weeksOfDays.map((w) => computeWeekSegments(allDayEvents, w)),
    [weeksOfDays, allDayEvents]
  );
  // Per-week, per-column band reservation — each day's own band height now varies
  // (a day no all-day event touches reserves nothing), so capacity is per-column.
  const laneByWeek = useMemo(() => weekSegments.map((w) => w.laneByColumn), [weekSegments]);

  const labels = useMemo(() => weekdayLabels(weekStartsOn), [weekStartsOn]);

  // Measure the grid's usable height and chrome (header/band) from the visible
  // grid, plus the REAL per-day timed-row heights from the hidden measurement
  // layer (which always renders every event, so heights are never truncated by
  // cropping). Re-runs on resize and whenever the rendered events change.
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
  }, [days, events, timezone]);

  // Space policy, by priority:
  //   1. today + later days of THIS week ("protected") always show every event,
  //      and their real content sets the current-week track height;
  //   2. next/later weeks get all the remaining height (maximize what they show);
  //   3. past days of the current week crop to whatever's left in the current
  //      week's track — lowest priority, so they never steal from next week.
  // Per-day visible counts come from greedy-packing the REAL row heights, so a
  // cell fills with as many events as actually fit. All-day bands always show.
  const layout = useMemo(() => {
    if (!metrics) return null;
    const {
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
    } = metrics;

    // Height a cell reserves at the top for `lanes` all-day band rows. Now fed a
    // per-column lane count, not the per-week max — so a day no bar touches (0)
    // reserves nothing and hands that space back to its timed stack.
    const bandHeightFor = (lanes: number) =>
      lanes > 0 ? bandPadV + lanes * barH + (lanes - 1) * barGap : 0;
    const stackHeight = (hs: number[]) =>
      hs.length ? rowPadV + hs.reduce((a, b) => a + b, 0) + (hs.length - 1) * rowGap : rowPadV;

    // How many of `hs` fit in `innerPx` (a cell's height below header+band).
    // When not all fit, reserve a line for "+N more".
    const fitCount = (hs: number[], innerPx: number): number => {
      const avail = innerPx - rowPadV;
      if (avail <= 0 || hs.length === 0) return 0;
      let full = 0;
      for (let i = 0; i < hs.length; i++) full += hs[i] + (i > 0 ? rowGap : 0);
      if (full <= avail) return hs.length;
      let used = 0;
      let count = 0;
      for (let i = 0; i < hs.length; i++) {
        const add = hs[i] + (count > 0 ? rowGap : 0);
        if (used + add + rowGap + morePx <= avail) {
          used += add;
          count += 1;
        } else break;
      }
      return count;
    };

    const week0 = weeksOfDays[0] ?? [];
    const lanes0 = laneByWeek[0] ?? [];

    // Priority 1: busiest protected day sets the current-week height — and its
    // band now counts per-column, since today's own all-day rows sit in its cell.
    let protectedPx = 0;
    week0.forEach((date, col) => {
      if (date >= today) {
        protectedPx = Math.max(
          protectedPx,
          bandHeightFor(lanes0[col] ?? 0) + stackHeight(dayHeights[date] ?? [])
        );
      }
    });
    // Keep the current week at least ~2 rows tall so it never collapses to a sliver.
    const floorPx = rowPadV + (rowUnitPx > 0 ? 2 * rowUnitPx + rowGap : 0);
    const currentWeekPx = Math.min(
      Math.ceil(headerH + Math.max(protectedPx, floorPx) + 6),
      availH
    );
    const laterWeeks = Math.max(0, weeks - 1);
    const laterWeekPx = laterWeeks > 0 ? Math.max(0, availH - currentWeekPx) / laterWeeks : 0;

    // Per-day visible counts. Protected days = all (Infinity); others greedily
    // packed into whatever's left below the header and that column's own band.
    const visibleByDay: Record<string, number> = {};
    week0.forEach((date, col) => {
      if (date >= today) {
        visibleByDay[date] = Infinity;
      } else {
        const inner = currentWeekPx - headerH - bandHeightFor(lanes0[col] ?? 0);
        visibleByDay[date] = fitCount(dayHeights[date] ?? [], inner);
      }
    });
    for (let wi = 1; wi < weeksOfDays.length; wi++) {
      const lanes = laneByWeek[wi] ?? [];
      weeksOfDays[wi].forEach((date, col) => {
        const inner = laterWeekPx - headerH - bandHeightFor(lanes[col] ?? 0);
        visibleByDay[date] = fitCount(dayHeights[date] ?? [], inner);
      });
    }

    return {
      gridRows: `${currentWeekPx}px repeat(${laterWeeks}, minmax(0, 1fr))`,
      visibleByDay,
    };
  }, [metrics, weeksOfDays, laneByWeek, today, weeks]);

  return (
    <div className="flex h-full flex-col">
      {/* Weekday header — shown once, so day cells don't repeat it per row */}
      <div className="grid shrink-0 grid-cols-7 gap-px bg-gray-800 pb-px">
        {labels.map((label) => (
          <div
            key={label}
            className="bg-gray-950 px-2 py-1.5 text-left text-sm font-semibold uppercase tracking-wider text-gray-500"
          >
            {label}
          </div>
        ))}
      </div>

      {/* Calendar grid — one WeekRow per row; 1px gaps separate weeks */}
      <div
        ref={gridRef}
        className="relative grid min-h-0 flex-1 gap-px bg-gray-800"
        style={{ gridTemplateRows: layout?.gridRows ?? `repeat(${weeks}, minmax(0, 1fr))` }}
      >
        {weeksOfDays.map((weekDays, wi) => {
          const { segments, slotCount, laneByColumn } = weekSegments[wi];
          const capacities = weekDays.map((date) =>
            layout ? (layout.visibleByDay[date] ?? Infinity) : Infinity
          );
          return (
            <WeekRow
              key={weekDays[0]}
              weekDays={weekDays}
              weekIndex={wi}
              today={today}
              segments={segments}
              slotCount={slotCount}
              laneByColumn={laneByColumn}
              timedByDay={timedByDay}
              colorMap={colorMap}
              capacities={capacities}
              timezone={timezone}
              todayColor={todayColor}
            />
          );
        })}

        {/* Hidden measurement layer — full (uncropped) event stacks at the real
            column width, so the layout can read true per-day heights no matter
            what the visible cells crop. Out of flow, so it adds no height. */}
        <div
          ref={measureRef}
          aria-hidden
          className="pointer-events-none invisible absolute inset-0 -z-10"
        >
          <div className="grid grid-cols-7 gap-px">
            {days.map((date) => (
              <div key={date} data-measure-day={date} className="space-y-1.5 px-1 py-1">
                {(timedByDay.get(date) ?? []).map((event) => (
                  <EventItem
                    key={`${event.event_id}-${event.calendar_id}`}
                    event={event}
                    color={colorMap.get(event.calendar_id)?.color ?? '#6b7280'}
                    timeZone={timezone}
                  />
                ))}
              </div>
            ))}
            <div data-more-sample className="px-2 pt-0.5 text-xs font-semibold text-gray-500">
              +0 more
            </div>
          </div>
        </div>
      </div>

      {/* Footer — calendar legend (left, toggleable) + sync indicator (right) */}
      {(() => {
        const label = loading ? { text: 'Loading…', isError: false } : formatSyncLabel(sync);
        return (
          <div className="flex shrink-0 items-center justify-between px-4 py-1 text-xs">
            {showLegend ? (
              <button
                type="button"
                onClick={toggleLegend}
                title="Hide calendar legend"
                className="flex items-center gap-3 text-gray-400 transition-colors hover:text-gray-200"
              >
                {calendars.map((c) => (
                  <span key={c.id} className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: c.color }}
                      aria-hidden
                    />
                    {c.name}
                  </span>
                ))}
              </button>
            ) : (
              <button
                type="button"
                onClick={toggleLegend}
                title="Show calendar legend"
                className="flex items-center gap-1 opacity-40 transition-opacity hover:opacity-100"
              >
                {calendars.map((c) => (
                  <span
                    key={c.id}
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: c.color }}
                    aria-hidden
                  />
                ))}
              </button>
            )}
            <span className={label.isError ? 'text-amber-500/90' : 'text-gray-600'}>
              {label.text}
            </span>
          </div>
        );
      })()}
    </div>
  );
}
