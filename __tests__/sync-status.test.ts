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
});
