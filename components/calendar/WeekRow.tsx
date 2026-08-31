import EventItem from './EventItem';
import {
  formatEventTime,
  isFinished,
  isWeekendDate,
  type AllDaySegment,
  type CalendarEvent,
} from './calendar-utils';
import { accentStripes, eventPaint, stripes } from './event-paint';

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
  /** Wall-clock ms, from `useMinuteTick`. Dims events on TODAY that have
   * already finished, so the current column reads like the past days do. 0 (or
   * omitted) dims nothing — that's the server render, before the client knows
   * the time. Only today: a past day's whole cell already dims, and dimming
   * twice would compound to 16%. */
  now?: number;
  /** Click handler for a day's "+N more" — receives this row's week index so the
   * grid can expand next week (week ≥ 1) or return to normal (week 0). */
  /** A day's "+N more" was clicked. The wall uses `weekIndex` to move its
   * expand anchor; the personal board's week uses `date` to open that day in
   * full. Both are passed so neither caller has to derive the other. */
  onMoreClick: (weekIndex: number, date: string) => void;
  /** Tooltip for "+N more". The wall's default describes the expand toggle it
   * drives; a caller that does something else with the click says so here. */
  moreTitle?: (date: string, hiddenCount: number) => string;
  /** When set, events are clickable and open the edit modal. Omitted in
   * read-only deployments, so events stay inert there. */
  onEventClick?: (event: CalendarEvent) => void;
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
  now = 0,
  onMoreClick,
  moreTitle,
  onEventClick,
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
            // Only today's column dims per event; see the `now` prop.
            const dimFinished = date === today && now > 0;
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
                    const paint = eventPaint(event, colorMap);
                    return (
                      <EventItem
                        key={`${event.event_id}-${event.calendar_id}`}
                        event={event}
                        color={paint.primary}
                        accent={paint.shared ? accentStripes(paint.colors) : undefined}
                        timeZone={timezone}
                        past={dimFinished && isFinished(event, now)}
                        onClick={onEventClick ? () => onEventClick(event) : undefined}
                      />
                    );
                  })}
                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      className="cal-more"
                      onClick={() => onMoreClick(weekIndex, date)}
                      title={
                        moreTitle
                          ? moreTitle(date, hiddenCount)
                          : weekIndex === 0
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
              const paint = eventPaint(seg.event, colorMap);
              const color = paint.primary;
              const text = paint.textColor;
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
                    className={[
                      'cal-band-bar',
                      onEventClick ? 'cal-band-bar--clickable' : '',
                      seg.event.all_day ? '' : 'cal-band-bar--timed',
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
                    {/* A timed event in the band ran past midnight, so it
                        carries its times the way a chip would: start inline
                        before the title, end pinned to the far edge — over the
                        day it actually finishes on. Both spans render ONLY for
                        a timed bar, so an all-day bar's DOM is unchanged. */}
                    {!seg.event.all_day && (
                      <span className="cal-band-time">
                        {formatEventTime(seg.event.start_time, timezone)}
                      </span>
                    )}
                    {/* Shared bars scrim the title so it stays legible over the
                        stripes. Wrapped ONLY when shared — an ordinary bar keeps
                        its bare text node, so its DOM is unchanged. */}
                    {paint.shared ? (
                      <span className="cal-band-label">{seg.event.summary || '(No title)'}</span>
                    ) : (
                      seg.event.summary || '(No title)'
                    )}
                    {!seg.event.all_day && (
                      <span className="cal-band-end">
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
