'use client';

import { eventPaint } from '@/components/calendar/event-paint';
import EventTitle from '@/components/calendar/EventTitle';
import type { TitleIconSet } from '@/lib/calendar/title-rules';
import { eventTimeRangeParts, type CalendarEvent } from '@/components/calendar/calendar-utils';
import { isFinished } from '@/components/calendar/calendar-utils';

/**
 * The personal board's event row: a colour rail, then the family board's own
 * three lines stacked — time range, title, location.
 *
 * It used to put the START time in a fixed left column and then repeat the whole
 * range under the title, so every row printed its start time twice. The wall has
 * never done that: `EventItem` puts one time line above the title and nothing
 * else. This is that row at a finger's scale, plus the location the wall has no
 * room for.
 *
 * Lives on its own because it is the board's unit of "one event" in more than
 * one place — the Upcoming column and both day sheets — and those must stay
 * identical.
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
  const time = event.all_day
    ? null
    : eventTimeRangeParts(event.start_time, event.end_time, timezone);

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
        <span className="pb-event-body">
          {/* Start bright, "– end" dim, exactly like .cal-event-time on the wall:
              the start is the scanning key and the end is rarely needed at a
              glance. Both colours live in CSS so the pair can be retuned there. */}
          <span className="pb-event-when">
            {time ? (
              <>
                <span className="pb-event-when-start">{time.start}</span>
                {` – ${time.end}`}
              </>
            ) : (
              <span className="pb-event-when-start">All day</span>
            )}
          </span>
          <span className="pb-event-title">
            <EventTitle
              summary={event.summary}
              icons={titleIcons}
              calendarColor={paint.shared ? undefined : paint.primary}
              empty="(No title)"
            />
          </span>
          {event.location && <span className="pb-event-where">{event.location}</span>}
        </span>
      </button>
    </li>
  );
}
