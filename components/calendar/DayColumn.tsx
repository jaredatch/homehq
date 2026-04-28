import EventItem from './EventItem';
import type { CalendarEvent } from './calendar-utils';

interface DayColumnProps {
  date: string;
  isToday: boolean;
  showMonth: boolean;
  allDayEvents: CalendarEvent[];
  timedEvents: CalendarEvent[];
  colorMap: Map<string, string>;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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
  showMonth,
  allDayEvents,
  timedEvents,
  colorMap,
}: DayColumnProps) {
  const dateObj = parseLocalDate(date);
  const dayName = DAY_NAMES[dateObj.getDay()];
  const dayNum = dateObj.getDate();
  const monthName = MONTH_NAMES[dateObj.getMonth()];
  const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;

  const getColor = (calendarId: string) => colorMap.get(calendarId) ?? '#6b7280';

  return (
    <div
      className={`flex flex-col overflow-hidden ${
        isToday ? 'bg-gray-900' : isWeekend ? 'bg-gray-950/70' : 'bg-gray-950'
      }`}
    >
      {/* Day header */}
      <div
        className={`shrink-0 border-b px-1.5 py-1 text-center ${
          isToday ? 'border-blue-500/50' : 'border-gray-800/50'
        }`}
      >
        <div
          className={`text-[11px] font-medium uppercase tracking-wide ${
            isToday ? 'text-blue-400' : 'text-gray-500'
          }`}
        >
          {dayName}
        </div>
        <div
          className={`text-sm font-semibold leading-tight ${
            isToday ? 'text-blue-300' : 'text-gray-300'
          }`}
        >
          {showMonth ? `${monthName} ${dayNum}` : dayNum}
        </div>
      </div>

      {/* Events */}
      <div className="flex-1 space-y-px overflow-hidden px-0.5 py-0.5">
        {allDayEvents.map((event) => (
          <EventItem
            key={`ad-${event.event_id}-${event.calendar_id}`}
            event={event}
            color={getColor(event.calendar_id)}
          />
        ))}
        {timedEvents.map((event) => (
          <EventItem
            key={`t-${event.event_id}-${event.calendar_id}`}
            event={event}
            color={getColor(event.calendar_id)}
          />
        ))}
      </div>
    </div>
  );
}
