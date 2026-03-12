-- OAuth tokens (one row per provider)
CREATE TABLE IF NOT EXISTS oauth_tokens (
  provider TEXT NOT NULL UNIQUE,
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cached calendar events
CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  description TEXT,
  location TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id, calendar_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_time);
CREATE INDEX IF NOT EXISTS idx_calendar_events_calendar ON calendar_events(calendar_id);

-- Weather cache (single-row table)
CREATE TABLE IF NOT EXISTS weather_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_json TEXT NOT NULL DEFAULT '{}',
  forecast_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sync status tracking
CREATE TABLE IF NOT EXISTS sync_status (
  sync_type TEXT PRIMARY KEY,
  last_success TEXT,
  last_attempt TEXT,
  last_error TEXT
);

INSERT OR IGNORE INTO sync_status (sync_type) VALUES ('calendar');
INSERT OR IGNORE INTO sync_status (sync_type) VALUES ('weather');
