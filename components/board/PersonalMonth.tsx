'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MonthWeek from '@/components/calendar/MonthWeek';
import { mergeGroups } from '@/components/calendar/event-groups';
import { scopeToCalendars } from '@/components/calendar/calendar-filter';
import { monthCapacityByDay, useMonthGridMetrics } from '@/components/calendar/month-metrics';
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
} from '@/components/calendar/calendar-utils';
import { addMonths, monthGridDays, monthLabel, monthOf } from '@/components/calendar/month-utils';
import type { CalendarConfig } from '@/lib/config/types';
import PersonalSheet from './PersonalSheet';
import PersonalEventRow from './PersonalEventRow';
import PersonPicker from './PersonPicker';
import PersonalViewFooter from './PersonalViewFooter';
import type { TitleIconSet } from '@/lib/calendar/title-rules';
import { agendaLabel, type PersonOption } from './personal-utils';

interface PersonalMonthProps {
  calendars: CalendarConfig[];
  /** Whose month — inherited from the Upcoming column, like the week view. */
  scopeIds: string[];
  /** The picker's options and current selection — the shell's own state, so
   * switching here is the same switch the Upcoming column makes. */
  people: PersonOption[];
  person: number;
  onPersonChange: (index: number) => void;
  weekStartsOn: WeekStart;
  timezone?: string;
  todayColor: string;
  /** See PersonalShell.openEvent — the raw fetch travels with the event so
   * membership resolves against a list that actually holds it. */
  /** Sent as `?board=` so this view reads the same scoped slice the rest of
   * the board does. */
  boardSlug: string;
  onOpenEvent: (event: CalendarEvent, unfiltered: CalendarEvent[]) => void;
  onAddEvent?: () => void;
  onViewWeek: () => void;
  onClose: () => void;
  /** Idle auto-revert back to the three columns (ms). 0 disables. */
  resetMs: number;
  /** Configured title-icon rules (display.titleIcons), resolved server-side.
   * Undefined draws every title as the bare text node it always was. */
  titleIcons?: TitleIconSet;
}

const POLL_INTERVAL_MS = 60_000;

/**
 * "View Month" — the family board's month grid, full screen over the personal
 * board's three columns.
 *
 * Same grid, same chips, same spanning all-day bars: `MonthWeek` is rendered
 * unchanged, so there is one definition of what a month looks like. What this
 * component owns is the chrome around it and the interaction rules, which are
 * the personal board's, not the wall's — a tap opens the personal sheet rather
 * than the keyboard-driven modal, the day list is the board's own row format,
 * and the view reverts to the columns after idle (CLAUDE.md rules 1 and 12).
 *
 * The 1280×800 sizing lives under `.pb-view` in personal.css; `month.css` is
 * untouched, so the wall's month cannot move.
 */
