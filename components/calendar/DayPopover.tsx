import EventItem from './EventItem';
import { accentStripes, eventPaint, stripes } from './event-paint';
import { contrastText, formatEventTime, isFinished, type CalendarEvent } from './calendar-utils';
import { weekdayShortOf, type PopoverBox } from './month-utils';

interface DayPopoverProps {
  date: string; // YYYY-MM-DD
  box: PopoverBox;
  today: string;
  /** The day's complete set — band bars first, then timed chips. */
  allDay: CalendarEvent[];
  timed: CalendarEvent[];
  colorMap: Map<string, { color: string; textColor?: string }>;
  /** IANA zone for event times. Undefined = browser-local. */
  timezone?: string;
  /** Today's marker color, for the header's day-number pill. */
  todayColor: string;
  /** Wall-clock ms from `useMinuteTick`, so a finished event dims here exactly
   * as it does in the column behind. 0 dims nothing. */
  now: number;
  onClose: () => void;
  /** When set, rows open the edit modal. Omitted in read-only deployments —
   * the popover is a read surface there, as in month view. */
  onEventClick?: (event: CalendarEvent) => void;
}

/**
 * The wall's "+N more" day popover: one day's complete event list, floating
 * over the week grid.
 *
 * Month view has its own (`MonthDayPopover`) and this is deliberately not it.
 * The two share the part that is genuinely one thing — `popoverLayout()`, the
 * clamping math that keeps the card inside the calendar region — and nothing
 * else. `.mon-pop` is sized in `em` against `.mon-calendar`'s `clamp()` font
 * size and draws its rows as month chips; rendered on the wall it would come
 * out at the wrong scale AND in a different visual language from the column
 * directly behind it. So this one is `rem` like the rest of the wall's chrome
 * and renders real `EventItem` rows: the popover reads as that cell, zoomed.
 *
 * It mounts inside `.cal-grid` and never inside `.cal-weeks` — same containment
 * as month view, and for the same two reasons: `.cal-weeks` is `overflow: clip`
 * and would cut the card off, and its hidden measurement layer must never see
 * anything that isn't a real event row.
 */
export default function DayPopover({
  date,
  box,
  today,
  allDay,
  timed,
  colorMap,
  timezone,
  todayColor,
  now,
  onClose,
  onEventClick,
}: DayPopoverProps) {
  const dayNum = Number(date.slice(8, 10));
  const isPastDay = date < today;
  const isToday = date === today;

  return (
    <div
      className="cal-pop"
      style={{ left: box.left, top: box.top, width: box.width, maxHeight: box.maxHeight }}
      role="dialog"
      aria-label={`Events on ${weekdayShortOf(date)} ${date}`}
    >
      <div className="cal-pop-header">
        <span className="cal-pop-weekday">{weekdayShortOf(date)}</span>
        <span
          className={isToday ? 'cal-pop-daynum cal-pop-daynum--today' : 'cal-pop-daynum'}
          style={
            isToday ? { backgroundColor: todayColor, color: contrastText(todayColor) } : undefined
          }
        >
          {dayNum}
        </span>
        <button
          type="button"
          className="cal-pop-close"
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
        >
          ×
        </button>
      </div>

      {/* A past day keeps the grid's dim, so the card reads as that cell rather
          than as a different surface. */}
      <div className={isPastDay ? 'cal-pop-list cal-pop-list--past' : 'cal-pop-list'}>
        {allDay.map((event) => {
          const paint = eventPaint(event, colorMap);
          // A timed event in this list ran past midnight, so it carries its
          // times the way the band bar does — see WeekRow.
          const spanning = !event.all_day;
          return (
            <div
              key={`${event.event_id}-${event.calendar_id}`}
              className={[
                'cal-band-bar',
                onEventClick ? 'cal-band-bar--clickable' : '',
                spanning ? 'cal-band-bar--timed' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={
                paint.shared
                  ? { background: stripes(paint.colors), color: '#fff' }
                  : { backgroundColor: paint.primary, color: paint.textColor }
              }
              title={event.summary}
              role={onEventClick ? 'button' : undefined}
              tabIndex={onEventClick ? 0 : undefined}
              onClick={onEventClick ? () => onEventClick(event) : undefined}
              onKeyDown={
                onEventClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onEventClick(event);
                      }
                    }
                  : undefined
              }
            >
              {spanning && (
                <span className="cal-band-time">{formatEventTime(event.start_time, timezone)}</span>
              )}
              {paint.shared ? (
                <span className="cal-band-label">{event.summary || '(No title)'}</span>
              ) : (
                event.summary || '(No title)'
              )}
              {spanning && (
                <span className="cal-band-end">{formatEventTime(event.end_time, timezone)}</span>
              )}
            </div>
          );
        })}

        {timed.map((event) => {
          const paint = eventPaint(event, colorMap);
          return (
            <EventItem
              key={`${event.event_id}-${event.calendar_id}`}
              event={event}
              color={paint.primary}
              accent={paint.shared ? accentStripes(paint.colors) : undefined}
              timeZone={timezone}
              past={isToday && now > 0 && isFinished(event, now)}
              onClick={onEventClick ? () => onEventClick(event) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
