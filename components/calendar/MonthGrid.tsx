'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import MonthWeek from './MonthWeek';
import {
  addDays,
  assignEventsToDays,
  chunkWeeks,
  computeWeekSegments,
  formatSyncLabel,
  todayInZone,
  weekdayLabels,
  type CalendarEvent,
  type SyncStatus,
  type WeekStart,
} from './calendar-utils';
import { addMonths, monthGridDays, monthLabel, monthOf } from './month-utils';

interface MonthGridProps {
  calendars: { id: string; name: string; color: string; textColor?: string }[];
  weekStartsOn: WeekStart;
  /** IANA zone for "today" + event times. Undefined = browser-local. */
  timezone?: string;
  /** Today's marker color (any CSS color). */
  todayColor: string;
  /** Leave month view — back to the wall's week grid. Wired to the header
   * button and Esc; CalendarView flips viewMode back to 'week'. */
  onExit: () => void;
}

const POLL_INTERVAL_MS = 60_000;

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * The unit heights month view needs. Unlike the wall grid, this is a handful of
 * constants read once from three hidden sample elements — NOT a per-event
 * measurement layer. Chips are uniform single lines, so how many fit in a cell
 * is arithmetic. If this ever starts wanting per-event heights, the design has
 * drifted: month view is tractable precisely because it refuses that problem.
 */
interface MonthMetrics {
  cellH: number; // a day cell's content height (everything below the date header)
  chipH: number; // one timed chip
  chipGap: number; // gap between chips in a stack
  moreH: number; // the "N more" line, reserved whenever a cell crops
  barH: number; // one all-day band bar
  barGap: number; // gap between band slots
  bandPadV: number; // band container's top + bottom padding
}

