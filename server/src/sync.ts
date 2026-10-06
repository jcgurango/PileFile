import type { Db } from './db.ts'
import { transaction } from './db.ts'
import type {
  Action,
  AttachmentRow,
  Change,
  ChangeBody,
  MessageRow,
  PinRow,
  StreamRow,
  SyncResponse,
  VersionRow,
  StreamViewMode,
} from '../../shared/protocol.ts'

const PAGE = 500

// ------------------------------------------------------------------ hub

/** In-process fan-out of "something changed" pokes to open SSE connections. */
export class Hub {
  private listeners = new Map<string, Set<(seq: number) => void>>()

  subscribe(userId: string, fn: (seq: number) => void): () => void {
    let set = this.listeners.get(userId)
    if (!set) {
      set = new Set()
      this.listeners.set(userId, set)
    }
    set.add(fn)
    return () => {
      set.delete(fn)
      if (set.size === 0) this.listeners.delete(userId)
    }
  }

  poke(userId: string, seq: number): void {
    for (const fn of this.listeners.get(userId) ?? []) fn(seq)
  }
}

// ------------------------------------------------------------ row mapping

type Row = Record<string, unknown>

const toStream = (r: Row): StreamRow => ({
  id: r.id as string,
  name: r.name as string,
  parentId: (r.parent_id as string | null) ?? null,
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
})

const toMessage = (r: Row, versionCount: number): MessageRow => ({
  id: r.id as string,
  streamId: (r.stream_id as string | null) ?? null,
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
  text: r.text as string,
  versionCount,
  replyToId: (r.reply_to_id as string | null) ?? null,
  unread: (r.unread as number) === 1 ? 1 : 0,
  attachmentCount: r.attachment_count as number,
})

const toVersion = (r: Row): VersionRow => ({
  id: r.id as string,
  messageId: r.message_id as string,
  text: r.text as string,
  createdAt: r.created_at as number,
})

const toPin = (r: Row): PinRow => ({
  messageId: r.message_id as string,
  streamId: r.stream_id as string,
  pinnedAt: r.pinned_at as number,
})

const toAttachment = (r: Row): AttachmentRow => ({
  id: r.id as string,
  messageId: r.message_id as string,
  name: r.name as string,
  type: r.type as string,
  size: r.size as number,
  createdAt: r.created_at as number,
  order: r.ord as number,
})

// -------------------------------------------------------------- queries

export function currentSeq(db: Db, userId: string): number {
  const r = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM changes WHERE user_id = ?').get(userId) as { seq: number }
  return r.seq
}

function liveStream(db: Db, userId: string, id: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM streams WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(id, userId))
}