export default function PersonalMonth({
  calendars,
  scopeIds,
  people,
  person,
  onPersonChange,
  weekStartsOn,
  timezone,
  todayColor,
  boardSlug,
  onOpenEvent,
  onAddEvent,
  onViewWeek,
  onClose,
  resetMs,
  titleIcons,
}: PersonalMonthProps) {
  const [month, setMonth] = useState(() => monthOf(todayInZone(timezone)));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [sync, setSync] = useState<SyncStatus>({
    lastSuccess: null,
    lastAttempt: null,
    lastError: null,
  });
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState(() => todayInZone(timezone));
  // A day opened in full, from its "N more" — the month grid's own read surface,
  // in the board's row format rather than the wall's floating popover (a
  // popover anchored to a 180px cell is a poor target for a finger).
  const [openDay, setOpenDay] = useState<string | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);

  const days = useMemo(() => monthGridDays(month, weekStartsOn), [month, weekStartsOn]);
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
        `/api/calendar?start=${days[0]}&end=${addDays(days[days.length - 1], 1)}&board=${encodeURIComponent(boardSlug)}`
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
  }, [days, timezone, boardSlug]);

  useEffect(() => {
    const initial = setTimeout(fetchEvents, 0);
    const interval = setInterval(fetchEvents, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [fetchEvents]);

  // Paging closes an open day — its events belong to the month that just left.
  useEffect(() => setOpenDay(null), [month]);

  // Idle auto-revert (CLAUDE.md rule 1), restarted by any touch.
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

  // Esc for the Mac, where this gets developed; peel one layer at a time.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (openDay) setOpenDay(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, openDay]);

  // Scope to the board, narrow to the person, then merge — the same order as
  // every other grid in the app.
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

  const metrics = useMonthGridMetrics(gridRef, days);
  const capacityByDay = useMemo(
    () => (metrics ? monthCapacityByDay(metrics, weeksOfDays, weekSegments, timedByDay) : null),
    [metrics, weeksOfDays, weekSegments, timedByDay]
  );

  const syncLabel = loading ? { text: 'Loading…', isError: false } : formatSyncLabel(sync);

  /** What "N more" opens: only the rows the cell cropped. Band bars are never
   * cropped by capacity, so they stay on the grid. Same rule as the week. */
  const openDayEvents = useMemo(() => {
    if (!openDay) return [];
    const timed = timedByDay.get(openDay) ?? [];
    const capacity = capacityByDay?.[openDay] ?? Infinity;
    return timed.slice(Math.max(0, capacity));
  }, [openDay, timedByDay, capacityByDay]);

  const goToday = useCallback(() => setMonth(monthOf(todayInZone(timezone))), [timezone]);
  const thisMonth = month === monthOf(today);

  return (
    <div className="pb-view">
      <header className="pb-view-head">
        <h2 className="pb-view-title">{monthLabel(month)}</h2>
        <span className="pb-view-spacer" />
        {/* Whose month — the same control the week header and the Upcoming
            column carry, driving the same state. */}
        <PersonPicker
          people={people}
          person={person}
          onChange={onPersonChange}
          className="pb-view-person"
        />
        <div className="pb-view-nav">
          <button
            type="button"
            className="pb-view-navbtn"
            onClick={() => setMonth((m) => addMonths(m, -1))}
            aria-label="Previous month"
          >
            ‹
          </button>
          {!thisMonth && (
            <button type="button" className="pb-view-navbtn" onClick={goToday}>
              Today
            </button>
          )}
          <button
            type="button"
            className="pb-view-navbtn"
            onClick={() => setMonth((m) => addMonths(m, 1))}
            aria-label="Next month"
          >
            ›
          </button>
        </div>
      </header>

      {/* The wall's own month markup, reading month.css unchanged. Only the
          panel-sized overrides live under .pb-view in personal.css. */}
      <div className="pb-view-body mon-calendar">
        <div className="mon-weekdays">
          {labels.map((l) => (
            <div key={l} className="mon-weekday">
              {l}
            </div>
          ))}
        </div>

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
                titleIcons={titleIcons}
                onMoreClick={(date) => setOpenDay(date)}
                onEventClick={(event) => onOpenEvent(event, events)}
                // No hover-"+" create: there is no hover on a touch panel, and
                // "Add Event" in the footer is the one honest entry point.
              />
            );
          })}

          {/* Hidden unit samples — three boxes, not a duplicate of the month.
              They give the layout a chip / "N more" / band-bar height without
              depending on what any real day holds. Clipped by .mon-grid's
              overflow so they can never become scrollable overflow. */}
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

      <PersonalViewFooter onHome={onClose} sync={syncLabel}>
        <button type="button" className="pb-action" onClick={onViewWeek}>
          View Week
        </button>
        <span className="pb-action-sep">|</span>
        <button type="button" className="pb-action" onClick={onAddEvent} disabled={!onAddEvent}>
          Add Event
        </button>
      </PersonalViewFooter>

      {openDay && (
        <PersonalSheet
          title={`${openDayEvents.length} more · ${agendaLabel(openDay, today)}`}
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
                titleIcons={titleIcons}
              />
            ))}
          </ul>
        </PersonalSheet>
      )}
    </div>
  );
}
