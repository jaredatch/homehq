-- Completed to-dos stay on the board until the day rolls over.
--
-- 004 said "one row per ACTIVE task ... which is exactly the behaviour the
-- board wants, and why there is no completed flag to filter on here." Watching
-- it in use said otherwise: checking something off made it jump to a holding
-- area at the top of the column and then vanish a few seconds later, so the
-- reward for doing a thing was the list rearranging itself and the evidence
-- disappearing. A checked task now stays where it was, at the bottom of its own
-- section, struck through, and tapping it again reopens it.
--
-- completed_on is the LOCAL calendar day (YYYY-MM-DD in display.timezone) the
-- task was checked off on -- not an instant. The purge is then a plain string
-- compare against the same `today` the board groups by, with no timezone maths
-- on the read path and no chance of the two disagreeing about which day it is.
-- NULL means open, which is every existing row.
ALTER TABLE todos ADD COLUMN completed_on TEXT;

-- The purge sweeps by this column on every read, so it is worth an index even
-- on a family-sized list -- it is the only query that isn't already covered.
CREATE INDEX IF NOT EXISTS idx_todos_completed ON todos(completed_on);
