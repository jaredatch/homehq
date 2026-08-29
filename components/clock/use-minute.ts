'use client';

import { useSyncExternalStore } from 'react';

/**
 * The current minute, as an external store rather than state mirrored from an
 * effect. Polls every second but the snapshot is a whole-minute number, so
 * React only re-renders when the display would actually change — the clock
 * ticks over within a second of the rollover and does nothing in between.
 *
 * Returns 0 on the server: the machine rendering the page can't know the
 * kiosk's wall-clock time, so callers draw a placeholder until hydration.
 */
function subscribe(onStoreChange: () => void): () => void {
  const id = setInterval(onStoreChange, 1000);
  return () => clearInterval(id);
}

function getSnapshot(): number {
  return Math.floor(Date.now() / 60000);
}

function getServerSnapshot(): number {
  return 0;
}

export function useMinuteTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
