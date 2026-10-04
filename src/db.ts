import Dexie, { type EntityTable } from 'dexie'
import { extractTags, parseQuery, type ParsedQuery } from './tags'
import { kindOf, makeThumbnail } from './attachments'

/**
 * Two virtual views sit above the streams. IndexedDB keys cannot be null, so these
 * sentinels also serve as pin contexts for the two views.
 * - Inbox: every unread message, across all streams. New and edited messages land here
 *   until marked read. The triage zone.
 * - All: every message, read or not.
 */
export const INBOX_ID = 'inbox'
export const ALL_ID = 'all'
export const isVirtual = (id: string) => id === INBOX_ID || id === ALL_ID
export const viewName = (id: string) => (id === INBOX_ID ? 'Inbox' : id === ALL_ID ? 'All' : null)

export interface Stream {
  id: string
  name: string
  createdAt: number
  /** null for a top-level stream. */
  parentId: string | null
}

export interface Message {
  id: string
  /** Text of the current (latest) version, denormalized for display and search. */
  text: string
  createdAt: number
  /** Timestamp of the latest version. Equals createdAt when never edited. */
  updatedAt: number
  /** The one stream this message is filed in, or null when it is not filed anywhere. */
  streamId: string | null
  /** 1 while the message sits in the Inbox. Set on creation; cleared by marking read. */
  unread: 0 | 1
  /** Search tokens of the current text. Multi-entry indexed. */
  words: string[]
  /** Lowercased #tags in the current text. Multi-entry indexed, matched exactly. */
  tags: string[]
  versionCount: number
  /** Backlink to the message this one replies to. Kept even if that message is later deleted. */
  replyToId: string | null
  /** Denormalized so lists and quotes can say "3 attachments" without a lookup. */
  attachmentCount: number
}

/**
 * Attachment metadata. The bytes live in `files`, a lazily built preview in `thumbs`.
 * Attachments are fixed when a message is created; they are not edited or versioned.
 */
export interface Attachment {
  id: string
  messageId: string
  name: string
  type: string
  size: number
  createdAt: number
  /** Position within the message, in the order files were added. */
  order: number
}

interface FileRow {
  id: string
  blob: Blob
}

interface ThumbRow {
  id: string
  blob: Blob
  width: number
  height: number
}

/** One row per tag ever written, keeping the casing it was first written with. */
export interface Tag {
  name: string
  display: string
}

export interface Version {
  id: string
  messageId: string
  text: string
  createdAt: number
}

/**
 * A pin is scoped to a viewing context: a stream id, or INBOX_ID for the Inbox.
 * A message sorts to the top of a view only when it has a pin for that exact context.
 * Having a pin anywhere is enough to show the pinned styling.
 */
export interface Pin {
  messageId: string
  streamId: string
  pinnedAt: number
}

class PileFileDB extends Dexie {
  streams!: EntityTable<Stream, 'id'>
  messages!: EntityTable<Message, 'id'>
  versions!: EntityTable<Version, 'id'>
  pins!: Dexie.Table<Pin, [string, string]>
  tags!: EntityTable<Tag, 'name'>
  attachments!: EntityTable<Attachment, 'id'>
  files!: EntityTable<FileRow, 'id'>
  thumbs!: EntityTable<ThumbRow, 'id'>

  constructor() {
    super('pilefile')
    // Pre-stable: a schema change bumps this number and wipes local data instead of migrating.
    this.version(9)
      .stores({
        streams: 'id, name, createdAt, parentId',
        messages: 'id, createdAt, updatedAt, streamId, replyToId, unread, *words, *tags',
        versions: 'id, messageId',
        pins: '[messageId+streamId], messageId, streamId',
        tags: 'name',
        attachments: 'id, messageId',
        files: 'id',
        thumbs: 'id',
      })
      .upgrade((tx) => Promise.all(tx.storeNames.map((name) => tx.table(name).clear())))
  }
}

export const db = new PileFileDB()

const uid = () => crypto.randomUUID()

/** Lowercased, diacritic-stripped, de-duplicated word tokens. */
export function tokenize(text: string): string[] {
  const normalized = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
  const parts = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return Array.from(new Set(parts))
}

// ------------------------------------------------------------ stream tree

const byName = (a: Stream, b: Stream) => a.name.localeCompare(b.name)

export function childrenOf(streams: Stream[], parentId: string | null): Stream[] {
  return streams.filter((s) => s.parentId === parentId).sort(byName)
}

/** Every stream below `id`, depth first. Does not include `id` itself. */
export function descendantIds(streams: Stream[], id: string): string[] {
  const out: string[] = []
  const walk = (parentId: string) => {
    for (const child of childrenOf(streams, parentId)) {
      out.push(child.id)
      walk(child.id)
    }
  }
  walk(id)
  return out
}

