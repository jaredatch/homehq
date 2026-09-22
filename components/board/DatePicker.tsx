'use client';

import { useMemo, useState } from 'react';
import { weekdayLabels, type WeekStart } from '@/components/calendar/calendar-utils';
import { addMonths, monthLabel, monthOf } from '@/components/calendar/month-utils';
import { pickerDays } from './picker-utils';

interface DatePickerProps {
  /** The day currently chosen, or null when nothing is yet. */
  value: string | null;
  /** Today in the board's zone — marked on the grid, and where "Today" pages to. */
  today: string;
  weekStartsOn: WeekStart;
  /** The earliest day that can be picked. Earlier days draw, but disabled. */
  min?: string;
  /** Picking a day is the commit: one tap, and the sheet goes back to the form. */
  onPick: (date: string) => void;
}

/**
 * The personal board's date picker: a month of finger-sized days.
 *
 * It replaces `<input type="date">`, which failed a touch panel twice over.
 * Chromium only opens its popup from a small calendar icon — a tap on the text
 * selects the day or month segment for typing, which a panel with no keyboard
 * can't do — and when the popup does open it's sized for a mouse. It also draws
 * the value in the DEVICE's locale, so a Pi left on Raspberry Pi OS's en_GB
 * default showed 22/09/2026 where the Mac showed 09/22/2026. Everything here is
 * formatted by our own code, so it reads the same on every screen.
 *
 * The header is month view's: the month name, then ‹ Today › in its outlined
 * buttons, with Today only once you've paged away.
 */
export default function DatePicker({ value, today, weekStartsOn, min, onPick }: DatePickerProps) {
  const [month, setMonth] = useState(() => monthOf(value ?? today));
  const days = useMemo(() => pickerDays(month, weekStartsOn), [month, weekStartsOn]);
  const labels = useMemo(() => weekdayLabels(weekStartsOn), [weekStartsOn]);
  const thisMonth = monthOf(today);

  return (
    <div className="pb-dp">
      <div className="pb-dp-head">
        <span className="pb-dp-month">{monthLabel(month)}</span>
        <button
          type="button"
          className="pb-view-navbtn"
          onClick={() => setMonth((m) => addMonths(m, -1))}
          aria-label="Previous month"
        >
          ‹
        </button>
        {month !== thisMonth && (
          <button type="button" className="pb-view-navbtn" onClick={() => setMonth(thisMonth)}>
            Today
          </button>
        )}
        <button
          type="button"
          className="pb-view-navbtn"
          onClick={() => setMonth((m) => addMonths(m, 1))}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="pb-dp-weekdays" aria-hidden>
        {labels.map((label) => (
          <span key={label} className="pb-dp-weekday">
            {label}
          </span>
        ))}
      </div>

      <div className="pb-dp-grid" role="group" aria-label={monthLabel(month)}>
        {days.map((day) => {
          const classes = ['pb-dp-day'];
          if (monthOf(day) !== month) classes.push('pb-dp-day--outside');
          else if (day < today) classes.push('pb-dp-day--past');
          if (day === today) classes.push('pb-dp-day--today');
          if (day === value) classes.push('pb-dp-day--on');
          return (
            <button
              key={day}
              type="button"
              className={classes.join(' ')}
              disabled={!!min && day < min}
              // onClick, not the keyboard's onPointerDown: a pick swaps the sheet
              // back to the form, and switching on pointerdown would hand the
              // tap's click to whatever form control lands under the finger.
              onClick={() => onPick(day)}
              aria-pressed={day === value}
              aria-label={day}
            >
              {Number(day.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
