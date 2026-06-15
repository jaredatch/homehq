/**
 * WMO weather interpretation codes (WW) as used by Open-Meteo.
 * https://open-meteo.com/en/docs — "Weather variable documentation"
 *
 * Codes are mapped to a small set of semantic "glyphs". A glyph is rendered by
 * whichever icon set config.display.weatherIcons selects (see WeatherIcon) —
 * self-hosted SVGs (lucide/meteocons/weather-icons) or the emoji map below.
 */

export type WeatherGlyph =
  | 'clear-day'
  | 'clear-night'
  | 'partly-day'
  | 'partly-night'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'sleet'
  | 'snow'
  | 'thunder'
  | 'unknown';

export interface WeatherDescription {
  label: string;
  glyph: WeatherGlyph;
}

/** Emoji fallback set. Needs a color-emoji font on the host (the Pi lacks one,
 * which is why lucide is the default) — kept as a selectable option. */
export const WEATHER_EMOJI: Record<WeatherGlyph, string> = {
  'clear-day': '☀️',
  'clear-night': '🌙',
  'partly-day': '⛅',
  'partly-night': '🌙',
  cloudy: '☁️',
  fog: '🌫️',
  drizzle: '🌦️',
  rain: '🌧️',
  sleet: '🌨️',
  snow: '❄️',
  thunder: '⛈️',
  unknown: '🌡️',
};

export function describeWeather(code: number, isDay = true): WeatherDescription {
  switch (code) {
    case 0:
      return { label: 'Clear', glyph: isDay ? 'clear-day' : 'clear-night' };
    case 1:
      return { label: 'Mostly clear', glyph: isDay ? 'partly-day' : 'partly-night' };
    case 2:
      return { label: 'Partly cloudy', glyph: isDay ? 'partly-day' : 'partly-night' };
    case 3:
      return { label: 'Overcast', glyph: 'cloudy' };
    case 45:
    case 48:
      return { label: 'Fog', glyph: 'fog' };
    case 51:
    case 53:
    case 55:
      return { label: 'Drizzle', glyph: 'drizzle' };
    case 56:
    case 57:
      return { label: 'Freezing drizzle', glyph: 'sleet' };
    case 61:
    case 63:
      return { label: 'Rain', glyph: 'rain' };
    case 65:
      return { label: 'Heavy rain', glyph: 'rain' };
    case 66:
    case 67:
      return { label: 'Freezing rain', glyph: 'sleet' };
    case 71:
    case 73:
      return { label: 'Snow', glyph: 'snow' };
    case 75:
    case 77:
      return { label: 'Heavy snow', glyph: 'snow' };
    case 80:
    case 81:
      return { label: 'Showers', glyph: 'rain' };
    case 82:
      return { label: 'Heavy showers', glyph: 'rain' };
    case 85:
    case 86:
      return { label: 'Snow showers', glyph: 'snow' };
    case 95:
      return { label: 'Thunderstorm', glyph: 'thunder' };
    case 96:
    case 99:
      return { label: 'Thunderstorm + hail', glyph: 'thunder' };
    default:
      return { label: 'Unknown', glyph: 'unknown' };
  }
}
