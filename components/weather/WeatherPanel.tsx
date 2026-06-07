'use client';

import { useCallback, useEffect, useState } from 'react';
import { describeWeather } from '@/lib/weather/wmo';
import { isWeatherStale } from '@/lib/weather/staleness';
import type { WeatherData } from '@/lib/weather/types';

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayLabel(dateStr: string, index: number): string {
  if (index === 0) return 'Today';
  const [y, m, d] = dateStr.split('-').map(Number);
  return DAY_NAMES[new Date(y, m - 1, d).getDay()];
}

interface WeatherResponse {
  data: WeatherData;
  updatedAt: string | null;
}

export default function WeatherPanel() {
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [stale, setStale] = useState(false);

  const fetchWeather = useCallback(async () => {
    try {
      const res = await fetch('/api/weather');
      if (!res.ok) return;
      const data = await res.json();
      if (data.weather) {
        setWeather({ data: data.weather, updatedAt: data.weather.updatedAt ?? null });
        // A dead weather sync shouldn't masquerade as current conditions.
        setStale(isWeatherStale(data.weather.updatedAt ?? null));
      }
    } catch {
      // Keep existing data — resilience first
    }
  }, []);

  useEffect(() => {
    // Defer the initial fetch so no setState is reachable synchronously
    // from the effect body (react-hooks/set-state-in-effect).
    const initial = setTimeout(fetchWeather, 0);
    const interval = setInterval(fetchWeather, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [fetchWeather]);

  if (!weather) {
    return <div className="h-12" aria-hidden />;
  }

  const { data } = weather;
  const current = describeWeather(data.current.weatherCode, data.current.isDay);

  return (
    <div
      className={`flex items-center gap-5 ${stale ? 'opacity-50' : ''}`}
      title={stale ? 'Weather data is stale — sync may be failing' : undefined}
    >
      {/* Current conditions */}
      <div className="flex items-center gap-2" title={current.label}>
        <span className="text-3xl leading-none">{current.icon}</span>
        <span className="text-4xl font-semibold leading-none text-gray-100">
          {data.current.temperature}°
        </span>
        {stale && <span className="text-[11px] font-medium text-amber-500">stale</span>}
      </div>

      {/* Forecast */}
      <div className="flex items-center gap-4">
        {data.forecast.map((day, i) => {
          const desc = describeWeather(day.weatherCode);
          return (
            <div key={day.date} className="flex flex-col items-center" title={desc.label}>
              <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                {dayLabel(day.date, i)}
              </span>
              <span className="text-lg leading-tight">{desc.icon}</span>
              <span className="text-xs leading-tight text-gray-300">
                {day.tempMax}°<span className="text-gray-500">/{day.tempMin}°</span>
                {day.precipChance >= 15 && (
                  <span className="ml-1 text-sky-400">{day.precipChance}%</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
