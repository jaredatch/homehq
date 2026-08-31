import { describe, expect, it } from 'vitest';
import {
  assignEventsToDays,
  bandEvents,
  computeWeekSegments,
  eventDaySpan,
  spansMultipleDays,
  type CalendarEvent,
} from '@/components/calendar/calendar-utils';
import { buildAgenda } from '@/components/board/personal-utils';

/**
 * Timed events that run past midnight.
 *
 * The grid used to key every timed event by its start date alone, so an 8pm
 * event ending at 4:30am the next morning drew once, on the first day, with
 * nothing to say it continued. There is exactly one thing a week grid can do
 * with a span — draw a bar across the columns — which is the all-day band, so
 * that is where these events go now.
 */

const WEEK = [
  '2026-08-31',
  '2026-09-01',
  '2026-09-02',
  '2026-09-03',
  '2026-09-04',
  '2026-09-05',
  '2026-09-06',
];

function ev(over: Partial<CalendarEvent> & Pick<CalendarEvent, 'start_time' | 'end_time'>) {
  return {
    id: 1,
    event_id: 'e1',
    calendar_id: 'cal',
    summary: 'Event',
    description: null,
    location: null,
    all_day: 0,
    updated_at: '2026-08-31T00:00:00Z',
    recurring_event_id: null,
    group_id: null,
    ...over,
  } as CalendarEvent;
}

// The real event that started this: Tue 8pm through Wed 4:30am.
const SLEEP_STUDY = ev({
  event_id: 'sleep',
  summary: 'Sleep Study',
  start_time: '2026-09-01T20:00:00-05:00',
  end_time: '2026-09-02T04:30:00-05:00',
});

const ALL_DAY = ev({
  event_id: 'cobra',
  summary: 'Pay cobra',
  all_day: 1,
  start_time: '2026-09-01',
  end_time: '2026-09-02',
});

const SAME_DAY = ev({
  event_id: 'workout',
  summary: 'Workout',
  start_time: '2026-09-01T12:15:00-05:00',
  end_time: '2026-09-01T13:15:00-05:00',
});

describe('eventDaySpan', () => {
  it('passes an all-day event through with Google’s exclusive end', () => {
    expect(eventDaySpan(ALL_DAY)).toEqual({ from: '2026-09-01', to: '2026-09-02' });
  });

  it('makes a timed event’s end exclusive by rolling to the next day', () => {
    expect(eventDaySpan(SLEEP_STUDY)).toEqual({ from: '2026-09-01', to: '2026-09-03' });
  });

  it('keeps a same-day timed event inside one day', () => {
    expect(eventDaySpan(SAME_DAY)).toEqual({ from: '2026-09-01', to: '2026-09-02' });
  });

  it('does not roll an event that ends at exactly midnight', () => {
    // 11pm-to-midnight is a Tuesday event, not a Tuesday-and-Wednesday one.
    const late = ev({
      start_time: '2026-09-01T23:00:00-05:00',
      end_time: '2026-09-02T00:00:00-05:00',
    });
    expect(eventDaySpan(late)).toEqual({ from: '2026-09-01', to: '2026-09-02' });
    expect(spansMultipleDays(late)).toBe(false);
  });
});

describe('bandEvents', () => {
  it('takes every all-day event, as before', () => {
    expect(bandEvents([ALL_DAY, SAME_DAY])).toEqual([ALL_DAY]);
  });

  it('also takes a timed event that runs past midnight', () => {
    expect(bandEvents([SAME_DAY, SLEEP_STUDY])).toEqual([SLEEP_STUDY]);
  });

  it('leaves a board with no multi-day events with exactly its all-day set', () => {
    const events = [
      SAME_DAY,
      ALL_DAY,
      ev({
        event_id: 'x',
        start_time: '2026-09-03T09:00:00-05:00',
        end_time: '2026-09-03T10:00:00-05:00',
      }),
    ];
    expect(bandEvents(events)).toEqual([ALL_DAY]);
  });
});

