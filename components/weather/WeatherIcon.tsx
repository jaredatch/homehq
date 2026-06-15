import type { WeatherIconSet } from '@/lib/config/types';
import { WEATHER_EMOJI, type WeatherGlyph } from '@/lib/weather/wmo';
import { WEATHER_ICON_SVGS } from '@/lib/weather/weather-icon-svgs';

interface WeatherIconProps {
  glyph: WeatherGlyph;
  set: WeatherIconSet;
  /** Size + color come from the caller via text utilities — every set is sized
   * to 1em, so font-size scales the icon and currentColor tints the mono sets. */
  className?: string;
  label?: string;
}

// Renders one weather glyph in the configured set. SVG sets are self-hosted
// markup (see lib/weather/weather-icon-svgs.ts); emoji is the legacy fallback.
export default function WeatherIcon({ glyph, set, className, label }: WeatherIconProps) {
  if (set === 'emoji') {
    return (
      <span className={className} role="img" aria-label={label}>
        {WEATHER_EMOJI[glyph]}
      </span>
    );
  }

  return (
    <span
      className={`wx-icon ${className ?? ''}`}
      role="img"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: WEATHER_ICON_SVGS[set][glyph] }}
    />
  );
}
