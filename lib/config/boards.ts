import { getConfig, isCalendarWriteEnabled } from './index';
import type {
  AppConfig,
  BoardLayout,
  BoardTodosConfig,
  CalendarConfig,
  DisplayConfig,
} from './types';

/**
 * Boards — how one install serves more than one screen.
 *
 * A board is one configured screen. The FAMILY board is the kitchen wall: the
 * dense layout the app has always had, served at `/`, built straight from the
 * top-level config. A PERSONAL board is one person's touch screen, served at
 * `/b/<slug>`, built from the same top-level config with a per-board override
 * layer on top.
 *
 * The override direction is load-bearing. A board never supplies a base value,
 * only replaces one, so a config with no `boards` key resolves to exactly the
 * values the wall used before boards existed — the no-regression story is
 * structural rather than a promise (CLAUDE.md rule 2).
 */

/** Slug the implicit family board reports when the config names no boards. */
export const FAMILY_BOARD_SLUG = 'family';

/**
 * Calendars a board shows when it names none of its own: everything except the
 * ones marked hidden. Returns the SAME array when nothing is hidden, so a
 * config without the flag is byte-for-byte what it always was.
 */
function visibleCalendars(calendars: CalendarConfig[]): CalendarConfig[] {
  return calendars.some((c) => c.hidden) ? calendars.filter((c) => !c.hidden) : calendars;
}

export interface ResolvedBoard {
  slug: string;
  layout: BoardLayout;
  /** Header label on a personal board. Falls back to the slug. */
  name: string;
  accent?: string;
  /** The calendars this board draws, in the order it draws them. */
  calendars: CalendarConfig[];
  /** Which of those count as this board's own person. Defaults to all of them,
   * which leaves the person picker with nothing to switch to. */
  ownCalendarIds: string[];
  /** Calendars that stay in view whoever the picker is set to. */
  alwaysShowIds: string[];
  /** Where a new event lands by default; undefined means "let the UI decide",
   * which is the first calendar, as it has always been. */
  defaultCalendarId?: string;
  todos?: BoardTodosConfig;
  /** Top-level display block with this board's overrides merged over it. */
  display: DisplayConfig;
  /** Whether this board named `calendarWeeks` ITSELF, as opposed to inheriting
   * the wall's. A personal board's full-screen week wants one row on an 800px
   * panel where the kitchen wants two on a 27" one, and the merged block above
   * can't tell those apart — it only ever reports the wall's value. Boards only
   * override (CLAUDE.md rule 10), so the personal default lives in the personal
   * component and this says when to step aside for it. */
  ownsCalendarWeeks: boolean;
  calendarWriteEnabled: boolean;
}

/**
 * The family board: the top-level config, unchanged, wearing the board shape.
 * This is what `/` renders.
 */
export function familyBoard(config?: AppConfig): ResolvedBoard {
  const cfg = config ?? getConfig();
  const calendars = visibleCalendars(cfg.calendars);
  return {
    slug: FAMILY_BOARD_SLUG,
    layout: 'family',
    name: FAMILY_BOARD_SLUG,
    calendars,
    ownCalendarIds: calendars.map((c) => c.id),
    alwaysShowIds: [],
    display: cfg.display,
    // The wall's calendarWeeks IS the top-level one, by definition.
    ownsCalendarWeeks: true,
    calendarWriteEnabled: isCalendarWriteEnabled(cfg),
  };
}

/**
 * Resolve a configured board by slug, or null if the config names no such
 * board. Callers turn null into a 404 — an unknown slug must never silently
 * fall back to the family board, or a typo'd kiosk URL quietly puts the whole
 * family's calendar on a kid's dresser.
 */
export function resolveBoard(slug: string, config?: AppConfig): ResolvedBoard | null {
  const cfg = config ?? getConfig();
  const board = cfg.boards?.[slug];
  if (!board) return null;

  // Board order wins: a personal board leads with its own person's calendar,
  // whatever order the top-level list happens to be in. Ids are validated at
  // load, so every lookup here hits.
  const byId = new Map(cfg.calendars.map((c) => [c.id, c]));
  const calendars = board.calendars
    ? board.calendars.flatMap((id) => {
        const cal = byId.get(id);
        return cal ? [cal] : [];
      })
    : visibleCalendars(cfg.calendars);

  const ownCalendarIds = board.ownCalendars ?? calendars.map((c) => c.id);

  return {
    slug,
    layout: board.layout,
    name: board.name ?? slug,
    // A board with no accent takes the colour of the person it belongs to, so
    // it feels like hers with nothing extra in config.
    accent: board.accent ?? byId.get(ownCalendarIds[0])?.color,
    calendars,
    ownCalendarIds,
    alwaysShowIds: board.alwaysShow ?? [],
    defaultCalendarId: board.defaultCalendar,
    todos: board.todos,
    display: { ...cfg.display, ...board.display },
    ownsCalendarWeeks: board.display?.calendarWeeks !== undefined,
    calendarWriteEnabled: isCalendarWriteEnabled(cfg),
  };
}

/** Strip the port and case so `KidA.example.com:3000` matches `kida.example.com`. */
function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '');
}

/**
 * The board slug a hostname maps to, or null. Used by the proxy to rewrite `/`
 * on a board's own subdomain. A host no board claims — the kitchen's — returns
 * null and is left alone.
 */
export function boardSlugForHost(
  host: string | null | undefined,
  config?: AppConfig
): string | null {
  if (!host) return null;
  const cfg = config ?? getConfig();
  if (!cfg.boards) return null;

  const wanted = normalizeHost(host);
  for (const [slug, board] of Object.entries(cfg.boards)) {
    if (board.host && normalizeHost(board.host) === wanted) return slug;
  }
  return null;
}

/**
 * A board's own PIN, or null when it has none (and the family PIN is the only
 * way in).
 *
 * Deliberately NOT a field on `ResolvedBoard`. That object is built in a server
 * component and handed to the board components, and one careless spread into a
 * client component would ship the PIN to the browser. Reading it through a
 * separate call keeps the secret on a path no rendering code travels.
 */
export function boardPin(slug: string, config?: AppConfig): string | null {
  return (config ?? getConfig()).boards?.[slug]?.pin ?? null;
}

/** Every configured board slug, for diagnostics and the setup page. */
export function boardSlugs(config?: AppConfig): string[] {
  return Object.keys((config ?? getConfig()).boards ?? {});
}

/** Todoist project ids any board asks for — the sync loop's work list. */
export function todoProjectIds(config?: AppConfig): string[] {
  const cfg = config ?? getConfig();
  const ids = new Set<string>();
  for (const board of Object.values(cfg.boards ?? {})) {
    if (board.todos) ids.add(board.todos.projectId);
  }
  return [...ids];
}
