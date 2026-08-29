'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface PinPadProps {
  /** Which board this PIN is for, sent with the PIN so a path-only install
   * (every board on one host) can still tell them apart. Null = the family
   * board, which is what an unrecognised host resolves to. */
  boardSlug: string | null;
  /** Shown above the dots so a panel says whose it is. */
  boardName?: string;
  /** Where to go after a successful PIN. Always derived server-side from a
   * board that exists, never from raw query input. */
  returnTo: string;
}

const PIN_LENGTH = 6;

/**
 * PIN entry.
 *
 * The keypad is the point: the bedroom panels are touch-only, and Debian
 * trixie gives a Chromium kiosk no system on-screen keyboard, so a text input
 * here is a screen nobody can get past without carrying a USB keyboard
 * upstairs. It's drawn on every board, not just the personal ones — the wall
 * has a trackpad, tapping is no worse than typing, and one code path is one
 * thing to keep working.
 *
 * There is deliberately no `<input>` anywhere on this page. Focus is what
 * invites a platform keyboard to appear over ours, and a physical keyboard is
 * handled by a window listener instead, so the kitchen's keyboard still works.
 */
export default function PinPad({ boardSlug, boardName, returnTo }: PinPadProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = useCallback(
    async (value: string) => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: value, ...(boardSlug ? { board: boardSlug } : {}) }),
        });

        if (res.ok) {
          router.push(returnTo);
          router.refresh();
        } else {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(data?.error ?? 'Invalid PIN');
          setPin('');
        }
      } catch {
        setError('Connection error');
      } finally {
        setLoading(false);
      }
    },
    [boardSlug, returnTo, router]
  );

  const press = useCallback(
    (digit: string) => {
      if (loading || pin.length >= PIN_LENGTH) return;
      setError('');
      const next = pin + digit;
      setPin(next);
      // Submit on the last digit — there's no "enter" worth making someone hunt
      // for when the PIN is a known length.
      //
      // Computed out here rather than inside a setPin updater: React invokes
      // updaters twice in development, which fired the whole request twice —
      // two sessions minted per entry, and every wrong PIN costing two of the
      // five tries the rate limiter allows.
      if (next.length === PIN_LENGTH) submit(next);
    },
    [loading, pin, submit]
  );

  const backspace = useCallback(() => {
    if (loading) return;
    setError('');
    setPin((current) => current.slice(0, -1));
  }, [loading]);

  // A real keyboard still works — the kitchen has one, and so does any laptop
  // this ever gets opened on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') press(e.key);
      else if (e.key === 'Backspace') backspace();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, backspace]);

  const key = (label: string, onPress: () => void, mod?: string) => (
    <button
      key={label}
      type="button"
      className={`auth-key${mod ? ` auth-key--${mod}` : ''}`}
      // Act on press, not release: a finger that slides a few pixels between
      // down and up would otherwise lose the digit.
      onPointerDown={(e) => {
        e.preventDefault();
        onPress();
      }}
      disabled={loading}
      aria-label={label === '⌫' ? 'Delete' : label}
    >
      {label}
    </button>
  );

  return (
    <div className="auth-center">
      <div className="auth-panel">
        <h1 className="auth-h1">{boardName ?? 'HomeHQ'}</h1>
        <p className="auth-sub">Enter PIN to continue</p>

        <div className="auth-dots">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div
              key={i}
              className={`auth-dot ${i < pin.length ? 'auth-dot--on' : 'auth-dot--off'}`}
            />
          ))}
        </div>

        <div className="auth-keys" role="group" aria-label="PIN keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d, () => press(d)))}
          <span className="auth-key-spacer" aria-hidden />
          {key('0', () => press('0'))}
          {key('⌫', backspace, 'mod')}
        </div>

        {error && <p className="auth-error">{error}</p>}
        {loading && <p className="auth-loading">Verifying…</p>}
      </div>
    </div>
  );
}
