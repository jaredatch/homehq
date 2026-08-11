-- v1.3 shared events: link the per-calendar copies of one logical event.
-- An event that applies to two people (e.g. "No school" for Maddie AND Eleanor)
-- is stored as one REAL Google event per calendar, each stamped with the same
-- group_id in extendedProperties.private. That keeps the data honest in every
-- Google client while letting HomeHQ merge the copies into a single chip on the
-- board. NULL for ordinary single-calendar events (the overwhelming majority).
--
-- Why a column on each row rather than one row spanning calendars: the sync does
-- DELETE ... WHERE calendar_id = ? then reinserts, once per calendar, every 5
-- minutes -- any row whose identity spanned calendars would be shredded. Each row
-- still belongs to exactly one calendar; the stamp just rides along, re-derived
-- from Google on every sync. Existing rows are NULL until that sync repopulates.
ALTER TABLE calendar_events ADD COLUMN group_id TEXT;

-- Write fan-out looks siblings up by group (edit/delete touch every copy).
CREATE INDEX IF NOT EXISTS idx_calendar_events_group ON calendar_events(group_id);
