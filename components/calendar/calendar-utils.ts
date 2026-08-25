import type { LinkKind } from '@/lib/calendar/event-links';

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
  /** Google's series id when this is a recurring occurrence; null otherwise.
   * Recurring events open a "manage in Google Calendar" notice (edit blocked). */
  recurring_event_id: string | null;
  /** Shared-event stamp: every per-calendar copy of one logical event carries
   * the same id. null for ordinary single-calendar events. */
  group_id: string | null;
  updated_at: string;
  /** Display-only, added client-side by `mergeGroups` — never sent by the API.
   * Present only on a MERGED shared event: every calendar it belongs to, in
   * config order. Its absence is what makes an event render as a plain chip. */
  groupCalendarIds?: string[];
  /** Display-only, alongside `groupCalendarIds`: how the copies were recognised
   * (HomeHQ stamp · one Google event on two calendars · matching title+times).
   * Decides whether the edit form lets membership be changed. */
  groupMatch?: LinkKind;
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

const WEEKDAY_INDEX = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Wall-clock parts of an instant as seen in `timeZone`, or the browser's local
 * zone when `timeZone` is undefined (identical to the bare Date getters). Lets
 * the kiosk render one fixed zone regardless of the machine's OS clock — the
 * Pi was an hour off because its OS was on Eastern. See display.timezone.
 */
export function zonedParts(
  date: Date,
  timeZone?: string
): { year: number; month: number; day: number; hours: number; minutes: number; weekday: number } {
  if (!timeZone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hours: date.getHours(),
      minutes: date.getMinutes(),
      weekday: date.getDay(),
    };
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hours: Number(get('hour')) % 24, // hour12:false yields "24" at midnight in some ICU builds
    minutes: Number(get('minute')),
    weekday: WEEKDAY_INDEX.indexOf(get('weekday')),
  };
}

