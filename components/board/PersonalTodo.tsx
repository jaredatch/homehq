'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatEventTime, type WeekStart } from '@/components/calendar/calendar-utils';
import { groupTodos, isTodoSyncBroken, todoMeta, type Todo } from './todo-utils';
import PersonalTodoSheet from './PersonalTodoSheet';

interface PersonalTodoProps {
  /** Todoist project this board is bound to, or null when it has no to-dos. */
  projectId: string | null;
  timezone?: string;
  /** Today as YYYY-MM-DD in the board's zone — the pivot every section is
   * measured against. Comes from the shell so the column can't disagree with
   * the agenda about what day it is. */
  today: string;
  /** Which column the due-date picker's weeks start in, same as the grids. */
  weekStartsOn: WeekStart;
  /** How long the Add form stays open untouched before it closes itself (ms). */
  formResetMs: number;
  /** How long "tap a to-do to edit" waits for a pick before it gives up (ms).
   * 0 disables. */
  editResetMs: number;
}

const POLL_INTERVAL_MS = 60_000;

/** Font Awesome's `pen` (free solid), inlined for the same reason the home
 * button's house is: fixed chrome, not a configurable title icon. */
const PEN_PATH =
  'M362.7 19.3L314.3 67.7 444.3 197.7l48.4-48.4c25-25 25-65.5 0-90.5L453.3 19.3c-25-25-65.5-25-90.5 0zm-71 71L58.6 323.5c-10.4 10.4-18 23.3-22.2 37.4L1 481.2C-1.5 489.7 .8 498.8 7 505s15.3 8.5 23.7 6.1l120.3-35.4c14.1-4.2 27-11.8 37.4-22.2L421.7 220.3 291.7 90.3z';

/**
 * Column 2 — "Todo". Todoist tasks for this board's project, in five sections:
 * Past Due · Today · Tomorrow · Later · Anytime.
 *
 * Reads only the SQLite cache through /api/todos; the sync loop is the only
 * thing that talks to Todoist on a schedule (CLAUDE.md rule 3). Writes go out
 * through /api/todos/complete, which marks the cache row done so the tap sticks
 * instead of flickering back on the next poll.
 *
 * A checked task stays where it was — same section, bottom of the list, struck
 * through — until the day rolls over, and tapping it again reopens it. The
 * earlier design moved it to a holding area at the top and deleted it after five
 * seconds, so the reward for doing something was the list rearranging itself and
 * then losing the evidence.
 *
 * Editing is a mode, not a button on every row. A row's tap is "done", and
 * fixing a typo is rare, so a per-row Edit spent space on every line for
 * something almost never used. Instead the footer's **Edit** arms the column:
 * the next task tapped opens in the edit form rather than being checked off.
 * It is one-shot — the form closing puts the column back — and it gives up on
 * its own after `editResetMs` idle, so a board left armed can't turn a kid's
 * next tick into a form. While armed, every checkbox becomes a pen, so a tap
 * can't look like it will tick anything.
 */
