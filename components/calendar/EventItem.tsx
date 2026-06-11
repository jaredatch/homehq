import { contrastText, formatEventTimeRange } from './calendar-utils';

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
        className="line-clamp-2 rounded-sm px-2 py-1 text-sm font-semibold leading-snug"
        style={{ backgroundColor: color, color: contrastText(color) }}
        title={event.summary}
      >
        {event.summary || '(No title)'}
      </div>
    );
  }

  return (
    <div
      data-event-row
      className="border-l-4 py-1 pl-2 pr-1.5 leading-snug"
      style={{ borderColor: color }}
      title={event.summary}
    >
      <div className="text-xs font-semibold tabular-nums" style={{ color }}>
        {formatEventTimeRange(event.start_time, event.end_time)}
      </div>
      <div className="line-clamp-2 text-sm font-medium text-gray-100">
        {event.summary || '(No title)'}
      </div>
    </div>
  );
}
