import EventItem from './EventItem';
import { contrastText, isWeekendDate, type AllDaySegment, type CalendarEvent } from './calendar-utils';

interface WeekRowProps {
  weekDays: string[]; // 7 date strings (YYYY-MM-DD)
  weekIndex: number; // 0 = current week
  today: string;
  segments: AllDaySegment[]; // all-day spanning bars for this week
  slotCount: number; // band rows used
  timedByDay: Map<string, CalendarEvent[]>;
  colorMap: Map<string, { color: string; textColor?: string }>;
  /** Per-column max timed rows before "+N more". Infinity = show all. */
  capacities: number[];
}

// Today's marker — a small dot beside the date. Tweak the color here (could
// later move to config alongside the calendar colors).
const TODAY_DOT = 'bg-blue-400';

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
  timedByDay,
  colorMap,
  capacities,
}: WeekRowProps) {
  return (
    <div className="relative grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden">
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
                  <span className={`h-2 w-2 shrink-0 rounded-full ${TODAY_DOT}`} aria-hidden />
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* All-day band — events span the days they cover instead of repeating. */}
      {slotCount > 0 && (
        <div
          data-band
          className="relative grid grid-cols-7 gap-px pb-0.5 pt-0.5"
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
                style={{ gridColumn: `${seg.startCol + 1} / span ${seg.span}`, gridRow: seg.slot + 1 }}
              >
                <div
                  data-band-row
                  className="truncate px-2 py-1 text-sm font-semibold leading-snug"
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

      {/* Timed events — one stack per day, dimmed for days already past. */}
      <div className="relative grid min-h-0 grid-cols-7 gap-px">
        {weekDays.map((date, col) => {
          const isPast = date < today;
          const timed = timedByDay.get(date) ?? [];
          const capacity = capacities[col] ?? Infinity;
          const overflowing = timed.length > capacity;
          const visible = overflowing ? timed.slice(0, Math.max(0, capacity - 1)) : timed;
          const hiddenCount = timed.length - visible.length;
          return (
            <div
              key={date}
              data-events
              className={`space-y-1.5 overflow-hidden px-1 py-1 ${isPast ? 'opacity-40' : ''}`}
            >
              {visible.map((event) => {
                const cal = colorMap.get(event.calendar_id);
                return (
                  <EventItem
                    key={`${event.event_id}-${event.calendar_id}`}
                    event={event}
                    color={cal?.color ?? '#6b7280'}
                  />
                );
              })}
              {hiddenCount > 0 && (
                <div className="px-2 pt-0.5 text-xs font-semibold text-gray-500">
                  +{hiddenCount} more
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
