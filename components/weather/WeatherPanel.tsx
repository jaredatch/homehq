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
      className={`flex items-center gap-6 ${stale ? 'opacity-50' : ''}`}
      title={stale ? 'Weather data is stale — sync may be failing' : undefined}
    >
      {/* Current conditions — the live "now" reading. Rain lives on the forecast
          tiles below, so it isn't repeated here. */}
      <div className="flex items-center gap-2.5" title={current.label}>
        <span className="text-3xl leading-none">{current.icon}</span>
        <span className="text-4xl font-semibold leading-none text-gray-300">
          {data.current.temperature}°
        </span>
        {stale && <span className="text-[11px] font-medium text-amber-500">stale</span>}
      </div>

      {/* Forecast — one tile per day, aligned 2×2: high │ icon over low │ rain */}
      <div className="flex items-start gap-4">
        {data.forecast.map((day, i) => {
          const desc = describeWeather(day.weatherCode);
          const wetClass = day.precipChance >= 15 ? 'text-sky-500' : 'text-gray-600';
          return (
            <div key={day.date} className="flex flex-col" title={desc.label}>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                {dayLabel(day.date, i)}
              </span>
              {/* Icon is vertically centered against the high/low pair; rain is
                  taken out of flow so it tucks under the icon without shifting it. */}
              <div className="mt-1 flex items-center gap-2">
                <div className="flex flex-col gap-y-0.5">
                  <span className="text-base font-semibold leading-none text-gray-400">
                    {day.tempMax}°
                  </span>
                  <span className="text-base font-medium leading-none text-gray-500">
                    {day.tempMin}°
                  </span>
                </div>
                <div className="relative flex -translate-y-1 items-center">
                  <span className="text-2xl leading-none">{desc.icon}</span>
                  <span
                    className={`absolute left-1/2 top-full -translate-x-1/2 text-[11px] font-medium leading-none ${wetClass}`}
                  >
                    {day.precipChance}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
