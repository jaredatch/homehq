/**
 * How a (possibly shared) event gets its color.
 *
 * An ordinary event has one calendar and one color — every call here returns
 * exactly what the old `colorMap.get(event.calendar_id)` did, so unshared events
 * render byte-for-byte as before. A MERGED shared event carries
 * `groupCalendarIds`, and picks up a two-color treatment instead.
 */
import { contrastText } from './calendar-utils';

/** Gray-500 — the same fallback every call site used before. */
const FALLBACK = '#6b7280';

/** Stripe geometry, defined in CSS so both are tunable in one place. The period
 * is in `em` so it scales with the wall's root clamp() instead of turning into
 * pinstripes at 4K; the angle is a var so the look can be changed without
 * touching TS (0deg/180deg = horizontal bands, 45deg = diagonal). */
const PERIOD = 'var(--cal-stripe)';
const ANGLE = 'var(--cal-stripe-angle)';

/** Tighter period for the timed accent — it is a narrow rail a couple of em
 * tall, so a full-size period would show as a single flat band and read as one
 * color. See `accentStripes`. */
const ACCENT_PERIOD = 'var(--cal-stripe-accent)';

interface CalendarPaint {
  color: string;
  textColor?: string;
}

interface PaintableEvent {
  calendar_id: string;
  /** Present only on a merged shared event (added by mergeGroups). */
  groupCalendarIds?: string[];
}

export interface EventPaint {
  /** Primary color — the fill for an ordinary event, the first of the pair when shared. */
  primary: string;
  /** Every color this event carries, in config order. Length 1 unless shared. */
  colors: string[];
  /** Text over a solid fill. Shared bars use the scrim instead (see stripes()). */
  textColor: string;
  /** True when this is a merged shared event, i.e. it wants the two-color look. */
  shared: boolean;
}

export function eventPaint(
  event: PaintableEvent,
  colorMap: Map<string, CalendarPaint>
): EventPaint {
  const ids = event.groupCalendarIds ?? [event.calendar_id];
  const colors = ids.map((id) => colorMap.get(id)?.color ?? FALLBACK);
  const primary = colors[0] ?? FALLBACK;
  const own = colorMap.get(ids[0]);
  return {
    primary,
    colors,
    textColor: own?.textColor ?? contrastText(primary),
    shared: colors.length > 1,
  };
}

/**
 * Barber-pole for a filled bar (all-day). Angle and period come from CSS.
 *
 * The fill is the only surface where text sits ON the color, so a striped bar
 * pairs with `.cal-band-label` — a dark scrim behind the title that keeps it
 * white-on-near-black whatever the stripes do underneath.
 */
export function stripes(colors: string[]): string {
  const [a, b] = colors;
  return `repeating-linear-gradient(${ANGLE}, ${a} 0 ${PERIOD}, ${b} ${PERIOD} calc(${PERIOD} * 2))`;
}

/**
 * Stripes for the timed event's accent rail. A single 50/50 split reads as one
 * color on something this small unless you already know to look, so it takes
 * several alternating bands down its length and a much tighter period than a
 * filled bar.
 *
 * Shares `--cal-stripe-angle` with `stripes()` — the same forward-leaning "/"
 * barber pole the all-day bars use, so "two people" looks the same whether the
 * event landed in the band or in a day column. It was banded flat at 180deg
 * while the rail was a 1px sliver, where a diagonal had no width to travel
 * across; `.cal-event--shared` doubles the rail precisely so it does.
 */
export function accentStripes(colors: string[]): string {
  const [a, b] = colors;
  return `repeating-linear-gradient(${ANGLE}, ${a} 0 ${ACCENT_PERIOD}, ${b} ${ACCENT_PERIOD} calc(${ACCENT_PERIOD} * 2))`;
}
