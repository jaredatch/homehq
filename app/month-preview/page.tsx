import TopBar from '@/components/dashboard/TopBar';
import MonthGrid from '@/components/calendar/MonthGrid';
import { getConfig } from '@/lib/config';
import { todayInZone } from '@/components/calendar/calendar-utils';
import { monthOf } from '@/components/calendar/month-utils';

export const dynamic = 'force-dynamic';

/**
 * TEMPORARY Phase 2 harness for the static month grid — delete in Phase 3, when
 * the real footer toggle flips the dashboard's viewMode in place.
 *
 * It exists so MonthGrid can be built and DOM-measured against real cached data
 * at wall proportions without touching app/page.tsx or CalendarGrid, which must
 * stay byte-for-byte unchanged until month view actually ships.
 *
 * `?month=YYYY-MM` renders any month; the default is the current one.
 */
export default async function MonthPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const config = getConfig();
  const { month } = await searchParams;
  const today = todayInZone(config.display.timezone);
  const target = /^\d{4}-\d{2}$/.test(month ?? '') ? month! : monthOf(today);

  return (
    <div className="app-shell">
      <TopBar
        showWeather={config.display.showWeather}
        timezone={config.display.timezone}
        weatherIcons={config.display.weatherIcons ?? 'lucide'}
      />
      <main className="app-main">
        <MonthGrid
          calendars={config.calendars}
          weekStartsOn={config.display.weekStartsOn ?? 'monday'}
          timezone={config.display.timezone}
          todayColor={config.display.todayColor ?? '#60a5fa'}
          month={target}
        />
      </main>
    </div>
  );
}
