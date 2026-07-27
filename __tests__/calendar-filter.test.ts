import { describe, expect, it } from 'vitest';
import { nextFilter, filterEvents } from '@/components/calendar/calendar-filter';

// The store's snapshot logic is pure in `nextFilter`; the derivation is pure in
// `filterEvents`. Both are tested here without a React renderer.

describe('nextFilter — isolate-first, then additive', () => {
  const TOTAL = 6; // six calendars (like the household)

  it('isolates on the first click from "show all"', () => {
    const out = nextFilter(new Set(), 'jared', TOTAL);
    expect([...out]).toEqual(['jared']);
  });

  it('adds a second person to an existing filter', () => {
    const out = nextFilter(new Set(['jared']), 'sam', TOTAL);
    expect(out).toEqual(new Set(['jared', 'sam']));
  });

  it('toggles a kept person back off', () => {
    const out = nextFilter(new Set(['jared', 'sam']), 'jared', TOTAL);
    expect(out).toEqual(new Set(['sam']));
  });

  it('un-soloing the last person returns to "show all" (empty)', () => {
    const out = nextFilter(new Set(['sam']), 'sam', TOTAL);
    expect(out.size).toBe(0);
  });

  it('collapses to "show all" when every calendar ends up selected', () => {
    const five = new Set(['a', 'b', 'c', 'd', 'e']);
    const out = nextFilter(five, 'f', TOTAL);
    expect(out.size).toBe(0);
  });

  it('single-calendar setups can never stay filtered', () => {
    // Isolating the only calendar equals selecting all → "show all".
    const out = nextFilter(new Set(), 'only', 1);
    expect(out.size).toBe(0);
  });

  it('does not mutate the input set', () => {
    const input = new Set(['jared']);
    nextFilter(input, 'sam', TOTAL);
    expect(input).toEqual(new Set(['jared']));
  });
});

describe('filterEvents', () => {
  const events = [
    { calendar_id: 'jared', event_id: '1' },
    { calendar_id: 'sam', event_id: '2' },
    { calendar_id: 'jared', event_id: '3' },
  ];

  it('returns the SAME array reference when the filter is empty (wall invariant)', () => {
    expect(filterEvents(events, new Set())).toBe(events);
  });

  it('keeps only events whose calendar is in the filter', () => {
    const out = filterEvents(events, new Set(['jared']));
    expect(out.map((e) => e.event_id)).toEqual(['1', '3']);
  });

  it('supports a multi-calendar filter', () => {
    const out = filterEvents(events, new Set(['jared', 'sam']));
    expect(out).toHaveLength(3);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterEvents(events, new Set(['nobody']))).toEqual([]);
  });
});
