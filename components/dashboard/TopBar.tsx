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
    <header className="tb">
      <Clock timeZone={timezone} />
      {showWeather && <WeatherPanel iconSet={weatherIcons} />}
    </header>
  );
}
