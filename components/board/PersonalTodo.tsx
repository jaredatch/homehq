'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatEventTime } from '@/components/calendar/calendar-utils';
import { groupTodos, todoMeta, type Todo } from './todo-utils';
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

/** How long a checked-off task stays on screen, struck through, with an undo.
 * Long enough for a mis-tap to be caught; short enough that the list settles. */
const UNDO_WINDOW_MS = 5000;

/**
 * Column 2 — "Todo". Todoist tasks for this board's project, in five sections:
 * Past Due · Today · Tomorrow · Later · Anytime.
 *
 * Reads only the SQLite cache through /api/todos; the sync loop is the only
 * thing that talks to Todoist on a schedule (CLAUDE.md rule 3). Writes go out
 * through /api/todos/complete, which also drops the row from the cache so the
 * tap sticks instead of flickering back on the next poll.
 */
export default function PersonalTodo({
  projectId,
  timezone,
  today,
  formResetMs,
}: PersonalTodoProps) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** Tasks checked off but still on screen inside their undo window. */
  const [completing, setCompleting] = useState<Todo[]>([]);
  const [adding, setAdding] = useState(false);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const fetchTodos = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/todos?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setTodos(data.todos);
      setSyncError(data.sync?.lastError ?? null);
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

  // Clear any pending undo windows if the column unmounts.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    };
  }, []);

  const complete = useCallback(async (todo: Todo) => {
    // Optimistic: the row leaves the list and reappears struck through, so the
    // tap registers instantly on a panel that may be waiting on the network.
    setTodos((current) => current.filter((t) => t.id !== todo.id));
    setCompleting((current) => [...current, todo]);

    const timer = setTimeout(() => {
      setCompleting((current) => current.filter((t) => t.id !== todo.id));
      timers.current.delete(todo.id);
    }, UNDO_WINDOW_MS);
    timers.current.set(todo.id, timer);

    try {
      const res = await fetch('/api/todos/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: todo.id }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      // Put it back rather than let a failed write look like success.
      clearTimeout(timer);
      timers.current.delete(todo.id);
      setCompleting((current) => current.filter((t) => t.id !== todo.id));
      setTodos((current) => (current.some((t) => t.id === todo.id) ? current : [...current, todo]));
    }
  }, []);

  const undo = useCallback(
    async (todo: Todo) => {
      const timer = timers.current.get(todo.id);
      if (timer) clearTimeout(timer);
      timers.current.delete(todo.id);
      setCompleting((current) => current.filter((t) => t.id !== todo.id));
      setTodos((current) => (current.some((t) => t.id === todo.id) ? current : [...current, todo]));

      try {
        await fetch('/api/todos/reopen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: todo.id }),
        });
      } finally {
        // Either way, let the server's own view win.
        fetchTodos();
      }
    },
    [fetchTodos]
  );

  const sections = useMemo(() => groupTodos(todos, today), [todos, today]);
  const formatTime = useCallback((iso: string) => formatEventTime(iso, timezone), [timezone]);

  const row = (todo: Todo, done: boolean) => {
    const meta = todoMeta(todo, formatTime);
    return (
      <li className={`pb-todo${done ? ' pb-todo--done' : ''}`} key={todo.id}>
        <button
          type="button"
          className="pb-todo-main"
          onClick={() => !done && complete(todo)}
          aria-label={done ? `${todo.content}, done` : `Complete ${todo.content}`}
        >
          <span className="pb-todo-box" data-priority={todo.priority} aria-hidden>
            {done ? '✓' : ''}
          </span>
          <span className="pb-todo-body">
            <span className="pb-todo-content">{todo.content}</span>
            {meta && <span className="pb-todo-meta">{meta}</span>}
          </span>
        </button>
        {done && (
          <button type="button" className="pb-todo-undo" onClick={() => undo(todo)}>
            Undo
          </button>
        )}
      </li>
    );
  };

  return (
    <section className="pb-col pb-col--todo">
      <header className="pb-col-head">
        <h2 className="pb-col-title">Todo</h2>
      </header>

      <div className="pb-col-body">
        {!projectId ? (
          <p className="pb-todo-placeholder">No Todoist project set for this board.</p>
        ) : (
          <>
            {/* A dead to-do sync must be visible. The wall learned this the hard
                way: a silently failing sync hid behind stale data for weeks. */}
            {syncError && <p className="pb-todo-error">To-dos aren’t syncing right now.</p>}

            {completing.map((todo) => (
              <ul className="pb-todos pb-todos--done" key={`done-${todo.id}`}>
                {row(todo, true)}
              </ul>
            ))}

            {sections.map((section) => (
              <section className="pb-todo-group" key={section.key}>
                <h3
                  className={`pb-todo-label${section.key === 'pastDue' ? ' pb-todo-label--late' : ''}`}
                >
                  {section.label}
                </h3>
                <ul className="pb-todos">{section.todos.map((todo) => row(todo, false))}</ul>
              </section>
            ))}

            {loaded && sections.length === 0 && completing.length === 0 && (
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
          onAdded={fetchTodos}
        />
      )}
    </section>
  );
}
