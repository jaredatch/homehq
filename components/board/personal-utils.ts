import {
  addDays,
  eventDaySpan,
  spansMultipleDays,
  type CalendarEvent,
} from '@/components/calendar/calendar-utils';

/**
 * Pure helpers behind the personal board's Upcoming column. Kept out of the
 * components so the grouping rules — which days appear, what they're called,
 * what counts as finished — are unit-testable without a renderer, the same way
 * `calendar-utils` backs the wall grid.
 */

const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MONTH_LONG = [
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

const MONTH_SHORT = MONTH_LONG.map((m) => m.slice(0, 3));

/** A YYYY-MM-DD string as a local Date, with no UTC round-trip to shift it. */
function partsOf(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "Thursday" */
export function fullWeekday(dateStr: string): string {
  return WEEKDAY_LONG[partsOf(dateStr).getDay()];
}

/** "August 28" */
export function longDate(dateStr: string): string {
  const date = partsOf(dateStr);
  return `${MONTH_LONG[date.getMonth()]} ${date.getDate()}`;
}

/** "Aug 28" */
export function shortDate(dateStr: string): string {
  const date = partsOf(dateStr);
  return `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
}

/**
 * What a day is called in the agenda: "Today", "Tomorrow", then
 * "Sunday, Aug 30" — weekday AND date. The bare weekday reads fine for the next
 * few days and then quietly stops meaning anything; the date is what tells you
 * whether "Monday" is in three days or ten.
 */
export function agendaLabel(dateStr: string, today: string): string {
  if (dateStr === today) return 'Today';
  if (dateStr === addDays(today, 1)) return 'Tomorrow';
  return `${fullWeekday(dateStr)}, ${shortDate(dateStr)}`;
}

export interface AgendaDay {
  date: string;
  /** "Today" | "Tomorrow" | "Sunday, Aug 30" */
  label: string;
  allDay: CalendarEvent[];
  timed: CalendarEvent[];
}

/**
 * Group events into the Upcoming column's day sections.
 *
 * Today is ALWAYS present, even when empty — a column that opens on tomorrow
 * because nothing is on today reads as a bug, and "nothing today" is itself an
 * answer the screen exists to give. Every later day appears only if it has
 * something on it, so the column stays a list of what's coming rather than a
 * run of empty headers.
 */
export function buildAgenda(events: CalendarEvent[], today: string, dayCount: number): AgendaDay[] {
  const byDay = new Map<string, { allDay: CalendarEvent[]; timed: CalendarEvent[] }>();
  const days: string[] = [];
  for (let i = 0; i < dayCount; i++) {
    const day = addDays(today, i);
    days.push(day);
    byDay.set(day, { allDay: [], timed: [] });
  }

  for (const event of events) {
    // One rule for "which days is this on", shared with both grids: an all-day
    // event spans [start, end) with Google's exclusive end, and a timed event
    // running past midnight spans the days it actually covers. Anything else
    // lands in one day's timed list.
    const { from, to } = eventDaySpan(event);
    if (event.all_day || spansMultipleDays(event)) {
      for (const day of days) {
        if (day >= from && day < to) byDay.get(day)!.allDay.push(event);
      }
      continue;
    }
    const entry = byDay.get(from);
    if (entry) entry.timed.push(event);
  }

  const out: AgendaDay[] = [];
  for (const day of days) {
    const entry = byDay.get(day)!;
    if (day !== today && entry.allDay.length === 0 && entry.timed.length === 0) continue;
    entry.timed.sort((a, b) => a.start_time.localeCompare(b.start_time));
    out.push({ date: day, label: agendaLabel(day, today), ...entry });
  }
  return out;
}

/**
 * Whether a timed event has already finished. Drives the dimming that makes
 * "what's left of my day" readable at a glance — the most useful thing an
 * agenda can say at 4pm. All-day events never dim: a birthday is still true at
 * bedtime.
 */
export function isFinished(event: CalendarEvent, now: number): boolean {
  if (event.all_day) return false;
  const end = Date.parse(event.end_time);
  return Number.isFinite(end) && end < now;
}

export interface PersonOption {
  /** Stable key for the option, and what the dropdown shows. */
  label: string;
  /** Calendars this option narrows the column to. Empty = everyone. */
  calendarIds: string[];
}

/**
 * The Upcoming header's person picker.
 *
 * Her own entry comes first and is the default the column reverts to; the other
 * calendars follow individually, then "Everyone". Several calendars can be
 * "hers" (the one the family wall shows plus her private one), which is why the
 * first option carries a list rather than a single id.
 */
export function personOptions(
  calendars: { id: string; name: string }[],
  ownName: string,
  ownCalendarIds: string[],
  alwaysShowIds: string[] = []
): PersonOption[] {
  const own = new Set(ownCalendarIds);
  const always = new Set(alwaysShowIds);
  // Union rather than replace, so "Maddie" honestly means Maddie and the family
  // calendar is simply never absent — a family dinner is her evening too.
  const withAlways = (ids: Iterable<string>) => [...new Set([...ids, ...always])];

  const options: PersonOption[] = [];
  if (own.size > 0) options.push({ label: ownName, calendarIds: withAlways(own) });
  for (const cal of calendars) {
    // An always-shown calendar makes a poor option: it can never be turned off,
    // so an entry for it would only ever narrow AWAY from the others.
    if (own.has(cal.id) || always.has(cal.id)) continue;
    options.push({ label: cal.name, calendarIds: withAlways([cal.id]) });
  }
  if (options.length > 1) {
    options.push({ label: 'Everyone', calendarIds: calendars.map((c) => c.id) });
  }
  return options;
}

/* ---- Writing: where a new event lands, and what she may edit -------------- */

export interface EventTarget {
  /** Stable key for the segmented control's selected state. */
  key: 'justMe' | 'family';
  /** What the button says. */
  label: string;
  /** The calendar an event with this target is created on. */
  calendarId: string;
}

interface TargetCalendar {
  id: string;
  name: string;
  hidden?: boolean;
}

/**
 * The "Just me / Family" choice on Add Event.
 *
 * Both targets come out of the board's existing config — no new key:
 *
 *  - **Just me** is `defaultCalendar`, which is her room calendar: marked
 *    `hidden`, so it syncs but never reaches the kitchen wall.
 *  - **Family** is the first of her own calendars that ISN'T hidden — the one
 *    the wall already draws in her colour. Falling back to `alwaysShow` covers
 *    a board configured with only a private calendar of its own.
 *
 * "Family" therefore means "put it where everyone can see it", and it stays her
 * event in her colour rather than becoming the household's.
 *
 * Returns ONE target when a board has nowhere to publish to. A single-target
 * board renders no choice at all, which is honest: an inert two-way toggle is
 * worse than none.
 */
export function eventTargets(
  calendars: TargetCalendar[],
  ownCalendarIds: string[],
  alwaysShowIds: string[] = [],
  defaultCalendarId?: string
): EventTarget[] {
  const byId = new Map(calendars.map((c) => [c.id, c]));
  const own = ownCalendarIds.filter((id) => byId.has(id));

  const privateId = defaultCalendarId && byId.has(defaultCalendarId) ? defaultCalendarId : own[0];
  if (!privateId) return [];

  const sharedId =
    own.find((id) => id !== privateId && !byId.get(id)?.hidden) ??
    alwaysShowIds.find((id) => id !== privateId && byId.has(id));

  const targets: EventTarget[] = [{ key: 'justMe', label: 'Just me', calendarId: privateId }];
  if (sharedId) targets.push({ key: 'family', label: 'Family', calendarId: sharedId });
  return targets;
}

interface ScopedEvent {
  calendar_id: string;
  recurring_event_id: string | null;
  /** Present only on a merged shared event (added by `mergeGroups`). */
  groupCalendarIds?: string[];
}

/**
 * Whether tapping an event opens the editor or a read-only card.
 *
 * "Kids can act, but scoped": she can change what's on her own calendars and
 * nothing else. There is deliberately no path from a bedroom panel to deleting
 * a dentist appointment off the family wall.
 *
 * EVERY calendar a merged event lives on has to be hers, not just the copy she
 * happened to tap — a shared event with Mom is Mom's too, and saving it from
 * here would rewrite her copy as well.
 *
 * Repeating occurrences are read-only for everyone (the cache has no series
 * link), so they fall out here rather than reaching a form that would reject
 * them anyway.
 */
export function canEditEvent(event: ScopedEvent, ownCalendarIds: string[]): boolean {
  if (event.recurring_event_id) return false;
  const own = new Set(ownCalendarIds);
  const ids = event.groupCalendarIds ?? [event.calendar_id];
  return ids.length > 0 && ids.every((id) => own.has(id));
}
