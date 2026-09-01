'use client';

import { eventPaint } from '@/components/calendar/event-paint';
import EventTitle from '@/components/calendar/EventTitle';
import type { TitleIconSet } from '@/lib/calendar/title-rules';
import {
  formatEventTime,
  formatEventTimeRange,
  type CalendarEvent,
} from '@/components/calendar/calendar-utils';
import { isFinished } from '@/components/calendar/calendar-utils';

/**
 * The personal board's event row: colour rail · start time · title, with the
 * time range and location on a quieter second line.
 *
 * Lives on its own because it is the board's unit of "one event" in more than
 * one place — the Upcoming column and the week view's day sheet — and those two
 * must stay identical. It is deliberately NOT the wall's `EventItem`: that one
 * is a dense chip sized for a 27" panel read from across the room.
 */

export interface PersonalEventRowProps {
  event: CalendarEvent;
  colorMap: Map<string, { color: string; textColor?: string }>;
  timezone?: string;
  /** Epoch ms, ticking once a minute. 0 before hydration — nothing dims until
   * the client knows the time, so the server render never guesses. */
  now: number;
  onOpen: (event: CalendarEvent) => void;
  /** Configured title-icon rules (display.titleIcons), merged with this board's
   * own display overrides — a personal board draws the same conventions the
   * kitchen wall does. */
  titleIcons?: TitleIconSet;
}

/** The colour rail down the left of a row. A shared event carries two calendar
 * colours, so the rail splits rather than picking a winner — the same "one
 * event, two people" story the wall tells, in the space a rail has. */
export function railStyle(colors: string[]): string {
  if (colors.length < 2) return colors[0];
  const stop = 100 / colors.length;
  return `linear-gradient(180deg, ${colors
    .map((c, i) => `${c} ${i * stop}% ${(i + 1) * stop}%`)
    .join(', ')})`;
}

export default function PersonalEventRow({
  event,
  colorMap,
  timezone,
  now,
  onOpen,
  titleIcons,
}: PersonalEventRowProps) {
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
          <span className="pb-event-title">
            <EventTitle
              summary={event.summary}
              icons={titleIcons}
              calendarColor={paint.shared ? undefined : paint.primary}
            />
          </span>
          {meta && <span className="pb-event-meta">{meta}</span>}
        </span>
      </button>
    </li>
  );
}
