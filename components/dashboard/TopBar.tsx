import Clock from '@/components/clock/Clock';
import WeatherPanel from '@/components/weather/WeatherPanel';

interface TopBarProps {
  showWeather: boolean;
}

export default function TopBar({ showWeather }: TopBarProps) {
  return (
    <header className="flex items-center justify-between border-b border-gray-800 px-6 py-2">
      <Clock />
      {showWeather && <WeatherPanel />}
    </header>
  );
}
