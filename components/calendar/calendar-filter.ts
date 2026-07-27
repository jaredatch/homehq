'use client';

import { useSyncExternalStore } from 'react';

/**
 * Cross-view calendar filter — which calendars the calendar area is narrowed to.
 * An empty set means "show everyone": the default, and the ONLY state the
 * always-on wall ever boots into.
 *
 * Deliberately IN-MEMORY, not persisted — like `viewMode` and the expand toggle,
 * a filter must never survive a reload onto the wall (someone soloing "Sam" and
 * walking away must not hide the family's events for days). It survives the
 * week↔month switch only because CalendarView stays mounted around both grids,
 * so this module state is untouched by the swap. CalendarView also auto-reverts
 * it to "show all" after idle (config.display.filterResetSeconds).
 *
 * Mirrors the legend-collapse store's `useSyncExternalStore` shape in
 * CalendarFooter, minus the localStorage. The footer, both grids, and
 * CalendarView all read it directly — no prop drilling. The mutation and
 * derivation logic are pure exported functions (`nextFilter`, `filterEvents`)
 * so they're unit-testable without a React renderer.
 */

// A single shared empty set, the canonical "show all". The SAME reference every
// time nothing is filtered — so `useCalendarFilter()` is a stable snapshot and
// (via filterEvents) an unfiltered grid's derived events are referentially
// identical to its input. Typed ReadonlySet so it can't be mutated in place.
const EMPTY: ReadonlySet<string> = new Set<string>();

/**
 * The active set after clicking `id`, isolate-first then additive:
 * - from "show all" (empty) → solo `id`
 * - `id` already kept → remove it
 * - otherwise → add it
 * Selecting every calendar collapses back to "show all" (an empty set), so no
 * filter lingers when everyone is visible (and a single-calendar setup can't get
 * stuck filtered to its one calendar). Pure — returns a fresh set, mutates
 * nothing.
 */
export function nextFilter(
  current: ReadonlySet<string>,
  id: string,
  totalCount: number
): Set<string> {
  let next: Set<string>;
  if (current.size === 0) {
    next = new Set([id]); // isolate
  } else if (current.has(id)) {
    next = new Set(current);
    next.delete(id);
  } else {
    next = new Set(current);
    next.add(id);
  }
  return next.size >= totalCount ? new Set() : next;
}

/**
 * Narrow `events` to the active calendars. An empty filter returns the SAME
 * array reference, so an unfiltered grid's downstream layout is byte-for-byte
 * unchanged. Shared by both grids so filtering behaves identically in each.
 */
export function filterEvents<T extends { calendar_id: string }>(
  events: T[],
  active: ReadonlySet<string>
): T[] {
  return active.size === 0 ? events : events.filter((e) => active.has(e.calendar_id));
}

let current: ReadonlySet<string> = EMPTY;
const listeners = new Set<() => void>();

function commit(next: ReadonlySet<string>) {
  if (next === current) return;
  current = next;
  for (const l of listeners) l();
}

/** Toggle `id` in the filter (see nextFilter for the semantics). */
export function toggleCalendar(id: string, totalCount: number) {
  const next = nextFilter(current, id, totalCount);
  commit(next.size === 0 ? EMPTY : next); // keep "show all" the canonical EMPTY
}

/** Back to "show all". */
export function clearFilter() {
  commit(EMPTY);
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
const getSnapshot = () => current;
const getServerSnapshot = () => EMPTY;

/**
 * The active filter set (empty = show all). The reference is stable between
 * mutations, so it's safe as a `useMemo` dependency.
 */
export function useCalendarFilter(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
