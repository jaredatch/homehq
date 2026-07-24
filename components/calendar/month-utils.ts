import { generateRollingDays, startOfWeek, weekStartIndex, type WeekStart } from './calendar-utils';

/**
 * Month-view helpers. Kept out of calendar-utils so the wall grid's shared
 * utilities stay exactly as they are — month view only ever *reads* them.
 *
 * A "month key" here is the string `YYYY-MM`; day strings stay `YYYY-MM-DD`,
 * the same lexicographically-comparable format the rest of the calendar uses.
 */

const MONTH_NAMES_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTH_NAMES_SHORT = [
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

/**
 * How many week rows a month's grid needs: just enough to cover every day of
 * the month, no more. 4 (a 28-day February that starts on the week-start day),
 * 5 (most months), or 6. Deliberately NOT fixed at 6 — a hard 6 gives some
 * months a trailing row that's entirely next-month days (e.g. October 2026's
 * 6th row is all November). The cost is that cell height changes as you page
 * between a 5- and 6-row month, exactly as Google Calendar's month view does.
 */
export function monthRowCount(month: string, weekStartsOn: WeekStart): number {
  const [y, m] = month.split('-').map(Number);
  // Local Date getters, same convention as startOfWeek/addDays in calendar-utils.
  const firstWeekday = new Date(y, m - 1, 1).getDay();
  const leading = (firstWeekday - weekStartIndex(weekStartsOn) + 7) % 7;
  const daysInMonth = new Date(y, m, 0).getDate(); // day 0 of next month = last of this
  return Math.ceil((leading + daysInMonth) / 7);
}

/** The month key (`YYYY-MM`) containing a `YYYY-MM-DD` day. */
export function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** True when a day falls outside the rendered month (leading/trailing cells). */
export function isAdjacentMonth(dateStr: string, month: string): boolean {
  return monthOf(dateStr) !== month;
}

/**
 * The days of a month's grid, in column order, starting at the week containing
 * the 1st. Length is `monthRowCount() * 7` — 28, 35, or 42.
 */
export function monthGridDays(month: string, weekStartsOn: WeekStart): string[] {
  const gridStart = startOfWeek(`${month}-01`, weekStartsOn);
  return generateRollingDays(gridStart, monthRowCount(month, weekStartsOn) * 7);
}

/** Display title for a month key, e.g. "July 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES_LONG[m - 1]} ${y}`;
}

/** Short month name for a day string, used as the prefix on the 1st (`Jul 1`). */
export function shortMonthName(dateStr: string): string {
  return MONTH_NAMES_SHORT[Number(dateStr.slice(5, 7)) - 1];
}

/** Step a month key forward or back by `n` months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const year = Math.floor(total / 12);
  const mon = (total % 12) + 1;
  return `${year}-${String(mon).padStart(2, '0')}`;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Short weekday name ('Tue') for a day string — the day popover's header. */
export function weekdayShortOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAY_SHORT[new Date(y, m - 1, d).getDay()];
}

/** Where the day popover sits, relative to the calendar region. All px. */
export interface PopoverBox {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/**
 * Position the day popover over its day cell, Google-style: a bit wider than
 * the cell and centered on it, top pinned near the cell's top edge — then
 * clamped so it always stays inside the calendar region (the page can never
 * scroll: .app-main is overflow:clip, so anything past the edge would just be
 * cut off). Bottom-row cells get their anchor shifted UP far enough that the
 * popover always opens with at least ~half the region's height to grow into;
 * a longer day than that scrolls inside the popover's own list.
 *
 * `cell` is the day cell's rect relative to the calendar region; `container`
 * is the region's own size. Pure math, so the clamping is unit-testable.
 */
export function popoverLayout(
  cell: { left: number; top: number; width: number; height: number },
  container: { width: number; height: number },
  pad = 8
): PopoverBox {
  const width = Math.min(Math.max(cell.width * 1.35, 240), Math.max(0, container.width - 2 * pad));
  const left = clamp(cell.left + cell.width / 2 - width / 2, pad, container.width - pad - width);
  const minRoom = Math.min(container.height * 0.5, container.height - 2 * pad);
  const top = clamp(cell.top - 6, pad, Math.max(pad, container.height - pad - minRoom));
  return { left, top, width, maxHeight: container.height - pad - top };
}
