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

/** Stripe period. Defined in CSS (`--cal-stripe`) so it's tunable in one place,
 * and in `em` so it scales with the wall's root clamp() instead of turning into
 * pinstripes at 4K. */
const PERIOD = 'var(--cal-stripe)';

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
 * 45° barber-pole for a filled bar (all-day). The fill is the only surface where
 * text sits ON the color, so a striped bar pairs with `.cal-band-label` — a dark
 * translucent scrim behind the title that keeps it white-on-near-black whatever
 * the stripes do underneath.
 */
export function stripes(colors: string[]): string {
  const [a, b] = colors;
  return `repeating-linear-gradient(45deg, ${a} 0 ${PERIOD}, ${b} ${PERIOD} calc(${PERIOD} * 2))`;
}

/**
 * Hard two-tone split for the small accents that sit BESIDE text rather than
 * under it — the timed event's thin accent bar (180° = top/bottom) and the month
 * chip's dot (90° = left/right). Stripes would just read as noise at that size.
 */
export function split(colors: string[], deg: number): string {
  const [a, b] = colors;
  return `linear-gradient(${deg}deg, ${a} 0 50%, ${b} 50% 100%)`;
}
