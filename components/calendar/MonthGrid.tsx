'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CalendarFooter from './CalendarFooter';
import { useCalendarFilter, filterEvents, scopeToCalendars } from './calendar-filter';
import EventModal, { type EditableEvent } from './EventModal';
import { calendarIdsForEvent, isMembershipLocked, mergeGroups } from './event-groups';
import MonthDayPopover from './MonthDayPopover';
import MonthWeek from './MonthWeek';
import { monthCapacityByDay, useMonthGridMetrics } from './month-metrics';
import type { TitleIconSet } from '@/lib/calendar/title-rules';
import {
  addDays,
  assignEventsToDays,
  chunkWeeks,
  bandEvents,
  computeWeekSegments,
  formatSyncLabel,
  todayInZone,
  weekdayLabels,
  type CalendarEvent,
  type SyncStatus,
  type WeekStart,
} from './calendar-utils';
import {
  addMonths,
  monthCreateDate,
  monthGridDays,
  monthLabel,
  monthOf,
  popoverLayout,
  type PopoverBox,
} from './month-utils';

interface MonthGridProps {
  calendars: { id: string; name: string; color: string; textColor?: string }[];
  weekStartsOn: WeekStart;
  /** IANA zone for "today" + event times. Undefined = browser-local. */
  timezone?: string;
  /** Today's marker color (any CSS color). */
  todayColor: string;
  /** Whether event writes are on (config.google.calendarAccess === "readwrite").
   * Gates click-to-edit and empty-day create, exactly like the wall — in
   * readonly, events are inert and only the day popover (a read surface) works. */
  calendarWriteEnabled: boolean;
  /** EventModal's inactivity auto-close (ms). 0 disables. */
  createFormResetMs: number;
  /** Leave month view — back to the wall's week grid. Wired to the header
   * button and Esc; CalendarView flips viewMode back to 'week'. */
  onExit: () => void;
  /** Configured title-icon rules (display.titleIcons). Undefined draws every
   * chip and bar with the bare title it always had. */
  titleIcons?: TitleIconSet;
}

const POLL_INTERVAL_MS = 60_000;

