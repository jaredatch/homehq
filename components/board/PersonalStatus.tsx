'use client';

import WeatherIcon from '@/components/weather/WeatherIcon';
import { formatClockTime, formatClockDate } from '@/components/clock/Clock';
import { formatSyncLabel, type SyncStatus } from '@/components/calendar/calendar-utils';
import { describeWeather } from '@/lib/weather/wmo';
import type { WeatherData } from '@/lib/weather/types';
import type { WeatherIconSet } from '@/lib/config/types';

interface PersonalStatusProps {
  /** Epoch ms, ticking once a minute. 0 before hydration. */
  now: number;
  timezone?: string;
  /** null when weather is off for this board, or before the first fetch. */
  weather: WeatherData | null;
  weatherIcons: WeatherIconSet;
  sync: SyncStatus;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Today", then the short weekday — the family board's own rule. "Tomorrow"
 * was tried and dropped: it is twice the width of every other label, so the one
 * tile carrying it stretched and the row stopped reading as a set. */
function forecastDayLabel(dateStr: string, index: number): string {
  if (index === 0) return 'Today';
  const [y, m, d] = dateStr.split('-').map(Number);
  return DAY_NAMES[new Date(y, m - 1, d).getDay()];
}

/**
 * Column 3 — the clock, the weather, and (eventually) widgets.
 *
 * The clock is the one thing on this board meant to be read from the doorway,
 * so it carries the largest type on the screen. The widget region below the
 * weather is deliberately empty rather than padded with filler: what goes there
 * isn't decided (private/personal-boards-plan.md → Phase 5+).
 *
 * The forecast is the family board's arrangement — a row of tiles, each a
 * high/low pair beside an icon with the rain chance tucked under it — rather
 * than four full-width rows with the name pinned left and everything else
 * pinned right and a lake of dead space between. Stacked instead of inline
 * because a 427px column has no room to put the current reading beside it.
 */
export default function PersonalStatus({
  now,
  timezone,
  weather,
  weatherIcons,
  sync,
}: PersonalStatusProps) {
  const clock = now === 0 ? null : formatClockTime(new Date(now), timezone);
  const current = weather?.current;
  const conditions = current ? describeWeather(current.weatherCode, current.isDay) : null;
  const forecast = weather?.forecast?.slice(0, 4) ?? [];
  // Before hydration `now` is 0; timeAgo against the epoch would read "20000d
  // ago", so hold the label back until the client knows what time it is.
  const syncLabel = now === 0 ? null : formatSyncLabel(sync, now);

  return (
    <section className="pb-col pb-col--status">
      <header className="pb-status-clock">
        {clock ? (
          <>
            <div className="pb-status-time">
              {clock.time}
              <span className="pb-status-ampm">{clock.ampm}</span>
            </div>
            <div className="pb-status-date">{formatClockDate(new Date(now), timezone)}</div>
          </>
        ) : (
          <div className="pb-status-placeholder" aria-hidden />
        )}
      </header>

      {current && conditions && (
        <div className="pb-status-weather">
          <div className="pb-wx-now">
            <WeatherIcon
              glyph={conditions.glyph}
              set={weatherIcons}
              className="pb-wx-icon"
              label={conditions.label}
            />
            <span className="pb-wx-temp">{Math.round(current.temperature)}°</span>
            <span className="pb-wx-label">{conditions.label}</span>
          </div>

          <div className="pb-wx-days">
            {forecast.map((day, i) => {
              const desc = describeWeather(day.weatherCode);
              return (
                <div className="pb-wx-day" key={day.date} title={desc.label}>
                  <span className="pb-wx-day-name">{forecastDayLabel(day.date, i)}</span>
                  <div className="pb-wx-day-body">
                    <div className="pb-wx-hilo">
                      <span className="pb-wx-hi">{Math.round(day.tempMax)}°</span>
                      <span className="pb-wx-lo">{Math.round(day.tempMin)}°</span>
                    </div>
                    {/* Rain is out of flow under the icon, so adding it doesn't
                        move the temperatures — same trick as the wall's tile. */}
                    <div className="pb-wx-day-icon-wrap">
                      <WeatherIcon
                        glyph={desc.glyph}
                        set={weatherIcons}
                        className="pb-wx-day-icon"
                        label={desc.label}
                      />
                      <span
                        className={`pb-wx-rain ${
                          day.precipChance >= 15 ? 'pb-wx-rain--wet' : 'pb-wx-rain--dry'
                        }`}
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
      )}

      <div className="pb-col-body pb-widgets" />

      <footer className="pb-col-foot pb-col-foot--split">
        <button type="button" className="pb-action" disabled>
          Configure Widgets
        </button>
        {syncLabel && (
          <span className={`pb-sync${syncLabel.isError ? ' pb-sync--error' : ''}`}>
            {syncLabel.text}
          </span>
        )}
      </footer>
    </section>
  );
}
