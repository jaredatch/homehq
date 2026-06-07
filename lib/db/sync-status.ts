import { getDb } from './index';

interface SyncStatusRow {
  sync_type: string;
  last_success: string | null;
  last_attempt: string | null;
  last_error: string | null;
}

/**
 * Record a sync attempt.
 *
 * Timestamps are stored as ISO 8601 UTC (with the trailing `Z`) so the
 * browser parses them correctly — SQLite's `datetime('now')` emits UTC
 * without a zone marker, which JS Date treats as *local* time.
 *
 * `success` means data was updated this attempt. `error` may accompany a
 * success when the sync was partial (e.g. one of several calendars failed).
 */
export function updateSyncStatus(type: string, success: boolean, error?: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  if (success) {
    db.prepare(
      `UPDATE sync_status
       SET last_success = ?, last_attempt = ?, last_error = ?
       WHERE sync_type = ?`
    ).run(now, now, error ?? null, type);
  } else {
    db.prepare(
      `UPDATE sync_status
       SET last_attempt = ?, last_error = ?
       WHERE sync_type = ?`
    ).run(now, error ?? 'Unknown error', type);
  }
}

export function getSyncStatus(type: string): SyncStatusRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sync_status WHERE sync_type = ?').get(type) as
    | SyncStatusRow
    | undefined;
  return row ?? null;
}
