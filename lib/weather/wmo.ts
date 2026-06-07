/**
 * WMO weather interpretation codes (WW) as used by Open-Meteo.
 * https://open-meteo.com/en/docs — "Weather variable documentation"
 *
 * Emoji icons keep the dashboard dependency-free and read well at distance
 * on a dark background.
 */

export interface WeatherDescription {
  label: string;
  icon: string;
}

export function describeWeather(code: number, isDay = true): WeatherDescription {
  switch (code) {
    case 0:
      return { label: 'Clear', icon: isDay ? '☀️' : '🌙' };
    case 1:
      return { label: 'Mostly clear', icon: isDay ? '🌤️' : '🌙' };
    case 2:
      return { label: 'Partly cloudy', icon: '⛅' };
    case 3:
      return { label: 'Overcast', icon: '☁️' };
    case 45:
    case 48:
      return { label: 'Fog', icon: '🌫️' };
    case 51:
    case 53:
    case 55:
      return { label: 'Drizzle', icon: '🌦️' };
    case 56:
    case 57:
      return { label: 'Freezing drizzle', icon: '🌧️' };
    case 61:
    case 63:
      return { label: 'Rain', icon: '🌧️' };
    case 65:
      return { label: 'Heavy rain', icon: '🌧️' };
    case 66:
    case 67:
      return { label: 'Freezing rain', icon: '🌧️' };
    case 71:
    case 73:
      return { label: 'Snow', icon: '🌨️' };
    case 75:
    case 77:
      return { label: 'Heavy snow', icon: '❄️' };
    case 80:
    case 81:
      return { label: 'Showers', icon: '🌦️' };
    case 82:
      return { label: 'Heavy showers', icon: '🌧️' };
    case 85:
    case 86:
      return { label: 'Snow showers', icon: '🌨️' };
    case 95:
      return { label: 'Thunderstorm', icon: '⛈️' };
    case 96:
    case 99:
      return { label: 'Thunderstorm + hail', icon: '⛈️' };
    default:
      return { label: 'Unknown', icon: '🌡️' };
  }
}
