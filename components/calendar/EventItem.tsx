import { formatEventTimeRange } from './calendar-utils';

interface EventItemProps {
  event: {
    event_id: string;
    calendar_id: string;
    summary: string;
    start_time: string;
    end_time: string;
  };
  color: string;
  /** IANA zone for the time range. Undefined = browser-local. */
  timeZone?: string;
}

// Timed events only — all-day events render as spanning bars in WeekRow's band.
export default function EventItem({ event, color, timeZone }: EventItemProps) {
  return (
    <div data-event-row className="cal-event" title={event.summary}>
      {/* Accent bar, inset top/bottom so events read as slightly more spaced.
          Width is rem-based so it scales with the wall. */}
      <span className="cal-event-accent" style={{ backgroundColor: color }} aria-hidden />
      <div className="cal-event-time" style={{ color }}>
        {formatEventTimeRange(event.start_time, event.end_time, timeZone)}
      </div>
      <div className="cal-event-title">{event.summary || '(No title)'}</div>
    </div>
  );
}
