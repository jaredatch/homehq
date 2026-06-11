import EventItem from './EventItem';
import type { CalendarEvent } from './calendar-utils';

interface DayColumnProps {
  date: string;
  isToday: boolean;
  isPast: boolean;
  showMonth: boolean;
  allDayEvents: CalendarEvent[];
  timedEvents: CalendarEvent[];
  colorMap: Map<string, string>;
  /** Max event rows to show before collapsing the rest into "+N more". Infinity = show all. */
  capacity: number;
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

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export default function DayColumn({
  date,
  isToday,
  isPast,
  showMonth,
  allDayEvents,
  timedEvents,
  colorMap,
  capacity,
}: DayColumnProps) {
  const dateObj = parseLocalDate(date);
  const dayNum = dateObj.getDate();
  const monthName = MONTH_NAMES[dateObj.getMonth()];
  const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;

  const getColor = (calendarId: string) => colorMap.get(calendarId) ?? '#6b7280';

  // All-day events first, then timed. When the list exceeds the cell's capacity,
  // the last visible slot becomes a "+N more" tally rather than clipping silently.
  const items = [
    ...allDayEvents.map((event) => ({ event, kind: 'ad' })),
    ...timedEvents.map((event) => ({ event, kind: 't' })),
  ];
  const overflowing = items.length > capacity;
  const visible = overflowing ? items.slice(0, Math.max(0, capacity - 1)) : items;
  const hiddenCount = items.length - visible.length;

  return (
    <div
      className={`flex flex-col overflow-hidden ${
        isToday
          ? 'bg-blue-950/40 ring-1 ring-inset ring-blue-500/40'
          : isWeekend
            ? 'bg-gray-950/70'
            : 'bg-gray-950'
      }`}
    >
      {/* Day header — date only; the weekday lives in the shared header row */}
      <div
        data-day-header
        className={`shrink-0 border-b px-2 py-1 text-center ${
          isToday ? 'border-blue-500/60' : 'border-gray-800/50'
        }`}
      >
        <div
          className={`text-lg font-bold leading-tight ${
            isToday ? 'text-blue-200' : isPast ? 'text-gray-600' : 'text-gray-200'
          }`}
        >
          {showMonth ? `${monthName} ${dayNum}` : dayNum}
        </div>
      </div>

      {/* Events — dimmed for days already past */}
      <div
        data-events
        className={`flex-1 space-y-1.5 overflow-hidden px-1 py-1 ${isPast ? 'opacity-40' : ''}`}
      >
        {visible.map(({ event, kind }) => (
          <EventItem
            key={`${kind}-${event.event_id}-${event.calendar_id}`}
            event={event}
            color={getColor(event.calendar_id)}
          />
        ))}
        {hiddenCount > 0 && (
          <div className="px-2 pt-0.5 text-xs font-semibold text-gray-500">+{hiddenCount} more</div>
        )}
      </div>
    </div>
  );
}
