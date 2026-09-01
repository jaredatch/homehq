import {
  contrastText,
  formatEventTime,
  isWeekendDate,
  type AllDaySegment,
  type CalendarEvent,
} from './calendar-utils';
import { isAdjacentMonth, shortMonthName } from './month-utils';
import { eventPaint, stripes } from './event-paint';
import EventTitle from './EventTitle';
import type { TitleIconSet } from '@/lib/calendar/title-rules';

interface MonthWeekProps {
  weekDays: string[]; // 7 date strings (YYYY-MM-DD)
  /** Month being rendered (`YYYY-MM`); days outside it dim as adjacent-month. */
  month: string;
  today: string;
  segments: AllDaySegment[]; // all-day spanning bars for this week
  slotCount: number; // band rows used
  /** Per-column band rows to reserve at the top of each day's cell (0 = none). */
  laneByColumn: number[];
  timedByDay: Map<string, CalendarEvent[]>;
  colorMap: Map<string, { color: string; textColor?: string }>;
  /** Per-column count of timed chips to show; the rest collapse to "N more". */
  capacities: number[];
  /** IANA zone for event times. Undefined = browser-local. */
  timezone?: string;
  /** Today's marker color (any CSS color), from config.display.todayColor. */
  todayColor: string;
  /** A day's "N more" was clicked — open its popover, anchored to the cell.
   * Always wired: the popover is a read surface, so it works in readonly too. */
  onMoreClick: (date: string, cell: HTMLElement) => void;
  /** When set, chips + bars are clickable and open the edit modal. Omitted in
   * read-only deployments, so events stay inert there (like the wall). */
  onEventClick?: (event: CalendarEvent) => void;
  /** When set, each cell grows a hover-revealed "+" in its bottom-right corner
   * that opens the create modal with that date pre-filled. A deliberate button
   * — not a whole-cell click target — so there are no accidental modal opens,
   * and a day already full of events can still take one more. Omitted in
   * read-only deployments. */
  onDayClick?: (date: string) => void;
  /** Configured title-icon rules (display.titleIcons). Undefined draws every
   * chip and bar with the bare title it always had. */
  titleIcons?: TitleIconSet;
}

/**
 * One week row of the month grid. Deliberately mirrors WeekRow's proven
 * structure — continuous background, a header row of day numbers, then a
 * content area where timed events sit in per-day stacks and all-day events are
 * an absolute spanning overlay lined up against invisible per-column spacers.
 *
 * The difference from the wall: timed events render as uniform single-line
 * chips, so nothing here needs measuring per event.
 */
