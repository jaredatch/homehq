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
  /** CSS `background` for the accent bar, set only on a shared event (a
   * two-tone split). Undefined leaves the bar a solid `color`, unchanged. */
  accent?: string;
  /** IANA zone for the time range. Undefined = browser-local. */
  timeZone?: string;
  /** When set, the row becomes clickable (opens the edit modal). Omitted on the
   * hidden measurement layer and in read-only deployments, so the box is
   * unchanged there. */
  onClick?: () => void;
}

// Timed events only — all-day events render as spanning bars in WeekRow's band.
export default function EventItem({ event, color, accent, timeZone, onClick }: EventItemProps) {
  const interactive = !!onClick;
  return (
    <div
      data-event-row
      className={interactive ? 'cal-event cal-event--clickable' : 'cal-event'}
      title={event.summary}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick!();
              }
            }
          : undefined
      }
    >
      {/* Accent bar, inset top/bottom so events read as slightly more spaced.
          Width is rem-based so it scales with the wall. */}
      <span
        className="cal-event-accent"
        style={accent ? { background: accent } : { backgroundColor: color }}
        aria-hidden
      />
      <div className="cal-event-time" style={{ color }}>
        {formatEventTimeRange(event.start_time, event.end_time, timeZone)}
      </div>
      <div className="cal-event-title">{event.summary || '(No title)'}</div>
    </div>
  );
}
