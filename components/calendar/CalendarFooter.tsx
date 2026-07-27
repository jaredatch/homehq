'use client';

import { useCallback, useSyncExternalStore, type ReactNode } from 'react';
import type { SyncLabel } from './calendar-utils';
import { useCalendarFilter, toggleCalendar, clearFilter } from './calendar-filter';

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

  // Per-person filter — clicking a name isolates it, then adds/removes; empty =
  // show all. Shared across views + reverts on idle (both handled elsewhere);
  // here the legend just drives and reflects it. The chevron toggle owns
  // collapse now, so a name-click filters instead of hiding the legend.
  const filter = useCalendarFilter();
  const filterActive = filter.size > 0;
  const total = calendars.length;

  return (
    <div className={rule ? 'cal-footer cal-footer--rule' : 'cal-footer'}>
      <div className="cal-footer-left">
        <div className="cal-legend-group">
          <button
            type="button"
            onClick={toggleLegend}
            title={showLegend ? 'Hide calendar legend' : 'Show calendar legend'}
            aria-expanded={showLegend}
            className={
              showLegend ? 'cal-legend-toggle cal-legend-toggle--open' : 'cal-legend-toggle'
            }
          >
            <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden focusable="false">
              <path
                d="M6 4l4 4-4 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {showLegend ? (
            <div className="cal-legend">
              {calendars.map((c) => {
                const cls = !filterActive
                  ? 'cal-legend-item'
                  : filter.has(c.id)
                    ? 'cal-legend-item cal-legend-item--on'
                    : 'cal-legend-item cal-legend-item--off';
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCalendar(c.id, total)}
                    title={`Show only ${c.name}`}
                    aria-pressed={filterActive && filter.has(c.id)}
                    className={cls}
                  >
                    <span
                      className="cal-legend-dot"
                      style={{ backgroundColor: c.color }}
                      aria-hidden
                    />
                    {c.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="cal-legend-collapsed" aria-hidden>
              {calendars.map((c) => (
                <span
                  key={c.id}
                  className={
                    filterActive && !filter.has(c.id)
                      ? 'cal-legend-dot--sm cal-legend-dot--muted'
                      : 'cal-legend-dot--sm'
                  }
                  style={{ backgroundColor: c.color }}
                />
              ))}
            </div>
          )}
          {filterActive && (
            <button
              type="button"
              onClick={clearFilter}
              title="Clear filter — show all calendars"
              className="cal-legend-clear"
            >
              ✕ Show all
            </button>
          )}
        </div>
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
      <div className="cal-footer-right">
        <span className={sync.isError ? 'cal-sync--error' : 'cal-sync'}>{sync.text}</span>
        {/* Manual hard refresh — an always-there escape hatch for the wall. If
            the long-lived SPA ever gets weird, one click re-mounts everything
            (and picks up the latest deploy) with no keyboard shortcut or kiosk
            fiddling. Same reload the kiosk self-update uses; no confirm because
            a reload is non-destructive (only ephemeral state is lost). */}
        <button
          type="button"
          onClick={() => window.location.reload()}
          title="Reload HomeHQ"
          aria-label="Reload HomeHQ"
          className="cal-refresh"
        >
          <svg
            viewBox="0 0 24 24"
            width="1em"
            height="1em"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            focusable="false"
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>
    </div>
  );
}
