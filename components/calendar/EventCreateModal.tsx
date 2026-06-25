'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nextHourRange } from './calendar-utils';

interface CalendarOption {
  id: string;
  name: string;
  color: string;
  textColor?: string;
}

interface EventCreateModalProps {
  calendars: CalendarOption[];
  /** IANA zone the event's times are entered in (the display zone). */
  timezone?: string;
  /** Default date (YYYY-MM-DD) — today in the display zone. */
  defaultDate: string;
  /** Inactivity auto-close (ms). 0 disables. */
  resetMs: number;
  onClose: () => void;
  /** Called after a confirmed create so the grid refetches and shows it. */
  onCreated: () => void;
}

export default function EventCreateModal({
  calendars,
  timezone,
  defaultDate,
  resetMs,
  onClose,
  onCreated,
}: EventCreateModalProps) {
  const defaultTimes = useMemo(() => nextHourRange(timezone), [timezone]);

  const [title, setTitle] = useState('');
  const [calendarId, setCalendarId] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState(defaultTimes.start);
  const [endTime, setEndTime] = useState(defaultTimes.end);
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleRef = useRef<HTMLInputElement>(null);

  // Title + calendar are required (no default calendar — must be chosen). Timed
  // events also need an end after the start.
  const timesValid = allDay || (!!startTime && !!endTime && endTime > startTime);
  const canSubmit =
    title.trim() !== '' && calendarId !== '' && date !== '' && timesValid && !submitting;

  // Inactivity auto-close — mirrors the expand auto-revert. The wall never
  // sleeps, so an abandoned half-filled form must not stick; any interaction
  // (typing, field changes, keys) restarts the clock.
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

  // Autofocus the title on open (we have a real keyboard at the wall).
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Esc closes from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/calendar/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calendarId,
          title: title.trim(),
          allDay,
          date,
          startTime: allDay ? undefined : startTime,
          endTime: allDay ? undefined : endTime,
          location: location.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Couldn’t add event (${res.status})`);
        setSubmitting(false);
        return;
      }
      // Confirmed by Google + written to the cache — refetch so it appears.
      onCreated();
      onClose();
    } catch {
      setError('Couldn’t reach the server — try again');
      setSubmitting(false);
    }
  }, [
    canSubmit,
    calendarId,
    title,
    allDay,
    date,
    startTime,
    endTime,
    location,
    notes,
    onCreated,
    onClose,
  ]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    resetTimer();
    // Enter submits — except inside the notes textarea, where it's a newline.
    if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="cal-modal-backdrop"
      onMouseDown={(e) => {
        // Close only when the press starts on the backdrop itself — not on a
        // text selection that happens to release out here.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="cal-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Add event"
        onKeyDown={onKeyDown}
        onChange={resetTimer}
      >
        <div className="cal-modal-header">
          <h2 className="cal-modal-title">Add event</h2>
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

          <label className="cal-field">
            <span className="cal-field-label">Calendar</span>
            <select
              className="cal-select"
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
            >
              <option value="" disabled>
                Select calendar…
              </option>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <div className="cal-field-row">
            <label className="cal-field cal-field--date">
              <span className="cal-field-label">Date</span>
              <input
                className="cal-input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            {!allDay && (
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

          <label className="cal-checkbox">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
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
          <button type="button" className="cal-btn cal-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="cal-btn cal-btn--primary"
            onClick={submit}
            disabled={!canSubmit}
          >
            {submitting ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
