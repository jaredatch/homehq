import { describe, it, expect } from 'vitest';
import { diffMembership, readCalendarIds, MAX_GROUP_CALENDARS } from '@/lib/calendar/event-groups';

describe('diffMembership', () => {
  it('reports no change when the set is identical', () => {
    expect(diffMembership(['maddie', 'eleanor'], ['maddie', 'eleanor'])).toEqual({
      kept: ['maddie', 'eleanor'],
      added: [],
      removed: [],
    });
  });

  it('removes only the unchecked calendar (Maddie can no longer go)', () => {
    expect(diffMembership(['maddie', 'eleanor'], ['eleanor'])).toEqual({
      kept: ['eleanor'],
      added: [],
      removed: ['maddie'],
    });
  });

  it('promotes an ordinary event by adding a second calendar', () => {
    expect(diffMembership(['maddie'], ['maddie', 'eleanor'])).toEqual({
      kept: ['maddie'],
      added: ['eleanor'],
      removed: [],
    });
  });

  it('handles a full swap (nothing kept)', () => {
    expect(diffMembership(['maddie'], ['eleanor'])).toEqual({
      kept: [],
      added: ['eleanor'],
      removed: ['maddie'],
    });
  });

  it('is order-insensitive about what counts as kept', () => {
    const diff = diffMembership(['maddie', 'eleanor'], ['eleanor', 'maddie']);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect([...diff.kept].sort()).toEqual(['eleanor', 'maddie']);
  });
});

describe('readCalendarIds', () => {
  it('reads an explicit array', () => {
    expect(readCalendarIds({ calendarIds: ['maddie', 'eleanor'] })).toEqual(['maddie', 'eleanor']);
  });

  it('accepts the original scalar calendarId', () => {
    expect(readCalendarIds({ calendarId: 'maddie' })).toEqual(['maddie']);
  });

  it('prefers the array when both are present', () => {
    expect(readCalendarIds({ calendarIds: ['eleanor'], calendarId: 'maddie' })).toEqual([
      'eleanor',
    ]);
  });

  it('collapses duplicates so one calendar never gets two identical events', () => {
    expect(readCalendarIds({ calendarIds: ['maddie', 'maddie'] })).toEqual(['maddie']);
  });

  it('preserves the order the user chose', () => {
    expect(readCalendarIds({ calendarIds: ['eleanor', 'maddie'] })).toEqual(['eleanor', 'maddie']);
  });

  it('returns null when nothing usable is present', () => {
    expect(readCalendarIds({})).toBeNull();
    expect(readCalendarIds({ calendarIds: [] })).toBeNull();
    expect(readCalendarIds({ calendarId: '' })).toBeNull();
    expect(readCalendarIds({ calendarIds: [1, null] })).toBeNull();
  });

  it('drops non-string entries but keeps the valid ones', () => {
    expect(readCalendarIds({ calendarIds: ['maddie', 42, null] })).toEqual(['maddie']);
  });
});

describe('MAX_GROUP_CALENDARS', () => {
  it('is a UI/route rule, not a schema one — two while the design is settled', () => {
    expect(MAX_GROUP_CALENDARS).toBe(2);
  });
});
