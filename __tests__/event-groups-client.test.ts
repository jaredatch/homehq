import { describe, it, expect } from 'vitest';
import { isMembershipLocked, mergeGroups } from '@/components/calendar/event-groups';
import { calendarIdsForEvent } from '@/lib/calendar/event-links';

/** Config order — Maddie before Eleanor, as the legend reads. */
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
  groupMatch?: 'stamp' | 'google' | 'twin';
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

/** A stamped pair — HomeHQ's own shared event (tier 1). */
const pair = () => [
  make({ event_id: 'g_maddie', calendar_id: 'maddie', group_id: 'grp' }),
  make({ event_id: 'g_eleanor', calendar_id: 'eleanor', group_id: 'grp' }),
];

/** An invite: ONE Google event surfacing on two calendars, so one event id (tier 2). */
const invited = () => [
  make({ event_id: 'shared_id', calendar_id: 'jared', summary: 'Lunch' }),
  make({ event_id: 'shared_id', calendar_id: 'sam', summary: 'Lunch' }),
];

/** The same thing typed in twice — two unrelated ids, identical title+times (tier 3). */
const twins = () => [
  make({ event_id: 't_maddie', calendar_id: 'maddie', summary: 'Pigs' }),
  make({ event_id: 't_eleanor', calendar_id: 'eleanor', summary: 'Pigs' }),
];

describe('calendarIdsForEvent', () => {
  const maddie = make({ event_id: 'g_maddie', calendar_id: 'maddie', group_id: 'grp_1' });
  const eleanor = make({ event_id: 'g_eleanor', calendar_id: 'eleanor', group_id: 'grp_1' });
  // Distinct title AND times so it can't twin-match anything else here.
  const solo = make({
    event_id: 'solo',
    calendar_id: 'family',
    summary: 'Trash out',
    start_time: '2026-09-10',
    end_time: '2026-09-11',
  });
  const other = make({
    event_id: 'o_jared',
    calendar_id: 'jared',
    summary: 'Dinner',
    start_time: '2026-09-11',
    end_time: '2026-09-12',
    group_id: 'grp_2',
  });

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

  it('finds the sibling of an invite (same Google id, two calendars)', () => {
    const [jared, sam] = invited();
    expect(calendarIdsForEvent([jared, sam], jared).sort()).toEqual(['jared', 'sam']);
  });

  it('finds the sibling of a twin pair', () => {
    const [a, b] = twins();
    expect(calendarIdsForEvent([a, b], a).sort()).toEqual(['eleanor', 'maddie']);
  });
});

describe('isMembershipLocked', () => {
  it('locks an invite — its guest list belongs to Google, not to us', () => {
    const [jared, sam] = invited();
    expect(isMembershipLocked([jared, sam], jared)).toBe(true);
  });

  it('leaves a stamped shared event editable', () => {
    const [a, b] = pair();
    expect(isMembershipLocked([a, b], a)).toBe(false);
  });

  it('leaves a twin pair editable — saving adopts it into a real group', () => {
    const [a, b] = twins();
    expect(isMembershipLocked([a, b], a)).toBe(false);
  });

  it('leaves an ordinary event editable', () => {
    const solo = make({ event_id: 'solo' });
    expect(isMembershipLocked([solo], solo)).toBe(false);
  });
});

