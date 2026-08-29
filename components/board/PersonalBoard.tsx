import { getDeployVersion } from '@/lib/version';
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
      appVersion={getDeployVersion()}
    />
  );
}
