import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, _setDefaultDb } from '@/lib/db';
import { getToken, saveToken } from '@/lib/db/tokens';
import type Database from 'better-sqlite3';

describe('token queries', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'homehq-tokens-'));
    db = getDb(join(tmpDir, 'test.db'));
    _setDefaultDb(db);
  });

  afterEach(() => {
    _setDefaultDb(null);
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for missing provider', () => {
    expect(getToken('google')).toBeNull();
  });

  it('saves and retrieves a token', () => {
    saveToken('google', 'access_123', 'refresh_456', 1700000000);
    const token = getToken('google');
    expect(token).not.toBeNull();
    expect(token!.access_token).toBe('access_123');
    expect(token!.refresh_token).toBe('refresh_456');
    expect(token!.expires_at).toBe(1700000000);
  });

  it('updates access token while preserving refresh token', () => {
    saveToken('google', 'access_1', 'refresh_1', 1700000000);
    saveToken('google', 'access_2', null, 1700001000);
    const token = getToken('google');
    expect(token!.access_token).toBe('access_2');
    expect(token!.refresh_token).toBe('refresh_1');
    expect(token!.expires_at).toBe(1700001000);
  });

  it('replaces refresh token when a new one is provided', () => {
    saveToken('google', 'access_1', 'refresh_1', 1700000000);
    saveToken('google', 'access_2', 'refresh_2', 1700001000);
    const token = getToken('google');
    expect(token!.refresh_token).toBe('refresh_2');
  });
});