/** Root-first chain of ancestors, not including `id` itself. */
export function ancestorsOf(streams: Stream[], id: string): Stream[] {
  const byId = new Map(streams.map((s) => [s.id, s]))
  const chain: Stream[] = []
  let cur = byId.get(id)?.parentId ?? null
  while (cur) {
    const s = byId.get(cur)
    if (!s || chain.includes(s)) break
    chain.unshift(s)
    cur = s.parentId
  }
  return chain
}

export interface TreeRow {
  stream: Stream
  depth: number
  hasChildren: boolean
}

/** Depth-first flattening of the whole tree, siblings sorted by name. */
export function flattenTree(streams: Stream[]): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (parentId: string | null, depth: number) => {
    for (const s of childrenOf(streams, parentId)) {
      rows.push({ stream: s, depth, hasChildren: childrenOf(streams, s.id).length > 0 })
      walk(s.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}

/** "Parent › Child › Grandchild" for tooltips and search results. */
export function streamPath(streams: Stream[], id: string): string {
  const self = streams.find((s) => s.id === id)
  if (!self) return ''
  return [...ancestorsOf(streams, id), self].map((s) => s.name).join(' › ')
}

// ---------------------------------------------------------------- streams

export async function createStream(name: string, parentId: string | null = null): Promise<string> {
  const id = uid()
  await db.streams.add({ id, name: name.trim(), createdAt: Date.now(), parentId })
  return id
}

export async function renameStream(id: string, name: string): Promise<void> {
  await db.streams.update(id, { name: name.trim() })
}

/** Re-parents a stream. Refuses to nest a stream under itself or one of its descendants. */
export async function moveStream(id: string, parentId: string | null): Promise<void> {
  if (parentId === id) return
  const streams = await db.streams.toArray()
  if (parentId && descendantIds(streams, id).includes(parentId)) return
  await db.streams.update(id, { parentId })
}

/**
 * Deletes a stream. Its child streams and its own messages move up to its parent
 * (to the top level / no stream when it was top level). Pins in its context are dropped.
 */
export async function deleteStream(id: string): Promise<void> {
  await db.transaction('rw', db.streams, db.messages, db.pins, async () => {
    const stream = await db.streams.get(id)
    if (!stream) return
    const parentId = stream.parentId
    await db.streams.where('parentId').equals(id).modify({ parentId })
    await db.messages.where('streamId').equals(id).modify({ streamId: parentId })
    await db.pins.where('streamId').equals(id).delete()
    await db.streams.delete(id)
  })
}

// --------------------------------------------------------------- messages

/** Records any tags not seen before, keeping the first casing. Returns the index keys. */
async function indexTags(text: string): Promise<string[]> {
  const refs = extractTags(text)
  if (refs.length) {
    const existing = await db.tags.bulkGet(refs.map((r) => r.name))
    const fresh = refs.filter((_, i) => existing[i] === undefined)
    if (fresh.length) await db.tags.bulkPut(fresh)
  }
  return refs.map((r) => r.name)
}

/** Search words come from the text and from attachment file names. */
const wordsFor = (text: string, names: string[]) => tokenize([text, ...names].join(' '))

async function attachmentNames(messageId: string): Promise<string[]> {
  return (await db.attachments.where('messageId').equals(messageId).toArray()).map((a) => a.name)
}

export async function addMessage(
  text: string,
  streamId: string,
  replyToId: string | null = null,
  files: File[] = [],
): Promise<string> {
  const id = uid()
  const now = Date.now()
  await db.transaction('rw', db.messages, db.versions, db.tags, db.attachments, db.files, async () => {
    await db.messages.add({
      id,
      text,
      createdAt: now,
      updatedAt: now,
      streamId: isVirtual(streamId) ? null : streamId,
      unread: 1,
      words: wordsFor(
        text,
        files.map((f) => f.name),
      ),
      tags: await indexTags(text),
      versionCount: 1,
      replyToId,
      attachmentCount: files.length,
    })
    await db.versions.add({ id: uid(), messageId: id, text, createdAt: now })
    await storeFiles(id, files, now, 0)
  })
  return id
}

async function storeFiles(messageId: string, files: File[], now: number, firstOrder: number): Promise<void> {
  for (const [i, f] of files.entries()) {
    const attId = uid()
    await db.attachments.add({
      id: attId,
      messageId,
      name: f.name,
      type: f.type || 'application/octet-stream',
      size: f.size,
      createdAt: now,
      order: firstOrder + i,
    })
    await db.files.add({ id: attId, blob: f })
  }
}

/** Records a new version. The message keeps its original createdAt so ordering is stable. */
export async function editMessage(id: string, text: string): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.messages, db.versions, db.tags, db.attachments, async () => {
    const m = await db.messages.get(id)
    if (!m || m.text === text) return
    await db.versions.add({ id: uid(), messageId: id, text, createdAt: now })
    await db.messages.update(id, {
      text,
      words: wordsFor(text, await attachmentNames(id)),
      tags: await indexTags(text),
      updatedAt: now,
      versionCount: m.versionCount + 1,
    })
  })
}

