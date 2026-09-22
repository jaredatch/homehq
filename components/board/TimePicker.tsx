'use client';

import { fromClock12, toClock12, type Clock12 } from './picker-utils';

interface TimePickerProps {
  /** 24-hour `HH:mm`, the shape the write routes take. */
  value: string;
  onChange: (next: string) => void;
}

const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Five-minute steps: fine enough for a 7:50 bell, coarse enough to fit a 4×3
 * grid beside the hours. An existing event on an odd minute keeps it — no cell
 * lights up, and nothing changes unless a minute is tapped. */
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

/**
 * The personal board's time picker: every hour, every five minutes, and AM/PM,
 * all on screen at once. Any time is at most three taps and none of it scrolls.
 *
 * It replaces `<input type="time">`, which on the panel was a mouse-sized popup
 * of scrolling columns that took several taps to open, drawn 24-hour on a Pi
 * left on en_GB. This draws 12-hour everywhere, from our own code.
 *
 * Every tap applies at once. The form it came from still has Cancel, so the
 * picker doesn't need a second way to back out.
 */
export default function TimePicker({ value, onChange }: TimePickerProps) {
  const clock = toClock12(value);
  const set = (next: Partial<Clock12>) => onChange(fromClock12({ ...clock, ...next }));

  const cell = (key: string, label: string, on: boolean, pick: () => void) => (
    <button
      key={key}
      type="button"
      className={`pb-tp-cell${on ? ' pb-tp-cell--on' : ''}`}
      onClick={pick}
      aria-pressed={on}
    >
      {label}
    </button>
  );

  return (
    <div className="pb-tp">
      <div className="pb-tp-group">
        <span className="pb-field-label">Hour</span>
        <div className="pb-tp-grid" role="group" aria-label="Hour">
          {HOURS.map((h) => cell(`h${h}`, String(h), h === clock.hour, () => set({ hour: h })))}
        </div>
      </div>

      <div className="pb-tp-group">
        <span className="pb-field-label">Minute</span>
        <div className="pb-tp-grid" role="group" aria-label="Minute">
          {MINUTES.map((m) =>
            cell(`m${m}`, `:${String(m).padStart(2, '0')}`, m === clock.minute, () =>
              set({ minute: m })
            )
          )}
        </div>
      </div>

      <div className="pb-seg pb-tp-meridiem" role="group" aria-label="AM or PM">
        {(['AM', 'PM'] as const).map((half) => {
          const on = clock.pm === (half === 'PM');
          return (
            <button
              key={half}
              type="button"
              className={`pb-seg-btn${on ? ' pb-seg-btn--on' : ''}`}
              onClick={() => set({ pm: half === 'PM' })}
              aria-pressed={on}
            >
              {half}
            </button>
          );
        })}
      </div>
    </div>
  );
}
