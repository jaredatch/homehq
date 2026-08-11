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

/** The fields that must agree before two copies are shown as one event. */
interface MergeableLike extends GroupedLike {
  summary: string;
  start_time: string;
  end_time: string;
  all_day: number;
  groupCalendarIds?: string[];
}

/** Copies drift apart when someone edits one of them outside HomeHQ. */
function membersAgree(members: readonly MergeableLike[]): boolean {
  const [first] = members;
  return members.every(
    (m) =>
      m.summary === first.summary &&
      m.start_time === first.start_time &&
      m.end_time === first.end_time &&
      m.all_day === first.all_day
  );
}

/**
 * Collapse the per-calendar copies of each shared event into ONE event carrying
 * `groupCalendarIds`, so the board shows "No school" once instead of twice.
 *
 * Apply this AFTER `filterEvents`. Ordering the two that way delivers the whole
 * spec for free: filtered to Maddie, only her copy survives, the merge is a
 * no-op, and it renders in her color; unfiltered, both survive and collapse into
 * one two-color chip.
 *
 * Two contracts matter:
 *  - **Same reference when nothing merges** (and untouched objects otherwise),
 *    so the default wall render stays byte-for-byte identical and downstream
 *    useMemos keep their identity.
 *  - **Drift un-merges.** If the copies stop agreeing — someone edited one on
 *    their phone — they render separately again, exactly as they do today.
 *    Nothing is lost or silently reconciled; re-saving from the board re-syncs.
 *
 * `calendarOrder` (config order) picks the representative copy, so the primary
 * color and the React key are deterministic rather than query-order dependent.
 */
export function mergeGroups<T extends MergeableLike>(
  events: T[],
  calendarOrder: readonly string[]
): T[] {
  // Fast path: no shared events at all — hand back the very same array.
  if (!events.some((e) => e.group_id)) return events;

  const byGroup = new Map<string, T[]>();
  for (const event of events) {
    if (!event.group_id) continue;
    const list = byGroup.get(event.group_id);
    if (list) list.push(event);
    else byGroup.set(event.group_id, [event]);
  }

  const rank = new Map(calendarOrder.map((id, i) => [id, i]));
  const rankOf = (e: T) => rank.get(e.calendar_id) ?? Number.MAX_SAFE_INTEGER;

  const merged = new Map<string, { rep: T; calendarIds: string[] }>();
  for (const [groupId, members] of byGroup) {
    // One surviving member (or duplicates of one calendar) is just a normal
    // event — a group that shrank back to one person renders unstamped.
    const byCalendar = [...new Map(members.map((m) => [m.calendar_id, m])).values()];
    if (byCalendar.length < 2) continue;
    if (!membersAgree(byCalendar)) continue;
    const ordered = byCalendar.sort((a, b) => rankOf(a) - rankOf(b));
    merged.set(groupId, {
      rep: ordered[0],
      calendarIds: ordered.map((m) => m.calendar_id),
    });
  }

  // Every group drifted or was a group of one — nothing to collapse.
  if (merged.size === 0) return events;

  const out: T[] = [];
  const emitted = new Set<string>();
  for (const event of events) {
    const group = event.group_id ? merged.get(event.group_id) : undefined;
    if (!group) {
      out.push(event); // untouched object, same identity
      continue;
    }
    if (emitted.has(event.group_id!)) continue; // the other copy, already folded in
    emitted.add(event.group_id!);
    // Emitted where the first copy sat, so the caller's sort order survives —
    // safe because members only merge when their times agree.
    out.push({ ...group.rep, groupCalendarIds: group.calendarIds });
  }
  return out;
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
