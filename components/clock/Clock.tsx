'use client';

import { useSyncExternalStore } from 'react';

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

export function formatClockTime(date: Date): { time: string; ampm: string } {
  let hours = date.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return { time: `${hours}:${minutes}`, ampm };
}

export function formatClockDate(date: Date): string {
  return `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
}

// The wall clock is an external store: subscribe to its ticks rather than
// mirroring it into useState from an effect.
function subscribe(onStoreChange: () => void): () => void {
  // Poll every second; React only re-renders when the snapshot (whole minute)
  // actually changes, so the display ticks over within a second of the rollover.
  const id = setInterval(onStoreChange, 1000);
  return () => clearInterval(id);
}

function getSnapshot(): number {
  return Math.floor(Date.now() / 60000);
}

// The server can't know the kiosk's wall-clock time — render a placeholder
// until the client hydrates and takes over.
function getServerSnapshot(): number {
  return 0;
}

export default function Clock() {
  const minute = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (minute === 0) {
    return <div className="h-10 w-64" aria-hidden />;
  }

  const now = new Date(minute * 60000);
  const { time, ampm } = formatClockTime(now);

  return (
    <div className="flex items-baseline gap-4">
      <div className="flex items-baseline gap-1.5">
        <span className="text-4xl font-semibold tabular-nums leading-none text-gray-100">
          {time}
        </span>
        <span className="text-lg font-medium text-gray-400">{ampm}</span>
      </div>
      <span className="text-xl text-gray-300">{formatClockDate(now)}</span>
    </div>
  );
}
