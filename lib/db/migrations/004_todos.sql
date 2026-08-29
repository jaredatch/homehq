-- Todoist to-dos, cached the same way calendar events are: a scheduler pulls
-- them into SQLite and the board reads only from here, so a personal board
-- renders instantly, survives a Todoist outage, and never talks to an external
-- API on render (CLAUDE.md rule 3).
--
-- One row per ACTIVE task. Todoist's task list endpoint returns only active
-- tasks, so completing one makes it disappear on the next sync -- which is
-- exactly the behaviour the board wants, and why there is no completed flag to
-- filter on here.
--
-- Like calendar_events, the sync does DELETE ... WHERE project_id = ? then
-- reinserts, so `id` is Todoist's own task id and nothing local is keyed to a
-- row's lifetime.
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  description TEXT,
  -- Due date as YYYY-MM-DD in the task's own local sense. Todoist gives an
  -- all-day task a plain date and a timed one a datetime; both are kept, and
  -- the date is what the board groups by (Past Due / Today / Tomorrow / Later).
  -- NULL = an undated task, which lands in "Anytime".
  due_date TEXT,
  -- ISO 8601 instant for a task due at a specific time, else NULL.
  due_datetime TEXT,
  -- Todoist's human phrasing ("every school day"). Display only.
  due_string TEXT,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  -- Todoist priority, 1 (normal) to 4 (urgent). Note their API numbers this the
  -- opposite way round from the p1-p4 shown in their UI.
  priority INTEGER NOT NULL DEFAULT 1,
  -- Sub-tasks carry their parent's id; the board only draws top-level tasks.
  parent_id TEXT,
  child_order INTEGER NOT NULL DEFAULT 0,
  labels TEXT NOT NULL DEFAULT '[]',
  -- ISO 8601 UTC with a trailing Z, never SQLite's datetime('now'), which omits
  -- the zone marker and makes a browser read it as local time.
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_todos_project ON todos(project_id);
CREATE INDEX IF NOT EXISTS idx_todos_due ON todos(due_date);

INSERT OR IGNORE INTO sync_status (sync_type) VALUES ('todos');
