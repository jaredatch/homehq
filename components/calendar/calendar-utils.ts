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

export type WeekStart = 'monday' | 'sunday';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** JS getDay() index (0=Sun) that a column-0 maps to, per week-start preference. */
export function weekStartIndex(weekStartsOn: WeekStart): number {
  return weekStartsOn === 'sunday' ? 0 : 1;
}

/**
 * First day (YYYY-MM-DD) of the week containing `dateStr`. Anchoring the grid
 * to a fixed week start keeps the columns from sliding day to day.
 */
export function startOfWeek(dateStr: string, weekStartsOn: WeekStart): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const diff = (date.getDay() - weekStartIndex(weekStartsOn) + 7) % 7;
  date.setDate(date.getDate() - diff);
  return formatLocalDate(date);
}

/** Weekday labels in column order, e.g. ['Mon', …, 'Sun'] for a Monday start. */
export function weekdayLabels(weekStartsOn: WeekStart): string[] {
  const start = weekStartIndex(weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => WEEKDAY_SHORT[(start + i) % 7]);
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

export interface SyncLabel {
  text: string;
  isError: boolean;
}

/**
 * Human-readable sync indicator state. Errors are surfaced — a quietly dead
 * sync once went unnoticed for weeks behind a stale "Synced Xd ago".
 */
export function formatSyncLabel(sync: SyncStatus, now = Date.now()): SyncLabel {
  if (sync.lastError) {
    // Auth-related failures direct the family to /setup; their error
    // messages all reference it.
    const needsSetup = sync.lastError.includes('/setup');
    const suffix = needsSetup
      ? ' — reconnect Google at /setup'
      : sync.lastSuccess
        ? ` — last sync ${timeAgo(sync.lastSuccess, now)}`
        : '';
    return { text: `Sync failing${suffix}`, isError: true };
  }

  if (!sync.lastSuccess) {
    return { text: 'Not yet synced', isError: false };
  }

  return { text: `Synced ${timeAgo(sync.lastSuccess, now)}`, isError: false };
}

/**
 * Black or white text, whichever reads better on a solid hex background.
 * Used for all-day color bars, where the fill is the calendar's own color and
 * could be anything from bright yellow to dark navy.
 */
export function contrastText(hex: string): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#0a0a0a' : '#f5f5f5';
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
  const startMeridiem = new Date(start).getHours() >= 12 ? 'p' : 'a';
  const endMeridiem = new Date(end).getHours() >= 12 ? 'p' : 'a';
  // Drop the start meridiem when it matches the end's — "10–11:15a" reads
  // cleaner than "10a–11:15a" and saves width in a narrow column.
  const startLabel =
    startMeridiem === endMeridiem
      ? formatEventTime(start).replace(/[ap]$/, '')
      : formatEventTime(start);
  return `${startLabel}–${formatEventTime(end)}`;
}
