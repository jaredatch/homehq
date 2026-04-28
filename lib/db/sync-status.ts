import { getDb } from './index';

interface SyncStatusRow {
  sync_type: string;
  last_success: string | null;
  last_attempt: string | null;
  last_error: string | null;
}

export function updateSyncStatus(type: string, success: boolean, error?: string): void {
  const db = getDb();
  if (success) {
    db.prepare(
      `UPDATE sync_status
       SET last_success = datetime('now'), last_attempt = datetime('now'), last_error = NULL
       WHERE sync_type = ?`
    ).run(type);
  } else {
    db.prepare(
      `UPDATE sync_status
       SET last_attempt = datetime('now'), last_error = ?
       WHERE sync_type = ?`
    ).run(error ?? 'Unknown error', type);
  }
}

export function getSyncStatus(type: string): SyncStatusRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sync_status WHERE sync_type = ?').get(type) as
    | SyncStatusRow
    | undefined;
  return row ?? null;
}
