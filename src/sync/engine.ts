import { liveQuery } from 'dexie'
import { useSyncExternalStore } from 'react'
import {
  POKE_EVENT,
  type ActionsResponse,
  type PokePayload,
  type SyncResponse,
  type UserInfo,
} from '../../shared/protocol'
import { db, deleteMeta, getMeta, setMeta, setRemoteFileFetcher, type OutboxItem } from '../db'
import { applyChanges, buildInitialActions } from './apply'

export interface SyncState {
  /** Signed-in account, or null for local-only use. */
  user: UserInfo | null
  /** Whether the initial /api/me probe has finished. */
  ready: boolean
  /** Browser thinks it has a network. */
  online: boolean
  /** The live-update stream is open. */
  connected: boolean
  /** Items still waiting in the outbox. */
  pending: number
  syncing: boolean
  error: string | null
  lastSyncAt: number | null
}

const BATCH = 50
const CATCH_UP_MS = 60_000
const META_USER = 'user'
const lastSeqKey = (userId: string) => `lastSeq:${userId}`
const mergedKey = (userId: string) => `merged:${userId}`

class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init })
  if (!res.ok) {
    let msg = res.statusText
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg
    } catch {
      // keep statusText
    }
    throw new HttpError(res.status, msg)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

/**
 * Keeps the local database and the account in step.
 * Outgoing: drains the outbox in order over HTTP. Incoming: pulls the change log after the
 * last applied seq, nudged by SSE pokes, reconnects, visibility, and a periodic catch-up.
 */
class SyncEngine {
  private state: SyncState = {
    user: null,
    ready: false,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    connected: false,
    pending: 0,
    syncing: false,
    error: null,
    lastSyncAt: null,
  }
  private listeners = new Set<() => void>()
  private events: EventSource | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private backoff = 2000
  private running = false
  private chain: Promise<void> = Promise.resolve()
  private outboxSub: { unsubscribe: () => void } | null = null

  // ------------------------------------------------------------ store

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = () => this.state
  private set(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }

  // --------------------------------------------------------- lifecycle

