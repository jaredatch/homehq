'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';

interface PersonalSheetProps {
  title: string;
  /** Inactivity auto-close (ms). 0 disables. */
  resetMs: number;
  onClose: () => void;
  children: ReactNode;
  /** Buttons across the bottom. Omitted when a keyboard's Done key is the
   * commit — two ways to finish the same sentence is one too many. */
  footer?: ReactNode;
}

/**
 * The overlay every personal-board form lives in: Add Todo, Add Event, and the
 * read-only event card.
 *
 * It exists for the idle rule (CLAUDE.md rule 1). The wall never sleeps and
 * neither does a bedroom panel, so a half-typed to-do abandoned at bedtime must
 * not still be on screen at breakfast. Any touch restarts the clock, so it can
 * only ever fire after she's walked away.
 */
export default function PersonalSheet({
  title,
  resetMs,
  onClose,
  children,
  footer,
}: PersonalSheetProps) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimer = useCallback(() => {
    if (resetMs <= 0) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => closeRef.current(), resetMs);
  }, [resetMs]);

  useEffect(() => {
    resetTimer();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resetTimer]);

  // Esc for the Mac, where this gets developed. The panel has no keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="pb-sheet-backdrop"
      onPointerDown={(e) => {
        resetTimer();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="pb-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={resetTimer}
      >
        <header className="pb-sheet-head">
          <h2 className="pb-sheet-title">{title}</h2>
          <button type="button" className="pb-sheet-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="pb-sheet-body">{children}</div>

        {footer && <footer className="pb-sheet-foot">{footer}</footer>}
      </div>
    </div>
  );
}
