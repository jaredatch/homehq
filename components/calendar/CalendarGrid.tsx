'use client';

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react';
import WeekRow from './WeekRow';
import {
  assignEventsToDays,
  chunkWeeks,
  computeWeekSegments,
  formatLocalDate,
  formatSyncLabel,
  generateRollingDays,
  startOfWeek,
  weekdayLabels,
  type CalendarEvent,
  type SyncStatus,
  type WeekStart,
} from './calendar-utils';

interface CalendarGridProps {
  calendars: { id: string; name: string; color: string; textColor?: string }[];
  weeks: number;
  weekStartsOn: WeekStart;
}

const POLL_INTERVAL_MS = 60_000;

// useLayoutEffect on the client (measure before paint, no flash); useEffect on
// the server, where it no-ops anyway — sidesteps the SSR warning.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

interface GridMetrics {
  availH: number; // calendar grid's usable height
  headerH: number; // a day cell's date-header height
  rowH: number; // a single timed-event row's height
  rowPitch: number; // timed row-to-row distance (height + inter-row gap)
  rowPadV: number; // timed events container's top+bottom padding
  barH: number; // an all-day band bar's height
  barGap: number; // gap between band slots
  bandPadV: number; // band container's top+bottom padding
}

export default function CalendarGrid({ calendars, weeks, weekStartsOn }: CalendarGridProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [sync, setSync] = useState<SyncStatus>({
    lastSuccess: null,
    lastAttempt: null,
    lastError: null,
  });
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState(() => formatLocalDate(new Date()));
  const gridRef = useRef<HTMLDivElement>(null);
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
    const currentToday = formatLocalDate(new Date());
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
  }, [totalDays, weekStartsOn]);

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
  const slotCounts = useMemo(() => weekSegments.map((w) => w.slotCount), [weekSegments]);

  const labels = useMemo(() => weekdayLabels(weekStartsOn), [weekStartsOn]);

  // Measure the calendar's available height plus the (uniform) header, timed-row,
  // and band-bar sizes, so rows can be sized and overflow cropped in JS. Re-runs
  // on resize and whenever the rendered events change.
  useIsoLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const measure = () => {
      const availH = grid.clientHeight;
      const headerEl = grid.querySelector('[data-day-header]') as HTMLElement | null;
      const headerH = headerEl?.getBoundingClientRect().height ?? 0;

      const containers = grid.querySelectorAll('[data-events]');
      let rowPadV = 0;
      if (containers[0]) {
        const cs = getComputedStyle(containers[0] as HTMLElement);
        rowPadV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      }

      // Timed rows aren't perfectly uniform, so size to the TALLEST — a protected
      // day must never clip. Gap is the constant inter-row margin (space-y-1.5).
      const rowEls = grid.querySelectorAll('[data-event-row]');
      let rowH = 0;
      for (let i = 0; i < rowEls.length; i++) {
        rowH = Math.max(rowH, (rowEls[i] as HTMLElement).getBoundingClientRect().height);
      }
      let rowGap = 0;
      for (let i = 0; i < containers.length; i++) {
        const rows = containers[i].querySelectorAll('[data-event-row]');
        if (rows.length >= 2) {
          const r0 = (rows[0] as HTMLElement).getBoundingClientRect();
          const r1 = (rows[1] as HTMLElement).getBoundingClientRect();
          rowGap = Math.max(0, r1.top - r0.top - r0.height);
          break;
        }
      }
      const rowPitch = rowH + rowGap;

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

      if (availH && headerH && rowH) {
        setMetrics((prev) =>
          prev &&
          prev.availH === availH &&
          prev.headerH === headerH &&
          prev.rowH === rowH &&
          prev.rowPitch === rowPitch &&
          prev.rowPadV === rowPadV &&
          prev.barH === barH &&
          prev.barGap === barGap &&
          prev.bandPadV === bandPadV
            ? prev
            : { availH, headerH, rowH, rowPitch, rowPadV, barH, barGap, bandPadV }
        );
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [days, events]);

  // Space policy: today + the remaining days of THIS week always show every
  // event (they set the current-week height); past days and later weeks crop
  // their timed lists with "+N more". All-day bands are always shown in full.
  const layout = useMemo(() => {
    if (!metrics) return null;
    const { availH, headerH, rowH, rowPitch, rowPadV, barH, barGap, bandPadV } = metrics;
    const rowGap = Math.max(0, rowPitch - rowH);

    const timedHeightFor = (n: number) => rowPadV + (n > 0 ? n * rowH + (n - 1) * rowGap : 0);
    const bandHeightFor = (slots: number) =>
      slots > 0 ? bandPadV + slots * barH + (slots - 1) * barGap : 0;
    const capTimedFor = (cellPx: number, slots: number) => {
      const inner = cellPx - headerH - bandHeightFor(slots) - rowPadV;
      if (inner < rowH) return 0;
      return Math.floor((inner + rowGap) / rowPitch);
    };

    // Busiest protected day sets the current-week timed height.
    let protectedTimedMax = 0;
    (weeksOfDays[0] ?? []).forEach((date) => {
      if (date >= today) {
        protectedTimedMax = Math.max(protectedTimedMax, timedByDay.get(date)?.length ?? 0);
      }
    });
    const currSlots = slotCounts[0] ?? 0;

    // Current week: header + its full all-day band + enough rows for its busiest
    // protected day (floored at ~2 rows, 2px subpixel buffer), capped at the grid.
    const currentWeekPx = Math.min(
      Math.ceil(
        Math.max(
          headerH + bandHeightFor(currSlots) + timedHeightFor(protectedTimedMax),
          headerH + bandHeightFor(currSlots) + timedHeightFor(2)
        ) + 4
      ),
      availH
    );
    const laterWeeks = Math.max(0, weeks - 1);
    const laterWeekPx = laterWeeks > 0 ? Math.max(0, availH - currentWeekPx) / laterWeeks : 0;

    // Each later week's timed capacity depends on its own band height.
    const capLater = slotCounts.map((slots, wi) =>
      wi === 0 ? Infinity : capTimedFor(laterWeekPx, slots)
    );
    const capPastCurrent = capTimedFor(currentWeekPx, currSlots);

    return {
      gridRows: `${currentWeekPx}px repeat(${laterWeeks}, minmax(0, 1fr))`,
      capPastCurrent,
      capLater,
    };
  }, [metrics, weeksOfDays, slotCounts, timedByDay, today, weeks]);

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
        className="grid min-h-0 flex-1 gap-px bg-gray-800"
        style={{ gridTemplateRows: layout?.gridRows ?? `repeat(${weeks}, minmax(0, 1fr))` }}
      >
        {weeksOfDays.map((weekDays, wi) => {
          const { segments, slotCount } = weekSegments[wi];
          const capacities = weekDays.map((date) => {
            if (!layout) return Infinity;
            if (wi === 0) return date < today ? layout.capPastCurrent : Infinity;
            return layout.capLater[wi];
          });
          return (
            <WeekRow
              key={weekDays[0]}
              weekDays={weekDays}
              weekIndex={wi}
              today={today}
              segments={segments}
              slotCount={slotCount}
              timedByDay={timedByDay}
              colorMap={colorMap}
              capacities={capacities}
            />
          );
        })}
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