export default function MonthGrid({
  calendars,
  weekStartsOn,
  timezone,
  todayColor,
  onExit,
}: MonthGridProps) {
  // The month being shown. Owned here, never persisted — month view itself is
  // ephemeral (CalendarView unmounts it on exit), so a fresh entry always
  // starts at the current month.
  const [month, setMonth] = useState(() => monthOf(todayInZone(timezone)));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [sync, setSync] = useState<SyncStatus>({
    lastSuccess: null,
    lastAttempt: null,
    lastError: null,
  });
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState(() => todayInZone(timezone));
  const [metrics, setMetrics] = useState<MonthMetrics | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const sigRef = useRef<string>('');

  const days = useMemo(() => monthGridDays(month, weekStartsOn), [month, weekStartsOn]);
  const weeksOfDays = useMemo(() => chunkWeeks(days), [days]);
  const labels = useMemo(() => weekdayLabels(weekStartsOn), [weekStartsOn]);

  const colorMap = useMemo(
    () => new Map(calendars.map((c) => [c.id, { color: c.color, textColor: c.textColor }])),
    [calendars]
  );

  const fetchEvents = useCallback(async () => {
    setToday(todayInZone(timezone));
    const start = days[0];
    const end = addDays(days[days.length - 1], 1);
    try {
      const res = await fetch(`/api/calendar?start=${start}&end=${end}`);
      if (!res.ok) return;
      const data = await res.json();
      setEvents(data.events);
      setSync(data.sync);
    } catch {
      // Keep existing data — resilience first.
    } finally {
      setLoading(false);
    }
  }, [days, timezone]);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  // Paging. Changing `month` recomputes `days`, which re-creates fetchEvents,
  // which the effect above re-runs — so a page turn fetches its range at once
  // instead of waiting out the poll interval.
  const goPrev = useCallback(() => setMonth((m) => addMonths(m, -1)), []);
  const goNext = useCallback(() => setMonth((m) => addMonths(m, 1)), []);
  const goToday = useCallback(() => setMonth(monthOf(todayInZone(timezone))), [timezone]);

  // Keyboard — there's a real keyboard at the wall, and scrubbing months is
  // this view's main verb: ←/→ page, T jumps to today, Esc leaves. Skipped
  // while typing in a field (Phase 4 opens EventModal inside this view) or
  // when a modifier is down (⌘← is the browser's own back).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      } else if (e.key === 't' || e.key === 'T') {
        goToday();
      } else if (e.key === 'Escape') {
        onExit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goPrev, goNext, goToday, onExit]);

  const dayEventsMap = useMemo(() => assignEventsToDays(events, days), [events, days]);
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

  // Read the unit heights. Every cell is the same size (6 fixed rows, each
  // 1fr), so one cell body is representative — and because the cell clips its
  // content, its height never depends on how many chips it holds. That breaks
  // any measure→relayout→measure loop before it can start.
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
  }, [days]);

  // How many chips each day shows. Pure arithmetic: a cell's usable height minus
  // its OWN column's band reservation (per-column, like the wall — a day no
  // all-day bar touches reserves nothing and spends the room on chips), divided
  // by the uniform chip row. When anything is cropped, a line is reserved for
  // "N more" so the count never sits on top of a clipped chip.
  const capacityByDay = useMemo(() => {
    if (!metrics) return null;
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
  }, [metrics, weeksOfDays, weekSegments, timedByDay]);

  const label = loading ? { text: 'Loading…', isError: false } : formatSyncLabel(sync);

  return (
    <div className="mon-root">
      {/* Persistent chrome — header stays at wall (rem) scale like the top bar,
          NOT the dense grid scale, so the month label reads across the room and
          the nav is a usable click target for someone at the trackpad. */}
      <div className="mon-header">
        <span className="mon-title">{monthLabel(month)}</span>
        <div className="mon-nav">
          <button type="button" onClick={goPrev} title="Previous month (←)" className="mon-nav-btn">
            ‹
          </button>
          <button type="button" onClick={goNext} title="Next month (→)" className="mon-nav-btn">
            ›
          </button>
          <button type="button" onClick={goToday} title="Jump to today (T)" className="mon-today">
            Today
          </button>
        </div>
        <button
          type="button"
          onClick={onExit}
          title="Back to the dashboard (Esc)"
          className="mon-back"
        >
          Back to dashboard
        </button>
      </div>

      {/* The one region that opts out of wall scale — see .mon-calendar. */}
      <div className="mon-calendar">
        <div className="mon-weekdays">
          {labels.map((l) => (
            <div key={l} className="mon-weekday">
              {l}
            </div>
          ))}
        </div>

        {/* Row count is dynamic (4–6) — enough weeks to cover the month, no
            trailing all-next-month row. Cells reflow to fill the height. */}
        <div
          ref={gridRef}
          className="mon-grid"
          style={{ gridTemplateRows: `repeat(${weeksOfDays.length}, minmax(0, 1fr))` }}
        >
          {weeksOfDays.map((weekDays, wi) => {
            const { segments, slotCount, laneByColumn } = weekSegments[wi];
            const capacities = weekDays.map((date) =>
              capacityByDay ? (capacityByDay[date] ?? Infinity) : Infinity
            );
            return (
              <MonthWeek
                key={weekDays[0]}
                weekDays={weekDays}
                month={month}
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

          {/* Hidden unit samples — three boxes, not a duplicate of the month. They
            give the layout a chip / "N more" / band-bar height (plus the gaps and
            band padding from their containers) without depending on what any real
            day happens to hold. Clipped by .mon-grid's overflow so they can never
            become scrollable overflow. */}
          <div aria-hidden className="mon-sample">
            <div className="mon-day-events" data-mon-sample-stack>
              <div className="mon-chip" data-mon-sample-chip>
                <span className="mon-chip-dot" />
                <span className="mon-chip-time">8am</span>
                <span className="mon-chip-title">Sample</span>
              </div>
              <div className="mon-more" data-mon-sample-more>
                0 more
              </div>
            </div>
            <div className="mon-band-reserve" data-mon-sample-band>
              <div className="mon-band-bar" data-mon-sample-bar>
                Sample
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mon-footer">
        <div className="mon-legend">
          {calendars.map((c) => (
            <span key={c.id} className="mon-legend-item">
              <span className="mon-legend-dot" style={{ backgroundColor: c.color }} aria-hidden />
              {c.name}
            </span>
          ))}
        </div>
        <span className={label.isError ? 'mon-sync--error' : 'mon-sync'}>{label.text}</span>
      </div>
    </div>
  );
}
