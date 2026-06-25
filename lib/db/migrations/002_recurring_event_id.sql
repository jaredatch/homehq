-- v1.1.x edit/delete: track whether a cached event is an occurrence of a
-- recurring series. The sync expands recurring events (singleEvents=true), so
-- each row is a single occurrence; recurring_event_id holds Google's series id
-- (NULL for one-off events). Used to block edit/delete on recurring occurrences
-- for now -- editing a series isn't supported yet. Existing rows are NULL until
-- the next sync (DELETE + reinsert) repopulates them.
ALTER TABLE calendar_events ADD COLUMN recurring_event_id TEXT;