function liveMessage(db: Db, userId: string, id: string): Row | undefined {
  return db
    .prepare('SELECT * FROM messages WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(id, userId) as Row | undefined
}

function versionCount(db: Db, messageId: string): number {
  const r = db.prepare('SELECT COUNT(*) AS n FROM versions WHERE message_id = ?').get(messageId) as { n: number }
  return r.n
}

function messageChange(db: Db, userId: string, id: string): ChangeBody[] {
  const row = liveMessage(db, userId, id)
  return row ? [{ op: 'message.put', data: toMessage(row, versionCount(db, id)) }] : []
}

/** Attachment ids whose files must be removed from disk once the transaction commits. */
export interface ApplyResult {
  seq: number
  removedAttachmentIds: string[]
}

// ---------------------------------------------------------------- apply

export function applyActions(db: Db, userId: string, actions: Action[]): ApplyResult {
  const removed: string[] = []
  const seq = transaction(db, () => {
    const now = Date.now()
    const isApplied = db.prepare('SELECT 1 FROM applied_actions WHERE action_id = ?')
    const markApplied = db.prepare('INSERT INTO applied_actions (action_id, user_id, at) VALUES (?, ?, ?)')
    const insertChange = db.prepare('INSERT INTO changes (user_id, payload, at) VALUES (?, ?, ?)')
    for (const action of actions) {
      if (isApplied.get(action.id)) continue
      markApplied.run(action.id, userId, now)
      const changes = applyOne(db, userId, action, removed)
      for (const c of changes) insertChange.run(userId, JSON.stringify(c), now)
    }
    return currentSeq(db, userId)
  })
  return { seq, removedAttachmentIds: removed }
}

function applyOne(db: Db, userId: string, a: Action, removed: string[]): ChangeBody[] {
  switch (a.type) {
    case 'stream.put': {
      const s = a.stream
      const existing = db.prepare('SELECT * FROM streams WHERE id = ? AND user_id = ?').get(s.id, userId) as Row | undefined
      if (existing?.deleted_at) return []
      if (!existing) {
        db.prepare(
          'INSERT INTO streams (id, user_id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(s.id, userId, s.name, s.parentId, s.createdAt, s.updatedAt)
      } else if (s.updatedAt >= (existing.updated_at as number)) {
        db.prepare('UPDATE streams SET name = ?, parent_id = ?, updated_at = ? WHERE id = ?').run(
          s.name,
          s.parentId,
          s.updatedAt,
          s.id,
        )
      } else {
        return []
      }
      const row = db.prepare('SELECT * FROM streams WHERE id = ?').get(s.id) as Row
      return [{ op: 'stream.put', data: toStream(row) }]
    }

    case 'stream.delete': {
      const res = db
        .prepare('UPDATE streams SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
        .run(a.at, a.streamId, userId)
      return res.changes ? [{ op: 'stream.delete', id: a.streamId }] : []
    }

    case 'message.create': {
      const m = a.message
      const exists = db.prepare('SELECT 1 FROM messages WHERE id = ?').get(m.id)
      if (exists) return []
      db.prepare(
        `INSERT INTO messages (id, user_id, stream_id, created_at, updated_at, text, reply_to_id, unread, attachment_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(m.id, userId, m.streamId, m.createdAt, m.updatedAt, m.text, m.replyToId, m.unread, a.attachments.length)
      const v = a.version
      db.prepare('INSERT OR IGNORE INTO versions (id, user_id, message_id, text, created_at) VALUES (?, ?, ?, ?, ?)').run(
        v.id,
        userId,
        m.id,
        v.text,
        v.createdAt,
      )
      const out: ChangeBody[] = [...messageChange(db, userId, m.id), { op: 'version.put', data: v }]
      for (const att of a.attachments) {
        db.prepare(
          `INSERT OR IGNORE INTO attachments (id, user_id, message_id, name, type, size, created_at, ord)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(att.id, userId, m.id, att.name, att.type, att.size, att.createdAt, att.order)
        out.push({ op: 'attachment.put', data: att })
      }
      return out
    }

    case 'message.edit': {
      const v = a.version
      const m = liveMessage(db, userId, v.messageId)
      if (!m) return []
      const inserted = db
        .prepare('INSERT OR IGNORE INTO versions (id, user_id, message_id, text, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(v.id, userId, v.messageId, v.text, v.createdAt)
      if (!inserted.changes) return []
      // Newest version by timestamp is the current text; an older concurrent edit is kept but not shown.
      if (v.createdAt >= (m.updated_at as number)) {
        db.prepare('UPDATE messages SET text = ?, updated_at = ? WHERE id = ?').run(v.text, v.createdAt, v.messageId)
      }
      return [{ op: 'version.put', data: v }, ...messageChange(db, userId, v.messageId)]
    }

    case 'message.move': {
      const res = db
        .prepare('UPDATE messages SET stream_id = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
        .run(a.streamId, a.messageId, userId)
      return res.changes ? messageChange(db, userId, a.messageId) : []
    }

    case 'message.read': {
      const res = db
        .prepare('UPDATE messages SET unread = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
        .run(a.unread, a.messageId, userId)
      return res.changes ? messageChange(db, userId, a.messageId) : []
    }

    case 'message.delete': {
      const id = a.messageId
      const res = db
        .prepare('UPDATE messages SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
        .run(a.at, id, userId)
      if (!res.changes) return []
      db.prepare('DELETE FROM pins WHERE message_id = ? AND user_id = ?').run(id, userId)
      const atts = db
        .prepare('SELECT id FROM attachments WHERE message_id = ? AND user_id = ? AND deleted_at IS NULL')
        .all(id, userId) as Array<{ id: string }>
      db.prepare('UPDATE attachments SET deleted_at = ? WHERE message_id = ? AND user_id = ?').run(a.at, id, userId)
      for (const att of atts) removed.push(att.id)
      return [{ op: 'message.delete', id }]
    }

    case 'pin.put': {
      const p = a.pin
      if (!liveMessage(db, userId, p.messageId)) return []
      db.prepare(
        `INSERT INTO pins (user_id, message_id, stream_id, pinned_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(message_id, stream_id) DO UPDATE SET pinned_at = excluded.pinned_at`,
      ).run(userId, p.messageId, p.streamId, p.pinnedAt)
      return [{ op: 'pin.put', data: p }]
    }

    case 'pin.remove': {
      const res = db
        .prepare('DELETE FROM pins WHERE message_id = ? AND stream_id = ? AND user_id = ?')
        .run(a.messageId, a.streamId, userId)
      return res.changes ? [{ op: 'pin.remove', messageId: a.messageId, streamId: a.streamId }] : []
    }

    // Pages and view choices belong to a stream; both are dropped by clients when the stream is deleted.
    case 'page.edit': {
      // An upsert: the editor rewrites the version it is typing into, and the newest timestamp wins.
      const v = a.version
      if (!liveStream(db, userId, v.streamId)) return []
      const res = db
        .prepare(
          `INSERT INTO page_versions (id, user_id, stream_id, text, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET text = excluded.text, created_at = excluded.created_at
           WHERE page_versions.user_id = excluded.user_id AND excluded.created_at >= page_versions.created_at`,
        )
        .run(v.id, userId, v.streamId, v.text, v.createdAt)
      return res.changes ? [{ op: 'page.put', data: v }] : []
    }

    case 'view.set': {
      const v = a.view
      if (!liveStream(db, userId, v.streamId)) return []
      const res = db
        .prepare(
          `INSERT INTO stream_views (user_id, stream_id, view, at) VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id, stream_id) DO UPDATE SET view = excluded.view, at = excluded.at WHERE excluded.at >= stream_views.at`,
        )
        .run(userId, v.streamId, v.view, v.at)
      return res.changes ? [{ op: 'view.put', data: v }] : []
    }

    case 'read.all': {
      db.prepare('UPDATE messages SET unread = 0 WHERE user_id = ? AND deleted_at IS NULL AND unread = 1').run(userId)
      return [{ op: 'read.all', at: a.at }]
    }

    default:
      return []
  }
}

// ----------------------------------------------------------------- pull

export function pull(db: Db, userId: string, since: number): SyncResponse {
  if (since <= 0) return snapshot(db, userId)
  const rows = db
    .prepare('SELECT seq, payload FROM changes WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?')
    .all(userId, since, PAGE + 1) as Array<{ seq: number; payload: string }>
  const more = rows.length > PAGE
  const page = more ? rows.slice(0, PAGE) : rows
  const changes: Change[] = page.map((r) => ({ ...(JSON.parse(r.payload) as ChangeBody), seq: r.seq }))
  return { changes, seq: page.length ? page[page.length - 1].seq : since, more }
}

/** Current state as a single batch of put-changes, for a client with no history. */
function snapshot(db: Db, userId: string): SyncResponse {
  const seq = currentSeq(db, userId)
  const changes: Change[] = []
  const streams = new Set<string>()
  for (const r of db.prepare('SELECT * FROM streams WHERE user_id = ? AND deleted_at IS NULL').all(userId) as Row[]) {
    streams.add(r.id as string)
    changes.push({ seq, op: 'stream.put', data: toStream(r) })
  }
  for (const r of db.prepare('SELECT * FROM page_versions WHERE user_id = ?').all(userId) as Row[]) {
    if (!streams.has(r.stream_id as string)) continue
    const data = { id: r.id as string, streamId: r.stream_id as string, text: r.text as string, createdAt: r.created_at as number }
    changes.push({ seq, op: 'page.put', data })
  }
  for (const r of db.prepare('SELECT * FROM stream_views WHERE user_id = ?').all(userId) as Row[]) {
    if (!streams.has(r.stream_id as string)) continue
    const data = { streamId: r.stream_id as string, view: r.view as StreamViewMode, at: r.at as number }
    changes.push({ seq, op: 'view.put', data })
  }
  const counts = new Map<string, number>()
  for (const r of db
    .prepare('SELECT message_id, COUNT(*) AS n FROM versions WHERE user_id = ? GROUP BY message_id')
    .all(userId) as Array<{ message_id: string; n: number }>) {
    counts.set(r.message_id, r.n)
  }
  const live = new Set<string>()
  for (const r of db.prepare('SELECT * FROM messages WHERE user_id = ? AND deleted_at IS NULL').all(userId) as Row[]) {
    live.add(r.id as string)
    changes.push({ seq, op: 'message.put', data: toMessage(r, counts.get(r.id as string) ?? 1) })
  }
  for (const r of db.prepare('SELECT * FROM versions WHERE user_id = ?').all(userId) as Row[]) {
    if (live.has(r.message_id as string)) changes.push({ seq, op: 'version.put', data: toVersion(r) })
  }
  for (const r of db.prepare('SELECT * FROM pins WHERE user_id = ?').all(userId) as Row[]) {
    if (live.has(r.message_id as string)) changes.push({ seq, op: 'pin.put', data: toPin(r) })
  }
  for (const r of db.prepare('SELECT * FROM attachments WHERE user_id = ? AND deleted_at IS NULL').all(userId) as Row[]) {
    if (live.has(r.message_id as string)) changes.push({ seq, op: 'attachment.put', data: toAttachment(r) })
  }
  return { changes, seq, more: false }
}

/** Attachment metadata, for upload and download authorization. */
export function attachmentRow(db: Db, userId: string, id: string): (AttachmentRow & { uploaded: boolean }) | null {
  const r = db
    .prepare('SELECT * FROM attachments WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(id, userId) as Row | undefined
  return r ? { ...toAttachment(r), uploaded: (r.uploaded as number) === 1 } : null
}

export function markUploaded(db: Db, id: string): void {
  db.prepare('UPDATE attachments SET uploaded = 1 WHERE id = ?').run(id)
}
