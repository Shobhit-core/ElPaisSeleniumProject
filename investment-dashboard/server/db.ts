// SQLite persistence (Node's built-in node:sqlite — no native build step).
// A single-user personal app does not need a database server; the file is easy to back up.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS transactions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     date TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('BUY','SELL','DIVIDEND')),
     symbol TEXT NOT NULL, name TEXT NOT NULL, asset_class TEXT NOT NULL, sector TEXT,
     quantity REAL NOT NULL, price REAL NOT NULL,
     brokerage REAL NOT NULL DEFAULT 0, stt REAL NOT NULL DEFAULT 0, other_charges REAL NOT NULL DEFAULT 0,
     rationale TEXT, exit_rationale TEXT, lessons TEXT,
     source TEXT NOT NULL DEFAULT 'manual', external_id TEXT UNIQUE, created_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS idx_txn_symbol ON transactions(symbol, date);
   CREATE TABLE IF NOT EXISTS cash_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, amount REAL NOT NULL, note TEXT, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS instruments (
     symbol TEXT PRIMARY KEY, name TEXT NOT NULL, isin TEXT, instrument_key TEXT, exchange TEXT,
     kind TEXT NOT NULL, amfi_code TEXT, updated_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS idx_instr_name ON instruments(name);
   CREATE TABLE IF NOT EXISTS quotes (symbol TEXT PRIMARY KEY, price REAL NOT NULL, prev_close REAL, as_of TEXT NOT NULL, source TEXT NOT NULL, fetched_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS candles (symbol TEXT NOT NULL, date TEXT NOT NULL, open REAL, high REAL, low REAL, close REAL NOT NULL, volume REAL, PRIMARY KEY (symbol, date));
   CREATE TABLE IF NOT EXISTS mf_navs (scheme_code TEXT PRIMARY KEY, isin TEXT, isin_reinv TEXT, name TEXT NOT NULL, nav REAL NOT NULL, nav_date TEXT NOT NULL, category TEXT, amc TEXT);
   CREATE INDEX IF NOT EXISTS idx_mf_name ON mf_navs(name);
   CREATE TABLE IF NOT EXISTS research_notes (symbol TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS alerts (
     id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, severity TEXT NOT NULL, symbol TEXT,
     title TEXT NOT NULL, why TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, read_at TEXT);
   CREATE TABLE IF NOT EXISTS snapshots (date TEXT PRIMARY KEY, invested REAL NOT NULL, value REAL NOT NULL, cash REAL NOT NULL);
   CREATE TABLE IF NOT EXISTS broker_tokens (provider TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, expires_at TEXT NOT NULL, user_label TEXT, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS analyst_log (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, answer TEXT NOT NULL, sources TEXT NOT NULL, mode TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS feed_cache (feed TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at TEXT NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS reviews (
     id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('sale','holding','decision')),
     review_date TEXT NOT NULL, thesis_correct TEXT NOT NULL CHECK (thesis_correct IN ('yes','partly','no','too_early')),
     disciplined TEXT NOT NULL CHECK (disciplined IN ('yes','partly','no')), outcome TEXT, lesson TEXT, created_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS idx_reviews_symbol ON reviews(symbol, review_date);`,
];

export type DB = DatabaseSync;

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  let v = row?.version ?? 0;
  if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  for (; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.prepare("UPDATE schema_version SET version = ?").run(v + 1);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return db;
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function getSetting<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(db: DB, key: string, value: unknown): void {
  db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, JSON.stringify(value), new Date().toISOString());
}

/** Consistent online backup using VACUUM INTO. Returns the backup file path. */
export function backupDb(db: DB, dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `portfolio-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  db.prepare("VACUUM INTO ?").run(file);
  return file;
}
