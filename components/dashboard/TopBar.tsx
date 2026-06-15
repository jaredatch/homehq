import Clock from '@/components/clock/Clock';
import WeatherPanel from '@/components/weather/WeatherPanel';
import type { WeatherIconSet } from '@/lib/config/types';

interface TopBarProps {
  showWeather: boolean;
  timezone?: string;
  weatherIcons: WeatherIconSet;
}

export default function TopBar({ showWeather, timezone, weatherIcons }: TopBarProps) {
  return (
    <header className="flex items-center justify-between border-b border-gray-800 py-2 pl-6 pr-3">
      <Clock timeZone={timezone} />
      {showWeather && <WeatherPanel iconSet={weatherIcons} />}
    </header>
  );
}
