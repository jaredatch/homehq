'use client';

import { useCallback, useEffect, useState } from 'react';
import CalendarGrid from './CalendarGrid';
import MonthGrid from './MonthGrid';
import type { WeekStart } from './calendar-utils';

interface CalendarViewProps {
  calendars: { id: string; name: string; color: string; textColor?: string }[];
  weeks: number;
  weekStartsOn: WeekStart;
  /** IANA zone for "today" + event times. Undefined = browser-local. */
  timezone?: string;
  /** Today's accent color (any CSS color). */
  todayColor: string;
  /** See CalendarGrid — passed straight through. */
  expandResetMs: number;
  calendarWriteEnabled: boolean;
  createFormResetMs: number;
  appVersion: string;
  /** How long month view stays up with no interaction before auto-reverting to
   * the week grid (ms). 0 disables. From config.display.monthViewResetSeconds. */
  monthViewResetMs: number;
}

/**
 * The calendar area's view switch: the wall's week grid (default) or the
 * sit-down month view. `viewMode` is ephemeral on purpose — like the expand
 * toggle and the event modal, it is never persisted, so the always-on wall
 * boots into the week grid every time and a reload always recovers it.
 *
 * Only one grid is mounted at a time. That keeps the week path exactly what it
 * was (CalendarGrid doesn't know month view exists beyond its footer button)
 * and gives month view a clean slate on every entry — it re-opens on the
 * current month, never wherever someone left it.
 */
export default function CalendarView({ monthViewResetMs, ...gridProps }: CalendarViewProps) {
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');

  const enterMonth = useCallback(() => setViewMode('month'), []);
  const exitMonth = useCallback(() => setViewMode('week'), []);

  // Auto-revert: month view is a transient, at-the-keyboard mode on an
  // always-on wall — someone walking away mid-scrub must never leave the
  // kitchen stuck on November. A fresh timer starts on entry and restarts on
  // ANY interaction (capture-phase, so it sees clicks and keys wherever they
  // land, including the keyboard shortcuts MonthGrid handles) — reset-on-
  // interaction means it can't yank someone away mid-task. Leaving month view
  // tears it all down. 0 disables (config.display.monthViewResetSeconds = 0).
  useEffect(() => {
    if (viewMode !== 'month' || monthViewResetMs <= 0) return;
    let timer = setTimeout(exitMonth, monthViewResetMs);
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(exitMonth, monthViewResetMs);
    };
    window.addEventListener('pointerdown', restart, true);
    window.addEventListener('keydown', restart, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', restart, true);
      window.removeEventListener('keydown', restart, true);
    };
  }, [viewMode, monthViewResetMs, exitMonth]);

  if (viewMode === 'month') {
    return (
      <MonthGrid
        calendars={gridProps.calendars}
        weekStartsOn={gridProps.weekStartsOn}
        timezone={gridProps.timezone}
        todayColor={gridProps.todayColor}
        onExit={exitMonth}
      />
    );
  }

  return <CalendarGrid {...gridProps} onMonthClick={enterMonth} />;
}