/**
 * Files a message in one stream (or none). Pins survive only in contexts that still
 * show the message afterwards: the Inbox, the new stream, and that stream's ancestors.
 */
export async function moveMessage(id: string, streamId: string | null): Promise<void> {
  await db.transaction('rw', db.messages, db.streams, db.pins, async () => {
    await db.messages.update(id, { streamId })
    const streams = await db.streams.toArray()
    const keep = new Set<string>([INBOX_ID])
    if (streamId) {
      keep.add(streamId)
      for (const a of ancestorsOf(streams, streamId)) keep.add(a.id)
    }
    await db.pins
      .where('messageId')
      .equals(id)
      .filter((p) => !keep.has(p.streamId))
      .delete()
  })
}

export async function deleteMessage(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.messages, db.versions, db.pins, db.attachments, db.files, db.thumbs],
    async () => {
      const attIds = await db.attachments.where('messageId').equals(id).primaryKeys()
      await db.files.bulkDelete(attIds)
      await db.thumbs.bulkDelete(attIds)
      await db.attachments.bulkDelete(attIds)
      await db.versions.where('messageId').equals(id).delete()
      await db.pins.where('messageId').equals(id).delete()
      await db.messages.delete(id)
    },
  )
}

// ------------------------------------------------------------ attachments

export async function getFileBlob(attachmentId: string): Promise<Blob | undefined> {
  return (await db.files.get(attachmentId))?.blob
}

/** Pending thumbnail work, so two tiles for the same file share one generation. */
const thumbJobs = new Map<string, Promise<Blob | null>>()

/** The stored thumbnail for an image or video, generated on first request. Null when undecodable. */
export function getThumbBlob(att: Attachment): Promise<Blob | null> {
  const kind = kindOf(att.type)
  if (kind !== 'image' && kind !== 'video') return Promise.resolve(null)
  let job = thumbJobs.get(att.id)
  if (!job) {
    job = (async () => {
      const cached = await db.thumbs.get(att.id)
      if (cached) return cached.blob
      const file = await db.files.get(att.id)
      if (!file) return null
      const made = await makeThumbnail(file.blob, kind)
      if (!made) return null
      await db.thumbs.put({ id: att.id, blob: made.blob, width: made.width, height: made.height })
      return made.blob
    })()
    thumbJobs.set(att.id, job)
    job.catch(() => thumbJobs.delete(att.id))
  }
  return job
}

// ------------------------------------------------------------- read state

export async function setRead(id: string, read: boolean): Promise<void> {
  await db.messages.update(id, { unread: read ? 0 : 1 })
}

export function unreadCount(): Promise<number> {
  return db.messages.where('unread').equals(1).count()
}

/** Clears the Inbox. Returns how many messages were marked. */
export async function markAllRead(): Promise<number> {
  return db.messages.where('unread').equals(1).modify({ unread: 0 })
}

// ------------------------------------------------------------------- pins

/** Pins (or re-pins, refreshing the timestamp) a message in the given context. */
export async function pinMessage(messageId: string, streamId: string): Promise<void> {
  await db.pins.put({ messageId, streamId, pinnedAt: Date.now() })
}

export async function unpinMessage(messageId: string, streamId: string): Promise<void> {
  await db.pins.delete([messageId, streamId])
}

// ------------------------------------------------------------------ views

export interface StreamViewData {
  /** Pinned-here first (latest pin on top), then everything else newest first by creation time. */
  messages: Message[]
  /** Every pin of every listed message, in any context, keyed by message id. */
  pinsByMessage: Map<string, Pin[]>
  /** Messages that listed messages reply to, keyed by id. A missing key means the original was deleted. */
  replyTargets: Map<string, Message>
  /** Attachments of listed messages, keyed by message id, in upload order. */
  attachmentsByMessage: Map<string, Attachment[]>
}

/**
 * All is every message; the Inbox is every unread one. A stream shows its own messages
 * plus those of all streams nested under it. Only pins for `streamId` itself affect the order.
 */
