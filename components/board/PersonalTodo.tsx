'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatEventTime } from '@/components/calendar/calendar-utils';
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
  /** How long the Add form stays open untouched before it closes itself (ms). */
  formResetMs: number;
}

const POLL_INTERVAL_MS = 60_000;

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
 */
export default function PersonalTodo({
  projectId,
  timezone,
  today,
  formResetMs,
}: PersonalTodoProps) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [syncBroken, setSyncBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  /** Rows with a write in flight, so a double-tap can't fire twice. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);
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

  const addedTodo = useCallback(
    async (id: string) => {
      await fetchTodos();
      if (id) setLanded(id);
    },
    [fetchTodos]
  );

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
          onClick={() => toggle(todo)}
          aria-pressed={done}
          aria-label={done ? `${todo.content}, done — tap to undo` : `Complete ${todo.content}`}
        >
          <span className="pb-todo-box" data-priority={todo.priority} aria-hidden>
            {done ? '✓' : ''}
          </span>
          <span className="pb-todo-body">
            <span className="pb-todo-content">{todo.content}</span>
            {meta && <span className="pb-todo-meta">{meta}</span>}
          </span>
        </button>
      </li>
    );
  };

  return (
    <section className="pb-col pb-col--todo">
      <header className="pb-col-head">
        <h2 className="pb-col-title">Todo</h2>
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
          onClick={() => setAdding(true)}
          disabled={!projectId}
        >
          Add Todo
        </button>
      </footer>

      {adding && projectId && (
        <PersonalTodoSheet
          projectId={projectId}
          today={today}
          resetMs={formResetMs}
          onClose={() => setAdding(false)}
          onAdded={addedTodo}
        />
      )}
    </section>
  );
}
