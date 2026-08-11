/**
 * Client-side view of shared events (see lib/calendar/event-groups.ts for the
 * write side). A shared event is stored as one real Google event per calendar,
 * every copy carrying the same `group_id`.
 */

/** The minimum an event needs for group membership questions. */
interface GroupedLike {
  calendar_id: string;
  group_id: string | null;
}

/**
 * Which calendars an event currently lives on — one for an ordinary event, more
 * for a shared one.
 *
 * Pass the UNFILTERED event list: with a per-person filter active, a sibling may
 * be hidden from the grid, but the edit form still has to show it checked or
 * saving would silently drop that person from the event.
 */
export function calendarIdsForEvent(events: readonly GroupedLike[], event: GroupedLike): string[] {
  if (!event.group_id) return [event.calendar_id];
  const ids = [
    ...new Set(events.filter((e) => e.group_id === event.group_id).map((e) => e.calendar_id)),
  ];
  // The event's own calendar is the floor: never return an empty set just
  // because the cache is momentarily missing its siblings.
  return ids.length > 0 ? ids : [event.calendar_id];
}
