'use client';

import type { CalendarEvent } from '@/components/calendar/calendar-utils';
import PersonalEventRow from './PersonalEventRow';
import type { AgendaDay, PersonOption } from './personal-utils';

interface PersonalUpcomingProps {
  days: AgendaDay[];
  colorMap: Map<string, { color: string; textColor?: string }>;
  timezone?: string;
  /** Epoch ms, ticking once a minute. 0 before hydration — nothing dims until
   * the client knows the time, so the server render never guesses. */
  now: number;
  people: PersonOption[];
  person: number;
  onPersonChange: (index: number) => void;
  /** Tapping a row. The shell decides whether that's the editor or a read-only
   * card — the row itself doesn't know whose calendar it's on. */
  onOpenEvent: (event: CalendarEvent) => void;
  /** Undefined when this board can't create events (read-only deployment, or
   * no calendar of its own to write to), which is what hides the button. */
  onAddEvent?: () => void;
  /** Opens the full-screen week. Undefined only if a board somehow has no
   * calendars to draw. */
  onViewWeek?: () => void;
  /** Opens the full-screen month. */
  onViewMonth?: () => void;
}

/**
 * Column 1 — "Upcoming". A vertical agenda: today (always, even when empty),
 * then every later day that has something on it.
 *
 * Agenda rather than a week grid because height is the tight axis on a
 * 1280×800 panel — 800px of rows beats 800px cut into seven columns.
 */
export default function PersonalUpcoming({
  days,
  colorMap,
  timezone,
  now,
  people,
  person,
  onPersonChange,
  onOpenEvent,
  onAddEvent,
  onViewWeek,
  onViewMonth,
}: PersonalUpcomingProps) {
  return (
    <section className="pb-col pb-col--upcoming">
      <header className="pb-col-head">
        <h2 className="pb-col-title">Upcoming</h2>
        {/* Only worth a picker when there IS someone else to look at. A board
            scoped to one person renders its own name as plain text. */}
        {people.length > 1 ? (
          <select
            className="pb-person"
            value={person}
            onChange={(e) => onPersonChange(Number(e.target.value))}
            aria-label="Whose calendar to show"
          >
            {people.map((option, i) => (
              <option key={option.label} value={i}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="pb-person pb-person--fixed">{people[0]?.label}</span>
        )}
      </header>

      <div className="pb-col-body">
        {days.map((day) => {
          const events = [...day.allDay, ...day.timed];
          return (
            <section className="pb-day" key={day.date}>
              <h3 className="pb-day-label">{day.label}</h3>
              {events.length === 0 ? (
                <p className="pb-day-empty">Nothing on your calendar today.</p>
              ) : (
                <ul className="pb-events">
                  {events.map((event) => (
                    <PersonalEventRow
                      key={`${event.calendar_id}:${event.event_id}`}
                      event={event}
                      colorMap={colorMap}
                      timezone={timezone}
                      now={now}
                      onOpen={onOpenEvent}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {/* Both views are full-screen overlays over the three columns, and both
          revert to the columns after idle (CLAUDE.md rule 1 —
          display.viewResetSeconds). */}
      <footer className="pb-col-foot">
        <button type="button" className="pb-action" onClick={onViewWeek} disabled={!onViewWeek}>
          View Week
        </button>
        <span className="pb-action-sep">|</span>
        <button type="button" className="pb-action" onClick={onViewMonth} disabled={!onViewMonth}>
          View Month
        </button>
        <span className="pb-action-sep">|</span>
        <button type="button" className="pb-action" onClick={onAddEvent} disabled={!onAddEvent}>
          Add Event
        </button>
      </footer>
    </section>
  );
}
