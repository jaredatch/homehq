import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, _setDefaultDb } from '@/lib/db';
import type Database from 'better-sqlite3';

describe('database', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'homehq-db-'));
    db = getDb(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the database file', () => {
    expect(db.open).toBe(true);
  });

  it('refuses to open the default (real) database under Vitest', () => {
    // Regression guard: test fixtures once overwrote the live Google refresh
    // token because the default DB path was reachable from tests.
    _setDefaultDb(null);
    expect(() => getDb()).toThrow('Refusing to open the default database');
  });

  it('enables WAL mode', () => {
    const result = db.pragma('journal_mode') as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe('wal');
  });

  it('enables foreign keys', () => {
    const result = db.pragma('foreign_keys') as { foreign_keys: number }[];
    expect(result[0].foreign_keys).toBe(1);
  });

  it('creates all expected tables', () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name != 'sqlite_sequence'"
      )
      .all()
      .map((row) => (row as { name: string }).name)
      .sort();

    expect(tables).toEqual([
      'calendar_events',
      'oauth_tokens',
      'sync_status',
      'todos',
      'weather_cache',
    ]);
  });

  it('records migration in _migrations table', () => {
    const migrations = db
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((row) => (row as { name: string }).name);

    expect(migrations).toContain('001_initial_schema.sql');
  });

  it('pre-populates sync_status rows', () => {
    const rows = db
      .prepare('SELECT sync_type FROM sync_status ORDER BY sync_type')
      .all()
      .map((row) => (row as { sync_type: string }).sync_type);

    expect(rows).toEqual(['calendar', 'todos', 'weather']);
  });

  it('is idempotent on re-init', () => {
    // Opening a second connection to the same db should not fail
    const db2 = getDb(join(tmpDir, 'test.db'));
    const tables = db2
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name != 'sqlite_sequence'"
      )
      .all()
      .map((row) => (row as { name: string }).name)
      .sort();

    expect(tables).toEqual([
      'calendar_events',
      'oauth_tokens',
      'sync_status',
      'todos',
      'weather_cache',
    ]);
    db2.close();
  });

  it('enforces single-row constraint on weather_cache', () => {
    db.prepare(
      "INSERT INTO weather_cache (id, current_json, forecast_json) VALUES (1, '{}', '{}')"
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO weather_cache (id, current_json, forecast_json) VALUES (2, '{}', '{}')"
        )
        .run()
    ).toThrow();
  });
});
