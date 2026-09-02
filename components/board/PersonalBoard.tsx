import { getDeployVersion } from '@/lib/version';
import { resolveTitleIcons } from '@/lib/calendar/title-icons';
import type { ResolvedBoard } from '@/lib/config/boards';
import PersonalShell from './PersonalShell';

/**
 * The personal board — one person's screen: 10", touched, at arm's length,
 * rather than 27", glanced, from across the kitchen. It inverts the wall's
 * priorities on purpose: bigger type, fewer things, vertical scroll instead of
 * a packed grid (private/personal-boards-plan.md).
 *
 * Server half: config into plain props. The client half owns every fetch.
 */
export default function PersonalBoard({ board }: { board: ResolvedBoard }) {
  const { display } = board;

  return (
    <PersonalShell
      // The API scopes its response to this board's calendars, so a bedroom
      // panel never downloads the rest of the household's events.
      boardSlug={board.slug}
      name={board.name}
      accent={board.accent ?? '#60a5fa'}
      calendars={board.calendars}
      ownCalendarIds={board.ownCalendarIds}
      alwaysShowIds={board.alwaysShowIds}
      defaultCalendarId={board.defaultCalendarId}
      // The same single gate the wall uses for the OAuth scope, the write
      // routes, and the button (CLAUDE.md rule 9) — a read-only deployment
      // shows a bedroom panel no write buttons either.
      calendarWriteEnabled={board.calendarWriteEnabled}
      timezone={display.timezone}
      showWeather={display.showWeather}
      weatherIcons={display.weatherIcons ?? 'lucide'}
      todoProjectId={board.todos?.projectId ?? null}
      // Peeking at someone else's calendar is the same kind of transient
      // narrowing as the wall's per-person filter, so it reuses that knob
      // rather than inventing a second one that means the same thing.
      peekResetMs={(display.filterResetSeconds ?? 300) * 1000}
      // Likewise for an abandoned form: same rule, same knob as the wall's.
      formResetMs={(display.createFormResetSeconds ?? 120) * 1000}
      // A full-screen week or month is this board's equivalent of the wall
      // sitting on November: transient, and never what the screen is still
      // showing the next morning.
      viewResetMs={(display.viewResetSeconds ?? 120) * 1000}
      // One week row by default, not the wall's two. On an 800px panel a single
      // row gives a day cell ~590px — about ten events before it crops — where
      // two rows would halve that for a screen showing one person's calendar.
      // A board that names calendarWeeks itself still wins.
      calendarWeeks={board.ownsCalendarWeeks ? display.calendarWeeks : 1}
      weekStartsOn={display.weekStartsOn ?? 'monday'}
      todayColor={display.todayColor ?? '#60a5fa'}
      appVersion={getDeployVersion()}
      // Resolved server-side, from this board's MERGED display block — so a
      // personal board inherits the wall's conventions by default and can still
      // override them the way it overrides any other display key.
      titleIcons={resolveTitleIcons(display)}
    />
  );
}
