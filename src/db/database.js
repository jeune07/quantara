// Single SQLite connection, opened lazily.
//
// Path is fixed to data/quantara.db at the project root — overridable with
// QUANTARA_DB env var for tests. Schema is created idempotently on first
// connect; existing databases are left alone.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'quantara.db');

let db = null;

function getDb() {
  if (db) return db;
  const dbPath = process.env.QUANTARA_DB || DEFAULT_DB_PATH;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

function initSchema(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS extractions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url      TEXT NOT NULL,
      sku             TEXT,
      title           TEXT,
      price_amount    REAL,
      price_currency  TEXT,
      price_raw       TEXT,
      availability    TEXT,
      extraction_mode TEXT,
      product_json    TEXT NOT NULL,
      extracted_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_extractions_url
      ON extractions(source_url, extracted_at DESC);
  `);
}

// Used by tests to reset between runs. Not called from normal code paths.
function _close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, _close };
