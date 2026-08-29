import { addDays } from '@/components/calendar/calendar-utils';

/**
 * Pure helpers behind the personal board's Todo column — which section a task
 * lands in and what order tasks come in. Kept out of the component so the rules
 * are unit-testable, the same way `personal-utils` backs the agenda.
 *
 * The shape mirrors the `todos` table, which the API sends straight through
 * (snake_case), exactly as calendar events do.
 */
export interface Todo {
  id: string;
  project_id: string;
  content: string;
  description: string | null;
  due_date: string | null;
  due_datetime: string | null;
  due_string: string | null;
  is_recurring: number;
  priority: number;
  parent_id: string | null;
  child_order: number;
  labels: string;
}

export type TodoSectionKey = 'pastDue' | 'today' | 'tomorrow' | 'later' | 'anytime';

export interface TodoSection {
  key: TodoSectionKey;
  label: string;
  todos: Todo[];
}

const LABELS: Record<TodoSectionKey, string> = {
  pastDue: 'Past Due',
  today: 'Today',
  tomorrow: 'Tomorrow',
  later: 'Later',
  anytime: 'Anytime',
};

/** Section ordering is the reading order: what's late, then what's now. */
const ORDER: TodoSectionKey[] = ['pastDue', 'today', 'tomorrow', 'later', 'anytime'];

export function sectionFor(todo: Todo, today: string): TodoSectionKey {
  if (!todo.due_date) return 'anytime';
  if (todo.due_date < today) return 'pastDue';
  if (todo.due_date === today) return 'today';
  if (todo.due_date === addDays(today, 1)) return 'tomorrow';
  return 'later';
}

/**
 * Dated sections read oldest-first, so the most overdue thing is the first
 * thing seen and "Later" builds toward the horizon. Within one day, an earlier
 * time comes first, then higher priority, then Todoist's own manual order —
 * which is the order she arranged them in, and the last word when nothing else
 * separates two tasks.
 */
function compare(a: Todo, b: Todo): number {
  const byDate = (a.due_date ?? '').localeCompare(b.due_date ?? '');
  if (byDate !== 0) return byDate;
  // A task with a clock time comes first: "4pm dentist" is a commitment that
  // shapes the day, while "practice piano" is just sometime today. Comparing
  // the raw strings would do the opposite, since "" sorts before any timestamp.
  if (!a.due_datetime !== !b.due_datetime) return a.due_datetime ? -1 : 1;
  const byTime = (a.due_datetime ?? '').localeCompare(b.due_datetime ?? '');
  if (byTime !== 0) return byTime;
  if (a.priority !== b.priority) return b.priority - a.priority; // 4 = urgent
  return a.child_order - b.child_order;
}

/**
 * Group tasks into the board's five sections.
 *
 * Five, not the wireframe's three: everything in the project has to reach the
 * board. An undated task is the common case in Todoist, and a to-do that exists
 * but is invisible is worse than having no list at all.
 *
 * Empty sections are dropped — five headings over an empty column reads as
 * broken, and a kid with nothing due should see a short list, not a form.
 */
export function groupTodos(todos: Todo[], today: string): TodoSection[] {
  const buckets = new Map<TodoSectionKey, Todo[]>(ORDER.map((k) => [k, []]));
  for (const todo of todos) {
    // Sub-tasks are Todoist structure, not a line on her list. The sync already
    // filters them; this is belt and braces for a cache written before it did.
    if (todo.parent_id) continue;
    buckets.get(sectionFor(todo, today))!.push(todo);
  }

  const sections: TodoSection[] = [];
  for (const key of ORDER) {
    const list = buckets.get(key)!;
    if (list.length === 0) continue;
    // "Anytime" has no dates to sort by, so it keeps Todoist's manual order.
    sections.push({
      key,
      label: LABELS[key],
      todos:
        key === 'anytime' ? list.sort((a, b) => a.child_order - b.child_order) : list.sort(compare),
    });
  }
  return sections;
}

/**
 * The trailing note on a row: the due time when there is one, plus a marker for
 * a repeating task so checking it off doesn't look like deleting it.
 */
export function todoMeta(todo: Todo, formatTime: (iso: string) => string): string {
  const parts: string[] = [];
  if (todo.due_datetime) parts.push(formatTime(todo.due_datetime));
  if (todo.is_recurring) parts.push('repeats');
  return parts.join(' · ');
}
