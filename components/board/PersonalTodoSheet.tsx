'use client';

import { useState } from 'react';
import { addDays, type WeekStart } from '@/components/calendar/calendar-utils';
import PersonalSheet from './PersonalSheet';
import OnScreenKeyboard, { KeyboardField } from './OnScreenKeyboard';
import DatePicker from './DatePicker';
import { formatPickedDate } from './picker-utils';
import type { Todo } from './todo-utils';

interface PersonalTodoSheetProps {
  projectId: string;
  /** The task being edited. Absent, this is Add Todo. */
  todo?: Todo;
  /** Today as YYYY-MM-DD in the board's zone — what the "Today" chip means. */
  today: string;
  /** Which column the date picker's weeks start in, same as the grids. */
  weekStartsOn: WeekStart;
  resetMs: number;
  onClose: () => void;
  /** Called after Todoist confirms an add or an edit, with the task's id, so
   * the column can refetch and scroll the row into view. */
  onSaved: (id: string) => void;
  /** Called after a delete goes through, so the column can refetch. */
  onDeleted?: () => void;
}

type When = 'none' | 'today' | 'tomorrow' | 'pick';

/** Which chip a task's existing due date lights. A date that isn't today or
 * tomorrow — a past-due one included — shows as the picked-date chip. */
function whenOf(due: string | null | undefined, today: string): When {
  if (!due) return 'none';
  if (due === today) return 'today';
  if (due === addDays(today, 1)) return 'tomorrow';
  return 'pick';
}

/**
 * Add Todo, and Edit Todo — the same form, opened on an existing task.
 *
 * Editing exists so a typo or a wrong day is a two-tap fix on the panel rather
 * than a job for a parent's phone. It sends only what changed: a text fix never
 * touches the due date, so a repeating task keeps its rule. A repeating task's
 * DATE isn't editable here at all — setting a plain date would quietly end the
 * repeat — so its chips give way to a line saying where that lives.
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
  todo,
  today,
  weekStartsOn,
  resetMs,
  onClose,
  onSaved,
  onDeleted,
}: PersonalTodoSheetProps) {
  const editing = !!todo;
  const repeats = !!todo?.is_recurring;
  const [content, setContent] = useState(todo?.content ?? '');
  const [when, setWhen] = useState<When>(() => whenOf(todo?.due_date, today));
  // Set by tapping a day, or seeded from the task being edited — so "pick"
  // never stands without a date.
  const [pickedDate, setPickedDate] = useState<string | null>(() =>
    whenOf(todo?.due_date, today) === 'pick' ? (todo?.due_date ?? null) : null
  );
  const [picking, setPicking] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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

  const save = async () => {
    const text = content.trim();
    if (!text || saving) return;

    let url = '/api/todos/create';
    let body: Record<string, unknown> = { projectId, content: text, dueDate };
    if (todo) {
      url = '/api/todos/update';
      body = { id: todo.id };
      if (text !== todo.content) body.content = text;
      if (!repeats && (dueDate ?? null) !== todo.due_date) body.dueDate = dueDate ?? null;
      // Nothing changed: Save is just Close.
      if (Object.keys(body).length === 1) {
        onClose();
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const verb = editing ? 'save' : 'add';
        setError(
          data.error
            ? `Couldn’t ${verb} that — try again.`
            : `Couldn’t ${verb} that (${res.status})`
        );
        setSaving(false);
        return;
      }
      const data = await res.json().catch(() => ({}));
      onSaved(typeof data?.todo?.id === 'string' ? data.todo.id : '');
      onClose();
    } catch {
      setError('Couldn’t reach the server — try again.');
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!todo || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/todos/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: todo.id }),
      });
      if (!res.ok) {
        setError(`Couldn’t delete that (${res.status})`);
        setSaving(false);
        return;
      }
      onDeleted?.();
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

  if (confirmingDelete && todo) {
    return (
      <PersonalSheet
        title="Delete to-do"
        resetMs={resetMs}
        onClose={onClose}
        footer={
          <>
            <button
              type="button"
              className="pb-btn"
              onClick={() => setConfirmingDelete(false)}
              disabled={saving}
            >
              Keep it
            </button>
            <button
              type="button"
              className="pb-btn pb-btn--danger"
              onClick={remove}
              disabled={saving}
            >
              {saving ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }
      >
        <p className="pb-detail-title">{todo.content}</p>
        <p className="pb-detail-meta">
          {repeats
            ? 'This removes it, and every time it repeats, for good.'
            : 'This removes it for good. If you did it, tick it off instead.'}
        </p>
        {error && <p className="pb-sheet-error">{error}</p>}
      </PersonalSheet>
    );
  }

  return (
    <PersonalSheet
      title={editing ? 'Edit to-do' : 'Add to-do'}
      resetMs={resetMs}
      onClose={onClose}
      // Delete isn't a second way to finish — the keyboard's Done key still is
      // the only commit — so this footer doesn't break the one-commit rule.
      footer={
        editing ? (
          <button
            type="button"
            className="pb-btn pb-btn--danger-ghost pb-btn--left"
            onClick={() => {
              setError(null);
              setConfirmingDelete(true);
            }}
          >
            Delete
          </button>
        ) : undefined
      }
    >
      <KeyboardField value={content} placeholder="What do you need to do?" label="To-do" />

      {repeats ? (
        <p className="pb-detail-meta">
          Repeats{todo?.due_string ? ` ${todo.due_string}` : ''}. Change when in Todoist.
        </p>
      ) : (
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
      )}

      {error && <p className="pb-sheet-error">{error}</p>}

      {/* "Adding…" rather than "…": Todoist's create round trip can take a few
          seconds, and a button that turns into an ellipsis reads as a stall. */}
      <OnScreenKeyboard
        value={content}
        onChange={setContent}
        onDone={save}
        doneLabel={editing ? (saving ? 'Saving…' : 'Save') : saving ? 'Adding…' : 'Add'}
        doneDisabled={content.trim() === '' || saving}
      />
    </PersonalSheet>
  );
}