  /** Called once at startup: restore the session if there is one. */
  async init(): Promise<void> {
    window.addEventListener('online', () => {
      this.set({ online: true })
      this.kick()
    })
    window.addEventListener('offline', () => this.set({ online: false, connected: false }))
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.kick()
    })
    setRemoteFileFetcher(async (id) => {
      if (!this.state.user) return undefined
      const res = await fetch(`/api/attachments/${id}`, { credentials: 'same-origin' })
      return res.ok ? res.blob() : undefined
    })

    const cached = await getMeta<UserInfo>(META_USER)
    try {
      const { user } = await api<{ user: UserInfo | null }>('/api/me')
      if (user) {
        await setMeta(META_USER, user)
        this.set({ user, ready: true })
        this.start()
      } else {
        await deleteMeta(META_USER)
        this.set({ user: null, ready: true })
      }
    } catch {
      // Offline: keep working against the cached account; the queue drains when we are back.
      this.set({ user: cached ?? null, ready: true, error: cached ? 'Offline' : null })
      if (cached) this.start()
    }
  }

  async login(name: string, password: string): Promise<void> {
    const { user } = await api<{ user: UserInfo }>('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, password }),
    })
    await setMeta(META_USER, user)
    this.set({ user, error: null })
    if (!(await getMeta<boolean>(mergedKey(user.id)))) await this.mergeUp(user.id)
    this.start()
  }

  async logout(): Promise<void> {
    this.stop()
    try {
      await api('/api/logout', { method: 'POST' })
    } catch {
      // Session may already be gone; local sign-out still proceeds.
    }
    await deleteMeta(META_USER)
    this.set({ user: null, connected: false, error: null })
  }

  /** First sign-in on a device with existing notes: push them all, then pull. */
  private async mergeUp(userId: string): Promise<void> {
    const actions = await buildInitialActions()
    const attachmentIds = await db.attachments.toCollection().primaryKeys()
    await db.transaction('rw', db.outbox, db.meta, async () => {
      for (const action of actions) await db.outbox.add({ kind: 'action', action })
      for (const attachmentId of attachmentIds) {
        if (await db.files.get(attachmentId)) await db.outbox.add({ kind: 'upload', attachmentId })
      }
      await setMeta(mergedKey(userId), true)
    })
  }

  private start(): void {
    if (this.running || !this.state.user) return
    this.running = true
    // New local work should go out right away, not wait for the next poke or catch-up tick.
    let lastPending = -1
    this.outboxSub = liveQuery(() => db.outbox.count()).subscribe({
      next: (pending) => {
        const grew = pending > lastPending && lastPending !== -1
        lastPending = pending
        this.set({ pending })
        if (grew) this.kick()
      },
    })
    this.timer = setInterval(() => this.kick(), CATCH_UP_MS)
    this.connect()
    this.kick()
  }

  private stop(): void {
    this.running = false
    this.events?.close()
    this.events = null
    this.outboxSub?.unsubscribe()
    this.outboxSub = null
    if (this.timer) clearInterval(this.timer)
    if (this.retry) clearTimeout(this.retry)
    this.timer = this.retry = null
    this.set({ connected: false, syncing: false })
  }

  private connect(): void {
    if (!this.running || this.events) return
    const es = new EventSource('/api/events')
    this.events = es
    es.onopen = () => {
      this.set({ connected: true })
      this.kick()
    }
    es.addEventListener(POKE_EVENT, (e) => {
      const { seq } = JSON.parse((e as MessageEvent).data) as PokePayload
      void seq
      this.kick()
    })
    es.onerror = () => {
      // EventSource reconnects on its own; a 401 would keep failing, which /api/me on the next kick catches.
      this.set({ connected: false })
    }
  }

  // --------------------------------------------------------------- work

  /** Push then pull, serialized so runs never overlap. */
  kick(): void {
    if (!this.running || !this.state.user) return
    this.chain = this.chain.then(() => this.cycle()).catch(() => undefined)
  }

  private async cycle(): Promise<void> {
    if (!this.running) return
    this.set({ syncing: true })
    try {
      await this.drain()
      await this.pull()
      this.backoff = 2000
      this.set({ error: null, lastSyncAt: Date.now() })
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        this.stop()
        await deleteMeta(META_USER)
        this.set({ user: null, error: 'Signed out. Log in again to resume syncing.' })
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      this.set({ error: this.state.online ? message : 'Offline' })
      if (this.retry) clearTimeout(this.retry)
      this.retry = setTimeout(() => this.kick(), this.backoff)
      this.backoff = Math.min(this.backoff * 2, 60_000)
    } finally {
      this.set({ syncing: false })
    }
  }

  private async drain(): Promise<void> {
    for (;;) {
      const items = (await db.outbox.orderBy('seq').limit(BATCH).toArray()) as Array<Required<OutboxItem>>
      if (items.length === 0) return
      if (items[0].kind === 'upload') {
        await this.upload(items[0])
        continue
      }
      const batch: Array<Required<OutboxItem>> = []
      for (const item of items) {
        if (item.kind !== 'action') break
        batch.push(item)
      }
      const actions = batch.flatMap((b) => (b.kind === 'action' ? [b.action] : []))
      await api<ActionsResponse>('/api/actions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actions }),
      })
      await db.outbox.bulkDelete(batch.map((b) => b.seq))
    }
  }

  private async upload(item: Required<OutboxItem>): Promise<void> {
    if (item.kind !== 'upload') return
    const file = await db.files.get(item.attachmentId)
    const att = await db.attachments.get(item.attachmentId)
    if (!file || !att) {
      await db.outbox.delete(item.seq)
      return
    }
    const res = await fetch(`/api/attachments/${item.attachmentId}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': att.type },
      body: file.blob,
    })
    // 404: the message was deleted before the bytes went up. Nothing to retry.
    if (res.ok || res.status === 404) {
      await db.outbox.delete(item.seq)
      return
    }
    throw new HttpError(res.status, `Upload failed (${res.status})`)
  }

  private async pull(): Promise<void> {
    const user = this.state.user
    if (!user) return
    const key = lastSeqKey(user.id)
    for (;;) {
      const since = (await getMeta<number>(key)) ?? 0
      const page = await api<SyncResponse>(`/api/sync?since=${since}`)
      await applyChanges(page.changes)
      await setMeta(key, page.seq)
      if (!page.more) return
    }
  }
}

export const sync = new SyncEngine()

export function useSyncState(): SyncState {
  return useSyncExternalStore(sync.subscribe, sync.getSnapshot, sync.getSnapshot)
}
