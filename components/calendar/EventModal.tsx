'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, formatEventTimeRange, nextHourRange, zonedParts } from './calendar-utils';
import { MAX_GROUP_CALENDARS } from '@/lib/calendar/event-groups';

interface CalendarOption {
  id: string;
  name: string;
  color: string;
  textColor?: string;
}

/** The fields of a cached event the edit form needs. */
export interface EditableEvent {
  event_id: string;
  calendar_id: string;
  summary: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  all_day: number;
  recurring_event_id: string | null;
  group_id: string | null;
}

interface EventModalProps {
  /** "create" = blank form; "edit" = pre-filled from `event` with Save + Delete. */
  mode: 'create' | 'edit';
  /** Required in edit mode — the event being changed. */
  event?: EditableEvent;
  /** Edit mode: every calendar this event currently lives on (one for an
   * ordinary event, more for a shared one). Seeds the picker. */
  groupCalendarIds?: string[];
  calendars: CalendarOption[];
  /** IANA zone the times are entered/read in (the display zone). */
  timezone?: string;
  /** Default date (YYYY-MM-DD) for a new event — today in the display zone. */
  defaultDate: string;
  /** Inactivity auto-close (ms). 0 disables. */
  resetMs: number;
  onClose: () => void;
  /** Called after a confirmed create/update/delete so the grid refetches. */
  onSaved: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Date (YYYY-MM-DD) + HH:mm of an event's start/end in the display zone, so the
 * form shows the same wall-clock the grid does. All-day rows store a bare date. */
function initialValues(
  event: EditableEvent | undefined,
  groupCalendarIds: string[] | undefined,
  timezone: string | undefined,
  defaultDate: string
) {
  const fallback = nextHourRange(timezone);
  if (!event) {
    return {
      title: '',
      calendarIds: [] as string[],
      allDay: false,
      date: defaultDate,
      endDate: defaultDate,
      startTime: fallback.start,
      endTime: fallback.end,
      location: '',
      notes: '',
    };
  }
  const allDay = !!event.all_day;
  let date: string;
  let endDate: string;
  let startTime = fallback.start;
  let endTime = fallback.end;
  if (allDay) {
    date = event.start_time.slice(0, 10);
    // Stored end is EXCLUSIVE (Google's all-day convention), so the last day the
    // event actually covers — the one to show the user — is the day before.
    endDate = addDays(event.end_time.slice(0, 10), -1);
    if (endDate < date) endDate = date;
  } else {
    const s = zonedParts(new Date(event.start_time), timezone);
    const e = zonedParts(new Date(event.end_time), timezone);
    date = `${s.year}-${pad(s.month)}-${pad(s.day)}`;
    endDate = date;
    startTime = `${pad(s.hours)}:${pad(s.minutes)}`;
    endTime = `${pad(e.hours)}:${pad(e.minutes)}`;
  }
  return {
    title: event.summary,
    calendarIds: groupCalendarIds?.length ? groupCalendarIds : [event.calendar_id],
    allDay,
    date,
    endDate,
    startTime,
    endTime,
    location: event.location ?? '',
    notes: event.description ?? '',
  };
}

/** Human "when" line for the delete confirmation. */
function whenLabel(event: EditableEvent, timezone: string | undefined): string {
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(event.all_day ? `${event.start_time}T00:00:00` : event.start_time));
  if (event.all_day) return `${dateLabel} · All day`;
  return `${dateLabel}, ${formatEventTimeRange(event.start_time, event.end_time, timezone)}`;
}

