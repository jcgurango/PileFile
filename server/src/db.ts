import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type Db = DatabaseSync

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    pass_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE streams (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    parent_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX streams_user ON streams(user_id);

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stream_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    text TEXT NOT NULL,
    reply_to_id TEXT,
    unread INTEGER NOT NULL DEFAULT 1,
    attachment_count INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER
  );
  CREATE INDEX messages_user ON messages(user_id);

  CREATE TABLE versions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX versions_message ON versions(message_id);
  CREATE INDEX versions_user ON versions(user_id);

  CREATE TABLE pins (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    pinned_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, stream_id)
  );
  CREATE INDEX pins_user ON pins(user_id);

  CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    ord INTEGER NOT NULL,
    uploaded INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER
  );
  CREATE INDEX attachments_message ON attachments(message_id);
  CREATE INDEX attachments_user ON attachments(user_id);

  CREATE TABLE changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE INDEX changes_user_seq ON changes(user_id, seq);

  CREATE TABLE applied_actions (
    action_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  `,
]

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  migrate(db)
  return db
}

function migrate(db: Db): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  let version = row.user_version
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[version])
      version++
      db.exec(`PRAGMA user_version = ${version}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

/** Runs `fn` inside a transaction, rolling back on throw. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
