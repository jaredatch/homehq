import { describe, it, expect } from 'vitest';
import { calendarIdsForEvent, mergeGroups } from '@/components/calendar/event-groups';

describe('calendarIdsForEvent', () => {
  const maddie = { calendar_id: 'maddie', group_id: 'grp_1' };
  const eleanor = { calendar_id: 'eleanor', group_id: 'grp_1' };
  const solo = { calendar_id: 'family', group_id: null };
  const other = { calendar_id: 'jared', group_id: 'grp_2' };

  it('returns just its own calendar for an ordinary event', () => {
    expect(calendarIdsForEvent([solo, maddie, eleanor], solo)).toEqual(['family']);
  });

  it('finds every calendar a shared event lives on', () => {
    const ids = calendarIdsForEvent([solo, maddie, eleanor, other], maddie);
    expect([...ids].sort()).toEqual(['eleanor', 'maddie']);
  });

  it('does not bleed across groups', () => {
    expect(calendarIdsForEvent([maddie, eleanor, other], other)).toEqual(['jared']);
  });

  it('falls back to its own calendar when siblings are missing from the list', () => {
    // A filtered or short-range list may not contain the sibling; the form must
    // never end up with an empty selection.
    expect(calendarIdsForEvent([maddie], maddie)).toEqual(['maddie']);
    expect(calendarIdsForEvent([], maddie)).toEqual(['maddie']);
  });

  it('collapses duplicate rows for the same calendar', () => {
    expect(calendarIdsForEvent([maddie, maddie, eleanor], maddie).sort()).toEqual([
      'eleanor',
      'maddie',
    ]);
  });
});

describe('mergeGroups', () => {
  // Config order — Maddie before Eleanor, as the legend reads.
  const ORDER = ['jared', 'sam', 'maddie', 'eleanor', 'family'];

  interface TestEvent {
    event_id: string;
    calendar_id: string;
    summary: string;
    start_time: string;
    end_time: string;
    all_day: number;
    group_id: string | null;
    groupCalendarIds?: string[];
  }

  const make = (overrides: Partial<TestEvent> = {}): TestEvent => ({
    event_id: 'evt',
    calendar_id: 'maddie',
    summary: 'No school',
    start_time: '2026-09-04',
    end_time: '2026-09-05',
    all_day: 1,
    group_id: null,
    ...overrides,
  });

  const pair = () => [
    make({ event_id: 'g_maddie', calendar_id: 'maddie', group_id: 'grp' }),
    make({ event_id: 'g_eleanor', calendar_id: 'eleanor', group_id: 'grp' }),
  ];

  it('returns the SAME array reference when nothing is shared', () => {
    const events = [make({ event_id: 'a' }), make({ event_id: 'b', calendar_id: 'family' })];
    expect(mergeGroups(events, ORDER)).toBe(events);
  });

  it('collapses two copies into one event carrying both calendars', () => {
    const out = mergeGroups(pair(), ORDER);
    expect(out).toHaveLength(1);
    expect(out[0].groupCalendarIds).toEqual(['maddie', 'eleanor']);
  });

  it('picks the representative by config order, not input order', () => {
    // Eleanor's copy arrives first; Maddie still wins the primary slot.
    const out = mergeGroups([...pair()].reverse(), ORDER);
    expect(out[0].calendar_id).toBe('maddie');
    expect(out[0].event_id).toBe('g_maddie');
    expect(out[0].groupCalendarIds).toEqual(['maddie', 'eleanor']);
  });

  it('leaves ungrouped events as the very same objects', () => {
    const solo = make({ event_id: 'solo', calendar_id: 'family' });
    const out = mergeGroups([solo, ...pair()], ORDER);
    expect(out.find((e) => e.event_id === 'solo')).toBe(solo);
  });

  it('un-merges drifted copies rather than picking a winner', () => {
    const [a, b] = pair();
    b.summary = 'No school (early release)'; // edited on someone's phone
    const out = mergeGroups([a, b], ORDER);
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.groupCalendarIds === undefined)).toBe(true);
  });

  it('un-merges on a time change too', () => {
    const [a, b] = pair();
    b.end_time = '2026-09-06';
    expect(mergeGroups([a, b], ORDER)).toHaveLength(2);
  });

  it('returns the same reference when every group drifted', () => {
    const [a, b] = pair();
    b.summary = 'different';
    const events = [a, b];
    expect(mergeGroups(events, ORDER)).toBe(events);
  });

  it('leaves a group of one alone (membership shrank back to one person)', () => {
    const [only] = pair();
    const events = [only];
    expect(mergeGroups(events, ORDER)).toBe(events);
    expect(events[0].groupCalendarIds).toBeUndefined();
  });

  it('keeps groups independent', () => {
    const other = [
      make({ event_id: 'h_jared', calendar_id: 'jared', summary: 'Dinner', group_id: 'grp2' }),
      make({ event_id: 'h_sam', calendar_id: 'sam', summary: 'Dinner', group_id: 'grp2' }),
    ];
    const out = mergeGroups([...pair(), ...other], ORDER);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.groupCalendarIds)).toEqual([
      ['maddie', 'eleanor'],
      ['jared', 'sam'],
    ]);
  });

  it('emits the merged event where the first copy sat, preserving sort order', () => {
    const early = make({
      event_id: 'early',
      calendar_id: 'family',
      start_time: '2026-09-04T08:00',
    });
    const late = make({ event_id: 'late', calendar_id: 'family', start_time: '2026-09-04T20:00' });
    const out = mergeGroups([early, ...pair(), late], ORDER);
    expect(out.map((e) => e.event_id)).toEqual(['early', 'g_maddie', 'late']);
  });

  it('tolerates a calendar missing from config order without dropping it', () => {
    const out = mergeGroups(pair(), ['eleanor']); // maddie unranked
    expect(out).toHaveLength(1);
    expect(out[0].calendar_id).toBe('eleanor'); // ranked one wins
    expect([...out[0].groupCalendarIds!].sort()).toEqual(['eleanor', 'maddie']);
  });
});
