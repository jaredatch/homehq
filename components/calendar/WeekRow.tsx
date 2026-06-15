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
}: WeekRowProps) {
  return (
    <div className="relative grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      {/* Continuous background — column tints + 1px separators behind everything,
          so the all-day band's spanning bars sit on an unbroken grid. */}
      <div className="absolute inset-0 grid grid-cols-7 gap-px bg-gray-800" aria-hidden>
        {weekDays.map((date) => (
          <div key={date} className={isWeekendDate(date) ? 'bg-gray-950/70' : 'bg-gray-950'} />
        ))}
      </div>

      {/* Header row — weekday lives in the shared header above the grid; here it's
          the date, with today marked by an accent + underline (no full-cell tint). */}
      <div className="relative grid grid-cols-7 gap-px">
        {weekDays.map((date) => {
          const isToday = date === today;
          const isPast = date < today;
          const { dayNum, monthName } = dayNumber(date);
          const showMonth = (weekIndex === 0 && date === weekDays[0]) || date.slice(8, 10) === '01';
          return (
            <div
              key={date}
              data-day-header
              className="border-b border-gray-800/50 px-2 py-1 text-left"
            >
              {/* Today is styled like every other day; a dot is the only marker. */}
              <span className="flex items-center gap-1.5">
                <span
                  className={`text-lg font-bold leading-tight ${
                    isPast ? 'text-gray-600' : 'text-gray-200'
                  }`}
                >
                  {showMonth ? `${monthName} ${dayNum}` : dayNum}
                </span>
                {isToday && (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
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
      <div className="relative min-h-0">
        {/* Timed events — one stack per day, dimmed for days already past. */}
        <div className="relative grid min-h-0 grid-cols-7 gap-px">
          {weekDays.map((date, col) => {
            const isPast = date < today;
            const lanes = laneByColumn[col] ?? 0;
            const timed = timedByDay.get(date) ?? [];
            const capacity = capacities[col] ?? Infinity;
            const visible = timed.slice(0, Math.max(0, capacity));
            const hiddenCount = timed.length - visible.length;
            return (
              <div
                key={date}
                data-events
                className={`flex min-h-0 flex-col overflow-hidden ${isPast ? 'opacity-40' : ''}`}
              >
                {/* Reserve this column's band rows with invisible, self-sizing
                    bars — same box as a real bar, so the overlay lines up without
                    passing pixel measurements down. */}
                {lanes > 0 && (
                  <div aria-hidden className="flex shrink-0 flex-col gap-px pb-0.5 pt-0.5">
                    {Array.from({ length: lanes }).map((_, i) => (
                      <div
                        key={i}
                        className="invisible truncate px-2 py-0.5 text-[0.8125rem] font-semibold leading-snug"
                      >
                        &nbsp;
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-1.5 px-1 py-1">
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
                    <div className="px-2 pt-0.5 text-xs font-semibold text-gray-500">
                      +{hiddenCount} more
                    </div>
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
            className="pointer-events-none absolute inset-x-0 top-0 grid grid-cols-7 gap-px pb-0.5 pt-0.5"
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
                  className={`min-w-0 ${isPast ? 'opacity-40' : ''}`}
                  style={{
                    gridColumn: `${seg.startCol + 1} / span ${seg.span}`,
                    gridRow: seg.slot + 1,
                  }}
                >
                  <div
                    data-band-row
                    className="truncate px-2 py-0.5 text-[0.8125rem] font-semibold leading-snug"
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
