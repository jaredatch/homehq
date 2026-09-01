import { matchTitleIcon, titleIconColor, type TitleIconSet } from '@/lib/calendar/title-rules';

interface EventTitleProps {
  summary: string;
  /** The board's configured rules. Undefined — the default — makes this
   * component return the bare string and nothing else. */
  icons?: TitleIconSet;
  /** This event's calendar colour, used only by a rule asking for
   * `"color": "calendar"`. */
  calendarColor?: string;
  /** True where the title is drawn ON a calendar-coloured fill (the all-day
   * band bar). Colour overrides step aside there — see `titleIconColor`. */
  onFill?: boolean;
  /** What to draw when the event has no title. Each call site passes what it
   * already passed, so an untitled event is unchanged. */
  empty?: string;
}

/**
 * An event's title in a calendar grid, with its configured icon in front.
 *
 * THE NO-MATCH PATH RETURNS THE BARE STRING. Not a wrapped one, not a fragment
 * — the same text node every call site rendered before this component existed.
 * That is what makes `display.titleIcons` safe to add to a live wall: a
 * household without the key, or a title matching no rule, produces DOM that is
 * identical node-for-node, so the geometry the measurement layer reads cannot
 * move (CLAUDE.md rule 2).
 *
 * It is used ONLY in the grids. Modals, tooltips, and everything written back
 * to Google keep the raw `summary`: the title is the truth, this is a way of
 * drawing it, and `event-links.ts` resolves siblings by comparing summaries.
 */
export default function EventTitle({
  summary,
  icons,
  calendarColor,
  onFill,
  empty = '',
}: EventTitleProps) {
  const match = matchTitleIcon(summary, icons);
  if (!match) return summary || empty;

  const color = titleIconColor(match, icons, calendarColor, !!onFill);
  return (
    <>
      {/* A fixed-width box holding a height-normalised glyph.

          The box is what the line sees: same advance for every icon, so a
          column of school runs stacks its glyphs on one x and reads as a block
          before you have read a word. The svg inside is sized by HEIGHT and
          takes its natural width, because Font Awesome's viewBoxes are not
          square — car-side is 640x512 and phone is 512x512, so fitting both
          into the same square box drew the car 30% shorter than the phone and
          looked like a bug. A wide glyph now bleeds symmetrically into the
          0.35em gap instead of shrinking.

          Taking the svg out of flow is also what keeps the box's height fixed
          at exactly --cal-title-icon-size: .cal-band-bar's height must stay
          equal to its .cal-band-spacer or the all-day overlay drifts off every
          reserved lane. */}
      <span className="cal-title-icon" style={color ? { color } : undefined} aria-hidden>
        <svg viewBox={match.rule.viewBox} focusable="false">
          <path fill="currentColor" d={match.rule.path} />
        </svg>
      </span>
      {match.text}
    </>
  );
}
