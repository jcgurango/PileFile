import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Db } from './db.ts'
import type { UserInfo } from '../../shared/protocol.ts'

const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000 // 60 days, sliding
const SCRYPT_N = 16384
const KEY_LEN = 64

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N })
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${key.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, saltB64, keyB64] = stored.split('$')
  if (scheme !== 'scrypt') return false
  const expected = Buffer.from(keyB64, 'base64')
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n) })
  return timingSafeEqual(actual, expected)
}

// ----------------------------------------------------------------- users

export function createUser(db: Db, name: string, password: string): UserInfo {
  const id = randomUUID()
  db.prepare('INSERT INTO users (id, name, pass_hash, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    name,
    hashPassword(password),
    Date.now(),
  )
  return { id, name }
}

export function setPassword(db: Db, name: string, password: string): boolean {
  const res = db.prepare('UPDATE users SET pass_hash = ? WHERE name = ?').run(hashPassword(password), name)
  if (res.changes > 0) {
    // New password invalidates existing sessions.
    db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE name = ?)').run(name)
  }
  return res.changes > 0
}

export function deleteUser(db: Db, name: string): boolean {
  return db.prepare('DELETE FROM users WHERE name = ?').run(name).changes > 0
}

export function listUsers(db: Db): Array<UserInfo & { createdAt: number }> {
  return (db.prepare('SELECT id, name, created_at FROM users ORDER BY name').all() as Array<Record<string, unknown>>).map(
    (r) => ({ id: r.id as string, name: r.name as string, createdAt: r.created_at as number }),
  )
}

export function authenticate(db: Db, name: string, password: string): UserInfo | null {
  const row = db.prepare('SELECT id, name, pass_hash FROM users WHERE name = ?').get(name) as
    | { id: string; name: string; pass_hash: string }
    | undefined
  if (!row || !verifyPassword(password, row.pass_hash)) return null
  return { id: row.id, name: row.name }
}

// -------------------------------------------------------------- sessions

export function createSession(db: Db, userId: string): string {
  const id = randomBytes(32).toString('base64url')
  const now = Date.now()
  db.prepare(
    'INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, userId, now, now, now + SESSION_TTL_MS)
  return id
}

export function sessionUser(db: Db, sessionId: string | undefined): UserInfo | null {
  if (!sessionId) return null
  const now = Date.now()
  const row = db
    .prepare(
      `SELECT s.id AS sid, s.expires_at, u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sessionId, now) as { sid: string; expires_at: number; id: string; name: string } | undefined
  if (!row) return null
  // Slide the expiry at most once an hour to keep writes low.
  if (row.expires_at - now < SESSION_TTL_MS - 60 * 60 * 1000) {
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(now, now + SESSION_TTL_MS, row.sid)
  }
  return { id: row.id, name: row.name }
}

export function destroySession(db: Db, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
}
