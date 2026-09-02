'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * HomeHQ's own on-screen keyboard.
 *
 * The bedroom panels are touch-only, and Debian trixie has no system on-screen
 * keyboard we can rely on in a Chromium kiosk. Drawing our own means text entry
 * works identically on the panel, on the Mac, and in a phone browser, with
 * nothing to provision per device (private/personal-boards-plan.md).
 *
 * The field it edits is NOT an `<input>` — see `KeyboardField` below. Nothing on
 * this screen ever takes text focus, so the browser has no reason to raise a
 * second keyboard over this one.
 *
 * A REAL keyboard still types into it, through a window listener rather than a
 * focused element. That is how the PIN keypad already works, and it's the same
 * trade: the listener costs nothing on a panel that has no keyboard, and it is
 * the difference between testing this on a Mac by hand and testing it by
 * clicking 40 drawn keys with a mouse.
 */

interface OnScreenKeyboardProps {
  value: string;
  onChange: (next: string) => void;
  /** The green key, bottom right. Usually "commits and closes the sheet". */
  onDone: () => void;
  doneLabel?: string;
  /** Disables the done key while the value isn't usable yet (empty title). */
  doneDisabled?: boolean;
}

/** Rows are laid out on a 20-column grid, so a 10-key row is 2 columns per key
 * and the stagger and the wide modifiers land on the same rhythm. */
const LETTER_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const SYMBOL_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['-', '/', ':', ';', '(', ')', '$', '&', '@', '#'],
  ['.', ',', '?', '!', "'", '"', '+'],
];

/** Todoist's own cap, and well past anything a title needs. Long enough that
 * nobody hits it by writing; short enough that a stuck key can't run away. */
const MAX_LENGTH = 500;

export default function OnScreenKeyboard({
  value,
  onChange,
  onDone,
  doneLabel = 'Done',
  doneDisabled = false,
}: OnScreenKeyboardProps) {
  const [symbols, setSymbols] = useState(false);
  // Starts on so the first letter of a fresh entry is capitalised without
  // anyone thinking about it, and drops after one letter like a phone's.
  const [shift, setShift] = useState(true);

  const insert = (ch: string) => {
    if (value.length >= MAX_LENGTH) return;
    onChange(value + (shift ? ch.toUpperCase() : ch));
    setShift(false);
  };

  const backspace = () => {
    const next = value.slice(0, -1);
    onChange(next);
    // Back to an empty field is the start of a sentence again.
    if (next === '') setShift(true);
  };

  // A physical keyboard, for the Mac this gets built and tested on. The listener
  // binds once and reads through a ref, so it can't go stale on `value` and the
  // window handler isn't torn down and rebuilt on every keystroke. Written in an
  // effect rather than during render — a ref is not a render-time value.
  const latest = useRef({ value, onChange, onDone, doneDisabled });
  useEffect(() => {
    latest.current = { value, onChange, onDone, doneDisabled };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never swallow a shortcut, and never fight a real input if one somehow
      // has focus (the wall's modal is on the same page in dev).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;

      const {
        value: current,
        onChange: change,
        onDone: done,
        doneDisabled: locked,
      } = latest.current;

      if (e.key === 'Enter') {
        e.preventDefault();
        if (!locked) done();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        const next = current.slice(0, -1);
        // Write the new value straight back into the ref as well as calling
        // onChange. React batches, and the effect that refreshes this ref
        // doesn't run between two keydowns delivered in the same batch — so a
        // burst (key auto-repeat, or a fast typist) would have every event
        // after the first computing from a stale value and undoing the ones
        // before it. Typing "Xy" produced "y".
        latest.current = { ...latest.current, value: next };
        change(next);
        if (next === '') setShift(true);
        return;
      }
      // Esc belongs to the sheet, which closes on it.
      if (e.key === 'Escape') return;
      // One printable character. `key` is already the shifted form, so the
      // drawn Shift is left alone — a real keyboard says what it typed.
      if (e.key.length !== 1) return;
      e.preventDefault();
      if (current.length >= MAX_LENGTH) return;
      const next = current + e.key;
      latest.current = { ...latest.current, value: next };
      change(next);
      setShift(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const rows = symbols ? SYMBOL_ROWS : LETTER_ROWS;

  // `id` is kept separate from `label` so shifting a letter row relabels the
  // keys instead of remounting every one of them.
  const key = (
    id: string,
    label: string,
    onClick: () => void,
    span: number,
    mod?: string,
    on?: boolean
  ) => (
    <button
      key={id}
      type="button"
      className={`pb-kb-key${mod ? ` pb-kb-key--${mod}` : ''}${on ? ' pb-kb-key--on' : ''}`}
      style={{ gridColumn: `span ${span}` }}
      // Keys act on press, not release: a finger that slides a few pixels off
      // the key between down and up would otherwise eat the keystroke.
      onPointerDown={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="pb-kb" role="group" aria-label="On-screen keyboard">
      {rows.map((row, i) => (
        <div className="pb-kb-row" key={i}>
          {/* The half-key inset that gives row two its stagger. */}
          {!symbols && i === 1 && (
            <span className="pb-kb-spacer" style={{ gridColumn: 'span 1' }} />
          )}
          {i === 2 &&
            (symbols ? (
              <span className="pb-kb-spacer" style={{ gridColumn: 'span 3' }} />
            ) : (
              key('shift', '⇧', () => setShift((v) => !v), 3, 'mod', shift)
            ))}
          {row.map((ch) => key(ch, shift && !symbols ? ch.toUpperCase() : ch, () => insert(ch), 2))}
          {i === 2 && key('backspace', '⌫', backspace, 3, 'mod')}
          {!symbols && i === 1 && (
            <span className="pb-kb-spacer" style={{ gridColumn: 'span 1' }} />
          )}
        </div>
      ))}

      <div className="pb-kb-row">
        {key('layer', symbols ? 'ABC' : '?123', () => setSymbols((v) => !v), 3, 'mod')}
        {key('comma', ',', () => insert(','), 2)}
        {key('space', ' ', () => insert(' '), 10)}
        {key('period', '.', () => insert('.'), 2)}
        <button
          type="button"
          className="pb-kb-key pb-kb-key--done"
          style={{ gridColumn: 'span 3' }}
          onPointerDown={(e) => {
            e.preventDefault();
            if (!doneDisabled) onDone();
          }}
          disabled={doneDisabled}
        >
          {doneLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * The thing the keyboard types into: a div, not an input.
 *
 * A real text input would invite the platform to raise its own keyboard over
 * ours (and on the Pi, to raise nothing at all and simply look broken). Drawing
 * the value ourselves keeps exactly one keyboard on screen, always this one.
 */
export function KeyboardField({
  value,
  placeholder,
  label,
}: {
  value: string;
  placeholder?: string;
  label: string;
}) {
  return (
    <div className="pb-kb-field" role="textbox" aria-readonly aria-label={label}>
      {/* The caret sits where the next character will land: after the text, or
          ahead of the placeholder while the field is still empty. */}
      {value ? (
        <>
          <span className="pb-kb-value">{value}</span>
          <span className="pb-kb-caret" aria-hidden />
        </>
      ) : (
        <>
          <span className="pb-kb-caret" aria-hidden />
          <span className="pb-kb-placeholder">{placeholder}</span>
        </>
      )}
    </div>
  );
}
