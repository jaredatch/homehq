import { formatEventTimeRange } from './calendar-utils';

interface EventItemProps {
  event: {
    event_id: string;
    calendar_id: string;
    summary: string;
    start_time: string;
    end_time: string;
  };
  color: string;
}

// Timed events only — all-day events render as spanning bars in WeekRow's band.
export default function EventItem({ event, color }: EventItemProps) {
  return (
    <div data-event-row className="relative py-1 pl-3 pr-1.5 leading-snug" title={event.summary}>
      {/* Accent bar, inset top/bottom so events read as slightly more spaced. */}
      <span
        className="absolute inset-y-1 left-0 w-0.5"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <div className="text-xs font-medium tabular-nums" style={{ color }}>
        {formatEventTimeRange(event.start_time, event.end_time)}
      </div>
      <div className="line-clamp-2 text-sm font-medium text-gray-100">
        {event.summary || '(No title)'}
      </div>
    </div>
  );
}
