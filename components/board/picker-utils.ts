import {
  generateRollingDays,
  startOfWeek,
  type WeekStart,
} from '@/components/calendar/calendar-utils';
import { fullWeekday, shortDate } from './personal-utils';

/**
 * Pure helpers behind the personal board's drawn date and time pickers. Kept
 * out of the components so the rules — how a 24-hour value reads on a 12-hour
 * face, what happens to the end when the start moves — are unit-testable
 * without a renderer, the same way `personal-utils` backs the agenda.
 *
 * Values stay in the shapes the write routes already take: `YYYY-MM-DD` for a
 * day and 24-hour `HH:mm` for a time. Only what's DRAWN is 12-hour.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** The last minute of the day. A single-day form can't end any later. */
export const LAST_MINUTE = 23 * 60 + 59;

/** "17:05" → 1025. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** 1025 → "17:05", clamped to the one day a form can hold. */
export function fromMinutes(total: number): string {
  const clamped = Math.min(Math.max(total, 0), LAST_MINUTE);
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

/** A time as the picker draws it: 1–12, a minute, and which half of the day. */
export interface Clock12 {
  hour: number;
  minute: number;
  pm: boolean;
}

/** "00:30" → 12:30 AM, "12:00" → 12:00 PM, "17:05" → 5:05 PM. */
export function toClock12(hhmm: string): Clock12 {
  const [h, m] = hhmm.split(':').map(Number);
  return { hour: h % 12 || 12, minute: m, pm: h >= 12 };
}

/** The inverse of `toClock12`: 12 AM is midnight, 12 PM is noon. */
export function fromClock12({ hour, minute, pm }: Clock12): string {
  const h = (hour % 12) + (pm ? 12 : 0);
  return `${pad(h)}:${pad(minute)}`;
}

/** "17:05" → "5:05 PM". The clock column's own shape, with the minutes always
 * shown — in a field, "5 PM" beside "5:30 PM" reads as two different formats. */
export function formatClock12(hhmm: string): string {
  const { hour, minute, pm } = toClock12(hhmm);
  return `${hour}:${pad(minute)} ${pm ? 'PM' : 'AM'}`;
}

/** 90 → "1 hr 30 min". What the End readout says it adds up to. */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/**
 * Where the end goes when the start moves: along with it, keeping the event's
 * length, the way Google Calendar does. Moving a one-hour practice from 5 to 7
 * should leave a one-hour practice, not a form complaining that 6:00 is before
 * 7:00.
 *
 * An end that was already at or before the start has no length worth keeping,
 * so it falls back to an hour. Clamped to 23:59, because this form holds one
 * day — a start of 11:30 PM gets a shorter event rather than one that silently
 * wraps into tomorrow.
 */
export function carryEnd(prevStart: string, nextStart: string, end: string): string {
  const length = toMinutes(end) - toMinutes(prevStart);
  return fromMinutes(toMinutes(nextStart) + (length > 0 ? length : 60));
}

/** "Tue, Sep 22" — and "Tue, Jan 5, 2027" once it isn't this year, because a
 * month name alone stops saying which January the moment the grid pages past
 * December. */
export function formatPickedDate(dateStr: string, today: string): string {
  const label = `${fullWeekday(dateStr).slice(0, 3)}, ${shortDate(dateStr)}`;
  return dateStr.slice(0, 4) === today.slice(0, 4) ? label : `${label}, ${dateStr.slice(0, 4)}`;
}

/**
 * The days a date picker draws for a month: always six weeks, starting on the
 * week containing the 1st.
 *
 * Six fixed rows, unlike month view's 4–6. The sheet is centred on the panel,
 * so a grid that changed height between a five- and a six-week month would
 * move the ‹ › buttons half a row under the finger that just tapped them.
 */
export function pickerDays(month: string, weekStartsOn: WeekStart): string[] {
  return generateRollingDays(startOfWeek(`${month}-01`, weekStartsOn), 42);
}
