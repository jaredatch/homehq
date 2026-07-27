'use client';

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react';
import WeekRow from './WeekRow';
import EventItem from './EventItem';
import EventModal, { type EditableEvent } from './EventModal';
import CalendarFooter from './CalendarFooter';
import { useCalendarFilter, filterEvents } from './calendar-filter';
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
  /** How long "expand next week" stays up before auto-reverting to the current
   * week (ms). 0 disables auto-revert. From config.display.expandResetSeconds. */
  expandResetMs: number;
  /** Whether event creation is on (config.google.calendarAccess === "readwrite").
   * Gates the "+ Add event" button + modal. */
  calendarWriteEnabled: boolean;
  /** How long the "Add event" modal stays open with no interaction before it
   * auto-closes (ms). 0 disables. From config.display.createFormResetSeconds. */
  createFormResetMs: number;
  /** Build token this page was served by; the grid hard-reloads when the server
   * later reports a different one (a deploy or a manual kiosk-reload). */
  appVersion: string;
  /** Opens month view (a footer button beside the other controls). Optional so
   * the grid itself stays view-agnostic — CalendarView owns the mode switch;
   * without it the footer renders exactly as before month view existed. */
  onMonthClick?: () => void;
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
  expandResetMs,
  calendarWriteEnabled,
  createFormResetMs,
  appVersion,
  onMonthClick,
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

  // Per-person filter (shared across views, empty = show all). When empty this
  // returns the SAME `events` reference below, so the default wall render is
  // byte-for-byte unchanged.
  const filter = useCalendarFilter();

  // "Expand next week" — flips the layout priority so next week shows every
  // event and the current week crops to the remaining space. Ephemeral on
  // purpose (no persistence): the always-on wall kiosk must never boot stuck in
  // this mode, and a reload always returns to the default current-week view.
  const [expanded, setExpanded] = useState(false);
  // Clicking a day's "+N more" toggles the expand state by week: a next-week
  // (week ≥ 1) "+N more" expands next week; a current-week (week 0) one returns
  // to the normal view. Pairs with the footer toggle.
  const handleMoreClick = useCallback((weekIndex: number) => {
    setExpanded(weekIndex !== 0);
  }, []);

  // Auto-revert: the current week is the default, most-important view, so a peek
  // at next week must never stick on the always-on wall. A fresh timer starts
  // whenever `expanded` turns true; collapsing (via the toggle or a current-week
  // "+N more") trips the cleanup and clears it. If still expanded when the timer
  // fires, snap back to the current week. Re-expanding restarts the clock, so it
  // can never get stuck. 0 disables (config.display.expandResetSeconds = 0).
  useEffect(() => {
    if (!expanded || expandResetMs <= 0) return;
    const t = setTimeout(() => setExpanded(false), expandResetMs);
    return () => clearTimeout(t);
  }, [expanded, expandResetMs]);

  // Event modal — ephemeral (like the expand toggle), so the wall never boots
  // with a form open. null = closed; otherwise create (blank) or edit (a clicked
  // event). Clicking an event opens edit; "+ Add event" opens create.
  const [modal, setModal] = useState<
    { mode: 'create' } | { mode: 'edit'; event: EditableEvent } | null
  >(null);
  // Only wire click-to-edit when writes are on — read-only deployments leave
  // events inert (byte-identical to before this feature).
  const handleEventClick = useCallback(
    (event: CalendarEvent) => {
      if (calendarWriteEnabled) setModal({ mode: 'edit', event });
    },
    [calendarWriteEnabled]
  );

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

  // Self-update: poll the deployed build token and hard-reload when it changes,
  // so a deploy (or a manual kiosk-reload) reaches the wall display without
  // touching the Pi. Loop-proof — the reloaded page is re-served with the new
  // token as its baseline, so it matches and settles. We never reload on a fetch
  // error (a network blip must not bounce the kiosk), and the first check waits
  // one interval so a fresh load always settles before any reload can fire.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const { version } = await res.json();
        if (!cancelled && version && version !== appVersion) {
          window.location.reload();
        }
      } catch {
        // Offline/transient — keep showing the current bundle.
      }
    };
    const interval = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [appVersion]);

  const days = useMemo(
    () => generateRollingDays(startOfWeek(today, weekStartsOn), totalDays),
    [today, totalDays, weekStartsOn]
  );
  const weeksOfDays = useMemo(() => chunkWeeks(days), [days]);

  // Narrow to the filtered calendars. Empty filter → the same array reference,
  // so every downstream memo (and the measurement layer) is identical to today.
  const visibleEvents = useMemo(() => filterEvents(events, filter), [events, filter]);
  const dayEventsMap = useMemo(
    () => assignEventsToDays(visibleEvents, days),
    [visibleEvents, days]
  );

  // Timed events keyed by start day; all-day events are laid out separately as
  // spanning bars in each week's band.
  const timedByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const day of days) map.set(day, dayEventsMap.get(day)?.timed ?? []);
    return map;
  }, [days, dayEventsMap]);

  const allDayEvents = useMemo(() => visibleEvents.filter((e) => e.all_day), [visibleEvents]);
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
  }, [days, visibleEvents, timezone]);

  // Space policy, by priority:
  //   1. the "protected" days of the ANCHOR week always show every event, and
  //      their real content sets the anchor week's track height;
  //   2. every other week gets an even share of the remaining height (maximize
  //      what it shows);
  //   3. non-protected days of the anchor week crop to whatever's left in its
  //      track — lowest priority, so they never steal from the other weeks.
  // The anchor is the current week by default (protected = today-onward). When
  // "Expand next week" is on, the anchor becomes next week — and because all of
  // next week is in the future, the SAME `date >= today` predicate protects the
  // whole row, while the current week falls to a remaining-height share that
  // crops behind "+N more".
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

    // Which week is maximized. Default = current week (0); "Expand next week"
    // moves the anchor to week 1 (guarded so it can't point past the grid).
    const anchorWeek = expanded ? Math.min(1, weeksOfDays.length - 1) : 0;
    const anchorDays = weeksOfDays[anchorWeek] ?? [];
    const anchorLanes = laneByWeek[anchorWeek] ?? [];

    // Priority 1: busiest protected day sets the anchor week's height — its band
    // counts per-column, since a protected day's own all-day rows sit in its cell.
    let protectedPx = 0;
    anchorDays.forEach((date, col) => {
      if (date >= today) {
        protectedPx = Math.max(
          protectedPx,
          bandHeightFor(anchorLanes[col] ?? 0) + stackHeight(dayHeights[date] ?? [])
        );
      }
    });
    // Keep a week at least ~2 rows tall so it never collapses to a sliver.
    const floorPx = rowPadV + (rowUnitPx > 0 ? 2 * rowUnitPx + rowGap : 0);
    const otherWeeks = Math.max(0, weeks - 1);
    // In expanded mode the de-prioritized weeks keep a readable floor, so a very
    // busy next week can't swallow the whole screen. Default mode is unchanged —
    // the protected current week may still take up to the full height.
    const minOtherPx = expanded && otherWeeks > 0 ? otherWeeks * (headerH + floorPx) : 0;
    const maxAnchorPx = Math.max(0, availH - minOtherPx);
    const anchorPx = Math.min(Math.ceil(headerH + Math.max(protectedPx, floorPx) + 6), maxAnchorPx);
    const otherWeekPx = otherWeeks > 0 ? Math.max(0, availH - anchorPx) / otherWeeks : 0;

    // Per-day visible counts. Protected days (anchor week, today-onward) = all
    // (Infinity); every other day greedily packs into whatever its track leaves
    // below the header and that column's own band.
    const visibleByDay: Record<string, number> = {};
    weeksOfDays.forEach((weekDays, wi) => {
      const isAnchor = wi === anchorWeek;
      const trackPx = isAnchor ? anchorPx : otherWeekPx;
      const lanes = laneByWeek[wi] ?? [];
      weekDays.forEach((date, col) => {
        if (isAnchor && date >= today) {
          visibleByDay[date] = Infinity;
        } else {
          const inner = trackPx - headerH - bandHeightFor(lanes[col] ?? 0);
          visibleByDay[date] = fitCount(dayHeights[date] ?? [], inner);
        }
      });
    });

    return {
      gridRows: weeksOfDays
        .map((_, wi) => (wi === anchorWeek ? `${anchorPx}px` : 'minmax(0, 1fr)'))
        .join(' '),
      visibleByDay,
    };
  }, [metrics, weeksOfDays, laneByWeek, today, weeks, expanded]);

  return (
    <div className="cal-grid">
      {/* Weekday header — shown once, so day cells don't repeat it per row */}
      <div className="cal-weekdays">
        {labels.map((label) => (
          <div key={label} className="cal-weekday">
            {label}
          </div>
        ))}
      </div>

      {/* Calendar grid — one WeekRow per row; 1px gaps separate weeks */}
      <div
        ref={gridRef}
        className="cal-weeks"
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
              onMoreClick={handleMoreClick}
              onEventClick={calendarWriteEnabled ? handleEventClick : undefined}
            />
          );
        })}

        {/* Hidden measurement layer — full (uncropped) event stacks at the real
            column width, so the layout can read true per-day heights no matter
            what the visible cells crop. Out of flow, so it adds no height. */}
        <div ref={measureRef} aria-hidden className="cal-measure">
          <div className="cal-measure-grid">
            {days.map((date) => (
              <div key={date} data-measure-day={date} className="cal-day-events">
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
            <div data-more-sample className="cal-more">
              +0 more
            </div>
          </div>
        </div>
      </div>

      {/* Footer — shared across views (CalendarFooter): legend, view switch,
          + Add event, then this view's expand toggle trailing last. */}
      <CalendarFooter
        calendars={calendars}
        viewLabel="View Month"
        viewTitle="Open the month view"
        onViewClick={onMonthClick}
        onAddClick={calendarWriteEnabled ? () => setModal({ mode: 'create' }) : undefined}
        sync={loading ? { text: 'Loading…', isError: false } : formatSyncLabel(sync)}
      >
        {weeks > 1 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            title={
              expanded ? 'Show the current week in full' : 'Expand next week to show all its events'
            }
            aria-pressed={expanded}
            className="cal-expand"
          >
            {expanded ? '‹ Current week' : 'Expand next week ›'}
          </button>
        )}
      </CalendarFooter>

      {calendarWriteEnabled && modal && (
        <EventModal
          key={
            modal.mode === 'edit' ? `${modal.event.event_id}-${modal.event.calendar_id}` : 'create'
          }
          mode={modal.mode}
          event={modal.mode === 'edit' ? modal.event : undefined}
          calendars={calendars}
          timezone={timezone}
          defaultDate={today}
          resetMs={createFormResetMs}
          onClose={() => setModal(null)}
          onSaved={fetchEvents}
        />
      )}
    </div>
  );
}
