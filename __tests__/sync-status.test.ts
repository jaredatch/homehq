import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, _setDefaultDb } from '@/lib/db';
import { updateSyncStatus, getSyncStatus } from '@/lib/db/sync-status';
import type Database from 'better-sqlite3';

describe('sync status queries', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'homehq-sync-'));
    db = getDb(join(tmpDir, 'test.db'));
    _setDefaultDb(db);
  });

  afterEach(() => {
    _setDefaultDb(null);
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads pre-populated sync status', () => {
    const status = getSyncStatus('calendar');
    expect(status).not.toBeNull();
    expect(status!.sync_type).toBe('calendar');
    expect(status!.last_success).toBeNull();
  });

  it('records a successful sync', () => {
    updateSyncStatus('calendar', true);
    const status = getSyncStatus('calendar');
    expect(status!.last_success).not.toBeNull();
    expect(status!.last_error).toBeNull();
  });

  it('records a failed sync with error message', () => {
    updateSyncStatus('calendar', false, 'Token expired');
    const status = getSyncStatus('calendar');
    expect(status!.last_error).toBe('Token expired');
    expect(status!.last_attempt).not.toBeNull();
  });

  it('clears error on subsequent success', () => {
    updateSyncStatus('calendar', false, 'Network error');
    updateSyncStatus('calendar', true);
    const status = getSyncStatus('calendar');
    expect(status!.last_error).toBeNull();
    expect(status!.last_success).not.toBeNull();
  });

  it('stores timestamps as ISO 8601 UTC so browsers parse them correctly', () => {
    updateSyncStatus('calendar', true);
    const status = getSyncStatus('calendar');
    // Must include the trailing Z — SQLite's datetime('now') format gets
    // misparsed as local time by JS Date.
    expect(status!.last_success).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('records a partial success: data updated AND error noted', () => {
    updateSyncStatus('calendar', true, 'Partial sync — Mom: 404');
    const status = getSyncStatus('calendar');
    expect(status!.last_success).not.toBeNull();
    expect(status!.last_error).toBe('Partial sync — Mom: 404');
  });
});
