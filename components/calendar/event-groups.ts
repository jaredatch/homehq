/**
 * Client-side view of shared events: collapsing the per-calendar copies of one
 * logical event into a single chip.
 *
 * WHICH copies count as one event is not decided here — that lives in
 * `lib/calendar/event-links.ts`, shared with the write routes on purpose (see the
 * header there for why a read/write disagreement corrupts data). This module
 * only does the collapsing, and does it by bucketing the whole list once per
 * tier rather than asking `resolveLink` about every event in turn.
 */

import {
  dedupeByCalendar,
  googleKey,
  membersAgree,
  resolveLink,
  twinKey,
  type LinkKind,
  type LinkableEvent,
} from '@/lib/calendar/event-links';
import { MAX_GROUP_CALENDARS } from '@/lib/calendar/event-groups';

/** What a mergeable event carries in, and what merging adds. */
interface MergeableLike extends LinkableEvent {
  groupCalendarIds?: string[];
  groupMatch?: LinkKind;
}

interface Merged<T> {
  rep: T;
  calendarIds: string[];
  kind: LinkKind;
}

/**
 * Collapse every recognised set of copies into ONE event carrying
 * `groupCalendarIds` (+ `groupMatch`), so the board shows "Lunch" once instead of
 * on both Jared's and Sam's rows.
 *
 * Apply this AFTER `filterEvents`. Ordering the two that way delivers the whole
 * spec for free: filtered to Maddie, only her copy survives, the merge is a
 * no-op, and it renders in her colour; unfiltered, both survive and collapse into
 * one two-colour chip.
 *
 * Two contracts matter:
 *  - **Same reference when nothing merges** (and untouched objects otherwise),
 *    so a board with no shared events stays byte-for-byte identical and
 *    downstream useMemos keep their identity.
 *  - **Drift un-merges.** If stamped copies stop agreeing — someone edited one on
 *    their phone — they render separately again. Nothing is silently reconciled.
 *
 * `calendarOrder` (config order) picks the representative copy, so the primary
 * colour and the React key are deterministic rather than query-order dependent.
 */
export function mergeGroups<T extends MergeableLike>(
  events: T[],
  calendarOrder: readonly string[]
): T[] {
  const rank = new Map(calendarOrder.map((id, i) => [id, i]));
  const rankOf = (e: T) => rank.get(e.calendar_id) ?? Number.MAX_SAFE_INTEGER;

  // An event claimed by a stronger tier is invisible to the weaker ones, which is
  // what makes precedence work: a stamped pair never re-matches as twins.
  const claimed = new Set<T>();
  const groupOf = new Map<T, Merged<T>>();

  const runPass = (kind: LinkKind, keyOf: (e: T) => string | null, cap: number | null) => {
    const buckets = new Map<string, T[]>();
    for (const event of events) {
      if (claimed.has(event)) continue;
      const key = keyOf(event);
      if (key === null) continue;
      const list = buckets.get(key);
      if (list) list.push(event);
      else buckets.set(key, [event]);
    }
    for (const members of buckets.values()) {
      const byCalendar = dedupeByCalendar(members);
      // One surviving copy (or duplicates of a single calendar) is just a normal
      // event — a group that shrank back to one person renders unstamped.
      if (byCalendar.length < 2) continue;
      // Tiers 2 and 3 cap at two calendars: past that the two-colour paint has no
      // answer, and a wide accidental match is where a guess does real damage. A
      // stamped group is uncapped — it was created deliberately.
      if (cap !== null && byCalendar.length > cap) continue;
      if (!membersAgree(byCalendar)) continue;
      const ordered = [...byCalendar].sort((a, b) => rankOf(a) - rankOf(b));
      const group: Merged<T> = {
        rep: ordered[0],
        calendarIds: ordered.map((m) => m.calendar_id),
        kind,
      };
      for (const member of members) {
        claimed.add(member);
        groupOf.set(member, group);
      }
    }
  };

  runPass('stamp', (e) => e.group_id, null);
  runPass('google', (e) => (e.group_id ? null : googleKey(e)), MAX_GROUP_CALENDARS);
  runPass('twin', (e) => (e.group_id ? null : twinKey(e)), MAX_GROUP_CALENDARS);

  // Nothing was recognised — hand back the very same array.
  if (groupOf.size === 0) return events;

  const out: T[] = [];
  const emitted = new Set<Merged<T>>();
  for (const event of events) {
    const group = groupOf.get(event);
    if (!group) {
      out.push(event); // untouched object, same identity
      continue;
    }
    if (emitted.has(group)) continue; // another copy, already folded in
    emitted.add(group);
    // Emitted where the first copy sat, so the caller's sort order survives —
    // safe because copies only merge when their times agree.
    out.push({ ...group.rep, groupCalendarIds: group.calendarIds, groupMatch: group.kind });
  }
  return out;
}

/**
 * Which calendars an event currently lives on — one for an ordinary event, more
 * for a shared one. Seeds the edit form's calendar picker.
 *
 * Pass the UNFILTERED event list: with a per-person filter active a sibling may
 * be hidden from the grid, but the edit form still has to show it checked or
 * saving would silently drop that person from the event.
 */
export function calendarIdsForEvent<T extends LinkableEvent>(
  events: readonly T[],
  event: T
): string[] {
  const { members } = resolveLink(events, event);
  const ids = [...new Set(members.map((m) => m.calendar_id))];
  // The event's own calendar is the floor: never return an empty set just
  // because the cache is momentarily missing its siblings.
  return ids.length > 0 ? ids : [event.calendar_id];
}

/**
 * Whether the edit form must show membership as fixed.
 *
 * True only for a `google` link — one Google event resource on two calendars
 * because someone was invited. Its membership IS Google's guest list, and HomeHQ
 * has no honest way to edit that here: ticking a third calendar would not add a
 * guest, it would create a second, unrelated event. Every other tier stays fully
 * editable (a `twin` pair becomes a real stamped group the first time it is
 * saved).
 */
export function isMembershipLocked<T extends LinkableEvent>(
  events: readonly T[],
  event: T
): boolean {
  return resolveLink(events, event).kind === 'google';
}
