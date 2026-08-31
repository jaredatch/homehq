import { describe, it, expect } from 'vitest';
import {
  agendaLabel,
  buildAgenda,
  canEditEvent,
  eventTargets,
  fullWeekday,
  longDate,
  personOptions,
  shortDate,
} from '@/components/board/personal-utils';
import { isFinished, type CalendarEvent } from '@/components/calendar/calendar-utils';

function event(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 1,
    event_id: 'e1',
    calendar_id: 'kida@g',
    summary: 'Thing',
    description: null,
    location: null,
    start_time: '2026-08-28T15:30:00.000Z',
    end_time: '2026-08-28T16:30:00.000Z',
    all_day: 0,
    recurring_event_id: null,
    group_id: null,
    updated_at: '2026-08-28T00:00:00.000Z',
    ...over,
  };
}

describe('date labels', () => {
  it('names the weekday, long month, and short month', () => {
    expect(fullWeekday('2026-08-28')).toBe('Friday');
    expect(longDate('2026-08-28')).toBe('August 28');
    expect(shortDate('2026-08-28')).toBe('Aug 28');
  });

  it('uses the words a kid uses for the two nearest days', () => {
    expect(agendaLabel('2026-08-28', '2026-08-28')).toBe('Today');
    expect(agendaLabel('2026-08-29', '2026-08-28')).toBe('Tomorrow');
  });

  it('carries the date past tomorrow, not just the weekday', () => {
    // "Monday" alone stops meaning anything once it could be in ten days.
    expect(agendaLabel('2026-08-30', '2026-08-28')).toBe('Sunday, Aug 30');
    expect(agendaLabel('2026-09-07', '2026-08-28')).toBe('Monday, Sep 7');
  });

  it('crosses a month boundary without drifting a day', () => {
    expect(agendaLabel('2026-09-01', '2026-08-31')).toBe('Tomorrow');
    expect(shortDate('2026-01-01')).toBe('Jan 1');
    expect(shortDate('2026-12-31')).toBe('Dec 31');
  });
});

describe('buildAgenda', () => {
  const today = '2026-08-28';

  it('always shows today, even with nothing on it', () => {
    const days = buildAgenda([], today, 14);
    expect(days).toHaveLength(1);
    expect(days[0].label).toBe('Today');
    expect(days[0].timed).toEqual([]);
    expect(days[0].allDay).toEqual([]);
  });

  it('skips later days that have nothing on them', () => {
    const days = buildAgenda(
      [event({ event_id: 'a', start_time: '2026-08-30T18:00:00.000Z' })],
      today,
      14
    );
    expect(days.map((d) => d.date)).toEqual(['2026-08-28', '2026-08-30']);
  });

  it('orders a day’s timed events by start', () => {
    const days = buildAgenda(
      [
        event({ event_id: 'late', start_time: '2026-08-28T21:00:00.000Z' }),
        event({ event_id: 'early', start_time: '2026-08-28T13:00:00.000Z' }),
      ],
      today,
      14
    );
    expect(days[0].timed.map((e) => e.event_id)).toEqual(['early', 'late']);
  });

  it('spans an all-day event across [start, end) — Google’s end is exclusive', () => {
    const days = buildAgenda(
      [
        event({
          event_id: 'break',
          all_day: 1,
          start_time: '2026-08-29',
          end_time: '2026-08-31',
        }),
      ],
      today,
      14
    );
    // 29th and 30th, never the 31st.
    expect(days.filter((d) => d.allDay.length > 0).map((d) => d.date)).toEqual([
      '2026-08-29',
      '2026-08-30',
    ]);
  });

  it('ignores events past the window', () => {
    const days = buildAgenda(
      [event({ event_id: 'far', start_time: '2026-10-01T15:00:00.000Z' })],
      today,
      14
    );
    expect(days).toHaveLength(1);
  });
});

describe('isFinished', () => {
  const now = Date.parse('2026-08-28T17:00:00.000Z');

  it('is true once the end time has passed', () => {
    expect(isFinished(event({ end_time: '2026-08-28T16:30:00.000Z' }), now)).toBe(true);
  });

  it('is false while it is still running or still ahead', () => {
    expect(isFinished(event({ end_time: '2026-08-28T17:30:00.000Z' }), now)).toBe(false);
  });

  it('never dims an all-day event — a birthday is still true at bedtime', () => {
    expect(
      isFinished(event({ all_day: 1, start_time: '2026-08-28', end_time: '2026-08-29' }), now)
    ).toBe(false);
  });
});

