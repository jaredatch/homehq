import TopBar from '@/components/dashboard/TopBar';
import CalendarView from '@/components/calendar/CalendarView';
import { getDeployVersion } from '@/lib/version';
import type { ResolvedBoard } from '@/lib/config/boards';

/**
 * The family board — the dense wall layout, viewed from across the kitchen.
 *
 * Extracted from app/page.tsx unchanged so `/` and a `layout: "family"` board
 * at `/b/<slug>` render from one place. The markup here is load-bearing: `/`
 * must stay pixel-identical (CLAUDE.md rule 2), so any change is proved with a
 * normalised DOM geometry diff of `.cal-weeks` at 1920×1080 before it lands.
 */
export default function FamilyBoard({ board }: { board: ResolvedBoard }) {
  const { display } = board;
  // Stamp the page with the build it was served by; the grid reloads itself when
  // the server later reports a different one (a deploy or a manual kiosk-reload).
  const appVersion = getDeployVersion();

  return (
    <div className="app-shell">
      <TopBar
        showWeather={display.showWeather}
        timezone={display.timezone}
        weatherIcons={display.weatherIcons ?? 'lucide'}
      />
      <main className="app-main">
        <CalendarView
          calendars={board.calendars}
          weeks={display.calendarWeeks}
          weekStartsOn={display.weekStartsOn ?? 'monday'}
          timezone={display.timezone}
          todayColor={display.todayColor ?? '#60a5fa'}
          expandResetMs={(display.expandResetSeconds ?? 300) * 1000}
          calendarWriteEnabled={board.calendarWriteEnabled}
          createFormResetMs={(display.createFormResetSeconds ?? 120) * 1000}
          appVersion={appVersion}
          monthViewResetMs={(display.monthViewResetSeconds ?? 180) * 1000}
          filterResetMs={(display.filterResetSeconds ?? 300) * 1000}
        />
      </main>
    </div>
  );
}
