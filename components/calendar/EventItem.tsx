import { formatEventTime } from './calendar-utils';

interface EventItemProps {
  event: {
    event_id: string;
    calendar_id: string;
    summary: string;
    start_time: string;
    end_time: string;
    all_day: number;
  };
  color: string;
}

export default function EventItem({ event, color }: EventItemProps) {
  if (event.all_day) {
    return (
      <div
        data-event-row
        className="truncate rounded-r border-l-4 py-0.5 pl-2 pr-1.5 text-sm font-medium leading-snug text-gray-100"
        style={{ borderColor: color, backgroundColor: `${color}22` }}
        title={event.summary}
      >
        {event.summary || '(No title)'}
      </div>
    );
  }

  return (
    <div
      data-event-row
      className="flex min-w-0 items-baseline border-l-4 py-0.5 pl-2 pr-1.5 leading-snug"
      style={{ borderColor: color }}
      title={event.summary}
    >
      <span className="mr-1.5 shrink-0 text-xs font-medium tabular-nums text-gray-500">
        {formatEventTime(event.start_time)}
      </span>
      <span className="truncate text-sm text-gray-200">{event.summary || '(No title)'}</span>
    </div>
  );
}
