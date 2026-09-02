/**
 * What one board is allowed to read out of the event cache.
 *
 * `GET /api/calendar` used to return every cached event in the window and let
 * the browser narrow it, because every calendar in the cache was one the wall
 * drew. Personal boards broke that: a bedroom panel behind a kid's PIN was
 * downloading the parents' whole calendar — titles, locations, notes — and
 * simply not drawing it. Behind the household PIN, on the home LAN, that is
 * fine; as the default an OSS install ships with, it isn't.
 *
 * The naive fix breaks a real invariant. Dropping the other calendars' rows
 * would leave `canEditEvent` unable to see that an event ALSO lives on a
 * calendar this board can't — so it would call a shared event "hers" and let a
 * bedroom panel rewrite a parent's copy. That is the exact trap Phase 4 guards
 * against.
 *
 * So a scoped response carries `linkedCalendarIds` on every event: the full
 * membership of its link group, resolved HERE against the whole window. The
 * client can still merge and still refuse to edit without ever receiving the
 * other copies' contents — and link resolution moves off the browser, which is
 * where it belonged anyway.
 */

import { calendarIdsForEvent, type LinkableEvent } from './event-links';

/** A cached event as a scoped board receives it. */
export type ScopedEvent<T> = T & {
  /**
   * Every calendar this event lives on, including ones outside the board's
   * scope. Server-provided and present on EVERY event of a scoped response —
   * `[calendar_id]` when the event stands alone.
   *
   * Always present rather than only on linked events, so the client never has
   * to fall back to resolving links against the events it can see. That
   * fallback would be wrong in one direction that matters: tiers 2 and 3 cap at
   * two calendars, so three matching rows resolve to NO link over the full set
   * and to a link over a two-row subset. A client guess that disagrees with the
   * server is exactly the read/write split `event-links.ts` exists to prevent.
   */
  linkedCalendarIds: string[];
};

/**
 * Narrow `events` to the calendars a board may see, stamping each survivor with
 * its full link membership.
 *
 * `allowed` of `null` means "everything" — the family board, which draws every
 * calendar and whose edit form resolves membership client-side against the full
 * list. It hands back the SAME array, untouched: the wall's response stays
 * byte-for-byte what it has always been (CLAUDE.md rule 2).
 *
 * Resolving links over `events` alone is complete, not a shortcut. All three
 * link tiers require members to agree on start and end time, so every copy of
 * an event lands in the same range query the event itself did — a sibling
 * cannot be hiding outside the window.
 */
export function scopeEventsToBoard<T extends LinkableEvent>(
  events: T[],
  allowed: ReadonlySet<string> | null
): T[] | ScopedEvent<T>[] {
  if (allowed === null) return events;
  return events
    .filter((e) => allowed.has(e.calendar_id))
    .map((e) => ({ ...e, linkedCalendarIds: calendarIdsForEvent(events, e) }));
}
