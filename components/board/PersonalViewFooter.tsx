'use client';

import type { ReactNode } from 'react';
import type { SyncLabel } from '@/components/calendar/calendar-utils';

interface PersonalViewFooterProps {
  /** Leaves this view and returns to the three columns. */
  onHome: () => void;
  /** The view's own actions — "View Month", "Add Event", whatever it offers.
   * Rendered after the home button and its separator, so home always holds the
   * same spot however many of these there are. */
  children: ReactNode;
  sync: SyncLabel;
}

/**
 * Font Awesome's `house` (free solid), inlined.
 *
 * Not routed through `lib/calendar/title-icons.ts` on purpose: that machinery
 * exists so a glyph can change with a `config.json` edit and no rebuild, and it
 * is server-only. This one is fixed chrome, and threading a constant path down
 * PersonalBoard → Shell → every view would be noise. Hand-inlined SVG is already
 * how the wall's own footer chrome draws its chevron and its reload icon.
 */
const HOUSE_PATH =
  'M277.8 8.6c-12.3-11.4-31.3-11.4-43.5 0l-224 208c-9.6 9-12.8 22.9-8 35.1S18.8 272 32 272l16 0 0 176c0 35.3 28.7 64 64 64l288 0c35.3 0 64-28.7 64-64l0-176 16 0c13.2 0 25-8.1 29.8-20.3s1.6-26.2-8-35.1l-224-208zM240 320l32 0c26.5 0 48 21.5 48 48l0 96-128 0 0-96c0-26.5 21.5-48 48-48z';

/**
 * The footer every full-screen view on a personal board wears.
 *
 * It exists for the home button. "Close" used to be a text link sitting at the
 * end of each view's own action list, which meant the way out moved depending on
 * how many actions that view happened to have — and it would move again the
 * first time a view was added. Home is now a fixed glyph in a fixed place: far
 * left, always, whatever screen you are on. Nothing to read, nothing to hunt
 * for, and a new full-screen view gets it by rendering this footer.
 *
 * The three-column board itself has no home button. You are already there.
 */
export default function PersonalViewFooter({ onHome, children, sync }: PersonalViewFooterProps) {
  return (
    <footer className="pb-view-foot">
      <button type="button" className="pb-home" onClick={onHome} title="Home" aria-label="Home">
        <svg viewBox="0 0 512 512" aria-hidden focusable="false">
          <path d={HOUSE_PATH} fill="currentColor" />
        </svg>
      </button>
      <span className="pb-action-sep">|</span>
      {children}
      <span className={sync.isError ? 'pb-sync pb-sync--error' : 'pb-sync'}>{sync.text}</span>
    </footer>
  );
}