export default function MonthWeek({
  weekDays,
  month,
  today,
  segments,
  slotCount,
  laneByColumn,
  timedByDay,
  colorMap,
  capacities,
  timezone,
  todayColor,
  onMoreClick,
  onEventClick,
  onDayClick,
  titleIcons,
}: MonthWeekProps) {
  return (
    <div className="mon-week">
      {/* Continuous background — column tints + 1px separators behind
          everything, so the spanning all-day bars sit on an unbroken grid. */}
      <div className="mon-week-bg" aria-hidden>
        {weekDays.map((date) => {
          // Today wins over weekend/adjacent tints — a faint "you are here" lift
          // that the dense grid needs (the small pill alone is easy to lose).
          const classes = ['mon-bg-cell'];
          if (date === today) classes.push('mon-bg-cell--today');
          else if (isAdjacentMonth(date, month)) classes.push('mon-bg-cell--adjacent');
          else if (isWeekendDate(date)) classes.push('mon-bg-cell--weekend');
          return <div key={date} className={classes.join(' ')} />;
        })}
      </div>

      {/* Day numbers — right-aligned (Fantastical), month-prefixed on the 1st
          (both references), today filled with the configured accent. */}
      <div className="mon-week-header">
        {weekDays.map((date) => {
          const isToday = date === today;
          const isPast = date < today;
          const adjacent = isAdjacentMonth(date, month);
          const dayNum = Number(date.slice(8, 10));
          const label = dayNum === 1 ? `${shortMonthName(date)} 1` : String(dayNum);
          const classes = ['mon-date'];
          if (adjacent) classes.push('mon-date--adjacent');
          else if (isPast) classes.push('mon-date--past');
          return (
            <div key={date} data-mon-header className="mon-day-header">
              {isToday ? (
                <span
                  className="mon-date mon-date--today"
                  style={{ backgroundColor: todayColor, color: contrastText(todayColor) }}
                >
                  {label}
                </span>
              ) : (
                <span className={classes.join(' ')}>{label}</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mon-week-content">
        {/* Timed chips — one stack per day, below this column's band reservation. */}
        <div className="mon-week-days">
          {weekDays.map((date, col) => {
            const isPast = date < today;
            const adjacent = isAdjacentMonth(date, month);
            const lanes = laneByColumn[col] ?? 0;
            const timed = timedByDay.get(date) ?? [];
            const capacity = capacities[col] ?? Infinity;
            const visible = timed.slice(0, Math.max(0, capacity));
            const hiddenCount = timed.length - visible.length;
            const classes = ['mon-day'];
            if (isPast) classes.push('mon-day--past');
            else if (adjacent) classes.push('mon-day--adjacent');
            return (
              <div key={date} data-mon-body className={classes.join(' ')}>
                {/* Same per-column reservation trick as the wall: invisible bars
                    in the same box as real ones, so the overlay lines up without
                    threading pixel measurements down. */}
                {lanes > 0 && (
                  <div aria-hidden className="mon-band-reserve">
                    {Array.from({ length: lanes }).map((_, i) => (
                      <div key={i} className="mon-band-bar mon-band-bar--spacer">
                        &nbsp;
                      </div>
                    ))}
                  </div>
                )}
                <div className="mon-day-events">
                  {visible.map((event) => {
                    const paint = eventPaint(event, colorMap);
                    return (
                      <div
                        key={`${event.event_id}-${event.calendar_id}`}
                        className={onEventClick ? 'mon-chip mon-chip--clickable' : 'mon-chip'}
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
                        {/* Google's chip order: dot · time · title, all left,
                            time first — the scanning key for "when is it" — with
                            the title truncating at the cell edge. */}
                        {/* Two whole dots, not one split circle: a split reads as
                            a single muddy color when the two calendars are close
                            in hue (Maddie pink beside Eleanor purple). Separate
                            dots keep each color legible on its own. */}
                        {paint.shared ? (
                          <span className="mon-chip-dots" aria-hidden>
                            {paint.colors.map((c, i) => (
                              <span
                                key={i}
                                className="mon-chip-dot"
                                style={{ backgroundColor: c }}
                              />
                            ))}
                          </span>
                        ) : (
                          <span
                            className="mon-chip-dot"
                            style={{ backgroundColor: paint.primary }}
                            aria-hidden
                          />
                        )}
                        <span className="mon-chip-time">
                          {formatEventTime(event.start_time, timezone)}
                        </span>
                        <span className="mon-chip-title">
                          <EventTitle
                            summary={event.summary}
                            icons={titleIcons}
                            calendarColor={paint.shared ? undefined : paint.primary}
                            empty="(No title)"
                          />
                        </span>
                      </div>
                    );
                  })}
                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      className="mon-more"
                      title="Show all events for this day"
                      onClick={(e) =>
                        onMoreClick(
                          date,
                          (e.currentTarget.closest('[data-mon-body]') as HTMLElement) ??
                            e.currentTarget
                        )
                      }
                    >
                      {hiddenCount} more
                    </button>
                  )}
                </div>
                {/* Hover-revealed "add on this day" — floats over the corner, so
                    it works even when the cell is full and cropping. */}
                {onDayClick && (
                  <button
                    type="button"
                    className="mon-day-add"
                    title="Add an event on this day"
                    aria-label={`Add an event on ${date}`}
                    onClick={() => onDayClick(date)}
                  >
                    +
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* All-day band — bars span the days they cover. Drawn on top, aligned to
            the reserved spacers via the shared padding/gap geometry. */}
        {slotCount > 0 && (
          <div className="mon-band" style={{ gridTemplateRows: `repeat(${slotCount}, auto)` }}>
            {segments.map((seg) => {
              const paint = eventPaint(seg.event, colorMap);
              const color = paint.primary;
              const text = paint.textColor;
              // Dim only if the whole span is past — a multi-day event that still
              // reaches today stays bright, matching the wall. Adjacent-month days
              // deliberately do NOT dim bars: both references keep a spanning bar
              // at full strength across the month boundary.
              const isPast = weekDays[seg.startCol + seg.span - 1] < today;
              return (
                <div
                  key={`${seg.event.event_id}-${seg.event.calendar_id}`}
                  className={`mon-band-seg ${isPast ? 'mon-band-seg--past' : ''}`}
                  style={{
                    gridColumn: `${seg.startCol + 1} / span ${seg.span}`,
                    gridRow: seg.slot + 1,
                  }}
                >
                  <div
                    className={[
                      'mon-band-bar',
                      onEventClick ? 'mon-band-bar--clickable' : '',
                      seg.event.all_day ? '' : 'mon-band-bar--timed',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={
                      paint.shared
                        ? { background: stripes(paint.colors), color: '#fff' }
                        : { backgroundColor: color, color: text }
                    }
                    title={seg.event.summary}
                    role={onEventClick ? 'button' : undefined}
                    tabIndex={onEventClick ? 0 : undefined}
                    onClick={onEventClick ? () => onEventClick(seg.event) : undefined}
                    onKeyDown={
                      onEventClick
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onEventClick(seg.event);
                            }
                          }
                        : undefined
                    }
                  >
                    {/* A timed bar ran past midnight and carries its times —
                        see WeekRow. Timed-only, so all-day bars are unchanged. */}
                    {!seg.event.all_day && (
                      <span className="mon-band-time">
                        {formatEventTime(seg.event.start_time, timezone)}
                      </span>
                    )}
                    {/* Scrimmed only when shared — see WeekRow. */}
                    {paint.shared ? (
                      <span className="cal-band-label">
                        <EventTitle
                          summary={seg.event.summary}
                          icons={titleIcons}
                          onFill
                          empty="(No title)"
                        />
                      </span>
                    ) : (
                      <EventTitle
                        summary={seg.event.summary}
                        icons={titleIcons}
                        onFill
                        empty="(No title)"
                      />
                    )}
                    {!seg.event.all_day && (
                      <span className="mon-band-end">
                        {formatEventTime(seg.event.end_time, timezone)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
