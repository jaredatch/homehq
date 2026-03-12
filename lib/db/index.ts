import Database from 'better-sqlite3';
import { resolve } from 'path';
import { runMigrations } from './migrate';

const DEFAULT_DB_PATH = resolve(process.cwd(), 'data/homehq.db');

let db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  const path = dbPath ?? DEFAULT_DB_PATH;
  const isDefault = !dbPath;

  if (isDefault && db) {
    return db;
  }

  const instance = new Database(path);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');

  runMigrations(instance);

  if (isDefault) {
    db = instance;
  }

  return instance;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Inject a DB instance as the default singleton. Test use only. */
export function _setDefaultDb(instance: Database.Database | null): void {
  db = instance;
}
