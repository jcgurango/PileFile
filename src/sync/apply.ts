import type { Action, Change, MessageRow } from '../../shared/protocol'
import { attachmentNames, db, dropStreamExtras, indexTags, purgeMessageLocally, wordsFor, type Message } from '../db'

/**
 * Applies a page of server changes to the local database. Writes go straight to the
 * tables, never through the mutation helpers, so nothing here lands in the outbox.
 */
export async function applyChanges(changes: Change[]): Promise<void> {
  if (changes.length === 0) return
  await db.transaction(
    'rw',
    [
      db.streams,
      db.messages,
      db.versions,
      db.pins,
      db.tags,
      db.attachments,
      db.files,
      db.thumbs,
      db.pageVersions,
      db.streamViews,
    ],
    async () => {
      const reindex = new Set<string>()
      for (const c of changes) {
        switch (c.op) {
          case 'stream.put':
            await db.streams.put(c.data)
            break
          case 'stream.delete':
            await dropStreamExtras(c.id)
            await db.streams.delete(c.id)
            break
          case 'page.put': {
            // The same version can arrive more than once while it is being typed into; keep the newest.
            const local = await db.pageVersions.get(c.data.id)
            if (!local || c.data.createdAt >= local.createdAt) await db.pageVersions.put(c.data)
            break
          }
          case 'view.put': {
            // An older choice arriving late (this device's own echo, say) must not undo a newer one.
            const local = await db.streamViews.get(c.data.streamId)
            if (!local || c.data.at >= local.at) await db.streamViews.put(c.data)
            break
          }
          case 'message.put':
            await putMessage(c.data)
            reindex.add(c.data.id)
            break
          case 'message.delete':
            await purgeMessageLocally(c.id)
            break
          case 'version.put': {
            await db.versions.put(c.data)
            break
          }
          case 'pin.put':
            await db.pins.put(c.data)
            break
          case 'pin.remove':
            await db.pins.delete([c.messageId, c.streamId])
            break
          case 'attachment.put':
            await db.attachments.put(c.data)
            reindex.add(c.data.messageId)
            break
          case 'attachment.delete': {
            const att = await db.attachments.get(c.id)
            if (att) {
              await db.attachments.delete(c.id)
              await db.files.delete(c.id)
              await db.thumbs.delete(c.id)
              reindex.add(att.messageId)
            }
            break
          }
          case 'read.all':
            await db.messages.where('unread').equals(1).modify({ unread: 0 })
            break
        }
      }
      // Search words depend on attachment names, which may arrive after the message row.
      for (const id of reindex) {
        const m = await db.messages.get(id)
        if (m) await db.messages.update(id, { words: wordsFor(m.text, await attachmentNames(id)) })
      }
    },
  )
}

/** Upsert from a server row. A newer local edit still waiting in the outbox keeps its text. */
async function putMessage(row: MessageRow): Promise<void> {
  const local = await db.messages.get(row.id)
  const keepLocalText = local !== undefined && local.updatedAt > row.updatedAt
  const text = keepLocalText ? local.text : row.text
  const next: Message = {
    id: row.id,
    text,
    createdAt: row.createdAt,
    updatedAt: keepLocalText ? local.updatedAt : row.updatedAt,
    streamId: row.streamId,
    unread: row.unread,
    replyToId: row.replyToId,
    attachmentCount: row.attachmentCount,
    versionCount: Math.max(row.versionCount, local?.versionCount ?? 0),
    words: wordsFor(text, []),
    tags: await indexTags(text),
  }
  await db.messages.put(next)
}

/**
 * Everything in the local database expressed as actions, for the first sign-in on a device
 * that already holds notes. Ids are stable, so replaying this onto an account that already
 * has some of it is harmless.
 */
export async function buildInitialActions(): Promise<Action[]> {
  const at = Date.now()
  const uid = () => crypto.randomUUID()
  const out: Action[] = []
  for (const s of await db.streams.toArray()) out.push({ id: uid(), at, type: 'stream.put', stream: s })
  const attachments = await db.attachments.toArray()
  const byMessage = new Map<string, typeof attachments>()
  for (const a of attachments) {
    const list = byMessage.get(a.messageId)
    if (list) list.push(a)
    else byMessage.set(a.messageId, [a])
  }
  for (const m of await db.messages.toArray()) {
    const versions = (await db.versions.where('messageId').equals(m.id).toArray()).sort(
      (a, b) => a.createdAt - b.createdAt,
    )
    const first = versions[0] ?? { id: uid(), messageId: m.id, text: m.text, createdAt: m.createdAt }
    const { words: _w, tags: _t, ...row } = m
    out.push({
      id: uid(),
      at,
      type: 'message.create',
      message: row,
      version: first,
      attachments: (byMessage.get(m.id) ?? []).sort((a, b) => a.order - b.order),
    })
    for (const v of versions.slice(1)) out.push({ id: uid(), at, type: 'message.edit', version: v })
    if (m.unread === 0) out.push({ id: uid(), at, type: 'message.read', messageId: m.id, unread: 0 })
  }
  for (const p of await db.pins.toArray()) out.push({ id: uid(), at, type: 'pin.put', pin: p })
  for (const v of await db.pageVersions.toArray()) out.push({ id: uid(), at, type: 'page.edit', version: v })
  for (const v of await db.streamViews.toArray()) out.push({ id: uid(), at, type: 'view.set', view: v })
  return out
}
