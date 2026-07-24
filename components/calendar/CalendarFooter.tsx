'use client';

import { useCallback, useSyncExternalStore, type ReactNode } from 'react';
import type { SyncLabel } from './calendar-utils';

// Collapsible-legend preference, persisted so it carries across views and
// reloads. Read via useSyncExternalStore (the Clock's idiom): the server
// snapshot is the default (expanded), and the real value hydrates in without a
// mismatch. The toggle dispatches an event so every subscribed footer stays
// in step.
const LEGEND_KEY = 'homehq:legend';
const LEGEND_EVENT = 'homehq:legend';
const subscribeLegend = (cb: () => void) => {
  window.addEventListener(LEGEND_EVENT, cb);
  return () => window.removeEventListener(LEGEND_EVENT, cb);
};
const readLegend = () => localStorage.getItem(LEGEND_KEY) !== '0';

interface CalendarFooterProps {
  calendars: { id: string; name: string; color: string }[];
  /** View-switch button label — "View Month" on the wall, "View Upcoming" in
   * month view. Omit the handler and the button (with its separator) vanishes. */
  viewLabel?: string;
  viewTitle?: string;
  onViewClick?: () => void;
  /** Opens the create modal. Only passed when writes are on — readonly
   * deployments render no add button at all. */
  onAddClick?: () => void;
  /** View-specific trailing controls (the wall's expand toggle). Rendered last
   * so the shared controls hold the same positions in every view. */
  children?: ReactNode;
  sync: SyncLabel;
  /** Draw a rule above the footer (month view — its grid has no bottom chrome
   * of its own, so the footer needs the divider the wall gets for free). */
  rule?: boolean;
}

/**
 * The calendar area's footer, shared by every view so the bottom bar is a
 * constant the way the top bar is: legend, view switch, and "+ Add event"
 * always sit in the same order and position; anything view-specific trails.
 * rem-based (persistent chrome) — it must never inherit month view's dense
 * grid scale.
 *
 * Owns the collapsible-legend state (persisted) so the choice carries across
 * views instead of each grid keeping its own.
 */
export default function CalendarFooter({
  calendars,
  viewLabel,
  viewTitle,
  onViewClick,
  onAddClick,
  children,
  sync,
  rule,
}: CalendarFooterProps) {
  // Legend — on by default while the family learns the colors, collapsible to
  // a faint dot cluster once it's just noise. Choice persists across views.
  const showLegend = useSyncExternalStore(subscribeLegend, readLegend, () => true);
  const toggleLegend = useCallback(() => {
    localStorage.setItem(LEGEND_KEY, showLegend ? '0' : '1');
    window.dispatchEvent(new Event(LEGEND_EVENT));
  }, [showLegend]);

  return (
    <div className={rule ? 'cal-footer cal-footer--rule' : 'cal-footer'}>
      <div className="cal-footer-left">
        {showLegend ? (
          <button
            type="button"
            onClick={toggleLegend}
            title="Hide calendar legend"
            className="cal-legend"
          >
            {calendars.map((c) => (
              <span key={c.id} className="cal-legend-item">
                <span className="cal-legend-dot" style={{ backgroundColor: c.color }} aria-hidden />
                {c.name}
              </span>
            ))}
          </button>
        ) : (
          <button
            type="button"
            onClick={toggleLegend}
            title="Show calendar legend"
            className="cal-legend-collapsed"
          >
            {calendars.map((c) => (
              <span
                key={c.id}
                className="cal-legend-dot--sm"
                style={{ backgroundColor: c.color }}
                aria-hidden
              />
            ))}
          </button>
        )}
        {onViewClick && (
          <>
            <span className="cal-footer-sep" aria-hidden />
            <button type="button" onClick={onViewClick} title={viewTitle} className="cal-viewbtn">
              {viewLabel}
            </button>
          </>
        )}
        {onAddClick && (
          <>
            <span className="cal-footer-sep" aria-hidden />
            <button
              type="button"
              onClick={onAddClick}
              title="Add a calendar event"
              className="cal-addbtn"
            >
              + Add event
            </button>
          </>
        )}
        {children && (
          <>
            <span className="cal-footer-sep" aria-hidden />
            {children}
          </>
        )}
      </div>
      <span className={sync.isError ? 'cal-sync--error' : 'cal-sync'}>{sync.text}</span>
    </div>
  );
}
