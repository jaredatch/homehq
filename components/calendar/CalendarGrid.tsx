'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import WeekRow from './WeekRow';
import EventItem from './EventItem';
import EventModal, { type EditableEvent } from './EventModal';
import { calendarIdsForEvent, isMembershipLocked, mergeGroups } from './event-groups';
import { accentStripes, eventPaint } from './event-paint';
import CalendarFooter from './CalendarFooter';
import { useMinuteTick } from '@/components/clock/use-minute';
import { useCalendarFilter, filterEvents, scopeToCalendars } from './calendar-filter';
import { useWeekGridMetrics } from './week-metrics';
import { planWallWeeks } from './wall-layout';
import DayPopover from './DayPopover';
import { popoverLayout, type PopoverBox } from './month-utils';
import {
  assignEventsToDays,
  chunkWeeks,
  bandEvents,
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
  // .cal-grid — the day popover floats inside it, never inside .cal-weeks,
  // which is overflow:clip and holds the measurement layer. Same containment
  // month view uses (.mon-calendar vs .mon-grid).
  const calRef = useRef<HTMLDivElement>(null);
  // Read by the "+N more" handler, which must not re-create itself per render.
  const anchorWeekRef = useRef(0);

  // Wall-clock minute, for dimming today's finished events. The same store the
  // clock uses, so an event greys out on the tick the clock moves; 0 until the
  // client hydrates, which is why nothing dims on the server render.
  const minute = useMinuteTick();
  const now = minute === 0 ? 0 : minute * 60000;

  // Per-person filter (shared across views, empty = show all). When empty this
  // returns the SAME `events` reference below, so the default wall render is
  // byte-for-byte unchanged.
  const filter = useCalendarFilter();

  // "Expand next week" — flips the layout priority so next week shows every
  // event and the current week crops to the remaining space. Ephemeral on
  // purpose (no persistence): the always-on wall kiosk must never boot stuck in
  // this mode, and a reload always returns to the default current-week view.
  const [expanded, setExpanded] = useState(false);
  // The day popover — one day's full list, floating over the grid. Ephemeral
  // like every other peek: never persisted, closed by Esc, a click outside, a
  // resize, and the idle timer below.
  const [popover, setPopover] = useState<{ date: string; box: PopoverBox } | null>(null);

  // One rule for "+N more": give that week the screen, and if it already has
  // the screen, open the day.
  //
  // Clicking a week that ISN'T the anchor moves the anchor there, which is what
  // this button has always done — a next-week "+N more" expands next week, and
  // one in the current week while next week is expanded collapses back. But
  // when the clicked week is ALREADY the anchor there is no height left to win,
  // and the click used to be silently dead: setExpanded would be handed the
  // value it already held. That is the common case now, since the collapse rule
  // usually leaves the current week alone on screen. It is also the only case
  // that can ever be answered, because a day like a school-year Tuesday wants
  // more height than the whole grid has.
  //
  // It covers a case that predates the collapse rule too: a PAST day of the
  // current week crops last (priority 3), so with two weeks up it can show
  // "+9 more" while week 0 is the anchor and not capped. Expanding could never
  // have helped that day either.
  const handleMoreClick = useCallback(
    (weekIndex: number, date: string, cell: HTMLElement | null) => {
      if (weekIndex !== anchorWeekRef.current) {
        setExpanded(weekIndex !== 0);
        return;
      }
      const grid = calRef.current;
      if (!grid || !cell) return;
      const gr = grid.getBoundingClientRect();
      const r = cell.getBoundingClientRect();
      setPopover({
        date,
        box: popoverLayout(
          { left: r.left - gr.left, top: r.top - gr.top, width: r.width, height: r.height },
          { width: gr.width, height: gr.height }
        ),
      });
    },
    []
  );

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

  // Esc closes the popover; a click anywhere outside it does too. Both are
  // skipped while the modal is up: a click inside the modal must not dismiss
  // the popover underneath it, or closing the modal would land on nothing.
  // A resize invalidates the anchor the box was measured against, so it just
  // closes.
  useEffect(() => {
    if (!popover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopover(null);
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest('.cal-pop')) setPopover(null);
    };
    const onResize = () => setPopover(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    // Deferred a tick: the click that opened it is still propagating.
    const id = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onDown);
      clearTimeout(id);
    };
  }, [popover]);

  // Auto-revert, on the same key as the expand toggle. Both are the same kind
  // of peek behind the same button, so they share a timer rather than growing
  // the config a near-duplicate key. Month view's popover needs none of this —
  // its whole view reverts and takes the popover with it.
  useEffect(() => {
    if (!popover || expandResetMs <= 0) return;
    const t = setTimeout(() => setPopover(null), expandResetMs);
    return () => clearTimeout(t);
  }, [popover, expandResetMs]);

  // Expanding re-lays out every track, so the box the popover measured is stale.
  useEffect(() => setPopover(null), [expanded]);

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

  // Narrow to the filtered calendars, THEN collapse each shared event's copies
  // into one chip. Both steps hand back the same array reference when they have
  // nothing to do, so an unfiltered board with no shared events is identical to
  // today — right through to the measurement layer.
  //
  // The order is what makes the per-person behavior fall out for free: filtered
  // to Maddie, only her copy survives and the merge is a no-op, so a shared
  // event renders in HER color; unfiltered, both survive and become one
  // two-color chip.
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

  // Timed events keyed by start day; all-day events are laid out separately as
  // spanning bars in each week's band.
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
  // Per-week, per-column band reservation — each day's own band height now varies
  // (a day no all-day event touches reserves nothing), so capacity is per-column.
  const laneByWeek = useMemo(() => weekSegments.map((w) => w.laneByColumn), [weekSegments]);

  const labels = useMemo(() => weekdayLabels(weekStartsOn), [weekStartsOn]);

  // Measure the grid's usable height and chrome (header/band) from the visible
  // grid, plus the REAL per-day timed-row heights from the hidden measurement
  // layer. Shared with the personal board's week (components/calendar/
  // week-metrics.ts) — the measuring is identical; only how the height is then
  // spent differs, and that policy stays right below.
  const metrics = useWeekGridMetrics(gridRef, measureRef, days, visibleEvents, timezone);

  // How the measured height gets spent: the anchor week, the "expand next
  // week" peek, and the collapse rule. Pure and unit-tested in wall-layout.ts —
  // this is the wall's own policy and is deliberately NOT shared with the
  // personal board's week (CLAUDE.md rule 12).
  const layout = useMemo(
    () => (metrics ? planWallWeeks(metrics, weeksOfDays, laneByWeek, today, expanded) : null),
    [metrics, weeksOfDays, laneByWeek, today, expanded]
  );

  // Weeks actually rendered. Until the first measurement lands there is no
  // layout yet, so every week renders uncropped and the grid settles on the
  // next frame.
  const shownWeeks = layout?.shownWeeks ?? weeksOfDays.length;
  anchorWeekRef.current = layout?.anchorWeek ?? 0;
  // Did the collapse rule take a week off the screen? Only the footer toggle's
  // wording depends on this: "expand" is the wrong verb for a week that isn't
  // drawn at all.
  const collapsed = shownWeeks < weeksOfDays.length;

  return (
    <div ref={calRef} className="cal-grid">
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
        {weeksOfDays.slice(0, shownWeeks).map((weekDays, wi) => {
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
              now={now}
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
                {(timedByDay.get(date) ?? []).map((event) => {
                  // Paint identically to the visible layer — a gradient can't
                  // change height, but this layer must stay a faithful copy.
                  const paint = eventPaint(event, colorMap);
                  return (
                    <EventItem
                      key={`${event.event_id}-${event.calendar_id}`}
                      event={event}
                      color={paint.primary}
                      accent={paint.shared ? accentStripes(paint.colors) : undefined}
                      timeZone={timezone}
                    />
                  );
                })}
              </div>
            ))}
            <div data-more-sample className="cal-more">
              +0 more
            </div>
          </div>
        </div>
      </div>

      {/* Day popover — floats over the grid, deliberately outside .cal-weeks
          (clip + the measurement layer). */}
      {popover && (
        <DayPopover
          date={popover.date}
          box={popover.box}
          today={today}
          allDay={dayEventsMap.get(popover.date)?.allDay ?? []}
          timed={timedByDay.get(popover.date) ?? []}
          colorMap={colorMap}
          timezone={timezone}
          todayColor={todayColor}
          now={now}
          onClose={() => setPopover(null)}
          onEventClick={calendarWriteEnabled ? handleEventClick : undefined}
        />
      )}

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
              expanded
                ? 'Show the current week in full'
                : collapsed
                  ? 'Show next week'
                  : 'Expand next week to show all its events'
            }
            aria-pressed={expanded}
            className="cal-expand"
          >
            {expanded ? '‹ Current week' : collapsed ? 'Next week ›' : 'Expand next week ›'}
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
          // Derived from the UNFILTERED list: with a per-person filter on, a
          // sibling copy may be hidden from the grid but must still show checked.
          groupCalendarIds={
            modal.mode === 'edit' ? calendarIdsForEvent(events, modal.event) : undefined
          }
          membershipLocked={modal.mode === 'edit' && isMembershipLocked(events, modal.event)}
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
