import { contrastText, formatEventTime, type CalendarEvent } from './calendar-utils';
import { weekdayShortOf, type PopoverBox } from './month-utils';
import { eventPaint, stripes } from './event-paint';

interface MonthDayPopoverProps {
  date: string; // YYYY-MM-DD
  box: PopoverBox;
  today: string;
  /** The day's complete event set — all-day bars first, then timed chips. */
  allDay: CalendarEvent[];
  timed: CalendarEvent[];
  colorMap: Map<string, { color: string; textColor?: string }>;
  /** IANA zone for event times. Undefined = browser-local. */
  timezone?: string;
  /** Today's marker color, for the header's day-number pill. */
  todayColor: string;
  onClose: () => void;
  /** When set, rows are clickable and open the edit modal. Omitted in
   * read-only deployments — the popover is a read surface there. */
  onEventClick?: (event: CalendarEvent) => void;
}

/**
 * The "+N more" day popover — a floating card over the month grid showing one
 * day's complete event list in the grid's own visual language: all-day bars on
 * top, timed chips below, Google-style weekday + day-number header, X close.
 *
 * It renders inside .mon-calendar but OUTSIDE .mon-grid, so the grid's hidden
 * unit samples and capacity math are untouched. A long day scrolls inside
 * .mon-pop-list — deliberately contained, because the page itself can never
 * scroll (.app-main is overflow:clip).
 */
export default function MonthDayPopover({
  date,
  box,
  today,
  allDay,
  timed,
  colorMap,
  timezone,
  todayColor,
  onClose,
  onEventClick,
}: MonthDayPopoverProps) {
  const dayNum = Number(date.slice(8, 10));
  const isPastDay = date < today;

  const rowProps = (event: CalendarEvent) =>
    onEventClick
      ? {
          role: 'button' as const,
          tabIndex: 0,
          onClick: () => onEventClick(event),
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onEventClick(event);
            }
          },
        }
      : {};

  return (
    <div
      className="mon-pop"
      style={{ left: box.left, top: box.top, width: box.width, maxHeight: box.maxHeight }}
      role="dialog"
      aria-label={`Events on ${weekdayShortOf(date)} ${date}`}
    >
      <div className="mon-pop-header">
        <span className="mon-pop-weekday">{weekdayShortOf(date)}</span>
        <span
          className={date === today ? 'mon-pop-daynum mon-pop-daynum--today' : 'mon-pop-daynum'}
          style={
            date === today
              ? { backgroundColor: todayColor, color: contrastText(todayColor) }
              : undefined
          }
        >
          {dayNum}
        </span>
        <button
          type="button"
          className="mon-pop-close"
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
        >
          ×
        </button>
      </div>

      {/* Past days keep the grid's gentle dim so the popover reads as a zoomed-in
          cell, not a different surface. */}
      <div className={isPastDay ? 'mon-pop-list mon-pop-list--past' : 'mon-pop-list'}>
        {allDay.map((event) => {
          const paint = eventPaint(event, colorMap);
          return (
            <div
              key={`${event.event_id}-${event.calendar_id}`}
              className={onEventClick ? 'mon-band-bar mon-band-bar--clickable' : 'mon-band-bar'}
              style={
                paint.shared
                  ? { background: stripes(paint.colors), color: '#fff' }
                  : { backgroundColor: paint.primary, color: paint.textColor }
              }
              title={event.summary}
              {...rowProps(event)}
            >
              {paint.shared ? (
                <span className="cal-band-label">{event.summary || '(No title)'}</span>
              ) : (
                event.summary || '(No title)'
              )}
            </div>
          );
        })}
        {timed.map((event) => {
          const paint = eventPaint(event, colorMap);
          return (
            <div
              key={`${event.event_id}-${event.calendar_id}`}
              className={onEventClick ? 'mon-chip mon-chip--clickable' : 'mon-chip'}
              title={event.summary}
              {...rowProps(event)}
            >
              {/* Two whole dots when shared — see MonthWeek. */}
              {paint.shared ? (
                <span className="mon-chip-dots" aria-hidden>
                  {paint.colors.map((c, i) => (
                    <span key={i} className="mon-chip-dot" style={{ backgroundColor: c }} />
                  ))}
                </span>
              ) : (
                <span
                  className="mon-chip-dot"
                  style={{ backgroundColor: paint.primary }}
                  aria-hidden
                />
              )}
              <span className="mon-chip-time">{formatEventTime(event.start_time, timezone)}</span>
              <span className="mon-chip-title">{event.summary || '(No title)'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
