'use client';

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react';
import DayColumn from './DayColumn';
import {
  assignEventsToDays,
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
  calendars: { id: string; name: string; color: string }[];
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
  rowH: number; // a single event row's height
  pitch: number; // row-to-row distance (height + inter-row gap)
  padV: number; // events container's top+bottom padding
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

  const totalDays = weeks * 7;

  const colorMap = useMemo(() => new Map(calendars.map((c) => [c.id, c.color])), [calendars]);

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
  const dayEventsMap = useMemo(() => assignEventsToDays(events, days), [events, days]);

  const labels = useMemo(() => weekdayLabels(weekStartsOn), [weekStartsOn]);
  // Today always sits in the first week, so its column index is its offset from
  // the grid start — used to highlight the matching weekday header.
  const todayCol = days.indexOf(today);

  // Measure the calendar's available height plus the (uniform) header and event
  // row sizes, so rows can be sized and overflow cropped in JS. Re-runs on
  // resize and whenever the rendered events change.
  useIsoLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const measure = () => {
      // Fractional (getBoundingClientRect) rather than rounded (offsetHeight), so
      // sub-pixel row heights don't accumulate into a clip across many rows.
      const availH = grid.clientHeight;
      const headerEl = grid.querySelector('[data-day-header]') as HTMLElement | null;
      const headerH = headerEl?.getBoundingClientRect().height ?? 0;

      const containers = grid.querySelectorAll('[data-events]');
      let padV = 0;
      if (containers[0]) {
        const cs = getComputedStyle(containers[0] as HTMLElement);
        padV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      }

      // Event rows aren't perfectly uniform (all-day vs timed differ by ~1px), so
      // size to the TALLEST row — a protected day must never clip. Gap is the
      // constant inter-row margin, taken from any two adjacent rows.
      const rowEls = grid.querySelectorAll('[data-event-row]');
      let rowH = 0;
      for (let i = 0; i < rowEls.length; i++) {
        rowH = Math.max(rowH, (rowEls[i] as HTMLElement).getBoundingClientRect().height);
      }
      let gap = 0;
      for (let i = 0; i < containers.length; i++) {
        const rows = containers[i].querySelectorAll('[data-event-row]');
        if (rows.length >= 2) {
          const r0 = (rows[0] as HTMLElement).getBoundingClientRect();
          const r1 = (rows[1] as HTMLElement).getBoundingClientRect();
          gap = Math.max(0, r1.top - r0.top - r0.height);
          break;
        }
      }
      const pitch = rowH + gap;

      if (availH && headerH && rowH) {
        setMetrics((prev) =>
          prev &&
          prev.availH === availH &&
          prev.headerH === headerH &&
          prev.rowH === rowH &&
          prev.pitch === pitch &&
          prev.padV === padV
            ? prev
            : { availH, headerH, rowH, pitch, padV }
        );
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [days, events]);

  // Space policy: today + the remaining days of THIS week always show every
  // event (they set the current-week row height); past days and later weeks
  // crop with "+N more".
  const layout = useMemo(() => {
    if (!metrics) return null;
    const { availH, headerH, rowH, pitch, padV } = metrics;
    const gap = Math.max(0, pitch - rowH);

    // Exact pixel height a cell needs to show n event rows, and the inverse:
    // how many rows fit in a given cell height.
    const heightFor = (n: number) => headerH + padV + (n > 0 ? n * rowH + (n - 1) * gap : 0);
    const capFor = (px: number) => {
      const inner = px - headerH - padV;
      return inner < rowH ? 0 : Math.floor((inner + gap) / pitch);
    };

    let protectedMax = 0;
    days.forEach((date, i) => {
      if (i < 7 && date >= today) {
        const dd = dayEventsMap.get(date);
        if (dd) protectedMax = Math.max(protectedMax, dd.allDay.length + dd.timed.length);
      }
    });

    // Current week is exactly tall enough for its busiest protected day (with a
    // 2px buffer so subpixel rounding can never clip it), floored at ~2 rows and
    // capped at the whole grid (then later weeks collapse — an accepted extreme).
    const currentWeekPx = Math.min(
      Math.ceil(Math.max(heightFor(protectedMax), heightFor(2)) + 4),
      availH
    );
    const laterWeeks = Math.max(0, weeks - 1);
    const laterWeekPx = laterWeeks > 0 ? Math.max(0, availH - currentWeekPx) / laterWeeks : 0;

    return {
      gridRows: `${currentWeekPx}px repeat(${laterWeeks}, minmax(0, 1fr))`,
      capCurrent: capFor(currentWeekPx),
      capLater: capFor(laterWeekPx),
    };
  }, [metrics, days, dayEventsMap, today, weeks]);

  return (
    <div className="flex h-full flex-col">
      {/* Weekday header — shown once, so day cells don't repeat it per row */}
      <div className="grid shrink-0 grid-cols-7 gap-px bg-gray-800 pb-px">
        {labels.map((label, i) => (
          <div
            key={label}
            className={`bg-gray-950 py-1.5 text-center text-sm font-semibold uppercase tracking-wider ${
              i === todayCol ? 'text-blue-300' : 'text-gray-500'
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div
        ref={gridRef}
        className="grid min-h-0 flex-1 grid-cols-7 gap-px bg-gray-800"
        style={{ gridTemplateRows: layout?.gridRows ?? `repeat(${weeks}, minmax(0, 1fr))` }}
      >
        {days.map((date, index) => {
          const dayData = dayEventsMap.get(date)!;
          const isPast = date < today;
          const inCurrentWeek = index < 7;
          // Today + the rest of this week never crop; past days and later weeks do.
          const capacity = !layout
            ? Infinity
            : inCurrentWeek
              ? isPast
                ? layout.capCurrent
                : Infinity
              : layout.capLater;
          return (
            <DayColumn
              key={date}
              date={date}
              isToday={date === today}
              isPast={isPast}
              showMonth={index === 0 || date.slice(8, 10) === '01'}
              allDayEvents={dayData.allDay}
              timedEvents={dayData.timed}
              colorMap={colorMap}
              capacity={capacity}
            />
          );
        })}
      </div>

      {/* Sync indicator */}
      {(() => {
        const label = loading ? { text: 'Loading\u2026', isError: false } : formatSyncLabel(sync);
        return (
          <div
            className={`shrink-0 px-4 py-1 text-right text-xs ${
              label.isError ? 'text-amber-500/90' : 'text-gray-600'
            }`}
          >
            {label.text}
          </div>
        );
      })()}
    </div>
  );
}
