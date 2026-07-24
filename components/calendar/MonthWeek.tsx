import {
  contrastText,
  formatEventTime,
  isWeekendDate,
  type AllDaySegment,
  type CalendarEvent,
} from './calendar-utils';
import { isAdjacentMonth, shortMonthName } from './month-utils';

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
  /** When set, clicking a cell's empty area opens the create modal with that
   * date pre-filled. Omitted in read-only deployments. */
  onDayClick?: (date: string) => void;
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
              <div
                key={date}
                data-mon-body
                className={classes.join(' ')}
                // Empty-area click = create on that day (chips and "N more" stop
                // propagation; the band overlay is a sibling, so bar clicks never
                // bubble here). Only wired when writes are on.
                onClick={onDayClick ? () => onDayClick(date) : undefined}
              >
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
                    const color = colorMap.get(event.calendar_id)?.color ?? '#6b7280';
                    return (
                      <div
                        key={`${event.event_id}-${event.calendar_id}`}
                        className={onEventClick ? 'mon-chip mon-chip--clickable' : 'mon-chip'}
                        title={event.summary}
                        role={onEventClick ? 'button' : undefined}
                        tabIndex={onEventClick ? 0 : undefined}
                        onClick={
                          onEventClick
                            ? (e) => {
                                e.stopPropagation();
                                onEventClick(event);
                              }
                            : undefined
                        }
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
                        <span
                          className="mon-chip-dot"
                          style={{ backgroundColor: color }}
                          aria-hidden
                        />
                        <span className="mon-chip-time">
                          {formatEventTime(event.start_time, timezone)}
                        </span>
                        <span className="mon-chip-title">{event.summary || '(No title)'}</span>
                      </div>
                    );
                  })}
                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      className="mon-more"
                      title="Show all events for this day"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoreClick(
                          date,
                          (e.currentTarget.closest('[data-mon-body]') as HTMLElement) ??
                            e.currentTarget
                        );
                      }}
                    >
                      {hiddenCount} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* All-day band — bars span the days they cover. Drawn on top, aligned to
            the reserved spacers via the shared padding/gap geometry. */}
        {slotCount > 0 && (
          <div className="mon-band" style={{ gridTemplateRows: `repeat(${slotCount}, auto)` }}>
            {segments.map((seg) => {
              const cal = colorMap.get(seg.event.calendar_id);
              const color = cal?.color ?? '#6b7280';
              const text = cal?.textColor ?? contrastText(color);
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
                    className={
                      onEventClick ? 'mon-band-bar mon-band-bar--clickable' : 'mon-band-bar'
                    }
                    style={{ backgroundColor: color, color: text }}
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
                    {seg.event.summary || '(No title)'}
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
