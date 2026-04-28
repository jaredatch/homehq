export interface CalendarEvent {
  id: number;
  event_id: string;
  calendar_id: string;
  summary: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  all_day: number;
  updated_at: string;
}

export interface SyncStatus {
  lastSuccess: string | null;
  lastAttempt: string | null;
  lastError: string | null;
}

export interface DayEvents {
  allDay: CalendarEvent[];
  timed: CalendarEvent[];
}

export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function generateRollingDays(startDate: string, count: number): string[] {
  const [y, m, d] = startDate.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const days: string[] = [];

  for (let i = 0; i < count; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    days.push(formatLocalDate(date));
  }

  return days;
}

export function assignEventsToDays(
  events: CalendarEvent[],
  days: string[]
): Map<string, DayEvents> {
  const map = new Map<string, DayEvents>();

  for (const day of days) {
    map.set(day, { allDay: [], timed: [] });
  }

  for (const event of events) {
    if (event.all_day) {
      for (const day of days) {
        if (day >= event.start_time && day < event.end_time) {
          map.get(day)!.allDay.push(event);
        }
      }
      continue;
    }

    const startDate = event.start_time.slice(0, 10);
    const entry = map.get(startDate);
    if (entry) {
      entry.timed.push(event);
    }
  }

  return map;
}

export function timeAgo(isoString: string, now = Date.now()): string {
  const seconds = Math.floor((now - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return '1m ago';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1h ago';
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

export function formatEventTime(isoString: string): string {
  const date = new Date(isoString);
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'p' : 'a';

  hours = hours % 12 || 12;
  if (minutes === 0) return `${hours}${ampm}`;
  return `${hours}:${minutes.toString().padStart(2, '0')}${ampm}`;
}

export function formatEventTimeRange(start: string, end: string): string {
  return `${formatEventTime(start)}-${formatEventTime(end)}`;
}