export default function EventModal({
  mode,
  event,
  groupCalendarIds,
  calendars,
  timezone,
  defaultDate,
  resetMs,
  onClose,
  onSaved,
}: EventModalProps) {
  // groupCalendarIds is read once to seed the form; the modal is keyed per event
  // at the call site, so a different event remounts rather than re-deriving.
  const seedIds = groupCalendarIds?.join(',');
  const init = useMemo(
    () => initialValues(event, seedIds ? seedIds.split(',') : undefined, timezone, defaultDate),
    [event, seedIds, timezone, defaultDate]
  );

  const isEdit = mode === 'edit';
  const isRecurring = isEdit && !!event?.recurring_event_id;

  const [title, setTitle] = useState(init.title);
  const [calendarIds, setCalendarIds] = useState<string[]>(init.calendarIds);
  const [allDay, setAllDay] = useState(init.allDay);
  const [date, setDate] = useState(init.date);
  const [endDate, setEndDate] = useState(init.endDate);
  const [startTime, setStartTime] = useState(init.startTime);
  const [endTime, setEndTime] = useState(init.endTime);
  const [location, setLocation] = useState(init.location);
  const [notes, setNotes] = useState(init.notes);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleRef = useRef<HTMLInputElement>(null);

  // Title is required, and at least one calendar must be chosen — there's no
  // default, so an event can never silently land on the wrong person. Timed
  // events need an end after the start.
  const timesValid = allDay || (!!startTime && !!endTime && endTime > startTime);
  // End date is inclusive, so a one-day event has endDate === date.
  const datesValid = !allDay || (!!endDate && endDate >= date);
  const canSubmit =
    title.trim() !== '' &&
    calendarIds.length > 0 &&
    date !== '' &&
    datesValid &&
    timesValid &&
    !submitting;

  /**
   * One rule covers every case: **if the end matches the start, the end follows
   * the start; otherwise the two edges are independent.**
   *
   *  - New event — end starts equal to start, so it tracks. Touch the end and
   *    they differ, so it stops. ("Same as start unless you change it.")
   *  - Editing a single-day event — equal, so it tracks. Moving the date moves
   *    the event, which is what you almost always mean.
   *  - Editing a multi-day event — unequal, so changing either edge just makes
   *    the event longer or shorter. Nothing you didn't touch moves.
   *
   * Read live off the current values rather than remembered from open, so
   * stretching a single-day event to three days immediately stops the pinning
   * instead of collapsing the span you just set.
   */
  const changeStartDate = (next: string) => {
    if (allDay && endDate === date) setEndDate(next);
    setDate(next);
  };

  // Checking a second calendar makes this one event that applies to two people.
  // Capped while the two-color treatment is still being designed; unchecking is
  // always allowed, so the cap can never trap you.
  const toggleCalendar = (id: string) =>
    setCalendarIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= MAX_GROUP_CALENDARS
          ? prev
          : [...prev, id]
    );

  // What the event is actually on right now (not the pending selection) — the
  // delete confirmation has to describe what will really be removed.
  const savedNames = init.calendarIds
    .map((id) => calendars.find((c) => c.id === id)?.name)
    .filter(Boolean)
    .join(' and ');

  // Inactivity auto-close — the wall never sleeps, so an abandoned form must not
  // stick; any interaction restarts the clock.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimer = useCallback(() => {
    if (resetMs <= 0) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => closeRef.current(), resetMs);
  }, [resetMs]);

  useEffect(() => {
    resetTimer();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resetTimer]);

  // Autofocus the title on open (we have a real keyboard at the wall) — but not
  // when showing the recurring notice, which has no title field.
  useEffect(() => {
    if (!isRecurring) titleRef.current?.focus();
  }, [isRecurring]);

  // Esc closes from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const payload = {
      calendarIds,
      title: title.trim(),
      allDay,
      date,
      // Inclusive last day; the route converts to Google's exclusive end.
      endDate: allDay ? endDate : undefined,
      startTime: allDay ? undefined : startTime,
      endTime: allDay ? undefined : endTime,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      // Edit also sends the scalar anchor: it's the (eventId, calendarId) key the
      // route looks the event up by, independent of the membership being saved.
      ...(isEdit && event ? { eventId: event.event_id, calendarId: event.calendar_id } : {}),
    };
    try {
      const res = await fetch(isEdit ? '/api/calendar/update' : '/api/calendar/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Couldn’t save (${res.status})`);
        setSubmitting(false);
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError('Couldn’t reach the server — try again');
      setSubmitting(false);
    }
  }, [
    canSubmit,
    calendarIds,
    title,
    allDay,
    date,
    endDate,
    startTime,
    endTime,
    location,
    notes,
    isEdit,
    event,
    onSaved,
    onClose,
  ]);

  const remove = useCallback(async () => {
    if (!event) return;
    setDeleting(true);
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
        setDeleting(false);
        setConfirmingDelete(false);
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError('Couldn’t reach the server — try again');
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }, [event, onSaved, onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    resetTimer();
    // Enter submits the form — except inside the notes textarea (newline) and
    // never while the delete confirmation is up.
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !confirmingDelete &&
      (e.target as HTMLElement).tagName !== 'TEXTAREA'
    ) {
      e.preventDefault();
      save();
    }
  };

  const heading = isRecurring ? 'Repeating event' : isEdit ? 'Edit event' : 'Add event';

  return (
    <div
      className="cal-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="cal-modal"
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        onKeyDown={onKeyDown}
        onChange={resetTimer}
      >
        <div className="cal-modal-header">
          <h2 className="cal-modal-title">{heading}</h2>
          <button
            type="button"
            className="cal-modal-close"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        {isRecurring ? (
          // Recurring occurrences are blocked for now — the cache has no series
          // link, so editing one safely isn't supported. Point at Google.
          <>
            <div className="cal-modal-body">
              <p className="cal-modal-notice">
                ↻ This is a repeating event. Editing or deleting repeats isn’t supported here yet —
                change it in Google Calendar.
              </p>
            </div>
            <div className="cal-modal-footer">
              <button type="button" className="cal-btn cal-btn--primary" onClick={onClose}>
                OK
              </button>
            </div>
          </>
        ) : confirmingDelete && event ? (
          // Named confirm step — shows exactly what's being removed before it's gone.
          <>
            <div className="cal-modal-body">
              <p className="cal-confirm-lead">Delete this event?</p>
              <p className="cal-confirm-title">“{event.summary || '(No title)'}”</p>
              <p className="cal-confirm-when">{whenLabel(event, timezone)}</p>
              {init.calendarIds.length > 1 && (
                // Delete removes the whole shared event. Dropping one person is
                // an edit — uncheck them and save.
                <p className="cal-confirm-note">
                  Removes it from {savedNames}. To drop just one, cancel and uncheck them instead.
                </p>
              )}
              {error && <p className="cal-modal-error">{error}</p>}
            </div>
            <div className="cal-modal-footer">
              <button
                type="button"
                className="cal-btn cal-btn--ghost"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cal-btn cal-btn--danger"
                onClick={remove}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete event'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="cal-modal-body">
              <label className="cal-field">
                <span className="cal-field-label">Title</span>
                <input
                  ref={titleRef}
                  className="cal-input"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What’s happening?"
                />
              </label>

              <div className="cal-field">
                <span className="cal-field-label" id="cal-calendars-label">
                  Calendars{' '}
                  <span className="cal-field-opt">(pick up to {MAX_GROUP_CALENDARS})</span>
                </span>
                <div className="cal-calpick" role="group" aria-labelledby="cal-calendars-label">
                  {calendars.map((c) => {
                    const checked = calendarIds.includes(c.id);
                    // At the cap, the unchosen ones grey out — unchecking one
                    // frees a slot, so this can never be a dead end.
                    const atCap = !checked && calendarIds.length >= MAX_GROUP_CALENDARS;
                    return (
                      <label
                        key={c.id}
                        className={`cal-calpick-option${atCap ? ' is-disabled' : ''}${
                          checked ? ' is-checked' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={atCap}
                          onChange={() => toggleCalendar(c.id)}
                        />
                        <span className="cal-calpick-dot" style={{ backgroundColor: c.color }} />
                        <span className="cal-calpick-name">{c.name}</span>
                      </label>
                    );
                  })}
                </div>
                {calendarIds.length > 1 && (
                  <p className="cal-calpick-note">
                    Goes on both calendars as one event — the board shows it once.
                  </p>
                )}
              </div>

              {/* ONE row in both modes: all-day swaps the two time fields for the
                  end date rather than adding a row below. Toggling "All day" then
                  costs no height, so the modal doesn't jump under the cursor. */}
              <div className="cal-field-row">
                <label className="cal-field cal-field--date">
                  <span className="cal-field-label">{allDay ? 'Starts' : 'Date'}</span>
                  <input
                    className="cal-input"
                    type="date"
                    value={date}
                    onChange={(e) => changeStartDate(e.target.value)}
                  />
                </label>
                {allDay ? (
                  // Timed events stay same-day on purpose: the grid renders an
                  // event crossing midnight only on its start day.
                  <label className="cal-field cal-field--date">
                    <span className="cal-field-label">Ends</span>
                    <input
                      className="cal-input"
                      type="date"
                      value={endDate}
                      min={date}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </label>
                ) : (
                  <>
                    <label className="cal-field cal-field--time">
                      <span className="cal-field-label">Start</span>
                      <input
                        className="cal-input"
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                      />
                    </label>
                    <label className="cal-field cal-field--time">
                      <span className="cal-field-label">End</span>
                      <input
                        className="cal-input"
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                      />
                    </label>
                  </>
                )}
              </div>

              {allDay && !datesValid && (
                <p className="cal-modal-error">The end date must be on or after the start date.</p>
              )}

              <label className="cal-checkbox">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => {
                    // Turning all-day ON adopts the start date as a single day;
                    // the follow rule takes it from there.
                    if (e.target.checked) setEndDate(date);
                    setAllDay(e.target.checked);
                  }}
                />
                <span>All day</span>
              </label>

              <label className="cal-field">
                <span className="cal-field-label">
                  Location <span className="cal-field-opt">(optional)</span>
                </span>
                <input
                  className="cal-input"
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </label>

              <label className="cal-field">
                <span className="cal-field-label">
                  Notes <span className="cal-field-opt">(optional)</span>
                </span>
                <textarea
                  className="cal-textarea"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>

              {error && <p className="cal-modal-error">{error}</p>}
            </div>

            <div className="cal-modal-footer">
              {isEdit && (
                <button
                  type="button"
                  className="cal-btn cal-btn--danger-ghost cal-btn--left"
                  onClick={() => {
                    setError(null);
                    setConfirmingDelete(true);
                  }}
                >
                  Delete
                </button>
              )}
              <button type="button" className="cal-btn cal-btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="cal-btn cal-btn--primary"
                onClick={save}
                disabled={!canSubmit}
              >
                {submitting ? (isEdit ? 'Saving…' : 'Adding…') : isEdit ? 'Save' : 'Add'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