/** Today as YYYY-MM-DD in `timeZone` (or browser-local). */
export function todayInZone(timeZone?: string): string {
  const { year, month, day } = zonedParts(new Date(), timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Default times for a new event: the next whole hour and the hour after, as
 * HH:mm in `timeZone`. Clamps the end to 23:59 rather than wrapping past
 * midnight, so the default always satisfies end > start on a single day.
 */
export function nextHourRange(timeZone?: string): { start: string; end: string } {
  const { hours } = zonedParts(new Date(), timeZone);
  const fmt = (h: number) => `${String(h).padStart(2, '0')}:00`;
  const startH = (hours + 1) % 24;
  const endH = startH + 1;
  return { start: fmt(startH), end: endH >= 24 ? '23:59' : fmt(endH) };
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + n);
  return formatLocalDate(date);
}

export function isWeekendDate(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 || day === 6;
}

/** Split a flat list of days into rows of 7 (calendar weeks). */
export function chunkWeeks(days: string[]): string[][] {
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

export interface AllDaySegment {
  event: CalendarEvent;
  /** Column (0-6) the bar starts in, within this week. */
  startCol: number;
  /** Number of columns the bar covers. */
  span: number;
  /** Vertical slot (row) in the all-day band; overlapping events stack. */
  slot: number;
  /** Event started before this week (clip the left end flat). */
  continuesLeft: boolean;
  /** Event continues past this week (clip the right end flat). */
  continuesRight: boolean;
}

/**
 * Lay out a week's all-day events as horizontal bars that span the days they
 * cover (Google-Calendar style) instead of repeating per cell. Bars are packed
 * into slots greedily by start date so overlapping events stack without
 * colliding. All-day `end_time` is exclusive (the day after the last covered).
 */
export function computeWeekSegments(
  allDayEvents: CalendarEvent[],
  weekDays: string[]
): { segments: AllDaySegment[]; slotCount: number; laneByColumn: number[] } {
  const first = weekDays[0];
  const last = weekDays[weekDays.length - 1];
  const dayAfterLast = addDays(last, 1);

  const intersecting = allDayEvents
    .filter((e) => e.start_time <= last && e.end_time > first)
    .sort((a, b) => {
      if (a.start_time !== b.start_time) return a.start_time < b.start_time ? -1 : 1;
      // Longer events first so they claim the lower slots.
      if (a.end_time !== b.end_time) return a.end_time > b.end_time ? -1 : 1;
      return a.event_id < b.event_id ? -1 : 1;
    });

  const slotLastCol: number[] = []; // last column each slot is occupied through
  const segments: AllDaySegment[] = [];

  for (const e of intersecting) {
    let startCol = 0;
    while (startCol < 7 && weekDays[startCol] < e.start_time) startCol++;
    let endCol = 6;
    while (endCol >= 0 && weekDays[endCol] >= e.end_time) endCol--;
    if (startCol > 6 || endCol < 0 || endCol < startCol) continue;

    let slot = 0;
    while (slot < slotLastCol.length && slotLastCol[slot] >= startCol) slot++;
    slotLastCol[slot] = endCol;

    segments.push({
      event: e,
      startCol,
      span: endCol - startCol + 1,
      slot,
      continuesLeft: e.start_time < first,
      continuesRight: e.end_time > dayAfterLast,
    });
  }

  // Per-column lane reservation: how many band rows each day must reserve at the
  // top of its cell. It's the highest slot occupied in that column PLUS ONE —
  // crucially counting bars that merely *pass through* the column, not just ones
  // that start there, or a spanning bar would collide with that day's timed
  // events. Columns no bar touches stay 0, so their timed events flow to the top
  // (no placeholder gap). Empty lower slots under a high bar still count, keeping
  // a multi-day bar on its own row across every day it covers.
  const laneByColumn = new Array(weekDays.length).fill(0);
  for (const seg of segments) {
    for (let c = seg.startCol; c < seg.startCol + seg.span; c++) {
      laneByColumn[c] = Math.max(laneByColumn[c], seg.slot + 1);
    }
  }

  return { segments, slotCount: slotLastCol.length, laneByColumn };
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

export function formatEventTime(isoString: string, timeZone?: string): string {
  const { hours: h24, minutes } = zonedParts(new Date(isoString), timeZone);
  const ampm = h24 >= 12 ? 'pm' : 'am';
  const hours = h24 % 12 || 12;
  if (minutes === 0) return `${hours}${ampm}`;
  return `${hours}:${minutes.toString().padStart(2, '0')}${ampm}`;
}

/** The range split into its two halves, for markup that styles the start on
 * its own (`EventItem` wraps it in `.cal-event-time-start`). Unlike
 * `formatEventTimeRange` the start ALWAYS carries its meridiem: that formatter
 * drops it when it matches the end's, which only reads as a time because the
 * end is sitting right there lending it one. A start time that's styled apart
 * from its range has to stand on its own, so "2pm – 3pm", never "2 – 3pm". */
export function eventTimeRangeParts(
  start: string,
  end: string,
  timeZone?: string
): { start: string; end: string } {
  return {
    start: formatEventTime(start, timeZone),
    end: formatEventTime(end, timeZone),
  };
}

export function formatEventTimeRange(start: string, end: string, timeZone?: string): string {
  const startMeridiem = zonedParts(new Date(start), timeZone).hours >= 12 ? 'pm' : 'am';
  const endMeridiem = zonedParts(new Date(end), timeZone).hours >= 12 ? 'pm' : 'am';
  // Drop the start meridiem when it matches the end's — "8 – 9:30am" reads
  // cleaner than "8am – 9:30am". Spaces around the dash aid skimming on the
  // full-width row (the column has room for it).
  const startLabel =
    startMeridiem === endMeridiem
      ? formatEventTime(start, timeZone).replace(/[ap]m$/, '')
      : formatEventTime(start, timeZone);
  return `${startLabel} – ${formatEventTime(end, timeZone)}`;
}
