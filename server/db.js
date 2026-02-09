const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'signal-monitor.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    -- Servers table
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      username TEXT DEFAULT 'admin',
      password TEXT DEFAULT '',
      type TEXT DEFAULT 'flussonic',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Channel status tracking
    CREATE TABLE IF NOT EXISTS channel_status (
      channel_id TEXT NOT NULL,
      server_id TEXT DEFAULT 'default',
      status TEXT NOT NULL DEFAULT 'unknown',
      online_since TEXT,
      offline_since TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (channel_id, server_id)
    );

    -- Outage events
    CREATE TABLE IF NOT EXISTS channel_outage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      channel_name TEXT,
      server_id TEXT DEFAULT 'default',
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_seconds INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Notification destinations
    CREATE TABLE IF NOT EXISTS notification_destinations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Message templates
    CREATE TABLE IF NOT EXISTS message_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL DEFAULT 'global',
      scope_id TEXT,
      template TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(scope, scope_id)
    );

    -- Settings KV store
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Ignored channels
    CREATE TABLE IF NOT EXISTS ignored_channels (
      channel_id TEXT PRIMARY KEY
    );
  `);

  // Insert default server if none exists
  const count = db.prepare('SELECT COUNT(*) as c FROM servers').get();
  if (count.c === 0) {
    db.prepare(`INSERT INTO servers (id, name, base_url, username, password) VALUES (?, ?, ?, ?, ?)`)
      .run('default', 'Servidor Principal', 'http://157.254.55.203:8089', 'admin', '');
  }
}

module.exports = { getDb };
