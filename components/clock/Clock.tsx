'use client';

import { zonedParts } from '@/components/calendar/calendar-utils';
import { useMinuteTick } from './use-minute';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function formatClockTime(date: Date, timeZone?: string): { time: string; ampm: string } {
  const { hours: h24, minutes } = zonedParts(date, timeZone);
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const hours = h24 % 12 || 12;
  return { time: `${hours}:${String(minutes).padStart(2, '0')}`, ampm };
}

export function formatClockDate(date: Date, timeZone?: string): string {
  const { month, day, weekday } = zonedParts(date, timeZone);
  return `${DAY_NAMES[weekday]}, ${MONTH_NAMES[month - 1]} ${day}`;
}

export default function Clock({ timeZone }: { timeZone?: string }) {
  // 0 until the client hydrates — the server can't know the kiosk's clock.
  const minute = useMinuteTick();

  if (minute === 0) {
    return <div className="clk-placeholder" aria-hidden />;
  }

  const now = new Date(minute * 60000);
  const { time, ampm } = formatClockTime(now, timeZone);

  return (
    <div className="clk">
      <div className="clk-time-group">
        <span className="clk-time">{time}</span>
        <span className="clk-ampm">{ampm}</span>
      </div>
      <span className="clk-date">{formatClockDate(now, timeZone)}</span>
    </div>
  );
}
