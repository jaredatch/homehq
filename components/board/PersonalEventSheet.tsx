'use client';

import { useMemo, useState } from 'react';
import {
  addDays,
  formatEventTimeRange,
  nextHourRange,
  zonedParts,
  type CalendarEvent,
  type WeekStart,
} from '@/components/calendar/calendar-utils';
import PersonalSheet from './PersonalSheet';
import OnScreenKeyboard, { KeyboardField } from './OnScreenKeyboard';
import DatePicker from './DatePicker';
import TimePicker from './TimePicker';
import { railStyle } from './PersonalEventRow';
import {
  carryEnd,
  formatClock12,
  formatDuration,
  formatPickedDate,
  toMinutes,
} from './picker-utils';
import type { EventTarget } from './personal-utils';

interface PersonalEventSheetProps {
  /** "create" and "edit" write; "detail" is the read-only card someone else's
   * event opens into (see `canEditEvent`). */
  mode: 'create' | 'edit' | 'detail';
  /** Required for edit and detail. */
  event?: CalendarEvent;
  /** "Just me / Family". One entry means this board has nowhere to publish to
   * and the choice isn't drawn at all. */
  targets: EventTarget[];
  /** Calendar id → display name, for the detail card's calendar chips. */
  calendarNames: Map<string, string>;
  /** Calendar id → colour, so the read-only card carries the same rail and dots
   * the agenda row it was opened from does. */
  calendarColors: Map<string, string>;
  /** False on a read-only deployment. Only changes what the detail card says
   * about WHY it's read-only — the routes refuse the write either way. */
  writeEnabled: boolean;
  timezone?: string;
  /** Today in the board's zone — the date a new event opens on. */
  today: string;
  /** Which column the date picker's weeks start in, same as the grids. */
  weekStartsOn: WeekStart;
  resetMs: number;
  onClose: () => void;
  /** Called after Google confirms, so the agenda refetches. */
  onSaved: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Which face of the sheet is showing. The form is home; every other screen is
 * one field, drawn big, that hands back to the form when it's done. */
type Screen = 'form' | 'title' | 'date' | 'endDate' | 'start' | 'end';

/**
 * One form field as a button: the label and the value inside one box, the
 * shape the title row already had. Tapping it opens that field's own screen —
 * the keyboard, the date grid, or the time grid — because nothing on this board
 * is ever a focused input (CLAUDE.md rule 12).
 */
function FieldButton({
  label,
  value,
  placeholder,
  invalid,
  on,
  onClick,
}: {
  label: string;
  value: string;
  placeholder?: string;
  invalid?: boolean;
  /** The one being edited, on a screen that shows more than one. */
  on?: boolean;
  onClick: () => void;
}) {
  const valueClass = !value
    ? ' pb-fieldbtn-value--empty'
    : invalid
      ? ' pb-fieldbtn-value--error'
      : '';
  return (
    <button
      type="button"
      className={`pb-fieldbtn${on ? ' pb-fieldbtn--on' : ''}`}
      onClick={onClick}
      aria-pressed={on}
    >
      <span className="pb-field-label">{label}</span>
      <span className={`pb-fieldbtn-value${valueClass}`}>{value || placeholder}</span>
    </button>
  );
}

/** "Sat, Aug 30 · 4:00 – 5:00 PM" — the detail card's one-line when. */
function whenLabel(event: CalendarEvent, timezone: string | undefined): string {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: event.all_day ? 'UTC' : timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(event.all_day ? `${event.start_time}T00:00:00Z` : event.start_time));
  if (!event.all_day) {
    return `${day} · ${formatEventTimeRange(event.start_time, event.end_time, timezone)}`;
  }
  // Stored all-day ends are EXCLUSIVE (Google's convention); the last day it
  // actually covers is the day before.
  const last = addDays(event.end_time.slice(0, 10), -1);
  if (last <= event.start_time.slice(0, 10)) return `${day} · All day`;
  const lastDay = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${last}T00:00:00Z`));
  return `${day} – ${lastDay} · All day`;
}

/** The form's starting values: a blank event on today, or the one being edited
 * rendered in the display zone so the fields show the same wall-clock the
 * agenda does. */
function initialValues(
  event: CalendarEvent | undefined,
  timezone: string | undefined,
  today: string
) {
  const fallback = nextHourRange(timezone);
  if (!event) {
    return {
      title: '',
      allDay: false,
      date: today,
      endDate: today,
      startTime: fallback.start,
      endTime: fallback.end,
    };
  }
  if (event.all_day) {
    const date = event.start_time.slice(0, 10);
    let endDate = addDays(event.end_time.slice(0, 10), -1);
    if (endDate < date) endDate = date;
    // All-day rows carry no clock values, so the fields behind the toggle open
    // on a sensible hour rather than midnight–midnight.
    return {
      title: event.summary,
      allDay: true,
      date,
      endDate,
      startTime: fallback.start,
      endTime: fallback.end,
    };
  }
  const s = zonedParts(new Date(event.start_time), timezone);
  const e = zonedParts(new Date(event.end_time), timezone);
  const date = `${s.year}-${pad(s.month)}-${pad(s.day)}`;
  return {
    title: event.summary,
    allDay: false,
    date,
    endDate: date,
    startTime: `${pad(s.hours)}:${pad(s.minutes)}`,
    endTime: `${pad(e.hours)}:${pad(e.minutes)}`,
  };
}

/**
 * Add / edit / view one event from a personal board.
 *
 * Deliberately NOT the wall's `EventModal`. That form is built for a keyboard
 * and a mouse at a 27" wall: six fields, a multi-calendar picker, a 27rem
 * column. This one is built for a finger and a drawn keyboard, and its whole
 * calendar story is one two-way choice — "Just me" (her room calendar, which
 * the wall never draws) or "Family" (her own calendar, which it does). Sharing
 * a component would have meant bending the wall's form around a second set of
 * constraints, which is exactly how the family board gets broken.
 *
 * Both write through the same routes, so the rules that matter — inclusive
 * all-day ends, shared-event linking, the write gate — stay in one place.
 */
export default function PersonalEventSheet({
  mode,
  event,
  targets,
  calendarNames,
  calendarColors,
  writeEnabled,
  timezone,
  today,
  weekStartsOn,
  resetMs,
  onClose,
  onSaved,
}: PersonalEventSheetProps) {
  const init = useMemo(() => initialValues(event, timezone, today), [event, timezone, today]);

  // Which calendars this event is on right now. A merged shared event carries
  // several; an ordinary one carries its own.
  const currentIds = event ? (event.groupCalendarIds ?? [event.calendar_id]) : [];

  // Retargeting is only offered when there's exactly one calendar to move —
  // a two-way toggle over a two-calendar event would silently drop one of them
  // on save, so those edit their fields and keep their membership.
  const retargetable =
    mode === 'create' ||
    (currentIds.length === 1 && targets.some((t) => t.calendarId === currentIds[0]));
  const showTargets = targets.length > 1 && retargetable && mode !== 'detail';

  const [title, setTitle] = useState(init.title);
  const [targetKey, setTargetKey] = useState(
    () => targets.find((t) => t.calendarId === currentIds[0])?.key ?? targets[0]?.key ?? 'justMe'
  );
  const [allDay, setAllDay] = useState(init.allDay);
  const [date, setDate] = useState(init.date);
  const [endDate, setEndDate] = useState(init.endDate);
  const [startTime, setStartTime] = useState(init.startTime);
  const [endTime, setEndTime] = useState(init.endTime);
  // A new event opens straight on the keyboard: the title is required and
  // empty, so the first thing to do is always the same thing.
  const [screen, setScreen] = useState<Screen>(mode === 'create' ? 'title' : 'form');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timesValid = allDay || (!!startTime && !!endTime && endTime > startTime);
  const datesValid = !allDay || (!!endDate && endDate >= date);
  const canSave = title.trim() !== '' && !!date && datesValid && timesValid && !busy;

  // Same rule the wall's form uses: the end follows the start while the two
  // match, and goes independent the moment they differ. A start picked past the
  // end pulls the end with it — the grid would otherwise hand back a range that
  // runs backwards, and the only way out would be a second trip to the grid.
  const changeStartDate = (next: string) => {
    if (allDay && (endDate === date || endDate < next)) setEndDate(next);
    setDate(next);
  };

  // Moving the start carries the end along, keeping the event's length.
  const changeStartTime = (next: string) => {
    setEndTime(carryEnd(startTime, next, endTime));
    setStartTime(next);
  };

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    const targetId = targets.find((t) => t.key === targetKey)?.calendarId;
    const payload: Record<string, unknown> = {
      title: title.trim(),
      allDay,
      date,
      endDate: allDay ? endDate : undefined,
      startTime: allDay ? undefined : startTime,
      endTime: allDay ? undefined : endTime,
    };
    if (mode === 'edit' && event) {
      payload.eventId = event.event_id;
      payload.calendarId = event.calendar_id;
      // Resent unchanged rather than omitted: the update route reads a missing
      // location or note as "clear it", so leaving them out would wipe details
      // this form never shows.
      payload.location = event.location ?? undefined;
      payload.notes = event.description ?? undefined;
      // Membership only travels when there IS a single calendar to move. Any
      // other body leaves the event on the calendars it's already on.
      if (showTargets && targetId) payload.calendarIds = [targetId];
    } else {
      payload.calendarIds = targetId ? [targetId] : [];
    }
    try {
      const res = await fetch(mode === 'edit' ? '/api/calendar/update' : '/api/calendar/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Couldn’t save (${res.status})`);
        setBusy(false);
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError('Couldn’t reach the server — try again.');
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!event) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/calendar/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.event_id, calendarId: event.calendar_id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Couldn’t delete (${res.status})`);
        setBusy(false);
        setConfirmingDelete(false);
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError('Couldn’t reach the server — try again.');
      setBusy(false);
      setConfirmingDelete(false);
    }
  };

  /* ---- Read-only card -------------------------------------------------- */

  if (mode === 'detail' && event) {
    const names = currentIds.map((id) => calendarNames.get(id)).filter(Boolean);
    const colors = currentIds.map((id) => calendarColors.get(id)).filter(Boolean) as string[];
    const reason = event.recurring_event_id
      ? 'This one repeats — change it in Google Calendar.'
      : !writeEnabled
        ? 'This board can only show the calendar, not change it.'
        : 'This isn’t your calendar, so it’s read-only here.';
    return (
      <PersonalSheet
        // The WHEN is the sheet's heading, because the event's own title is the
        // first line of the body and two headings that look alike, one of them
        // the generic word "Event", read as a bug. This card is now built like
        // the row that opened it: the day up top, then rail, title, details.
        title={whenLabel(event, timezone)}
        resetMs={resetMs}
        onClose={onClose}
        footer={
          <button type="button" className="pb-btn pb-btn--primary pb-btn--wide" onClick={onClose}>
            Close
          </button>
        }
      >
        <div className="pb-detail">
          {/* Same colour rail the agenda row carries, so the card reads as that
              row opened rather than as a different surface. */}
          <span
            className="pb-detail-rail"
            style={{ background: railStyle(colors.length ? colors : ['var(--gray-600)']) }}
            aria-hidden
          />
          <div className="pb-detail-body">
            <p className="pb-detail-title">{event.summary || '(No title)'}</p>
            {names.length > 0 && (
              <p className="pb-detail-who">
                {names.map((name, i) => (
                  <span className="pb-detail-cal" key={name}>
                    <span
                      className="pb-detail-dot"
                      style={{ backgroundColor: colors[i] ?? 'var(--gray-600)' }}
                      aria-hidden
                    />
                    {name}
                  </span>
                ))}
              </p>
            )}
            {event.location && (
              <p className="pb-detail-line">
                <span className="pb-detail-label">Where</span>
                {event.location}
              </p>
            )}
            {event.description && <p className="pb-detail-notes">{event.description}</p>}
          </div>
        </div>
        {/* Says WHY it can't be changed here rather than leaving a card that
            looks like it's missing its buttons — and says the true reason: a
            read-only install would otherwise claim her own event isn't hers. */}
        <p className="pb-detail-meta">{reason}</p>
      </PersonalSheet>
    );
  }

  const formTitle = mode === 'edit' ? 'Edit event' : 'Add event';

  /* ---- Typing the title ------------------------------------------------ */

  if (screen === 'title') {
    return (
      <PersonalSheet title={formTitle} resetMs={resetMs} onClose={onClose}>
        <KeyboardField value={title} placeholder="What’s happening?" label="Event title" />
        <OnScreenKeyboard
          value={title}
          onChange={setTitle}
          onDone={() => setScreen('form')}
          doneLabel="Next"
          doneDisabled={title.trim() === ''}
        />
      </PersonalSheet>
    );
  }

  /* ---- Picking a day --------------------------------------------------- */

  if (screen === 'date' || screen === 'endDate') {
    const isEnd = screen === 'endDate';
    return (
      <PersonalSheet
        title={isEnd ? 'End date' : allDay ? 'Start date' : 'Date'}
        resetMs={resetMs}
        onClose={onClose}
        footer={
          <button type="button" className="pb-btn" onClick={() => setScreen('form')}>
            Back
          </button>
        }
      >
        <DatePicker
          value={isEnd ? endDate : date}
          today={today}
          weekStartsOn={weekStartsOn}
          // An all-day event can't end before it starts, so those days don't
          // offer themselves. The start has no floor: an edit may be in the past.
          min={isEnd ? date : undefined}
          onPick={(picked) => {
            if (isEnd) setEndDate(picked);
            else changeStartDate(picked);
            setScreen('form');
          }}
        />
      </PersonalSheet>
    );
  }

  /* ---- Picking a time --------------------------------------------------- */

  if (screen === 'start' || screen === 'end') {
    const isEnd = screen === 'end';
    const length = toMinutes(endTime) - toMinutes(startTime);
    return (
      <PersonalSheet
        title="Time"
        resetMs={resetMs}
        onClose={onClose}
        footer={
          <button
            type="button"
            className="pb-btn pb-btn--primary"
            onClick={() => setScreen('form')}
          >
            Done
          </button>
        }
      >
        {/* Start and End side by side, one of them lit: both are one tap away,
            and moving the start visibly moves the end with it. */}
        <div className="pb-field-row pb-tp-readouts">
          <FieldButton
            label="Starts"
            value={formatClock12(startTime)}
            on={!isEnd}
            onClick={() => setScreen('start')}
          />
          <FieldButton
            label={length > 0 ? `Ends · ${formatDuration(length)}` : 'Ends'}
            value={formatClock12(endTime)}
            invalid={!timesValid}
            on={isEnd}
            onClick={() => setScreen('end')}
          />
        </div>
        <TimePicker
          value={isEnd ? endTime : startTime}
          onChange={isEnd ? setEndTime : changeStartTime}
        />
        {!timesValid && <p className="pb-sheet-error">The end time has to be after the start.</p>}
      </PersonalSheet>
    );
  }

  /* ---- Delete confirmation --------------------------------------------- */

  if (confirmingDelete && event) {
    return (
      <PersonalSheet
        title="Delete event"
        resetMs={resetMs}
        onClose={onClose}
        footer={
          <>
            <button
              type="button"
              className="pb-btn"
              onClick={() => setConfirmingDelete(false)}
              disabled={busy}
            >
              Keep it
            </button>
            <button
              type="button"
              className="pb-btn pb-btn--danger"
              onClick={remove}
              disabled={busy}
            >
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }
      >
        <p className="pb-detail-title">{event.summary || '(No title)'}</p>
        <p className="pb-detail-when">{whenLabel(event, timezone)}</p>
        <p className="pb-detail-meta">This removes it from your calendar for good.</p>
        {error && <p className="pb-sheet-error">{error}</p>}
      </PersonalSheet>
    );
  }

  /* ---- The form -------------------------------------------------------- */

  return (
    <PersonalSheet
      title={formTitle}
      resetMs={resetMs}
      onClose={onClose}
      footer={
        <>
          {mode === 'edit' && (
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
          )}
          <button type="button" className="pb-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="pb-btn pb-btn--primary"
            onClick={save}
            disabled={!canSave}
          >
            {busy ? 'Saving…' : mode === 'edit' ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      <FieldButton
        label="Title"
        value={title}
        placeholder="What’s happening?"
        onClick={() => setScreen('title')}
      />

      {showTargets && (
        <div className="pb-field">
          <span className="pb-field-label" id="pb-target-label">
            Who sees it
          </span>
          <div className="pb-seg" role="group" aria-labelledby="pb-target-label">
            {targets.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`pb-seg-btn${targetKey === t.key ? ' pb-seg-btn--on' : ''}`}
                onClick={() => setTargetKey(t.key)}
                aria-pressed={targetKey === t.key}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="pb-field-note">
            {targetKey === 'family' ? 'Shows up on the kitchen board too.' : 'Only on your board.'}
          </p>
        </div>
      )}

      {/* One row in both states: all-day swaps the two clocks for an end date
          rather than adding a row, so toggling it doesn't move the buttons. */}
      <div className="pb-field-row">
        <FieldButton
          label={allDay ? 'Starts' : 'Date'}
          value={formatPickedDate(date, today)}
          onClick={() => setScreen('date')}
        />
        {allDay ? (
          <FieldButton
            label="Ends"
            value={formatPickedDate(endDate, today)}
            invalid={!datesValid}
            onClick={() => setScreen('endDate')}
          />
        ) : (
          <>
            <FieldButton
              label="Start"
              value={formatClock12(startTime)}
              onClick={() => setScreen('start')}
            />
            <FieldButton
              label="End"
              value={formatClock12(endTime)}
              invalid={!timesValid}
              onClick={() => setScreen('end')}
            />
          </>
        )}
      </div>

      <button
        type="button"
        className={`pb-toggle${allDay ? ' pb-toggle--on' : ''}`}
        onClick={() => {
          // Turning it on adopts the start date as a single day; the follow
          // rule takes it from there.
          if (!allDay) setEndDate(date);
          setAllDay((v) => !v);
        }}
        aria-pressed={allDay}
      >
        <span className="pb-toggle-box" aria-hidden>
          {allDay ? '✓' : ''}
        </span>
        <span>All day</span>
      </button>

      {allDay && !datesValid && (
        <p className="pb-sheet-error">The end date has to be on or after the start.</p>
      )}
      {!allDay && !timesValid && (
        <p className="pb-sheet-error">The end time has to be after the start.</p>
      )}
      {error && <p className="pb-sheet-error">{error}</p>}
    </PersonalSheet>
  );
}