describe('personOptions', () => {
  const calendars = [
    { id: 'kida@g', name: 'Kid A' },
    { id: 'kida-private@g', name: 'Kid A private' },
    { id: 'family@g', name: 'Family' },
    { id: 'kidb@g', name: 'Kid B' },
  ];

  it('puts her first, folding her calendars into one entry', () => {
    const options = personOptions(calendars, 'Kid A', ['kida@g', 'kida-private@g']);
    expect(options[0]).toEqual({
      label: 'Kid A',
      calendarIds: ['kida@g', 'kida-private@g'],
    });
  });

  it('lists everyone else individually, then Everyone', () => {
    const options = personOptions(calendars, 'Kid A', ['kida@g', 'kida-private@g']);
    expect(options.map((o) => o.label)).toEqual(['Kid A', 'Family', 'Kid B', 'Everyone']);
    expect(options.at(-1)!.calendarIds).toHaveLength(4);
  });

  it('folds an always-shown calendar into every option', () => {
    // "Maddie" honestly means Maddie; Family is simply never absent, because a
    // family dinner is her evening too.
    const options = personOptions(calendars, 'Kid A', ['kida@g'], ['family@g']);
    expect(options.map((o) => o.label)).toEqual(['Kid A', 'Kid A private', 'Kid B', 'Everyone']);
    expect(options[0].calendarIds.sort()).toEqual(['family@g', 'kida@g']);
    expect(options[2].calendarIds.sort()).toEqual(['family@g', 'kidb@g']);
  });

  it('never lists an always-shown calendar as its own option', () => {
    // It can't be switched off, so an entry for it could only narrow away from
    // everything else — a control that lies about what it does.
    const options = personOptions(calendars, 'Kid A', ['kida@g'], ['family@g']);
    expect(options.map((o) => o.label)).not.toContain('Family');
  });

  it('offers no picker when there is no one else to look at', () => {
    // One option means PersonalUpcoming renders her name as a label, not a
    // control — nothing to switch to, so nothing to auto-revert either.
    const own = [{ id: 'kida@g', name: 'Kid A' }];
    expect(personOptions(own, 'Kid A', ['kida@g'])).toEqual([
      { label: 'Kid A', calendarIds: ['kida@g'] },
    ]);
  });
});

describe('eventTargets', () => {
  // A personal board's calendars: her room calendar is hidden (syncs, never
  // reaches the wall), her own calendar is not, and Family is always shown.
  const calendars = [
    { id: 'kida@g', name: 'Kid A' },
    { id: 'kida-room@g', name: 'Kid A room', hidden: true },
    { id: 'family@g', name: 'Family' },
  ];

  it('offers her room calendar as "Just me" and her own as "Family"', () => {
    const targets = eventTargets(calendars, ['kida@g', 'kida-room@g'], ['family@g'], 'kida-room@g');
    expect(targets).toEqual([
      { key: 'justMe', label: 'Just me', calendarId: 'kida-room@g' },
      { key: 'family', label: 'Family', calendarId: 'kida@g' },
    ]);
  });

  it('never publishes to a hidden calendar', () => {
    // "Family" that lands somewhere the wall doesn't draw is a lie, and the
    // kind that only shows up when someone asks why nobody came.
    const targets = eventTargets(
      [
        { id: 'kida-room@g', name: 'Kid A room', hidden: true },
        { id: 'kida-other@g', name: 'Kid A other', hidden: true },
      ],
      ['kida-room@g', 'kida-other@g'],
      [],
      'kida-room@g'
    );
    expect(targets).toHaveLength(1);
    expect(targets[0].key).toBe('justMe');
  });

  it('falls back to the always-shown calendar when she owns only a private one', () => {
    const targets = eventTargets(
      [
        { id: 'kida-room@g', name: 'Kid A room', hidden: true },
        { id: 'family@g', name: 'Family' },
      ],
      ['kida-room@g'],
      ['family@g'],
      'kida-room@g'
    );
    expect(targets.map((t) => t.calendarId)).toEqual(['kida-room@g', 'family@g']);
  });

  it('falls back to her first own calendar when no default is configured', () => {
    const targets = eventTargets(calendars, ['kida@g', 'kida-room@g'], ['family@g']);
    expect(targets[0].calendarId).toBe('kida@g');
  });

  it('ignores a default that this board does not actually show', () => {
    const targets = eventTargets(calendars, ['kida@g'], [], 'somewhere-else@g');
    expect(targets[0].calendarId).toBe('kida@g');
  });

  it('returns nothing when the board has no calendar of its own', () => {
    // The Add Event button is hidden rather than opening a form with nowhere
    // to save to.
    expect(eventTargets(calendars, [], [])).toEqual([]);
  });
});

describe('canEditEvent', () => {
  const own = ['kida@g', 'kida-room@g'];

  it('lets her edit an event on her own calendar', () => {
    expect(canEditEvent(event({ calendar_id: 'kida@g' }), own)).toBe(true);
  });

  it('makes someone else’s event read-only', () => {
    expect(canEditEvent(event({ calendar_id: 'family@g' }), own)).toBe(false);
  });

  it('makes a shared event read-only when any copy is someone else’s', () => {
    // The whole point of the scoping rule: saving this would rewrite the
    // parent's copy too, from a bedroom panel.
    const shared = event({ calendar_id: 'kida@g', groupCalendarIds: ['kida@g', 'mom@g'] });
    expect(canEditEvent(shared, own)).toBe(false);
  });

  it('still allows an event shared between two of her own calendars', () => {
    const shared = event({
      calendar_id: 'kida@g',
      groupCalendarIds: ['kida@g', 'kida-room@g'],
    });
    expect(canEditEvent(shared, own)).toBe(true);
  });

  it('makes a repeating occurrence read-only even on her own calendar', () => {
    // The cache has no series link, so the write routes reject it anyway —
    // better to say so on a card than to reject a form she just filled in.
    const repeat = event({ calendar_id: 'kida@g', recurring_event_id: 'series-1' });
    expect(canEditEvent(repeat, own)).toBe(false);
  });
});