describe('mergeGroups', () => {
  it('returns the SAME array reference when nothing is shared', () => {
    const events = [
      make({ event_id: 'a', summary: 'Dentist' }),
      make({ event_id: 'b', calendar_id: 'family', summary: 'Trash out' }),
    ];
    expect(mergeGroups(events, ORDER)).toBe(events);
  });

  it('collapses two copies into one event carrying both calendars', () => {
    const out = mergeGroups(pair(), ORDER);
    expect(out).toHaveLength(1);
    expect(out[0].groupCalendarIds).toEqual(['maddie', 'eleanor']);
    expect(out[0].groupMatch).toBe('stamp');
  });

  it('picks the representative by config order, not input order', () => {
    // Eleanor's copy arrives first; Maddie still wins the primary slot.
    const out = mergeGroups([...pair()].reverse(), ORDER);
    expect(out[0].calendar_id).toBe('maddie');
    expect(out[0].event_id).toBe('g_maddie');
    expect(out[0].groupCalendarIds).toEqual(['maddie', 'eleanor']);
  });

  it('leaves ungrouped events as the very same objects', () => {
    const solo = make({ event_id: 'solo', calendar_id: 'family', summary: 'Trash out' });
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
      summary: 'Breakfast',
      start_time: '2026-09-04T08:00',
    });
    const late = make({
      event_id: 'late',
      calendar_id: 'family',
      summary: 'Bedtime',
      start_time: '2026-09-04T20:00',
    });
    const out = mergeGroups([early, ...pair(), late], ORDER);
    expect(out.map((e) => e.event_id)).toEqual(['early', 'g_maddie', 'late']);
  });

  it('tolerates a calendar missing from config order without dropping it', () => {
    const out = mergeGroups(pair(), ['eleanor']); // maddie unranked
    expect(out).toHaveLength(1);
    expect(out[0].calendar_id).toBe('eleanor'); // ranked one wins
    expect([...out[0].groupCalendarIds!].sort()).toEqual(['eleanor', 'maddie']);
  });

  // Tier 2 — Google's own link. "Lunch" on Jared's and Sam's calendars is one
  // event resource with a guest, so both rows carry the same event id.
  describe('invites (same Google event id)', () => {
    it('collapses an invite into one chip', () => {
      const out = mergeGroups(invited(), ORDER);
      expect(out).toHaveLength(1);
      expect(out[0].groupCalendarIds).toEqual(['jared', 'sam']);
      expect(out[0].groupMatch).toBe('google');
    });

    it('does not merge two rows of the same id on ONE calendar', () => {
      // A cache artefact, never two people.
      const events = [
        make({ event_id: 'dup', calendar_id: 'jared' }),
        make({ event_id: 'dup', calendar_id: 'jared' }),
      ];
      expect(mergeGroups(events, ORDER)).toBe(events);
    });

    it('refuses to merge past the two-calendar cap', () => {
      // Three colours have no answer in the paint, so it draws separately rather
      // than picking two arbitrarily.
      const events = [
        make({ event_id: 'wide', calendar_id: 'jared', summary: 'Lunch' }),
        make({ event_id: 'wide', calendar_id: 'sam', summary: 'Lunch' }),
        make({ event_id: 'wide', calendar_id: 'family', summary: 'Lunch' }),
      ];
      expect(mergeGroups(events, ORDER)).toHaveLength(3);
    });
  });

  // Tier 3 — the inferred one. Same title, same start, same end, different ids.
  describe('twins (same title and times, entered separately)', () => {
    it('collapses a twin pair into one chip', () => {
      const out = mergeGroups(twins(), ORDER);
      expect(out).toHaveLength(1);
      expect(out[0].groupCalendarIds).toEqual(['maddie', 'eleanor']);
      expect(out[0].groupMatch).toBe('twin');
    });

    it('does not merge a different title', () => {
      const [a, b] = twins();
      b.summary = 'Pigs (Eleanor only)';
      expect(mergeGroups([a, b], ORDER)).toHaveLength(2);
    });

    it('does not merge a different time', () => {
      const [a, b] = twins();
      b.start_time = '2026-09-05';
      expect(mergeGroups([a, b], ORDER)).toHaveLength(2);
    });

    it('does not merge an all-day copy with a timed one', () => {
      const [a, b] = twins();
      b.all_day = 0;
      expect(mergeGroups([a, b], ORDER)).toHaveLength(2);
    });

    it('does not merge two copies on the same calendar', () => {
      const events = [
        make({ event_id: 't1', calendar_id: 'maddie', summary: 'Pigs' }),
        make({ event_id: 't2', calendar_id: 'maddie', summary: 'Pigs' }),
      ];
      expect(mergeGroups(events, ORDER)).toBe(events);
    });

    it('refuses to merge past the two-calendar cap', () => {
      const events = [
        make({ event_id: 't1', calendar_id: 'maddie', summary: 'Pigs' }),
        make({ event_id: 't2', calendar_id: 'eleanor', summary: 'Pigs' }),
        make({ event_id: 't3', calendar_id: 'family', summary: 'Pigs' }),
      ];
      expect(mergeGroups(events, ORDER)).toHaveLength(3);
    });
  });

  describe('precedence', () => {
    it('a stamped pair is never re-matched by a weaker tier', () => {
      // Maddie + Eleanor are stamped; a third identical row on Family must NOT
      // be pulled in as a twin, or the deliberate pair would grow by accident.
      const family = make({ event_id: 'f', calendar_id: 'family' });
      const out = mergeGroups([...pair(), family], ORDER);
      expect(out).toHaveLength(2);
      expect(out[0].groupCalendarIds).toEqual(['maddie', 'eleanor']);
      expect(out.find((e) => e.event_id === 'f')).toBe(family);
    });

    it('an invite is matched as google, not as a twin', () => {
      const out = mergeGroups(invited(), ORDER);
      expect(out[0].groupMatch).toBe('google');
    });

    it('a drifted stamped pair does not fall back to twin matching', () => {
      // Their titles differ, so nothing should rescue them — drift means drift.
      const [a, b] = pair();
      b.summary = 'changed';
      expect(mergeGroups([a, b], ORDER)).toHaveLength(2);
    });
  });
});
