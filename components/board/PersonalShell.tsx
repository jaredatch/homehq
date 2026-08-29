'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useMinuteTick } from '@/components/clock/use-minute';
import { calendarIdsForEvent, mergeGroups } from '@/components/calendar/event-groups';
import {
  addDays,
  todayInZone,
  type CalendarEvent,
  type SyncStatus,
} from '@/components/calendar/calendar-utils';
import type { WeatherData } from '@/lib/weather/types';
import type { CalendarConfig, WeatherIconSet } from '@/lib/config/types';
import { buildAgenda, canEditEvent, eventTargets, personOptions } from './personal-utils';
import PersonalUpcoming from './PersonalUpcoming';
import PersonalTodo from './PersonalTodo';
import PersonalStatus from './PersonalStatus';
import PersonalEventSheet from './PersonalEventSheet';

interface PersonalShellProps {
  name: string;
  accent: string;
  calendars: CalendarConfig[];
  ownCalendarIds: string[];
  alwaysShowIds: string[];
  /** Where a "Just me" event lands — her room calendar, which the wall never
   * draws. Undefined falls back to the first of her own calendars. */
  defaultCalendarId?: string;
  /** The one gate for the OAuth scope, the write routes, and the buttons. */
  calendarWriteEnabled: boolean;
  timezone?: string;
  showWeather: boolean;
  weatherIcons: WeatherIconSet;
  /** Todoist project backing the Todo column, or null when unset. */
  todoProjectId: string | null;
  /** How long a peek at someone else's calendar survives idle before the
   * Upcoming column snaps back to her (ms). 0 disables. */
  peekResetMs: number;
  /** How long an untouched form stays open before it closes itself (ms). */
  formResetMs: number;
  appVersion: string;
}

const POLL_INTERVAL_MS = 60_000;
const WEATHER_POLL_MS = 5 * 60 * 1000;

/** How far ahead Upcoming looks. Two weeks matches the wall's default window;
 * past that she's reading a calendar, not a day. */
const AGENDA_DAYS = 14;

/**
 * The personal board: three equal columns — Upcoming · Todo · clock and
 * weather — each with its own footer, per Jared's wireframe
 * (private/reference/personal-board-wireframe.png).
 *
 * This half owns every fetch and every piece of transient state, so the three
 * columns stay presentational and the idle-revert rules live in one place.
 */
