/**
 * Event-title icons — the matching half.
 *
 * The family types a convention into Google Calendar ("Dropoff Alex",
 * "Dentist Appt", "Call w/ the school") and the wall draws the convention as a
 * glyph. This file decides WHETHER a title matches and WHAT is left of it; the
 * glyph itself is resolved server-side in `title-icons.ts` and arrives here
 * already baked into the rule.
 *
 * Three things are load-bearing:
 *
 * 1. **Nothing is ever rewritten in the database.** `event-links.ts` joins
 *    `summary` into the key that decides "same event", so a rewritten title
 *    would make a read and a write disagree and insert a third copy
 *    (CLAUDE.md rule 6). This runs at render, on a copy, every time.
 * 2. **No match returns null**, and the caller then renders the bare string it
 *    always did. That is what keeps the wall byte-for-byte identical for a
 *    household that doesn't use the feature (CLAUDE.md rule 2) — structural,
 *    not a promise.
 * 3. **The icon always goes at the front.** Every example the feature was built
 *    for — an emoji anywhere, a "Dropoff" prefix, an "Appt" suffix — collapses
 *    to "icon, then what's left", which is also the only arrangement that lets
 *    a column of events line its glyphs up in a gutter you can read across a
 *    kitchen.
 */

/**
 * One resolved rule. The four match kinds are normalised to arrays here so the
 * matcher has no shapes to branch on; config accepts a bare string for each.
 * Exactly one kind is non-empty per rule (enforced by config validation).
 */
export interface TitleIconRule {
  equals: string[];
  prefix: string[];
  suffix: string[];
  contains: string[];
  /** Keep the matched words rather than dropping them — "Pigs" wants its icon
   * AND its word, where "Dropoff Alex" wants the word gone. */
  keep: boolean;
  /** CSS colour, or the literal 'calendar' for the event's own calendar
   * colour. Undefined inherits the surrounding title colour. */
  color?: string;
  /** The glyph: an SVG viewBox and a single path, already looked up. */
  viewBox: string;
  path: string;
  /** The configured id ("solid:taxi"). Carried for React keys and for the
   * message when something goes wrong. */
  icon: string;
}

/** Every rule plus the board's default icon colour. Undefined = feature off. */
export interface TitleIconSet {
  rules: TitleIconRule[];
  /** display.titleIconColor — the fallback for a rule that names no colour. */
  color?: string;
}

export interface TitleMatch {
  rule: TitleIconRule;
  /** What is left of the title once the matched words are gone. Never empty:
   * an icon alone is an event nobody can identify. */
  text: string;
}

/** Letters and digits, in any script — the family's titles are English but a
 * Unicode class costs nothing and never surprises anyone. */
const WORD = /[\p{L}\p{N}]/u;
const isWord = (ch: string | undefined): boolean => !!ch && WORD.test(ch);

/**
 * Does the match at `at` sit on a word boundary?
 *
 * The rule is derived from the pattern rather than configured: an edge needs a
 * boundary only where the PATTERN itself ends in a word character. So "Drive"
 * refuses "Driveway repair" and "🚖" needs no boundary at all, with no per-rule
 * knob to set and nothing to get wrong at eleven at night in a JSON file.
 */
function bounded(title: string, at: number, pattern: string): boolean {
  if (isWord(pattern[0]) && isWord(title[at - 1])) return false;
  if (isWord(pattern[pattern.length - 1]) && isWord(title[at + pattern.length])) return false;
  return true;
}

/** Leading punctuation left dangling by a drop: "Dropoff: Alex" loses
 * "Dropoff" and must not become ": Alex". A trailing slash is deliberately
 * NOT stripped — "Call w/" drops "Call" and "w/" is the whole point. */
const LEAD_SEP = /^[\s:;,\-–—|/]+/;
const TRAIL_SEP = /[\s:;,\-–—|]+$/;

function tidy(text: string): string {
  return text
    .replace(LEAD_SEP, '')
    .replace(TRAIL_SEP, '')
    .replace(/\s{2,}/g, ' ');
}

/** Where `pattern` matches under `kind`, or -1. Operates on the case-folded
 * pair; the caller guarantees the indices still line up with the original. */
function locate(lower: string, pattern: string, kind: keyof TitleIconRule): number {
  if (!pattern) return -1;
  switch (kind) {
    case 'equals':
      return lower === pattern ? 0 : -1;
    case 'prefix':
      return lower.startsWith(pattern) ? 0 : -1;
    case 'suffix':
      return lower.endsWith(pattern) ? lower.length - pattern.length : -1;
    default:
      return lower.indexOf(pattern);
  }
}

const KINDS = ['equals', 'prefix', 'suffix', 'contains'] as const;

/**
 * The first rule that matches `summary`, with the remaining title.
 *
 * First match wins and one icon is drawn per title. Stacking two glyphs on a
 * chip sized for a wall buys nothing and makes the order of a JSON array into
 * a visual decision nobody would remember making.
 */
export function matchTitleIcon(summary: string, set?: TitleIconSet): TitleMatch | null {
  const title = summary.trim();
  if (!title || !set?.rules.length) return null;

  // Case-insensitive by default: an event typed on a phone at a stoplight says
  // "dropoff" as often as "Dropoff". Lowercasing is length-preserving for every
  // script the family types, but not universally (U+0130 folds to two chars),
  // so an exotic title falls back to a case-SENSITIVE pass rather than slicing
  // the original at indices that no longer point where they did.
  const folded = title.toLowerCase();
  const caseFolded = folded.length === title.length;
  const haystack = caseFolded ? folded : title;

  for (const rule of set.rules) {
    for (const kind of KINDS) {
      for (const raw of rule[kind]) {
        const pattern = caseFolded ? raw.toLowerCase() : raw;
        const at = locate(haystack, pattern, kind);
        if (at < 0 || !bounded(haystack, at, pattern)) continue;

        if (rule.keep) return { rule, text: title };
        const text = tidy(title.slice(0, at) + title.slice(at + pattern.length));
        // Dropping the match can leave nothing at all ("Pigs" matched whole).
        // A lone glyph is not an event anyone can read, so the words come back.
        return { rule, text: text || title };
      }
    }
  }
  return null;
}

/** The colour to paint a matched glyph.
 *
 * `onFill` is the all-day band bar, where the background IS the calendar colour:
 * a calendar-coloured glyph would vanish into it and a fixed one can fail
 * contrast against a palette the config is free to change. There the glyph
 * takes the bar's own contrast text and every colour setting steps aside.
 *
 * `calendarColor` is undefined on a SHARED event, and deliberately so: an event
 * on two calendars has two colours, and painting the glyph with the first would
 * say it belongs to one person when the whole point of a shared event is that it
 * doesn't. Asking for "calendar" and getting nothing therefore falls back to the
 * board's own `titleIconColor`, which is how a shared row keeps the neutral
 * glyph while every ordinary row takes its rail's colour. */
export function titleIconColor(
  match: TitleMatch,
  set: TitleIconSet | undefined,
  calendarColor: string | undefined,
  onFill: boolean
): string | undefined {
  if (onFill) return undefined;
  const want = match.rule.color ?? set?.color;
  if (!want) return undefined;
  if (want !== 'calendar') return want;
  if (calendarColor) return calendarColor;
  // The board default, unless that is itself "calendar" — then there is nothing
  // left to fall back to and the glyph inherits the title's colour.
  return set?.color && set.color !== 'calendar' ? set.color : undefined;
}
