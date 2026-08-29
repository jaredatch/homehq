'use client';

import { eventPaint } from '@/components/calendar/event-paint';
import {
  formatEventTime,
  formatEventTimeRange,
  type CalendarEvent,
} from '@/components/calendar/calendar-utils';
import { isFinished, type AgendaDay, type PersonOption } from './personal-utils';

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
}

/** The colour rail down the left of a row. A shared event carries two calendar
 * colours, so the rail splits rather than picking a winner — the same "one
 * event, two people" story the wall tells, in the space a rail has. */
function railStyle(colors: string[]): string {
  if (colors.length < 2) return colors[0];
  const stop = 100 / colors.length;
  return `linear-gradient(180deg, ${colors
    .map((c, i) => `${c} ${i * stop}% ${(i + 1) * stop}%`)
    .join(', ')})`;
}

function EventRow({
  event,
  colorMap,
  timezone,
  now,
  onOpen,
}: {
  event: CalendarEvent;
  colorMap: PersonalUpcomingProps['colorMap'];
  timezone?: string;
  now: number;
  onOpen: (event: CalendarEvent) => void;
}) {
  const paint = eventPaint(event, colorMap);
  const past = now > 0 && isFinished(event, now);
  const meta = [
    event.all_day ? null : formatEventTimeRange(event.start_time, event.end_time, timezone),
    event.location,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="pb-event-item">
      {/* The whole row is the target. A 10" panel has no room for a separate
          affordance, and every row leads somewhere — hers to the editor,
          everyone else's to a read-only card. */}
      <button
        type="button"
        className={`pb-event${past ? ' pb-event--past' : ''}`}
        onClick={() => onOpen(event)}
      >
        <span className="pb-event-rail" style={{ background: railStyle(paint.colors) }} />
        <span className="pb-event-when">
          {event.all_day ? 'All day' : formatEventTime(event.start_time, timezone)}
        </span>
        <span className="pb-event-body">
          <span className="pb-event-title">{event.summary}</span>
          {meta && <span className="pb-event-meta">{meta}</span>}
        </span>
      </button>
    </li>
  );
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
                    <EventRow
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

      {/* The two views land in Phase 5 — see private/personal-boards-plan.md.
          Rendered disabled rather than hidden so the column's proportions are
          the real ones from day one. */}
      <footer className="pb-col-foot">
        <button type="button" className="pb-action" disabled>
          View Week
        </button>
        <span className="pb-action-sep">|</span>
        <button type="button" className="pb-action" disabled>
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
