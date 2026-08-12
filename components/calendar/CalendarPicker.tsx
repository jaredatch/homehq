'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface PickerCalendar {
  id: string;
  name: string;
  color: string;
}

interface CalendarPickerProps {
  /** Every calendar, in config order — the order tokens and rows render in. */
  calendars: PickerCalendar[];
  /** Currently chosen calendar ids (selection order; rendered in config order). */
  selected: string[];
  /** MAX_GROUP_CALENDARS — beyond this, unchosen rows grey out. */
  max: number;
  /** Open state lives in the parent so Esc can peel one layer at a time. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: (id: string) => void;
  /** The field label, for aria-labelledby on both the trigger and the list. */
  labelId: string;
}

/** The dropdown's fixed-position box, in viewport px. */
interface ListBox {
  left: number;
  width: number;
  /** Exactly one of top/bottom is set — bottom means the list flipped upward. */
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/** Whether the last measurement flipped the list above the field. */
interface Placement {
  box: ListBox;
  up: boolean;
}

const rootPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/**
 * The event modal's calendar chooser: a collapsed token field that opens a
 * checkbox list.
 *
 * It replaced a wrapping grid of checkbox pills — one pill per calendar, always
 * visible. That read well at four calendars and fell apart at eight: three rows,
 * 157px, 22% of the modal's whole height, and growing with every calendar added.
 * Collapsed, this field is one row forever.
 *
 * What the collapse costs is one click to open, and seeing every color at once
 * on a blank form. What it buys back is that an event you're EDITING shows its
 * calendars as tokens without opening anything — the common case keeps its
 * glance, and only the empty case has to ask.
 *
 * The list is portaled to <body> because .cal-modal is `overflow-y: auto`, which
 * clips both axes — an absolutely-positioned dropdown would be cut off at the
 * modal's edge. Expanding inline instead would shove the date fields down, and
 * that jump is exactly what `1012837` removed from the all-day toggle.
 */
export default function CalendarPicker({
  calendars,
  selected,
  max,
  open,
  onOpenChange,
  onToggle,
  labelId,
}: CalendarPickerProps) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  // Tokens follow config order, not the order they were clicked, so the same
  // pair always reads the same way ("Jared, Sam" — never "Sam, Jared").
  const chosen = calendars.filter((c) => selected.includes(c.id));

  // Anchor the list to the trigger. Prefers dropping down; flips up only when
  // below is genuinely cramped AND above is roomier, so it doesn't flap.
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gutter = rootPx() * 0.75;
    const below = window.innerHeight - r.bottom - gutter;
    const above = r.top - gutter;
    const flip = below < rootPx() * 8 && above > below;
    setPlacement({
      up: flip,
      box: {
        left: r.left,
        width: r.width,
        ...(flip ? { bottom: window.innerHeight - r.top } : { top: r.bottom }),
        maxHeight: Math.max(flip ? above : below, rootPx() * 6),
      },
    });
  }, []);

  // Measure-then-position, before paint. The placement is deliberately NOT
  // cleared on close: the portal is unmounted anyway, and keeping the last value
  // means a reopen renders at roughly the right spot and is corrected below,
  // never at 0,0 first.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    // Capture phase so a scroll inside the modal (the only scrollable ancestor)
    // is seen too — a fixed-position list doesn't move with its anchor.
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  // Click anywhere that isn't the trigger (which toggles itself) or the list.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, onOpenChange]);

  // Focus the first row as the list mounts. This has to be a callback ref, not
  // an effect on `open`: the portal renders one commit later than the open flip
  // (it waits on the measured box), so an effect would run while listRef is
  // still null.
  const attachList = useCallback((node: HTMLDivElement | null) => {
    listRef.current = node;
    node?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
  }, []);

  // Hand focus back to the trigger on close — but only when closing is what
  // orphaned it (activeElement falls to <body> when the focused row unmounts).
  // Clicking straight into another field closes this too, and there the browser
  // is already moving focus somewhere better.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (!open && wasOpen.current && document.activeElement === document.body) {
      triggerRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  const toggle = (id: string) => {
    onToggle(id);
    // Hitting the cap ends the decision, so the list puts itself away: a shared
    // event is open · click · click and you're back on the form.
    if (!selected.includes(id) && selected.length + 1 >= max) onOpenChange(false);
  };

  // Arrow keys walk the enabled rows; Enter toggles (a bare checkbox ignores
  // Enter, and the modal treats it as Save — a dead key here would be worse).
  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
    const rows = [
      ...(listRef.current?.querySelectorAll<HTMLInputElement>('input:not(:disabled)') ?? []),
    ];
    const at = rows.indexOf(document.activeElement as HTMLInputElement);
    e.preventDefault();
    if (e.key === 'Enter') {
      if (at >= 0) rows[at].click();
      return;
    }
    if (!rows.length) return;
    const step = e.key === 'ArrowDown' ? 1 : -1;
    rows[(at + step + rows.length) % rows.length].focus();
  };

  return (
    <>
      <div
        ref={triggerRef}
        className={open ? 'cal-calpick-field is-open' : 'cal-calpick-field'}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-labelledby={labelId}
        onClick={() => onOpenChange(!open)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          // Enter must not reach the modal, which reads it as Save.
          e.stopPropagation();
          onOpenChange(true);
        }}
      >
        {chosen.length === 0 ? (
          // Echoes the title field's "What's happening?" rather than repeating
          // the "Calendars" label right above it.
          <span className="cal-calpick-placeholder">Who’s it for?</span>
        ) : (
          <span className="cal-calpick-tokens">
            {chosen.map((c) => (
              <span key={c.id} className="cal-calpick-token">
                <span className="cal-calpick-dot" style={{ backgroundColor: c.color }} />
                <span className="cal-calpick-token-name">{c.name}</span>
                <button
                  type="button"
                  className="cal-calpick-token-x"
                  aria-label={`Remove ${c.name}`}
                  // The × lives inside the trigger, so both would fire.
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(c.id);
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  ×
                </button>
              </span>
            ))}
          </span>
        )}
        <span className="cal-calpick-caret" aria-hidden>
          ▾
        </span>
      </div>

      {open &&
        placement &&
        createPortal(
          <div
            ref={attachList}
            className={placement.up ? 'cal-calpick-list cal-calpick-list--up' : 'cal-calpick-list'}
            role="group"
            aria-labelledby={labelId}
            style={placement.box}
            onKeyDown={onListKeyDown}
          >
            {calendars.map((c) => {
              const checked = selected.includes(c.id);
              // At the cap the unchosen grey out. Unchecking always frees a
              // slot, so this can never be a dead end.
              const atCap = !checked && selected.length >= max;
              return (
                <label
                  key={c.id}
                  className={`cal-calpick-row${atCap ? ' is-disabled' : ''}${
                    checked ? ' is-checked' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={atCap}
                    onChange={() => toggle(c.id)}
                  />
                  <span className="cal-calpick-dot" style={{ backgroundColor: c.color }} />
                  <span className="cal-calpick-name">{c.name}</span>
                </label>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
