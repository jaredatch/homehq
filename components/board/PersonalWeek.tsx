'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import WeekRow from '@/components/calendar/WeekRow';
import EventItem from '@/components/calendar/EventItem';
import { accentStripes, eventPaint } from '@/components/calendar/event-paint';
import { mergeGroups } from '@/components/calendar/event-groups';
import { scopeToCalendars } from '@/components/calendar/calendar-filter';
import { bandHeightFor, fitCount, useWeekGridMetrics } from '@/components/calendar/week-metrics';
import {
  addDays,
  assignEventsToDays,
  chunkWeeks,
  bandEvents,
  computeWeekSegments,
  formatSyncLabel,
  generateRollingDays,
  startOfWeek,
  todayInZone,
  weekdayLabels,
  type CalendarEvent,
  type SyncStatus,
  type WeekStart,
} from '@/components/calendar/calendar-utils';
import type { CalendarConfig } from '@/lib/config/types';
import PersonalSheet from './PersonalSheet';
import PersonalEventRow from './PersonalEventRow';
import { agendaLabel } from './personal-utils';

interface PersonalWeekProps {
  /** The board's calendars, in draw order. */
  calendars: CalendarConfig[];
  /** Whose week — the Upcoming column's current person selection, inherited so
   * that peeking at a sister's agenda and then tapping "View Week" doesn't
   * silently snap back to her own. */
  scopeIds: string[];
  /** Week rows to draw (display.calendarWeeks). A personal board defaults to 1:
   * one row on an 800px panel gives a day cell ~590px, which is about ten
   * events before it has to crop. */
  weeks: number;
  weekStartsOn: WeekStart;
  timezone?: string;
  todayColor: string;
  /** Tapping an event. Handed the raw, UNFILTERED fetch alongside it so the
   * shell can resolve the event's full calendar membership — see the note on
   * PersonalShell.openEvent. */
  onOpenEvent: (event: CalendarEvent, unfiltered: CalendarEvent[]) => void;
  onAddEvent?: () => void;
  onViewMonth: () => void;
  onClose: () => void;
  /** Idle auto-revert back to the three columns (ms). 0 disables. */
  resetMs: number;
}

const POLL_INTERVAL_MS = 60_000;

/** "Sep 1 – 6", or "Aug 31 – Sep 6" when the range crosses a month. */
function rangeLabel(first: string, last: string): string {
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const parse = (d: string) => {
    const [, m, day] = d.split('-').map(Number);
    return { m: MONTHS[m - 1], day };
  };
  const a = parse(first);
  const b = parse(last);
  return a.m === b.m ? `${a.m} ${a.day} – ${b.day}` : `${a.m} ${a.day} – ${b.m} ${b.day}`;
}

/**
 * "View Week" — the family board's own week grid, full screen over the personal
 * board's three columns.
 *
 * It is the WALL's grid on purpose, not a second design: the same seven columns,
 * the same day cells, the same spanning all-day band, the same "+N more". At
 * 1280×800 the root font resolves to 20px, so a column is ~9rem against the
 * wall's ~12rem — narrower, but the same layout doing the same job, and one
 * fewer thing to keep working.
 *
 * What differs is everything around it, and that is what this component owns:
 * writes are scoped to her calendars, an event opens the personal sheet rather
 * than the wall's keyboard-driven modal, and the whole view reverts to the
 * columns after idle (CLAUDE.md rules 1 and 12).
 */
