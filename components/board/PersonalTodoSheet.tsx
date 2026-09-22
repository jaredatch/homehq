'use client';

import { useState } from 'react';
import { addDays, type WeekStart } from '@/components/calendar/calendar-utils';
import PersonalSheet from './PersonalSheet';
import OnScreenKeyboard, { KeyboardField } from './OnScreenKeyboard';
import DatePicker from './DatePicker';
import { formatPickedDate } from './picker-utils';

interface PersonalTodoSheetProps {
  projectId: string;
  /** Today as YYYY-MM-DD in the board's zone — what the "Today" chip means. */
  today: string;
  /** Which column the date picker's weeks start in, same as the grids. */
  weekStartsOn: WeekStart;
  resetMs: number;
  onClose: () => void;
  /** Called after Todoist confirms, with the new task's id, so the column can
   * refetch and scroll the row into view. */
  onAdded: (id: string) => void;
}

type When = 'none' | 'today' | 'tomorrow' | 'pick';

/**
 * Add Todo.
 *
 * One text field and a due choice, which is the whole job: anything richer
 * (priority, labels, sub-tasks) is Todoist's on a phone, not a kid's on a 10"
 * panel with a drawn keyboard.
 *
 * **No due date is the default**, and a specific date is now pickable. Phase 4
 * defaulted to Today on the grounds that a task had to visibly land where she
 * was already looking, since "Anytime" is the last section in a column that may
 * be scrolled. Using it said the cost was higher than the benefit: most of what
 * gets typed in isn't due today, and a wrong date is harder to notice — and
 * harder to fix from here — than a missing one. The landing problem is solved
 * where it belongs instead: the column scrolls the new task into view.
 *
 * "Pick a date" opens the board's own drawn month grid in place of the keyboard,
 * the same one the event form uses. It used to be a native `<input type="date">`,
 * which on the panel took several taps to open, opened mouse-sized, and drew
 * the date in the Pi's locale rather than ours (see DatePicker).
 */
export default function PersonalTodoSheet({
  projectId,
  today,
  weekStartsOn,
  resetMs,
  onClose,
  onAdded,
}: PersonalTodoSheetProps) {
  const [content, setContent] = useState('');
  const [when, setWhen] = useState<When>('none');
  // Only ever set by tapping a day, so "pick" never stands without a date.
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dueDate =
    when === 'today'
      ? today
      : when === 'tomorrow'
        ? addDays(today, 1)
        : when === 'pick'
          ? (pickedDate ?? undefined)
          : undefined;

  const add = async () => {
    const text = content.trim();
    if (!text || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/todos/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, content: text, dueDate }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.error ? 'Couldn’t add that — try again.' : `Couldn’t add that (${res.status})`
        );
        setSaving(false);
        return;
      }
      const data = await res.json().catch(() => ({}));
      onAdded(typeof data?.todo?.id === 'string' ? data.todo.id : '');
      onClose();
    } catch {
      setError('Couldn’t reach the server — try again.');
      setSaving(false);
    }
  };

  const chip = (key: When, label: string, onClick = () => setWhen(key)) => (
    <button
      key={key}
      type="button"
      className={`pb-chip${when === key ? ' pb-chip--on' : ''}`}
      onClick={onClick}
      aria-pressed={when === key}
    >
      {label}
    </button>
  );

  /* The keyboard steps aside for the grid, and comes back holding what was
     typed — the text lives here, not in the keyboard. */
  if (picking) {
    return (
      <PersonalSheet
        title="Due date"
        resetMs={resetMs}
        onClose={onClose}
        footer={
          <button type="button" className="pb-btn" onClick={() => setPicking(false)}>
            Back
          </button>
        }
      >
        <DatePicker
          value={when === 'pick' ? pickedDate : null}
          today={today}
          weekStartsOn={weekStartsOn}
          // A new to-do due yesterday would land straight in Past Due.
          min={today}
          onPick={(picked) => {
            // Today and Tomorrow already have chips of their own; lighting
            // those instead of a third chip that says the same thing keeps one
            // answer per day.
            if (picked === today) setWhen('today');
            else if (picked === addDays(today, 1)) setWhen('tomorrow');
            else {
              setPickedDate(picked);
              setWhen('pick');
            }
            setPicking(false);
          }}
        />
      </PersonalSheet>
    );
  }

  return (
    <PersonalSheet title="Add to-do" resetMs={resetMs} onClose={onClose}>
      <KeyboardField value={content} placeholder="What do you need to do?" label="To-do" />

      <div className="pb-chips" role="group" aria-label="When">
        {chip('none', 'No date')}
        {chip('today', 'Today')}
        {chip('tomorrow', 'Tomorrow')}
        {/* Once a day is picked, the chip IS the answer: it says the date, and
            tapping it again reopens the grid on that day. */}
        {chip(
          'pick',
          when === 'pick' && pickedDate ? formatPickedDate(pickedDate, today) : 'Pick a date',
          () => setPicking(true)
        )}
      </div>

      {error && <p className="pb-sheet-error">{error}</p>}

      {/* "Adding…" rather than "…": Todoist's create round trip can take a few
          seconds, and a button that turns into an ellipsis reads as a stall. */}
      <OnScreenKeyboard
        value={content}
        onChange={setContent}
        onDone={add}
        doneLabel={saving ? 'Adding…' : 'Add'}
        doneDisabled={content.trim() === '' || saving}
      />
    </PersonalSheet>
  );
}