export default function PersonalTodo({
  projectId,
  timezone,
  today,
  weekStartsOn,
  formResetMs,
  editResetMs,
}: PersonalTodoProps) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [syncBroken, setSyncBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  /** Rows with a write in flight, so a double-tap can't fire twice. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);
  /** Edit is armed: the next task tapped opens for editing. */
  const [choosing, setChoosing] = useState(false);
  /** The task picked while armed, while its sheet is open. */
  const [editing, setEditing] = useState<Todo | null>(null);
  /** A task just added, to be scrolled to once it lands in the list. */
  const [landed, setLanded] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const fetchTodos = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/todos?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setTodos(data.todos);
      // Failing AND stale, not merely failing: a single bad tick is noise.
      setSyncBroken(isTodoSyncBroken(data.sync?.lastError, data.sync?.lastSuccess));
      setLoaded(true);
    } catch {
      // Keep what's on screen — a network blip must never blank the list.
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    // Deferred so no setState is reachable synchronously from the effect body
    // (react-hooks/set-state-in-effect), matching the other pollers.
    const initial = setTimeout(fetchTodos, 0);
    const interval = setInterval(fetchTodos, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [projectId, fetchTodos]);

  /**
   * Tick a task off, or put it back.
   *
   * Optimistic in place: the row keeps its position and just changes state, so
   * nothing under a finger moves. A failed write rolls the row back rather than
   * letting it sit there looking done.
   */
  const toggle = useCallback(
    async (todo: Todo) => {
      if (busy.has(todo.id)) return;
      const done = !!todo.completed_on;
      const next = done ? null : today;

      setBusy((current) => new Set(current).add(todo.id));
      setTodos((current) =>
        current.map((t) => (t.id === todo.id ? { ...t, completed_on: next } : t))
      );

      try {
        const res = await fetch(done ? '/api/todos/reopen' : '/api/todos/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: todo.id }),
        });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        // Put it back rather than let a failed write look like success.
        setTodos((current) =>
          current.map((t) => (t.id === todo.id ? { ...t, completed_on: todo.completed_on } : t))
        );
      } finally {
        setBusy((current) => {
          const nextBusy = new Set(current);
          nextBusy.delete(todo.id);
          return nextBusy;
        });
      }
    },
    [busy, today]
  );

  /**
   * Bring a just-added task into view.
   *
   * This is what pays for "no due date" being the default: an undated task lands
   * in "Anytime", the LAST section, which on a full column is below the fold —
   * and a to-do that appears to vanish reads as the button not working. The
   * highlight fades on its own, so nothing here survives idle (rule 1).
   */
  useEffect(() => {
    if (!landed) return;
    const row = bodyRef.current?.querySelector(`[data-todo-id="${CSS.escape(landed)}"]`);
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [landed, todos]);

  // Expiry is its OWN effect, keyed on `landed` alone. Folded into the one
  // above it restarted on every list change — checking a task off re-armed the
  // highlight on a row added minutes earlier, and it never went out.
  useEffect(() => {
    if (!landed) return;
    const timer = setTimeout(() => setLanded(null), 2000);
    return () => clearTimeout(timer);
  }, [landed]);

  const savedTodo = useCallback(
    async (id: string) => {
      await fetchTodos();
      if (id) setLanded(id);
    },
    [fetchTodos]
  );

  // Armed edit mode gives up after idle (rule 1). Any touch in the column —
  // scrolling to find the task, say — restarts the clock.
  const chooseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armChooseTimer = useCallback(() => {
    if (chooseTimer.current) clearTimeout(chooseTimer.current);
    if (editResetMs > 0) chooseTimer.current = setTimeout(() => setChoosing(false), editResetMs);
  }, [editResetMs]);
  useEffect(() => {
    if (!choosing) return;
    armChooseTimer();
    return () => {
      if (chooseTimer.current) clearTimeout(chooseTimer.current);
    };
  }, [choosing, armChooseTimer]);

  const tapRow = (todo: Todo) => {
    if (!choosing) {
      toggle(todo);
      return;
    }
    // A ticked-off task has nothing left to fix; the tap does nothing rather
    // than quietly un-ticking it while she thinks she's editing.
    if (todo.completed_on) return;
    setChoosing(false);
    setEditing(todo);
  };

  const hasOpen = todos.some((t) => !t.completed_on && !t.parent_id);

  const sections = useMemo(() => groupTodos(todos, today), [todos, today]);
  const formatTime = useCallback((iso: string) => formatEventTime(iso, timezone), [timezone]);

  const row = (todo: Todo) => {
    const done = !!todo.completed_on;
    const meta = todoMeta(todo, formatTime);
    return (
      <li
        className={`pb-todo${done ? ' pb-todo--done' : ''}${todo.id === landed ? ' pb-todo--new' : ''}`}
        key={todo.id}
        data-todo-id={todo.id}
      >
        {/* Tapping a done row un-does it. Checking off has no confirmation, so
            the correction for a mis-tap has to be the same one tap back. */}
        <button
          type="button"
          className="pb-todo-main"
          onClick={() => tapRow(todo)}
          aria-pressed={choosing ? undefined : done}
          aria-label={
            choosing
              ? done
                ? `${todo.content}, done`
                : `Edit ${todo.content}`
              : done
                ? `${todo.content}, done — tap to undo`
                : `Complete ${todo.content}`
          }
        >
          {choosing && !done ? (
            <span className="pb-todo-box pb-todo-box--edit" aria-hidden>
              <svg viewBox="0 0 512 512" focusable="false">
                <path d={PEN_PATH} fill="currentColor" />
              </svg>
            </span>
          ) : (
            <span className="pb-todo-box" data-priority={todo.priority} aria-hidden>
              {done ? '✓' : ''}
            </span>
          )}
          <span className="pb-todo-body">
            <span className="pb-todo-content">{todo.content}</span>
            {meta && <span className="pb-todo-meta">{meta}</span>}
          </span>
        </button>
      </li>
    );
  };

  return (
    <section
      className={`pb-col pb-col--todo${choosing ? ' pb-col--choosing' : ''}`}
      onPointerDown={choosing ? armChooseTimer : undefined}
    >
      <header className="pb-col-head">
        <h2 className="pb-col-title">Todo</h2>
        {/* In the header, not above the list: a line pushed in on top would
            shift every row down just as she reaches for one. */}
        {choosing && <p className="pb-todo-hint">Tap a to-do to edit it</p>}
      </header>

      <div className="pb-col-body" ref={bodyRef}>
        {!projectId ? (
          <p className="pb-todo-placeholder">No Todoist project set for this board.</p>
        ) : (
          <>
            {/* A dead to-do sync must be visible. The wall learned this the hard
                way: a silently failing sync hid behind stale data for weeks. */}
            {syncBroken && <p className="pb-todo-error">To-dos aren’t syncing right now.</p>}

            {sections.map((section) => (
              <section className="pb-todo-group" key={section.key}>
                <h3
                  className={`pb-todo-label${section.key === 'pastDue' ? ' pb-todo-label--late' : ''}`}
                >
                  {section.label}
                </h3>
                <ul className="pb-todos">{section.todos.map(row)}</ul>
              </section>
            ))}

            {loaded && sections.length === 0 && (
              <p className="pb-todo-placeholder">Nothing on your list.</p>
            )}
          </>
        )}
      </div>

      <footer className="pb-col-foot">
        <button
          type="button"
          className="pb-action"
          onClick={() => {
            setChoosing(false);
            setAdding(true);
          }}
          disabled={!projectId}
        >
          Add
        </button>
        <span className="pb-action-sep">|</span>
        {/* Tapping it again while armed is the way back out. */}
        <button
          type="button"
          className={`pb-action${choosing ? ' pb-action--on' : ''}`}
          onClick={() => setChoosing((c) => !c)}
          aria-pressed={choosing}
          disabled={!projectId || !hasOpen}
        >
          Edit
        </button>
      </footer>

      {adding && projectId && (
        <PersonalTodoSheet
          projectId={projectId}
          today={today}
          weekStartsOn={weekStartsOn}
          resetMs={formResetMs}
          onClose={() => setAdding(false)}
          onSaved={savedTodo}
        />
      )}

      {editing && projectId && (
        <PersonalTodoSheet
          // Keyed so a second task's sheet never inherits the first's state.
          key={editing.id}
          projectId={projectId}
          todo={editing}
          today={today}
          weekStartsOn={weekStartsOn}
          resetMs={formResetMs}
          onClose={() => setEditing(null)}
          onSaved={savedTodo}
          onDeleted={fetchTodos}
        />
      )}
    </section>
  );
}
