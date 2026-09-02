'use client';

import { useState } from 'react';
import { addDays } from '@/components/calendar/calendar-utils';
import PersonalSheet from './PersonalSheet';
import OnScreenKeyboard, { KeyboardField } from './OnScreenKeyboard';

interface PersonalTodoSheetProps {
  projectId: string;
  /** Today as YYYY-MM-DD in the board's zone — what the "Today" chip means. */
  today: string;
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
 * The date picker is a native `<input type="date">`, the same control the event
 * form uses. It opens Chromium's own date popup rather than a text cursor, so it
 * doesn't break the rule that nothing on this board takes text focus.
 */
export default function PersonalTodoSheet({
  projectId,
  today,
  resetMs,
  onClose,
  onAdded,
}: PersonalTodoSheetProps) {
  const [content, setContent] = useState('');
  const [when, setWhen] = useState<When>('none');
  const [pickedDate, setPickedDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dueDate =
    when === 'today'
      ? today
      : when === 'tomorrow'
        ? addDays(today, 1)
        : when === 'pick'
          ? pickedDate
          : undefined;

  const add = async () => {
    const text = content.trim();
    if (!text || saving) return;
    if (when === 'pick' && !pickedDate) {
      setError('Pick a date, or choose No date.');
      return;
    }
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

  const chip = (key: When, label: string) => (
    <button
      key={key}
      type="button"
      className={`pb-chip${when === key ? ' pb-chip--on' : ''}`}
      onClick={() => setWhen(key)}
      aria-pressed={when === key}
    >
      {label}
    </button>
  );

  return (
    <PersonalSheet title="Add to-do" resetMs={resetMs} onClose={onClose}>
      <KeyboardField value={content} placeholder="What do you need to do?" label="To-do" />

      <div className="pb-chips" role="group" aria-label="When">
        {chip('none', 'No date')}
        {chip('today', 'Today')}
        {chip('tomorrow', 'Tomorrow')}
        {chip('pick', 'Pick a date')}
      </div>

      {/* Only once "Pick a date" is chosen — an always-present date field beside
          three chips reads as a fifth option that's already answered. */}
      {when === 'pick' && (
        <label className="pb-field pb-field--date">
          <span className="pb-field-label">Due</span>
          <input
            className="pb-input"
            type="date"
            value={pickedDate}
            onChange={(e) => setPickedDate(e.target.value)}
          />
        </label>
      )}

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
