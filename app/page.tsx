import TopBar from '@/components/dashboard/TopBar';
import CalendarView from '@/components/calendar/CalendarView';
import { getConfig, isCalendarWriteEnabled } from '@/lib/config';
import { getDeployVersion } from '@/lib/version';

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  const config = getConfig();
  // Stamp the page with the build it was served by; the grid reloads itself when
  // the server later reports a different one (a deploy or a manual kiosk-reload).
  const appVersion = getDeployVersion();

  return (
    <div className="app-shell">
      <TopBar
        showWeather={config.display.showWeather}
        timezone={config.display.timezone}
        weatherIcons={config.display.weatherIcons ?? 'lucide'}
      />
      <main className="app-main">
        <CalendarView
          calendars={config.calendars}
          weeks={config.display.calendarWeeks}
          weekStartsOn={config.display.weekStartsOn ?? 'monday'}
          timezone={config.display.timezone}
          todayColor={config.display.todayColor ?? '#60a5fa'}
          expandResetMs={(config.display.expandResetSeconds ?? 300) * 1000}
          calendarWriteEnabled={isCalendarWriteEnabled(config)}
          createFormResetMs={(config.display.createFormResetSeconds ?? 120) * 1000}
          appVersion={appVersion}
          monthViewResetMs={(config.display.monthViewResetSeconds ?? 180) * 1000}
        />
      </main>
    </div>
  );
}
