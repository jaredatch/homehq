// Shared validation + date math for the event create/update routes. Keeping it
// in one place stops the two routes' timing rules from drifting apart.

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:mm, 24-hour

/** Add n calendar days to a YYYY-MM-DD string (UTC math, no DST drift). */
export function addUtcDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The day after `date`. Google's all-day `end.date` is exclusive, so a
 * single-day all-day event ends on the following day. */
export const nextDay = (date: string): string => addUtcDays(date, 1);

/** Whole-day span of an all-day event from its stored (exclusive-end) dates.
 * Always ≥ 1. Lets an edit preserve a multi-day span on a date-only change. */
export function allDaySpanDays(startDate: string, endDate: string): number {
  const a = new Date(`${startDate}T00:00:00Z`).getTime();
  const b = new Date(`${endDate}T00:00:00Z`).getTime();
  const days = Math.round((b - a) / 86_400_000);
  return days >= 1 ? days : 1;
}

interface TimingBody {
  allDay?: unknown;
  date?: unknown;
  startTime?: unknown;
  endTime?: unknown;
}

export type ParsedTiming =
  | { allDay: true; date: string }
  | { allDay: false; date: string; startTime: string; endTime: string };

/**
 * Validate the date/all-day/time fields shared by create + update. Returns the
 * normalized timing or a 400-ready error message. (Title, calendar, location and
 * notes are route-specific and validated by each caller.)
 */
export function parseTiming(
  body: TimingBody
): { ok: true; timing: ParsedTiming } | { ok: false; error: string } {
  if (typeof body.date !== 'string' || !DATE_RE.test(body.date)) {
    return { ok: false, error: 'date is required (YYYY-MM-DD)' };
  }
  const date = body.date;

  if (body.allDay === true) {
    return { ok: true, timing: { allDay: true, date } };
  }

  if (typeof body.startTime !== 'string' || !TIME_RE.test(body.startTime)) {
    return { ok: false, error: 'startTime is required for a timed event (HH:mm)' };
  }
  if (typeof body.endTime !== 'string' || !TIME_RE.test(body.endTime)) {
    return { ok: false, error: 'endTime is required for a timed event (HH:mm)' };
  }
  // Zero-padded HH:mm compares correctly as strings.
  if (body.endTime <= body.startTime) {
    return { ok: false, error: 'endTime must be after startTime' };
  }

  return {
    ok: true,
    timing: { allDay: false, date, startTime: body.startTime, endTime: body.endTime },
  };
}
