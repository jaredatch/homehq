'use client';

import type { PersonOption } from './personal-utils';

interface PersonPickerProps {
  people: PersonOption[];
  person: number;
  onChange: (index: number) => void;
  /** Extra class for the wrapper, so a header can place it. */
  className?: string;
}

/**
 * "Whose calendar am I looking at" — the Upcoming header's picker, and the same
 * control in the week and month headers.
 *
 * One component rather than three copies: the selection is shared state (a view
 * inherits whatever the column was showing), so the control that changes it has
 * to look and behave the same everywhere or the three surfaces drift apart.
 *
 * A native `<select>` on purpose — Chromium gives it a real touch-sized popup on
 * the panel, which beats anything hand-rolled here. It is not a text input, so
 * it never invites a platform keyboard. The selection auto-reverts to her after
 * idle (CLAUDE.md rule 1, see PersonalShell).
 */
export default function PersonPicker({ people, person, onChange, className }: PersonPickerProps) {
  // Only worth a picker when there IS someone else to look at. A board scoped to
  // one person renders its own name as plain text.
  if (people.length <= 1) {
    return (
      <span className={`pb-person pb-person--fixed${className ? ` ${className}` : ''}`}>
        {people[0]?.label}
      </span>
    );
  }

  return (
    <select
      className={`pb-person${className ? ` ${className}` : ''}`}
      value={person}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label="Whose calendar to show"
    >
      {people.map((option, i) => (
        <option key={option.label} value={i}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
