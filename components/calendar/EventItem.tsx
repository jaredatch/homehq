import { formatEventTimeRange } from './calendar-utils';

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
        className="truncate rounded-r-sm border-l-[3px] py-[1px] pl-1.5 pr-1 text-xs leading-snug"
        style={{ borderColor: color, backgroundColor: `${color}18` }}
        title={event.summary}
      >
        {event.summary || '(No title)'}
      </div>
    );
  }

  return (
    <div
      className="flex min-w-0 items-baseline border-l-[3px] py-[1px] pl-1.5 pr-1 text-xs leading-snug"
      style={{ borderColor: color }}
      title={event.summary}
    >
      <span className="mr-1 shrink-0 text-[11px] text-gray-500">
        {formatEventTimeRange(event.start_time, event.end_time)}
      </span>
      <span className="truncate text-gray-300">{event.summary || '(No title)'}</span>
    </div>
  );
}
