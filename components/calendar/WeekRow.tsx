import EventItem from './EventItem';
import {
  contrastText,
  isWeekendDate,
  type AllDaySegment,
  type CalendarEvent,
} from './calendar-utils';

interface WeekRowProps {
  weekDays: string[]; // 7 date strings (YYYY-MM-DD)
  weekIndex: number; // 0 = current week
  today: string;
  segments: AllDaySegment[]; // all-day spanning bars for this week
  slotCount: number; // band rows used
  /** Per-column band rows to reserve at the top of each day's cell (0 = none). */
  laneByColumn: number[];
  timedByDay: Map<string, CalendarEvent[]>;
  colorMap: Map<string, { color: string; textColor?: string }>;
  /** Per-column count of timed events to show; the rest collapse to "+N more".
   * Infinity = show all (protected days). */
  capacities: number[];
  /** IANA zone for event times. Undefined = browser-local. */
  timezone?: string;
  /** Today's accent dot color (any CSS color), from config.display.todayColor. */
  todayColor: string;
  /** Click handler for a day's "+N more" — receives this row's week index so the
   * grid can expand next week (week ≥ 1) or return to normal (week 0). */
  onMoreClick: (weekIndex: number) => void;
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function dayNumber(dateStr: string): { dayNum: number; monthName: string } {
  const [, m, d] = dateStr.split('-').map(Number);
  return { dayNum: d, monthName: MONTH_NAMES[m - 1] };
}

export default function WeekRow({
  weekDays,
  weekIndex,
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
}: WeekRowProps) {
  return (
    <div className="cal-week">
      {/* Continuous background — column tints + 1px separators behind everything,
          so the all-day band's spanning bars sit on an unbroken grid. */}
      <div className="cal-week-bg" aria-hidden>
        {weekDays.map((date) => (
          <div
            key={date}
            className={isWeekendDate(date) ? 'cal-bg-cell cal-bg-cell--weekend' : 'cal-bg-cell'}
          />
        ))}
      </div>

      {/* Header row — weekday lives in the shared header above the grid; here it's
          the date, with today marked by an accent + underline (no full-cell tint). */}
      <div className="cal-week-header">
        {weekDays.map((date) => {
          const isToday = date === today;
          const isPast = date < today;
          const { dayNum, monthName } = dayNumber(date);
          const showMonth = (weekIndex === 0 && date === weekDays[0]) || date.slice(8, 10) === '01';
          return (
            <div key={date} data-day-header className="cal-day-header">
              {/* Today is styled like every other day; a dot is the only marker. */}
              <span className="cal-day-header-row">
                <span className={`cal-date ${isPast ? 'cal-date--past' : ''}`}>
                  {showMonth ? `${monthName} ${dayNum}` : dayNum}
                </span>
                {isToday && (
                  <span
                    className="cal-today-dot"
                    style={{ backgroundColor: todayColor }}
                    aria-hidden
                  />
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* Content area — timed stacks in normal flow, all-day bars as an absolute
          overlay on top. Each day reserves only the band rows that actually touch
          it (invisible spacers), so days no all-day event covers start at the top
          and reclaim the space instead of holding a uniform per-week placeholder. */}
      <div className="cal-week-content">
        {/* Timed events — one stack per day, dimmed for days already past. */}
        <div className="cal-week-timed">
          {weekDays.map((date, col) => {
            const isPast = date < today;
            const lanes = laneByColumn[col] ?? 0;
            const timed = timedByDay.get(date) ?? [];
            const capacity = capacities[col] ?? Infinity;
            const visible = timed.slice(0, Math.max(0, capacity));
            const hiddenCount = timed.length - visible.length;
            return (
              <div key={date} data-events className={`cal-day ${isPast ? 'cal-day--past' : ''}`}>
                {/* Reserve this column's band rows with invisible, self-sizing
                    bars — same box as a real bar, so the overlay lines up without
                    passing pixel measurements down. */}
                {lanes > 0 && (
                  <div aria-hidden className="cal-band-reserve">
                    {Array.from({ length: lanes }).map((_, i) => (
                      <div key={i} className="cal-band-spacer">
                        &nbsp;
                      </div>
                    ))}
                  </div>
                )}
                <div className="cal-day-events">
                  {visible.map((event) => {
                    const cal = colorMap.get(event.calendar_id);
                    return (
                      <EventItem
                        key={`${event.event_id}-${event.calendar_id}`}
                        event={event}
                        color={cal?.color ?? '#6b7280'}
                        timeZone={timezone}
                      />
                    );
                  })}
                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      className="cal-more"
                      onClick={() => onMoreClick(weekIndex)}
                      title={
                        weekIndex === 0
                          ? 'Back to the normal view'
                          : 'Expand next week to show all its events'
                      }
                    >
                      +{hiddenCount} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* All-day band — events span the days they cover instead of repeating.
            Drawn last (on top) and aligned to the reserved spacers above via the
            shared pt-0.5 / gap-px / row geometry. */}
        {slotCount > 0 && (
          <div
            data-band
            className="cal-band"
            style={{ gridTemplateRows: `repeat(${slotCount}, auto)` }}
          >
            {segments.map((seg) => {
              const cal = colorMap.get(seg.event.calendar_id);
              const color = cal?.color ?? '#6b7280';
              const text = cal?.textColor ?? contrastText(color);
              // Dim a bar only if its whole span is past — a multi-day event that
              // still reaches today/future stays bright, like timed events do.
              const isPast = weekDays[seg.startCol + seg.span - 1] < today;
              return (
                <div
                  key={`${seg.event.event_id}-${seg.event.calendar_id}`}
                  className={`cal-band-seg ${isPast ? 'cal-band-seg--past' : ''}`}
                  style={{
                    gridColumn: `${seg.startCol + 1} / span ${seg.span}`,
                    gridRow: seg.slot + 1,
                  }}
                >
                  <div
                    data-band-row
                    className="cal-band-bar"
                    style={{ backgroundColor: color, color: text }}
                    title={seg.event.summary}
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
