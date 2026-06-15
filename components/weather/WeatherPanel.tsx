'use client';

import { useCallback, useEffect, useState } from 'react';
import { describeWeather } from '@/lib/weather/wmo';
import { isWeatherStale } from '@/lib/weather/staleness';
import type { WeatherData } from '@/lib/weather/types';
import type { WeatherIconSet } from '@/lib/config/types';
import WeatherIcon from './WeatherIcon';

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

export default function WeatherPanel({ iconSet }: { iconSet: WeatherIconSet }) {
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
    return <div className="wx-placeholder" aria-hidden />;
  }

  const { data } = weather;
  const current = describeWeather(data.current.weatherCode, data.current.isDay);

  return (
    <div
      className={`wx ${stale ? 'wx--stale' : ''}`}
      title={stale ? 'Weather data is stale — sync may be failing' : undefined}
    >
      {/* Current conditions — the live "now" reading. Rain lives on the forecast
          tiles below, so it isn't repeated here. */}
      <div className="wx-current" title={current.label}>
        <WeatherIcon
          glyph={current.glyph}
          set={iconSet}
          className="wx-current-icon"
          label={current.label}
        />
        <span className="wx-temp">{data.current.temperature}°</span>
        {stale && <span className="wx-stale">stale</span>}
      </div>

      {/* Forecast — one tile per day, aligned 2×2: high │ icon over low │ rain */}
      <div className="wx-forecast">
        {data.forecast.map((day, i) => {
          const desc = describeWeather(day.weatherCode);
          return (
            <div key={day.date} className="wx-tile" title={desc.label}>
              <span className="wx-day">{dayLabel(day.date, i)}</span>
              {/* Icon is vertically centered against the high/low pair; rain is
                  taken out of flow so it tucks under the icon without shifting it. */}
              <div className="wx-temps">
                <div className="wx-hilo">
                  <span className="wx-high">{day.tempMax}°</span>
                  <span className="wx-low">{day.tempMin}°</span>
                </div>
                <div className="wx-icon-wrap">
                  <WeatherIcon
                    glyph={desc.glyph}
                    set={iconSet}
                    className="wx-forecast-icon"
                    label={desc.label}
                  />
                  <span
                    className={`wx-precip ${day.precipChance >= 15 ? 'wx-precip--wet' : 'wx-precip--dry'}`}
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
