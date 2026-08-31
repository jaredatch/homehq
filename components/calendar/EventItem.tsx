import { eventTimeRangeParts } from './calendar-utils';

interface EventItemProps {
  event: {
    event_id: string;
    calendar_id: string;
    summary: string;
    start_time: string;
    end_time: string;
  };
  /** The calendar's colour. Paints the accent rail and nothing else -- the row's
   * text is neutral on purpose, so this is the whole colour signal. */
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
  /** This event has already finished, so it dims the way a past day does.
   * Opacity only — it can never change the row's height, which the measurement
   * layer depends on. */
  past?: boolean;
}

// Timed events only — all-day events render as spanning bars in WeekRow's band.
export default function EventItem({
  event,
  color,
  accent,
  timeZone,
  onClick,
  past,
}: EventItemProps) {
  const interactive = !!onClick;
  const time = eventTimeRangeParts(event.start_time, event.end_time, timeZone);
  return (
    <div
      data-event-row
      className={[
        'cal-event',
        interactive ? 'cal-event--clickable' : '',
        past ? 'cal-event--past' : '',
      ]
        .filter(Boolean)
        .join(' ')}
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
      {/* The rail is the row's ONLY per-calendar colour -- the time used to be
          tinted with it as well, and dropping that is what lets the rail be
          wide enough to read from across the room. Width is rem-based so it
          scales with the wall (see .cal-event-accent). */}
      <span
        className="cal-event-accent"
        style={accent ? { background: accent } : { backgroundColor: color }}
        aria-hidden
      />
      {/* Start time is wrapped so it can be styled apart from the rest of the
          range; the separator and end stay a plain text node beside it and take
          the dimmer parent colour. Both colours live in CSS, deliberately: an
          inline `color` here would win over the stylesheet and there would be no
          way to retune the pair without editing the component. */}
      <div className="cal-event-time">
        <span className="cal-event-time-start">{time.start}</span>
        {` – ${time.end}`}
      </div>
      <div className="cal-event-title">{event.summary || '(No title)'}</div>
    </div>
  );
}
