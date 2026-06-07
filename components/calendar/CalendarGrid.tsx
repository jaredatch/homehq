'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import DayColumn from './DayColumn';
import {
  assignEventsToDays,
  formatLocalDate,
  formatSyncLabel,
  generateRollingDays,
  type CalendarEvent,
  type SyncStatus,
} from './calendar-utils';

interface CalendarGridProps {
  calendars: { id: string; name: string; color: string }[];
  weeks: number;
}

const POLL_INTERVAL_MS = 60_000;

export default function CalendarGrid({ calendars, weeks }: CalendarGridProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [sync, setSync] = useState<SyncStatus>({
    lastSuccess: null,
    lastAttempt: null,
    lastError: null,
  });
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState(() => formatLocalDate(new Date()));

  const totalDays = weeks * 7;

  const colorMap = useMemo(() => new Map(calendars.map((c) => [c.id, c.color])), [calendars]);

  const fetchEvents = useCallback(async () => {
    // Update today on each poll (handles midnight rollover)
    const currentToday = formatLocalDate(new Date());
    setToday(currentToday);

    const endDate = new Date();
    endDate.setHours(0, 0, 0, 0);
    endDate.setDate(endDate.getDate() + totalDays);
    const end = formatLocalDate(endDate);

    try {
      const res = await fetch(`/api/calendar?start=${currentToday}&end=${end}`);
      if (!res.ok) return;
      const data = await res.json();
      setEvents(data.events);
      setSync(data.sync);
    } catch {
      // Keep existing data — resilience first
    } finally {
      setLoading(false);
    }
  }, [totalDays]);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  const days = useMemo(() => generateRollingDays(today, totalDays), [today, totalDays]);
  const dayEventsMap = useMemo(() => assignEventsToDays(events, days), [events, days]);

  return (
    <div className="flex h-full flex-col">
      {/* Calendar grid */}
      <div
        className="grid flex-1 grid-cols-7 gap-px bg-gray-800"
        style={{ gridTemplateRows: `repeat(${weeks}, 1fr)` }}
      >
        {days.map((date, index) => {
          const dayData = dayEventsMap.get(date)!;
          return (
            <DayColumn
              key={date}
              date={date}
              isToday={date === today}
              showMonth={index === 0 || date.slice(8, 10) === '01'}
              allDayEvents={dayData.allDay}
              timedEvents={dayData.timed}
              colorMap={colorMap}
            />
          );
        })}
      </div>

      {/* Sync indicator */}
      {(() => {
        const label = loading ? { text: 'Loading\u2026', isError: false } : formatSyncLabel(sync);
        return (
          <div
            className={`shrink-0 px-4 py-1 text-right text-[11px] ${
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