describe('computeWeekSegments — the prefix trap', () => {
  it('spans an overnight event across both of its days', () => {
    // The bug this guards: "2026-09-01" < "2026-09-01T20:00:00-05:00" is TRUE
    // in a string compare, because the date is a prefix of the timestamp. Fed
    // in raw, the scan walked one column too far and drew the bar on Wednesday
    // alone.
    const { segments } = computeWeekSegments([SLEEP_STUDY], WEEK);
    expect(segments).toHaveLength(1);
    expect(segments[0].startCol).toBe(1); // Tuesday
    expect(segments[0].span).toBe(2); // through Wednesday
  });

  it('reserves a band lane on every column the bar passes through', () => {
    const { laneByColumn } = computeWeekSegments([SLEEP_STUDY], WEEK);
    expect(laneByColumn).toEqual([0, 1, 1, 0, 0, 0, 0]);
  });

  it('spans a timed event that runs several days', () => {
    // Real data: Salt Lake City Hyrox, Thu 10am to Sun 11am.
    const hyrox = ev({
      event_id: 'hyrox',
      start_time: '2026-09-03T10:00:00-05:00',
      end_time: '2026-09-06T11:00:00-05:00',
    });
    const { segments } = computeWeekSegments([hyrox], WEEK);
    expect(segments[0].startCol).toBe(3);
    expect(segments[0].span).toBe(4);
  });

  it('gives an all-day event the lane above a timed one starting the same day', () => {
    const { segments } = computeWeekSegments([SLEEP_STUDY, ALL_DAY], WEEK);
    const byId = Object.fromEntries(segments.map((s) => [s.event.event_id, s.slot]));
    expect(byId.cobra).toBeLessThan(byId.sleep);
  });

  it('clips a bar that starts before the week and flags it', () => {
    const spillIn = ev({
      start_time: '2026-08-30T20:00:00-05:00',
      end_time: '2026-08-31T04:30:00-05:00',
    });
    const { segments } = computeWeekSegments([spillIn], WEEK);
    expect(segments[0].startCol).toBe(0);
    expect(segments[0].span).toBe(1);
    expect(segments[0].continuesLeft).toBe(true);
  });

  it('leaves an all-day-only band exactly as it was', () => {
    // The rule 2 guard: for all-day events the new date normalisation is the
    // identity, so segments, slots, and lanes are unchanged.
    const b = ev({ event_id: 'b', all_day: 1, start_time: '2026-09-02', end_time: '2026-09-05' });
    const { segments, slotCount, laneByColumn } = computeWeekSegments([ALL_DAY, b], WEEK);
    expect(segments.map((s) => [s.event.event_id, s.startCol, s.span, s.slot])).toEqual([
      ['cobra', 1, 1, 0],
      ['b', 2, 3, 0],
    ]);
    expect(slotCount).toBe(1);
    expect(laneByColumn).toEqual([0, 1, 1, 1, 1, 0, 0]);
  });
});

describe('assignEventsToDays', () => {
  it('keeps an overnight event out of the timed stacks', () => {
    const map = assignEventsToDays([SLEEP_STUDY], WEEK);
    expect(map.get('2026-09-01')!.timed).toEqual([]);
    expect(map.get('2026-09-02')!.timed).toEqual([]);
  });

  it('lists it on both days it covers, and no others', () => {
    const map = assignEventsToDays([SLEEP_STUDY], WEEK);
    expect(map.get('2026-09-01')!.allDay).toEqual([SLEEP_STUDY]);
    expect(map.get('2026-09-02')!.allDay).toEqual([SLEEP_STUDY]);
    expect(map.get('2026-09-03')!.allDay).toEqual([]);
    expect(map.get('2026-08-31')!.allDay).toEqual([]);
  });

  it('still puts a same-day timed event in exactly one stack', () => {
    const map = assignEventsToDays([SAME_DAY], WEEK);
    expect(map.get('2026-09-01')!.timed).toEqual([SAME_DAY]);
    expect(map.get('2026-09-01')!.allDay).toEqual([]);
  });

  it('still spans an all-day event over [start, end)', () => {
    const trip = ev({ all_day: 1, start_time: '2026-09-01', end_time: '2026-09-04' });
    const map = assignEventsToDays([trip], WEEK);
    expect(map.get('2026-09-01')!.allDay).toHaveLength(1);
    expect(map.get('2026-09-03')!.allDay).toHaveLength(1);
    expect(map.get('2026-09-04')!.allDay).toHaveLength(0);
  });
});

describe('buildAgenda — the personal board says the same thing', () => {
  it('shows an overnight event on both of its days', () => {
    const agenda = buildAgenda([SLEEP_STUDY], '2026-09-01', 7);
    const tue = agenda.find((d) => d.date === '2026-09-01')!;
    const wed = agenda.find((d) => d.date === '2026-09-02')!;
    expect(tue.allDay).toEqual([SLEEP_STUDY]);
    expect(wed.allDay).toEqual([SLEEP_STUDY]);
    expect(tue.timed).toEqual([]);
  });

  it('leaves a same-day timed event in the timed list', () => {
    const agenda = buildAgenda([SAME_DAY], '2026-09-01', 7);
    expect(agenda[0].timed).toEqual([SAME_DAY]);
  });
});
