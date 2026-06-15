import TopBar from '@/components/dashboard/TopBar';
import CalendarGrid from '@/components/calendar/CalendarGrid';
import { getConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  const config = getConfig();

  return (
    <div className="flex h-screen flex-col">
      <TopBar
        showWeather={config.display.showWeather}
        timezone={config.display.timezone}
        weatherIcons={config.display.weatherIcons ?? 'lucide'}
      />
      <main className="flex-1 overflow-hidden">
        <CalendarGrid
          calendars={config.calendars}
          weeks={config.display.calendarWeeks}
          weekStartsOn={config.display.weekStartsOn ?? 'monday'}
          timezone={config.display.timezone}
          todayColor={config.display.todayColor ?? '#60a5fa'}
        />
      </main>
    </div>
  );
}
