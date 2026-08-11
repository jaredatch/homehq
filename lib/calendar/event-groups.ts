/**
 * Shared events: one logical event that applies to more than one person.
 *
 * It is stored as one REAL Google event per calendar, each stamped with the same
 * group id in extendedProperties.private. Nothing here is an illusion — on a
 * phone, in any client, "No school" genuinely is on Maddie's calendar and on
 * Eleanor's, because it genuinely is both girls' event. HomeHQ only owns the
 * presentation: it merges the copies back into a single chip on the board.
 *
 * We deliberately do NOT use Google's attendee/invite mechanism. That creates
 * separate event resources anyway (so the read side still has to dedupe), lands
 * asynchronously (breaking the confirmed-then-cached write pattern every route
 * here relies on), and forces an artificial organizer/guest hierarchy onto an
 * event that applies to both people equally.
 */

/** Key under extendedProperties.private on the Google event. Invisible in every
 * Google UI, returned by events.list, private to each calendar's own copy. */
export const GROUP_PROPERTY_KEY = 'homehqGroup';

/**
 * How many calendars one event may span. Capped at two while the two-color
 * treatment is being designed — three-plus is where striping turns to mud.
 *
 * This is a UI/route rule, never a schema one: the group stamp doesn't care how
 * many members it has, so raising this is a validation change plus a design
 * decision, not a migration.
 */
export const MAX_GROUP_CALENDARS = 2;

export function newGroupId(): string {
  return crypto.randomUUID();
}

export interface MembershipDiff {
  /** Calendars the event is on and stays on — patch these. */
  kept: string[];
  /** Calendars newly checked — insert a stamped copy on each. */
  added: string[];
  /** Calendars unchecked — delete their copy. */
  removed: string[];
}

/**
 * Diff an event's current calendars against the ones the user just chose.
 *
 * The motivating case: Maddie and Eleanor are both going Friday, then Maddie
 * can't. Unchecking her must delete only her copy and leave Eleanor's event
 * intact — not destroy both and rebuild one.
 *
 * Order follows `next` for added/`current` for kept+removed so callers issue
 * calls in a stable, testable sequence.
 */
export function diffMembership(current: string[], next: string[]): MembershipDiff {
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  return {
    kept: current.filter((id) => nextSet.has(id)),
    added: next.filter((id) => !currentSet.has(id)),
    removed: current.filter((id) => !nextSet.has(id)),
  };
}

/**
 * Normalize the calendar ids off a request body, accepting either `calendarIds`
 * (an array) or the original scalar `calendarId`. Duplicates are collapsed and
 * order is preserved, so a client that sends the same calendar twice gets one
 * event rather than two identical ones on the same calendar.
 *
 * Returns null when neither field carries a usable value — the caller decides
 * whether that's a 400 (create) or "leave membership alone" (update).
 */
export function readCalendarIds(body: {
  calendarIds?: unknown;
  calendarId?: unknown;
}): string[] | null {
  const raw = Array.isArray(body.calendarIds)
    ? body.calendarIds
    : typeof body.calendarId === 'string'
      ? [body.calendarId]
      : null;
  if (!raw) return null;

  const ids = raw.filter((id): id is string => typeof id === 'string' && id.length > 0);
  const deduped = [...new Set(ids)];
  return deduped.length > 0 ? deduped : null;
}
