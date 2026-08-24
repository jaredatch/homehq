/**
 * How HomeHQ decides that two cached rows are ONE event shown twice.
 *
 * Shared events (v1.3) only ever recognised its own stamp, so the board still
 * drew a double for the two ways a family actually ends up with one event on two
 * calendars without HomeHQ's help:
 *
 *  - **Google's own link** — Jared puts "Lunch" on his calendar and invites Sam.
 *    Google returns the SAME `event_id` from both calendars because it is one
 *    event resource with two attendees.
 *  - **Twins** — the same thing typed in twice, once per person, before shared
 *    events existed (or by someone working in Google directly). Two unrelated
 *    event ids, identical title and identical start/end.
 *
 * This module is the single definition of that matching, deliberately shared by
 * the read side (the grids merge chips with it) and the write side (the routes
 * resolve siblings with it). If they ever disagreed the damage is concrete: a
 * chip would claim two calendars, the update route would see only one, and
 * saving would "add" the second — writing a THIRD copy of an event that was
 * never duplicated in the first place.
 *
 * Precedence is strongest-evidence-first: an explicit stamp beats Google's id,
 * which beats a title match. Only the last tier is a guess.
 */

import { MAX_GROUP_CALENDARS } from './event-groups';

/**
 * How a set of copies was recognised.
 *
 * - `stamp` — HomeHQ's own `group_id`. Separate Google events by design; edit and
 *   delete fan out across every copy, and membership is editable.
 * - `google` — one Google event resource surfacing on two calendars (an invite).
 *   Membership belongs to Google's guest list, NOT to HomeHQ: adding a calendar
 *   here would mean creating a second, unrelated event. Locked in the UI.
 * - `twin` — matched on title + times alone. The only inferred tier. Editing one
 *   adopts the pair into a real `stamp` group, so a guess only ever has to be
 *   made once.
 */
export type LinkKind = 'stamp' | 'google' | 'twin';

/** The columns linking needs. Satisfied by both the DB row and the client event. */
export interface LinkableEvent {
  event_id: string;
  calendar_id: string;
  summary: string;
  start_time: string;
  end_time: string;
  all_day: number;
  group_id: string | null;
}

/**
 * The identity a twin match is made on: everything the user sees about WHEN and
 * WHAT, and nothing else. Location and notes are excluded on purpose — two
 * copies of one event routinely carry notes on only one of them, and demanding
 * they agree would un-merge most real pairs.
 *
 * NUL-joined because it cannot occur in any of the parts, so no title can spoof a
 * field boundary ("Lunch|2pm" vs a title of "Lunch" starting at "2pm").
 */
export function twinKey(event: LinkableEvent): string {
  return [event.summary, event.start_time, event.end_time, event.all_day].join('\u0000');
}

/** The tier-2 key: Google's id, which is shared across an invite's copies. */
export function googleKey(event: LinkableEvent): string {
  return event.event_id;
}

/** One copy per calendar, first occurrence winning — two rows on the SAME
 * calendar are a cache artefact, never two people. */
export function dedupeByCalendar<T extends LinkableEvent>(members: readonly T[]): T[] {
  return [...new Map(members.map((m) => [m.calendar_id, m])).values()];
}

/**
 * Whether copies still describe the same event. Only meaningful for `stamp`:
 * the other two tiers match ON these fields, so they agree by construction.
 *
 * Drift un-merges rather than reconciling. Someone moved one copy on their phone
 * and the two really are at different times now — saying so is the honest render.
 */
export function membersAgree(members: readonly LinkableEvent[]): boolean {
  const [first] = members;
  if (!first) return false;
  return members.every(
    (m) =>
      m.summary === first.summary &&
      m.start_time === first.start_time &&
      m.end_time === first.end_time &&
      m.all_day === first.all_day
  );
}

export interface ResolvedLink<T extends LinkableEvent> {
  /** null when this event stands alone — the overwhelmingly common case. */
  kind: LinkKind | null;
  /** Every copy, one per calendar. Always contains `event` itself. */
  members: T[];
}

/**
 * Resolve one event's copies out of a candidate list.
 *
 * Used for single-event questions (which calendars does the edit form check?
 * which rows does the update route patch?). The grids use `mergeGroups`, which
 * buckets the whole list once instead of calling this per event.
 *
 * `candidates` must be the UNFILTERED set. With a per-person filter active a
 * sibling may be hidden from the grid, but it is still on Google — resolving
 * against the filtered list would make the edit form silently drop that person.
 */
export function resolveLink<T extends LinkableEvent>(
  candidates: readonly T[],
  event: T
): ResolvedLink<T> {
  if (event.group_id) {
    const members = dedupeByCalendar(candidates.filter((c) => c.group_id === event.group_id));
    // A group that shrank back to one person is just an ordinary event again.
    if (members.length > 1 && membersAgree(members)) return { kind: 'stamp', members };
    return { kind: null, members: [event] };
  }

  // Tier 2 and 3 are capped at two calendars: past that the two-colour paint has
  // no answer, and a wide accidental match is exactly where a guess does damage.
  // A stamped group is never capped here — it was created deliberately.
  const google = dedupeByCalendar(
    candidates.filter((c) => !c.group_id && googleKey(c) === googleKey(event))
  );
  if (google.length > 1 && google.length <= MAX_GROUP_CALENDARS && membersAgree(google)) {
    return { kind: 'google', members: google };
  }

  const key = twinKey(event);
  const twins = dedupeByCalendar(
    candidates.filter((c) => !c.group_id && twinKey(c) === key && googleKey(c) !== googleKey(event))
  );
  // `twins` excludes same-id rows so an invite that failed the cap above (three
  // calendars) can't sneak back in through the looser tier.
  if (twins.length > 0) {
    const all = dedupeByCalendar([event, ...twins]);
    if (all.length > 1 && all.length <= MAX_GROUP_CALENDARS) return { kind: 'twin', members: all };
  }

  return { kind: null, members: [event] };
}
