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
  /** Called after Todoist confirms, so the column refetches. */
  onAdded: () => void;
}

type When = 'today' | 'tomorrow' | 'someday';

/**
 * Add Todo.
 *
 * One text field and a due choice, which is the whole job: anything richer
 * (priority, labels, sub-tasks) is Todoist's on a phone, not a kid's on a 10"
 * panel with a drawn keyboard.
 *
 * "Today" is the default rather than Todoist's own undated. An added task has
 * to visibly land somewhere she is already looking, and "Anytime" is the last
 * section in a column that may be scrolled — a to-do that appears to vanish
 * reads as the button not working. Overdue is not a failure state here: Past
 * Due is the FIRST section, so a task she didn't get to is the first thing she
 * sees, which is the point of writing it down.
 */
export default function PersonalTodoSheet({
  projectId,
  today,
  resetMs,
  onClose,
  onAdded,
}: PersonalTodoSheetProps) {
  const [content, setContent] = useState('');
  const [when, setWhen] = useState<When>('today');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dueDate = when === 'today' ? today : when === 'tomorrow' ? addDays(today, 1) : undefined;

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
      onAdded();
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
        {chip('today', 'Today')}
        {chip('tomorrow', 'Tomorrow')}
        {chip('someday', 'Someday')}
      </div>

      {error && <p className="pb-sheet-error">{error}</p>}

      <OnScreenKeyboard
        value={content}
        onChange={setContent}
        onDone={add}
        doneLabel={saving ? '…' : 'Add'}
        doneDisabled={content.trim() === '' || saving}
      />
    </PersonalSheet>
  );
}
