import { describe, it, expect } from 'vitest';
import { calendarIdsForEvent } from '@/components/calendar/event-groups';

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
