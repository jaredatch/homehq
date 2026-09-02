import { describe, it, expect } from 'vitest';
import { scopeEventsToBoard } from '@/lib/calendar/board-scope';
import type { LinkableEvent } from '@/lib/calendar/event-links';

/**
 * What a scoped board may read, and what it must still be told about the
 * calendars it can't. The dangerous case is the last one: a shared event whose
 * other copy is out of scope has to keep pointing at that copy, or the personal
 * board reads it as "only hers" and lets a bedroom panel rewrite a parent's
 * event (see lib/calendar/board-scope.ts).
 */

function event(over: Partial<LinkableEvent> & { calendar_id: string }): LinkableEvent {
  return {
    event_id: `ev-${over.calendar_id}`,
    summary: 'Dentist',
    start_time: '2026-09-10T14:00:00Z',
    end_time: '2026-09-10T15:00:00Z',
    all_day: 0,
    group_id: null,
    ...over,
  };
}

const HERS = new Set(['maddie', 'family']);

describe('scopeEventsToBoard', () => {
  it('hands back the same array for an unscoped board', () => {
    const events = [event({ calendar_id: 'maddie' }), event({ calendar_id: 'dad' })];
    expect(scopeEventsToBoard(events, null)).toBe(events);
  });

  it('drops events on calendars the board was not given', () => {
    const events = [
      event({ calendar_id: 'maddie' }),
      event({ calendar_id: 'dad', summary: 'Board meeting' }),
      event({ calendar_id: 'family', summary: 'Dinner' }),
    ];
    const scoped = scopeEventsToBoard(events, HERS);
    expect(scoped.map((e) => e.calendar_id)).toEqual(['maddie', 'family']);
    // The point of the whole exercise: the other calendar's CONTENT never
    // reaches the board.
    expect(JSON.stringify(scoped)).not.toContain('Board meeting');
  });

  it('stamps a stand-alone event with its own calendar', () => {
    const scoped = scopeEventsToBoard([event({ calendar_id: 'maddie' })], HERS);
    expect(scoped[0]).toHaveProperty('linkedCalendarIds', ['maddie']);
  });

  it('keeps an out-of-scope sibling visible through linkedCalendarIds', () => {
    const events = [
      event({ calendar_id: 'maddie', event_id: 'shared', group_id: 'g1' }),
      event({ calendar_id: 'dad', event_id: 'shared-dad', group_id: 'g1' }),
    ];
    const scoped = scopeEventsToBoard(events, HERS);
    expect(scoped).toHaveLength(1);
    expect(scoped[0]).toHaveProperty('linkedCalendarIds');
    expect(new Set((scoped[0] as { linkedCalendarIds: string[] }).linkedCalendarIds)).toEqual(
      new Set(['maddie', 'dad'])
    );
  });

  it('resolves a Google invite the same way — one event id on two calendars', () => {
    const events = [
      event({ calendar_id: 'maddie', event_id: 'invite-1' }),
      event({ calendar_id: 'dad', event_id: 'invite-1' }),
    ];
    const scoped = scopeEventsToBoard(events, HERS) as { linkedCalendarIds: string[] }[];
    expect(scoped).toHaveLength(1);
    expect(new Set(scoped[0].linkedCalendarIds)).toEqual(new Set(['maddie', 'dad']));
  });

  it('resolves a twin — the same thing typed in on two calendars', () => {
    const events = [
      event({ calendar_id: 'maddie', event_id: 'a' }),
      event({ calendar_id: 'dad', event_id: 'b' }),
    ];
    const scoped = scopeEventsToBoard(events, HERS) as { linkedCalendarIds: string[] }[];
    expect(new Set(scoped[0].linkedCalendarIds)).toEqual(new Set(['maddie', 'dad']));
  });

  it('resolves links against the FULL list, not the surviving slice', () => {
    // Three copies of one event blow the two-calendar cap, so the honest answer
    // is "no link". Resolving after filtering would leave two rows, sneak past
    // the cap, and report a link the write side would disagree with.
    const events = [
      event({ calendar_id: 'maddie', event_id: 'wide' }),
      event({ calendar_id: 'family', event_id: 'wide' }),
      event({ calendar_id: 'dad', event_id: 'wide' }),
    ];
    const scoped = scopeEventsToBoard(events, HERS) as { linkedCalendarIds: string[] }[];
    expect(scoped).toHaveLength(2);
    expect(scoped[0].linkedCalendarIds).toEqual(['maddie']);
    expect(scoped[1].linkedCalendarIds).toEqual(['family']);
  });

  it('leaves an in-scope pair linked to both of the board’s own calendars', () => {
    const events = [
      event({ calendar_id: 'maddie', event_id: 'both', group_id: 'g2' }),
      event({ calendar_id: 'family', event_id: 'both-f', group_id: 'g2' }),
    ];
    const scoped = scopeEventsToBoard(events, HERS) as { linkedCalendarIds: string[] }[];
    expect(scoped).toHaveLength(2);
    for (const e of scoped) {
      expect(new Set(e.linkedCalendarIds)).toEqual(new Set(['maddie', 'family']));
    }
  });

  it('does not mutate the rows it was handed', () => {
    const events = [event({ calendar_id: 'maddie' })];
    scopeEventsToBoard(events, HERS);
    expect(events[0]).not.toHaveProperty('linkedCalendarIds');
  });
});
