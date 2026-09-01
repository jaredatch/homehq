import EventItem from './EventItem';
import type { TitleIconSet } from '@/lib/calendar/title-rules';
import { accentStripes, eventPaint } from './event-paint';
import { contrastText, isFinished, type CalendarEvent } from './calendar-utils';
import { weekdayShortOf } from './month-utils';

/** Where the card sits, relative to `.cal-grid`. Vertically it anchors by ONE
 * edge — `bottom` to grow upward out of the button, `top` to grow down. */
export interface DayPopoverBox {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/**
 * Place the card over its day column, growing away from the "+N more" button.
 *
 * Horizontally this matches month view's `popoverLayout` — a bit wider than the
 * column, centred on it, clamped inside the region. Vertically it does not, and
 * can't: month view anchors to a small cell and reserves half the region to
 * grow into, which is right when a cell is one row of six. A week column is the
 * full height of the grid and its "+N more" is always the last thing in it, so
 * that rule opened a three-row card ~400px above the button that summoned it.
 *
 * Here the button's own edge is the anchor and the card grows into whichever
 * side has more room — upward in practice, since the button sits at the bottom
 * of a full-height column. Pure, so the clamping is unit-testable.
 */
export function dayPopoverBox(
  button: { top: number; bottom: number },
  cell: { left: number; width: number },
  container: { width: number; height: number },
  pad = 8
): DayPopoverBox {
  const width = Math.min(Math.max(cell.width * 1.35, 240), Math.max(0, container.width - 2 * pad));
  const left = clamp(cell.left + cell.width / 2 - width / 2, pad, container.width - pad - width);
  const above = button.bottom;
  const below = container.height - button.top;
  return above >= below
    ? { left, width, bottom: container.height - button.bottom, maxHeight: Math.max(0, above - pad) }
    : { left, width, top: button.top, maxHeight: Math.max(0, below - pad) };
}

interface DayPopoverProps {
  date: string; // YYYY-MM-DD
  box: DayPopoverBox;
  today: string;
  /** ONLY the events the cell had to crop — the ones behind "+N more". */
  hidden: CalendarEvent[];
  colorMap: Map<string, { color: string; textColor?: string }>;
  /** IANA zone for event times. Undefined = browser-local. */
  timezone?: string;
  /** Today's marker color, for the header's day-number pill. */
  todayColor: string;
  /** Wall-clock ms from `useMinuteTick`, so a finished event dims here exactly
   * as it does in the column behind. 0 dims nothing. */
  now: number;
  onClose: () => void;
  /** When set, rows open the edit modal. Omitted in read-only deployments —
   * the popover is a read surface there, as in month view. */
  onEventClick?: (event: CalendarEvent) => void;
  /** Configured title-icon rules (display.titleIcons), so the card reads as the
   * cell it came from rather than as a different surface. */
  titleIcons?: TitleIconSet;
}

/**
 * The wall's "+N more" popover: the events that didn't fit, floating over the
 * week grid.
 *
 * It shows the hidden events ONLY, not the whole day. Month view's popover
 * shows the day in full because a month cell holds two or three chips and the
 * rest is genuinely unseen. A week column shows a dozen, so repeating them
 * would answer a question nobody asked while covering the neighbouring days to
 * do it. "+3 more" opens three rows.
 *
 * That is also why there are no band bars here: an all-day event, and a timed
 * one running past midnight, always draw in the band. Cropping only ever
 * touches the timed stack, so nothing in the band can be behind "+N more".
 *
 * Month view has its own (`MonthDayPopover`) and this is deliberately not it.
 * The two share the part that is genuinely one thing — `popoverLayout()`, the
 * clamping math that keeps the card inside the calendar region — and nothing
 * else. `.mon-pop` is sized in `em` against `.mon-calendar`'s `clamp()` font
 * size and draws its rows as month chips; rendered on the wall it would come
 * out at the wrong scale AND in a different visual language from the column
 * directly behind it. So this one is `rem` like the rest of the wall's chrome
 * and renders real `EventItem` rows: the popover reads as that cell, zoomed.
 *
 * It mounts inside `.cal-grid` and never inside `.cal-weeks` — same containment
 * as month view, and for the same two reasons: `.cal-weeks` is `overflow: clip`
 * and would cut the card off, and its hidden measurement layer must never see
 * anything that isn't a real event row.
 */
export default function DayPopover({
  date,
  box,
  today,
  hidden,
  colorMap,
  timezone,
  todayColor,
  now,
  onClose,
  onEventClick,
  titleIcons,
}: DayPopoverProps) {
  const dayNum = Number(date.slice(8, 10));
  const isPastDay = date < today;
  const isToday = date === today;

  return (
    <div
      className="cal-pop"
      style={{
        left: box.left,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        maxHeight: box.maxHeight,
      }}
      role="dialog"
      aria-label={`Events on ${weekdayShortOf(date)} ${date}`}
    >
      <div className="cal-pop-header">
        <span className="cal-pop-weekday">{weekdayShortOf(date)}</span>
        <span
          className={isToday ? 'cal-pop-daynum cal-pop-daynum--today' : 'cal-pop-daynum'}
          style={
            isToday ? { backgroundColor: todayColor, color: contrastText(todayColor) } : undefined
          }
        >
          {dayNum}
        </span>
        <button
          type="button"
          className="cal-pop-close"
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
        >
          ×
        </button>
      </div>

      {/* A past day keeps the grid's dim, so the card reads as that cell rather
          than as a different surface. */}
      <div className={isPastDay ? 'cal-pop-list cal-pop-list--past' : 'cal-pop-list'}>
        {hidden.map((event) => {
          const paint = eventPaint(event, colorMap);
          return (
            <EventItem
              key={`${event.event_id}-${event.calendar_id}`}
              event={event}
              color={paint.primary}
              accent={paint.shared ? accentStripes(paint.colors) : undefined}
              timeZone={timezone}
              past={isToday && now > 0 && isFinished(event, now)}
              onClick={onEventClick ? () => onEventClick(event) : undefined}
              titleIcons={titleIcons}
            />
          );
        })}
      </div>
    </div>
  );
}