export default function PersonalShell({
  name,
  accent,
  calendars,
  ownCalendarIds,
  alwaysShowIds,
  defaultCalendarId,
  calendarWriteEnabled,
  timezone,
  showWeather,
  weatherIcons,
  todoProjectId,
  peekResetMs,
  formResetMs,
  appVersion,
}: PersonalShellProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [sync, setSync] = useState<SyncStatus>({
    lastSuccess: null,
    lastAttempt: null,
    lastError: null,
  });
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [today, setToday] = useState(() => todayInZone(timezone));

  // Drives the clock, the "synced Xm ago" label, and the past-event dimming, so
  // a finished event greys out on the same tick the clock moves.
  const minute = useMinuteTick();
  const now = minute === 0 ? 0 : minute * 60000;

  const people = useMemo(
    () => personOptions(calendars, name, ownCalendarIds, alwaysShowIds),
    [calendars, name, ownCalendarIds, alwaysShowIds]
  );

  // Whose events Upcoming is showing. Index 0 is hers and is the ONLY state the
  // board ever boots into — a peek at a sister's week must never be what the
  // screen is still showing on Sunday (CLAUDE.md rule 1).
  const [person, setPerson] = useState(0);

  useEffect(() => {
    if (person === 0 || peekResetMs <= 0) return;
    let timer = setTimeout(() => setPerson(0), peekResetMs);
    // Restart on any touch so it can't yank the view away mid-read; it only
    // ever fires after she's walked off.
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setPerson(0), peekResetMs);
    };
    window.addEventListener('pointerdown', restart, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', restart, true);
    };
  }, [person, peekResetMs]);

  // "Just me" (her room calendar, hidden from the wall) and "Family" (her own
  // calendar, which the wall draws). Both come out of config the board already
  // has — see eventTargets.
  const targets = useMemo(
    () => eventTargets(calendars, ownCalendarIds, alwaysShowIds, defaultCalendarId),
    [calendars, ownCalendarIds, alwaysShowIds, defaultCalendarId]
  );
  const canWrite = calendarWriteEnabled && targets.length > 0;

  const calendarNames = useMemo(() => new Map(calendars.map((c) => [c.id, c.name])), [calendars]);

  const colorMap = useMemo(
    () => new Map(calendars.map((c) => [c.id, { color: c.color, textColor: c.textColor }])),
    [calendars]
  );
  const calendarOrder = useMemo(() => calendars.map((c) => c.id), [calendars]);

  // What's open over the board: a new event, one of hers being edited, or
  // someone else's shown read-only. Never persisted, and the sheet closes
  // itself after idle (CLAUDE.md rule 1).
  const [sheet, setSheet] = useState<
    { mode: 'create' } | { mode: 'edit' | 'detail'; event: CalendarEvent } | null
  >(null);

  const fetchEvents = useCallback(async () => {
    // Re-derive today every poll so the board rolls over at midnight without a
    // reload — the wall grid does the same thing for the same reason.
    const currentToday = todayInZone(timezone);
    setToday(currentToday);

    try {
      const res = await fetch(
        `/api/calendar?start=${currentToday}&end=${addDays(currentToday, AGENDA_DAYS)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      setEvents(data.events);
      setSync(data.sync);
    } catch {
      // Keep what's on screen. A network blip must never blank a bedroom.
    }
  }, [timezone]);

  useEffect(() => {
    // Deferred so no setState is reachable synchronously from the effect body
    // (react-hooks/set-state-in-effect), matching WeatherPanel.
    const initial = setTimeout(fetchEvents, 0);
    const interval = setInterval(fetchEvents, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [fetchEvents]);

  const fetchWeather = useCallback(async () => {
    try {
      const res = await fetch('/api/weather');
      if (!res.ok) return;
      const data = await res.json();
      if (data.weather) setWeather(data.weather);
    } catch {
      // Same resilience contract as events.
    }
  }, []);

  useEffect(() => {
    if (!showWeather) return;
    // Deferred so no setState is reachable synchronously from the effect body
    // (react-hooks/set-state-in-effect), matching WeatherPanel.
    const initial = setTimeout(fetchWeather, 0);
    const interval = setInterval(fetchWeather, WEATHER_POLL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [showWeather, fetchWeather]);

  // Self-update: the same build-token poll the wall uses, so a deploy reaches
  // the bedroom Pis without anyone walking upstairs. Never reloads on a fetch
  // error, and the first check waits a full interval so a fresh load settles.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const { version } = await res.json();
        if (!cancelled && version && version !== appVersion) window.location.reload();
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

  // Narrow to the selected person, THEN merge each shared event's copies into
  // one row — the same order the wall uses, and for the same reason: narrowed
  // to her, a shared event's other copy is already gone, so it renders in her
  // colour rather than as a two-colour chip on her own screen.
  const days = useMemo(() => {
    const ids = new Set(people[person]?.calendarIds ?? calendarOrder);
    const mine = events.filter((e) => ids.has(e.calendar_id));
    return buildAgenda(mergeGroups(mine, calendarOrder), today, AGENDA_DAYS);
  }, [events, people, person, calendarOrder, today]);

  /**
   * Tapping an event: hers opens the editor, anyone else's opens a read-only
   * card ("kids can act, but scoped").
   *
   * Membership is resolved against the UNFILTERED event list, not the merged
   * row on screen. Narrowed to her, a shared event with a parent has already
   * lost its sibling copy, so the row alone would claim to be hers — and saving
   * it would rewrite the parent's copy too.
   */
  const openEvent = useCallback(
    (event: CalendarEvent) => {
      const withMembership = { ...event, groupCalendarIds: calendarIdsForEvent(events, event) };
      const editable = canWrite && canEditEvent(withMembership, ownCalendarIds);
      setSheet({ mode: editable ? 'edit' : 'detail', event: withMembership });
    },
    [events, canWrite, ownCalendarIds]
  );

  return (
    <div className="pb" style={{ '--pb-accent': accent } as CSSProperties}>
      <PersonalUpcoming
        days={days}
        colorMap={colorMap}
        timezone={timezone}
        now={now}
        people={people}
        person={person}
        onPersonChange={setPerson}
        onOpenEvent={openEvent}
        onAddEvent={canWrite ? () => setSheet({ mode: 'create' }) : undefined}
      />
      <PersonalTodo
        projectId={todoProjectId}
        timezone={timezone}
        today={today}
        formResetMs={formResetMs}
      />
      <PersonalStatus
        now={now}
        timezone={timezone}
        weather={showWeather ? weather : null}
        weatherIcons={weatherIcons}
        sync={sync}
      />

      {sheet && (
        <PersonalEventSheet
          key={sheet.mode === 'create' ? 'create' : `${sheet.event.event_id}:${sheet.mode}`}
          mode={sheet.mode}
          event={sheet.mode === 'create' ? undefined : sheet.event}
          targets={targets}
          calendarNames={calendarNames}
          writeEnabled={calendarWriteEnabled}
          timezone={timezone}
          today={today}
          resetMs={formResetMs}
          onClose={() => setSheet(null)}
          onSaved={fetchEvents}
        />
      )}
    </div>
  );
}
