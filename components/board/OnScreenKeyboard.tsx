'use client';

import { useState } from 'react';

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