export default function MonthGrid({
  calendars,
  weekStartsOn,
  timezone,
  todayColor,
  calendarWriteEnabled,
  createFormResetMs,
  onExit,
  titleIcons,
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
  const gridRef = useRef<HTMLDivElement>(null);
  const calRef = useRef<HTMLDivElement>(null);

  // Per-person filter, shared with the wall (empty = show all). Same array
  // reference when empty, so an unfiltered month renders exactly as before.
  const filter = useCalendarFilter();

  // The two interaction layers on top of the grid, both ephemeral like the view
  // itself (they die with it — CalendarView unmounts MonthGrid on exit or
  // auto-revert, so nothing here can ever stick on the wall).
  const [popover, setPopover] = useState<{ date: string; box: PopoverBox } | null>(null);
  const [modal, setModal] = useState<
    { mode: 'create'; date: string } | { mode: 'edit'; event: EditableEvent } | null
  >(null);

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

  // "N more" → the day popover, anchored over the clicked cell. Position is
  // computed once at open (relative to .mon-calendar, which the popover floats
  // inside — deliberately OUTSIDE .mon-grid, so the grid's hidden unit samples
  // and capacity math never see it). Paging or a resize invalidates the anchor,
  // so both just close it.
  const openDayPopover = useCallback((date: string, cell: HTMLElement) => {
    const cal = calRef.current;
    if (!cal) return;
    const cr = cal.getBoundingClientRect();
    const r = cell.getBoundingClientRect();
    setPopover({
      date,
      box: popoverLayout(
        { left: r.left - cr.left, top: r.top - cr.top, width: r.width, height: r.height },
        { width: cr.width, height: cr.height }
      ),
    });
  }, []);

  const handleEventClick = useCallback((event: CalendarEvent) => {
    setModal({ mode: 'edit', event });
  }, []);
  const handleDayClick = useCallback((date: string) => {
    setModal({ mode: 'create', date });
  }, []);
  // Footer "+ Add event" — the generic entry point: today for the current
  // month, the 1st of the viewed month otherwise (see monthCreateDate).
  const handleFooterAdd = useCallback(() => {
    setModal({ mode: 'create', date: monthCreateDate(month, todayInZone(timezone)) });
  }, [month, timezone]);

  useEffect(() => setPopover(null), [month]);

  // Click-outside + resize close the popover — except while the modal is up:
  // a click in the modal must not dismiss the popover underneath it, or closing
  // the modal would land somewhere unexpected (Esc peels one layer at a time).
  useEffect(() => {
    if (!popover || modal) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('.mon-pop')) setPopover(null);
    };
    const onResize = () => setPopover(null);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', onResize);
    };
  }, [popover, modal]);

  // Keyboard — there's a real keyboard at the wall, and scrubbing months is
  // this view's main verb: ←/→ page, T jumps to today, Esc leaves. Skipped
  // while typing in a field or when a modifier is down (⌘← is the browser's
  // own back). While EventModal is open it owns the keyboard outright (its own
  // Esc/Enter handling) — paging months behind a form would be disorienting.
  // Esc peels one layer at a time: modal (EventModal itself) → popover → view.
  const modalOpen = modal !== null;
  const popoverOpen = popover !== null;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (modalOpen) return;
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
        if (popoverOpen) setPopover(null);
        else onExit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goPrev, goNext, goToday, onExit, modalOpen, popoverOpen]);

  // Filter, then merge — same order and same reasoning as the wall grid.
  const calendarOrder = useMemo(() => calendars.map((c) => c.id), [calendars]);
  // Scope to the calendars this board was actually given BEFORE the per-person
  // filter — a calendar the board doesn't know about must never reach the grid,
  // filtered or not. A no-op (same array reference) when every cached event
  // belongs to a configured calendar, which is the normal case.
  const knownCalendars = useMemo(() => new Set(calendarOrder), [calendarOrder]);
  const scopedEvents = useMemo(
    () => scopeToCalendars(events, knownCalendars),
    [events, knownCalendars]
  );
  const filteredEvents = useMemo(() => filterEvents(scopedEvents, filter), [scopedEvents, filter]);
  const visibleEvents = useMemo(
    () => mergeGroups(filteredEvents, calendarOrder),
    [filteredEvents, calendarOrder]
  );
  const dayEventsMap = useMemo(
    () => assignEventsToDays(visibleEvents, days),
    [visibleEvents, days]
  );
  const timedByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const day of days) map.set(day, dayEventsMap.get(day)?.timed ?? []);
    return map;
  }, [days, dayEventsMap]);

  // All-day events PLUS any timed event running past midnight — the band is
  // the only place a week grid can draw something spanning two days.
  const bandBarEvents = useMemo(() => bandEvents(visibleEvents), [visibleEvents]);
  const weekSegments = useMemo(
    () => weeksOfDays.map((w) => computeWeekSegments(bandBarEvents, w)),
    [weeksOfDays, bandBarEvents]
  );

  // Unit heights, shared with the personal board's month
  // (components/calendar/month-metrics.ts).
  const metrics = useMonthGridMetrics(gridRef, days);

  const capacityByDay = useMemo(
    () => (metrics ? monthCapacityByDay(metrics, weeksOfDays, weekSegments, timedByDay) : null),
    [metrics, weeksOfDays, weekSegments, timedByDay]
  );

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
        {/* No exit button here — leaving the view is the footer's "View
            Upcoming" (the shared view switcher), plus Esc and auto-revert. */}
      </div>

      {/* The one region that opts out of wall scale — see .mon-calendar. Also
          the day popover's positioning context (it floats over the grid). */}
      <div ref={calRef} className="mon-calendar">
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
                onMoreClick={openDayPopover}
                onEventClick={calendarWriteEnabled ? handleEventClick : undefined}
                onDayClick={calendarWriteEnabled ? handleDayClick : undefined}
                titleIcons={titleIcons}
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

        {/* Day popover — floats over the grid, never inside it (the grid's
            hidden samples must not see it). Its own list scrolls; the page
            can't (.app-main is overflow:clip). */}
        {popover && (
          <MonthDayPopover
            date={popover.date}
            box={popover.box}
            today={today}
            allDay={dayEventsMap.get(popover.date)?.allDay ?? []}
            timed={timedByDay.get(popover.date) ?? []}
            colorMap={colorMap}
            timezone={timezone}
            todayColor={todayColor}
            onClose={() => setPopover(null)}
            onEventClick={calendarWriteEnabled ? handleEventClick : undefined}
            titleIcons={titleIcons}
          />
        )}
      </div>

      {/* Footer — the same shared bar as the wall, so legend / view switch /
          + Add event sit in identical positions across views. */}
      <CalendarFooter
        calendars={calendars}
        viewLabel="View Upcoming"
        viewTitle="Back to the dashboard (Esc)"
        onViewClick={onExit}
        onAddClick={calendarWriteEnabled ? handleFooterAdd : undefined}
        sync={label}
      />

      {/* Create pre-fills the clicked day — the check-then-add workflow in one
          motion. The same modal as the wall, same recurring-occurrence block,
          same idle auto-close. If the month view's own auto-revert fires while
          this is open, the whole view (modal included) unmounts — deliberate:
          interactions restart CalendarView's timer, so this only happens after
          total idleness, and the modal's shorter idle timer (default 120s vs
          180s) will normally have closed an abandoned form first anyway. */}
      {calendarWriteEnabled && modal && (
        <EventModal
          key={
            modal.mode === 'edit'
              ? `${modal.event.event_id}-${modal.event.calendar_id}`
              : `create-${modal.date}`
          }
          mode={modal.mode}
          event={modal.mode === 'edit' ? modal.event : undefined}
          // Unfiltered list on purpose — see the note in CalendarGrid.
          groupCalendarIds={
            modal.mode === 'edit' ? calendarIdsForEvent(events, modal.event) : undefined
          }
          membershipLocked={modal.mode === 'edit' && isMembershipLocked(events, modal.event)}
          calendars={calendars}
          timezone={timezone}
          defaultDate={modal.mode === 'create' ? modal.date : today}
          resetMs={createFormResetMs}
          onClose={() => setModal(null)}
          onSaved={fetchEvents}
        />
      )}
    </div>
  );
}