export async function loadStreamView(streamId: string, streams: Stream[]): Promise<StreamViewData> {
  const messages =
    streamId === ALL_ID
      ? await db.messages.toArray()
      : streamId === INBOX_ID
        ? await db.messages.where('unread').equals(1).toArray()
        : await db.messages
            .where('streamId')
            .anyOf([streamId, ...descendantIds(streams, streamId)])
            .toArray()

  const pins = await db.pins
    .where('messageId')
    .anyOf(messages.map((m) => m.id))
    .toArray()
  const pinsByMessage = new Map<string, Pin[]>()
  for (const p of pins) {
    const list = pinsByMessage.get(p.messageId)
    if (list) list.push(p)
    else pinsByMessage.set(p.messageId, [p])
  }

  const pinnedHere = (m: Message) =>
    pinsByMessage.get(m.id)?.find((p) => p.streamId === streamId)?.pinnedAt ?? 0
  messages.sort((a, b) => pinnedHere(b) - pinnedHere(a) || b.createdAt - a.createdAt)

  const replyIds = [...new Set(messages.flatMap((m) => (m.replyToId ? [m.replyToId] : [])))]
  const targets = replyIds.length ? await db.messages.bulkGet(replyIds) : []
  const replyTargets = new Map<string, Message>()
  for (const t of targets) if (t) replyTargets.set(t.id, t)

  const withFiles = messages.filter((m) => m.attachmentCount > 0).map((m) => m.id)
  const atts = withFiles.length
    ? (await db.attachments.where('messageId').anyOf(withFiles).toArray()).sort((a, b) => a.order - b.order)
    : []
  const attachmentsByMessage = new Map<string, Attachment[]>()
  for (const a of atts) {
    const list = attachmentsByMessage.get(a.messageId)
    if (list) list.push(a)
    else attachmentsByMessage.set(a.messageId, [a])
  }

  return { messages, pinsByMessage, replyTargets, attachmentsByMessage }
}

export function versionsOf(messageId: string): Promise<Version[]> {
  return db.versions.where('messageId').equals(messageId).reverse().sortBy('createdAt')
}

/** Message counts per stream including nested streams, the Inbox unread count, and the All total. */
export async function countsByStream(streams: Stream[]): Promise<Record<string, number>> {
  const own = new Map<string, number>()
  await Promise.all(
    streams.map(async (s) => {
      own.set(s.id, await db.messages.where('streamId').equals(s.id).count())
    }),
  )
  const counts: Record<string, number> = {
    [INBOX_ID]: await unreadCount(),
    [ALL_ID]: await db.messages.count(),
  }
  for (const s of streams) {
    const nested = descendantIds(streams, s.id).reduce((n, id) => n + (own.get(id) ?? 0), 0)
    counts[s.id] = (own.get(s.id) ?? 0) + nested
  }
  return counts
}

// ----------------------------------------------------------------- search

export const parseSearch = (query: string): ParsedQuery => parseQuery(query, tokenize)

/** True when the message carries every #tag exactly and every term as a word prefix. */
export function matchesQuery(message: Message, q: ParsedQuery): boolean {
  return (
    q.tags.every((t) => message.tags.includes(t)) &&
    q.terms.every((t) => message.words.some((w) => w.startsWith(t)))
  )
}

export interface TagSummary extends Tag {
  count: number
}

/** Every tag currently used by at least one message, most used first. */
export async function listTags(): Promise<TagSummary[]> {
  const all = await db.tags.toArray()
  const withCounts = await Promise.all(
    all.map(async (t) => ({ ...t, count: await db.messages.where('tags').equals(t.name).count() })),
  )
  return withCounts
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.display.localeCompare(b.display))
}

export interface SearchResults {
  /** Strings to highlight in result snippets. */
  highlights: string[]
  streams: Stream[]
  messages: Message[]
}

const EMPTY: SearchResults = { highlights: [], streams: [], messages: [] }
const MAX_RESULTS = 200

/**
 * Streams match on a case-insensitive substring of their name.
 * Messages must carry every #tag exactly and every other term as a word prefix.
 */
export async function search(query: string): Promise<SearchResults> {
  const q = query.trim()
  if (!q) return EMPTY

  const lower = q.toLowerCase()
  const streams = (await db.streams.toArray())
    .filter((s) => s.name.toLowerCase().includes(lower))
    .sort(byName)

  const parsed = parseSearch(q)
  if (parsed.terms.length === 0 && parsed.tags.length === 0) {
    return { highlights: [], streams, messages: [] }
  }

  const keySets = await Promise.all([
    ...parsed.tags.map((t) => db.messages.where('tags').equals(t).primaryKeys()),
    ...parsed.terms.map((t) => db.messages.where('words').startsWith(t).primaryKeys()),
  ])
  let ids = new Set(keySets[0] as string[])
  for (const keys of keySets.slice(1)) {
    const other = new Set(keys as string[])
    ids = new Set([...ids].filter((id) => other.has(id)))
  }

  const messages = (await db.messages.bulkGet([...ids]))
    .filter((m): m is Message => m !== undefined)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_RESULTS)

  return { highlights: parsed.highlights, streams, messages }
}