export default function PersonalWeek({
  calendars,
  scopeIds,
  weeks,
  weekStartsOn,
  timezone,
  todayColor,
  onOpenEvent,
  onAddEvent,
  onViewMonth,
  onClose,
  resetMs,
}: PersonalWeekProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [sync, setSync] = useState<SyncStatus>({
    lastSuccess: null,
    lastAttempt: null,
    lastError: null,
  });
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState(() => todayInZone(timezone));
  // How many pages forward or back from the current week. Ephemeral like the
  // view itself — leaving and re-entering always lands on this week.
  const [page, setPage] = useState(0);
  // A day opened in full, from its "+N more". Rare on a personal board (one week
  // row leaves a lot of cell), but a button that does nothing is worse than one
  // that is rarely needed.
  const [openDay, setOpenDay] = useState<string | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  const totalDays = weeks * 7;
  const anchor = useMemo(
    () => addDays(startOfWeek(today, weekStartsOn), page * totalDays),
    [today, weekStartsOn, page, totalDays]
  );
  const days = useMemo(() => generateRollingDays(anchor, totalDays), [anchor, totalDays]);
  const weeksOfDays = useMemo(() => chunkWeeks(days), [days]);
  const labels = useMemo(() => weekdayLabels(weekStartsOn), [weekStartsOn]);

  const colorMap = useMemo(
    () => new Map(calendars.map((c) => [c.id, { color: c.color, textColor: c.textColor }])),
    [calendars]
  );

  const fetchEvents = useCallback(async () => {
    setToday(todayInZone(timezone));
    try {
      const res = await fetch(
        `/api/calendar?start=${days[0]}&end=${addDays(days[days.length - 1], 1)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      setEvents(data.events);
      setSync(data.sync);
    } catch {
      // Keep what's on screen. A network blip must never blank a bedroom.
    } finally {
      setLoading(false);
    }
  }, [days, timezone]);

  useEffect(() => {
    // Deferred so no setState is reachable synchronously from the effect body,
    // matching the rest of the board.
    const initial = setTimeout(fetchEvents, 0);
    const interval = setInterval(fetchEvents, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [fetchEvents]);

  // Idle auto-revert (CLAUDE.md rule 1). A bedroom panel is as always-on as the
  // wall, so a week left open at bedtime must not still be there at breakfast.
  // Any touch restarts the clock, so it only ever fires after she's walked off.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (resetMs <= 0) return;
    let timer = setTimeout(() => closeRef.current(), resetMs);
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(() => closeRef.current(), resetMs);
    };
    window.addEventListener('pointerdown', restart, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', restart, true);
    };
  }, [resetMs]);

  // Esc for the Mac, where this gets developed. The panel has no keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Peel one layer at a time, like the wall's month view.
      if (openDay) setOpenDay(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, openDay]);

  // Scope to the board's calendars, THEN narrow to the selected person, THEN
  // merge each shared event's copies into one chip — the same order, and the
  // same reasoning, as both wall grids. Narrowed to her, a shared event's other
  // copy is already gone, so it renders in her colour rather than as a
  // two-colour chip on her own screen.
  const calendarOrder = useMemo(() => calendars.map((c) => c.id), [calendars]);
  const knownCalendars = useMemo(() => new Set(calendarOrder), [calendarOrder]);
  const scopedEvents = useMemo(
    () => scopeToCalendars(events, knownCalendars),
    [events, knownCalendars]
  );
  const personIds = useMemo(() => new Set(scopeIds), [scopeIds]);
  const mineEvents = useMemo(
    () =>
      personIds.size === 0
        ? scopedEvents
        : scopedEvents.filter((e) => personIds.has(e.calendar_id)),
    [scopedEvents, personIds]
  );
  const visibleEvents = useMemo(
    () => mergeGroups(mineEvents, calendarOrder),
    [mineEvents, calendarOrder]
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

  const metrics = useWeekGridMetrics(gridRef, measureRef, days, visibleEvents, timezone);

  /**
   * Space policy — deliberately the simple one.
   *
   * The wall protects the current week and lets "Expand next week" move that
   * anchor, because it shows two weeks and one of them matters more. A personal
   * board shows one week at a time and every day in it is equally hers, so each
   * row is an even share of the height and each cell packs what fits. Nothing
   * here needs the anchor machinery, and reaching for it would only import the
   * wall's constraints (CLAUDE.md rule 12).
   */
  const capacityByDay = useMemo(() => {
    if (!metrics) return null;
    const { availH, headerH, dayHeights } = metrics;
    // .cal-weeks is a 1px-gap grid of equal 1fr rows.
    const rowPx = (availH - (weeksOfDays.length - 1)) / weeksOfDays.length;

    const out: Record<string, number> = {};
    weeksOfDays.forEach((weekDays, wi) => {
      const lanes = weekSegments[wi].laneByColumn;
      weekDays.forEach((date, col) => {
        const inner = rowPx - headerH - bandHeightFor(metrics, lanes[col] ?? 0);
        out[date] = fitCount(metrics, dayHeights[date] ?? [], inner);
      });
    });
    return out;
  }, [metrics, weeksOfDays, weekSegments]);

  const syncLabel = loading ? { text: 'Loading…', isError: false } : formatSyncLabel(sync);

  const openDayEvents = useMemo(() => {
    if (!openDay) return [];
    const entry = dayEventsMap.get(openDay);
    return [...(entry?.allDay ?? []), ...(entry?.timed ?? [])];
  }, [openDay, dayEventsMap]);

  return (
    <div className="pb-view">
      <header className="pb-view-head">
        <h2 className="pb-view-title">{page === 0 ? 'This Week' : 'Week'}</h2>
        <span className="pb-view-range">{rangeLabel(days[0], days[days.length - 1])}</span>
        <span className="pb-view-spacer" />
        <div className="pb-view-nav">
          <button
            type="button"
            className="pb-view-navbtn"
            onClick={() => setPage((p) => p - 1)}
            aria-label="Previous week"
          >
            ‹
          </button>
          {page !== 0 && (
            <button type="button" className="pb-view-navbtn" onClick={() => setPage(0)}>
              Today
            </button>
          )}
          <button
            type="button"
            className="pb-view-navbtn"
            onClick={() => setPage((p) => p + 1)}
            aria-label="Next week"
          >
            ›
          </button>
        </div>
      </header>

      {/* The wall's own grid markup, so it reads the wall's stylesheet and there
          is exactly one definition of what a week looks like. Only the sizing
          that a 10" panel needs is overridden, scoped under .pb-view. */}
      <div className="pb-view-body cal-grid">
        <div className="cal-weekdays">
          {labels.map((label) => (
            <div key={label} className="cal-weekday">
              {label}
            </div>
          ))}
        </div>

        <div
          ref={gridRef}
          className="cal-weeks"
          style={{ gridTemplateRows: `repeat(${weeksOfDays.length}, minmax(0, 1fr))` }}
        >
          {weeksOfDays.map((weekDays, wi) => {
            const { segments, slotCount, laneByColumn } = weekSegments[wi];
            const capacities = weekDays.map((date) =>
              capacityByDay ? (capacityByDay[date] ?? Infinity) : Infinity
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
                onMoreClick={(_wi, date) => setOpenDay(date)}
                moreTitle={(date) => `Everything on ${agendaLabel(date, today)}`}
                onEventClick={(event) => onOpenEvent(event, events)}
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
      </div>

      <footer className="pb-view-foot">
        <button type="button" className="pb-action" onClick={onViewMonth}>
          View Month
        </button>
        <span className="pb-action-sep">|</span>
        <button type="button" className="pb-action" onClick={onAddEvent} disabled={!onAddEvent}>
          Add Event
        </button>
        <span className="pb-action-sep">|</span>
        <button type="button" className="pb-action" onClick={onClose}>
          Close
        </button>
        <span className={syncLabel.isError ? 'pb-sync pb-sync--error' : 'pb-sync'}>
          {syncLabel.text}
        </span>
      </footer>

      {/* A cropped day, in full. The Upcoming column's row format rather than the
          grid's dense chip — this is a read-at-arm's-length list, and it is the
          one place on this board where an event's whole title is legible. */}
      {openDay && (
        <PersonalSheet
          title={agendaLabel(openDay, today)}
          resetMs={resetMs}
          onClose={() => setOpenDay(null)}
        >
          <ul className="pb-events">
            {openDayEvents.map((event) => (
              <PersonalEventRow
                key={`${event.calendar_id}:${event.event_id}`}
                event={event}
                colorMap={colorMap}
                timezone={timezone}
                now={0}
                onOpen={(e) => {
                  setOpenDay(null);
                  onOpenEvent(e, events);
                }}
              />
            ))}
          </ul>
        </PersonalSheet>
      )}
    </div>
  );
}
