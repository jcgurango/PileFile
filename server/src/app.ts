import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { streamSSE } from 'hono/streaming'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync } from 'node:fs'
import type { Db } from './db.ts'
import { authenticate, createSession, destroySession, sessionUser } from './auth.ts'
import { applyActions, attachmentRow, currentSeq, Hub, markUploaded, pull } from './sync.ts'
import { AttachmentStore } from './attachments.ts'
import {
  POKE_EVENT,
  type Action,
  type ActionsRequest,
  type ActionsResponse,
  type LoginRequest,
  type PokePayload,
  type UserInfo,
} from '../../shared/protocol.ts'

export const COOKIE = 'pf_session'
const SESSION_MAX_AGE = 60 * 24 * 60 * 60

export interface AppOptions {
  db: Db
  store: AttachmentStore
  hub?: Hub
  /** Directory of the built client to serve, or undefined for API only. */
  staticDir?: string
  /** Set the Secure flag on the session cookie (any HTTPS deployment). */
  secureCookies?: boolean
}

type Env = { Variables: { user: UserInfo | null; sessionId: string | undefined } }

export function createApp({ db, store, hub = new Hub(), staticDir, secureCookies = false }: AppOptions) {
  const app = new Hono<Env>()

  app.use('/api/*', async (c, next) => {
    const sid = getCookie(c, COOKIE)
    c.set('sessionId', sid)
    c.set('user', sessionUser(db, sid))
    await next()
  })

  const requireUser = (c: { get: (k: 'user') => UserInfo | null }): UserInfo | null => c.get('user')

  // ------------------------------------------------------------- auth

  app.post('/api/login', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Partial<LoginRequest> | null
    if (!body || typeof body.name !== 'string' || typeof body.password !== 'string') {
      return c.json({ error: 'name and password required' }, 400)
    }
    const user = authenticate(db, body.name.trim(), body.password)
    if (!user) return c.json({ error: 'invalid credentials' }, 401)
    const sid = createSession(db, user.id)
    setCookie(c, COOKIE, sid, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: secureCookies,
      path: '/',
      maxAge: SESSION_MAX_AGE,
    })
    return c.json({ user })
  })

  app.post('/api/logout', (c) => {
    const sid = c.get('sessionId')
    if (sid) destroySession(db, sid)
    deleteCookie(c, COOKIE, { path: '/' })
    return c.body(null, 204)
  })

  // 200 with a null user when signed out, so the startup probe never logs a console error.
  app.get('/api/me', (c) => c.json({ user: requireUser(c) }))

  // ------------------------------------------------------------- sync

  app.post('/api/actions', async (c) => {
    const user = requireUser(c)
    if (!user) return c.json({ error: 'not signed in' }, 401)
    const body = (await c.req.json().catch(() => null)) as Partial<ActionsRequest> | null
    if (!body || !Array.isArray(body.actions)) return c.json({ error: 'actions[] required' }, 400)
    const actions = body.actions.filter(
      (a): a is Action => !!a && typeof a === 'object' && typeof a.id === 'string' && typeof a.type === 'string',
    )
    const { seq, removedAttachmentIds } = applyActions(db, user.id, actions)
    for (const id of removedAttachmentIds) {
      store.remove(user.id, id).catch((err: unknown) => console.error('attachment cleanup failed', id, err))
    }
    if (actions.length) hub.poke(user.id, seq)
    const res: ActionsResponse = { seq }
    return c.json(res)
  })

  app.get('/api/sync', (c) => {
    const user = requireUser(c)
    if (!user) return c.json({ error: 'not signed in' }, 401)
    const since = Number(c.req.query('since') ?? 0)
    return c.json(pull(db, user.id, Number.isFinite(since) ? since : 0))
  })

  app.get('/api/events', (c) => {
    const user = requireUser(c)
    if (!user) return c.json({ error: 'not signed in' }, 401)
    return streamSSE(c, async (stream) => {
      let pending: number | null = null
      const unsubscribe = hub.subscribe(user.id, (seq) => {
        pending = seq
      })
      stream.onAbort(unsubscribe)
      const hello: PokePayload = { seq: currentSeq(db, user.id) }
      await stream.writeSSE({ event: POKE_EVENT, data: JSON.stringify(hello) })
      let idle = 0
      while (!stream.aborted) {
        await stream.sleep(250)
        if (pending !== null) {
          const payload: PokePayload = { seq: pending }
          pending = null
          idle = 0
          await stream.writeSSE({ event: POKE_EVENT, data: JSON.stringify(payload) })
        } else if (++idle >= 100) {
          idle = 0
          await stream.writeSSE({ event: 'ping', data: '' })
        }
      }
    })
  })

  // ------------------------------------------------------ attachments

  app.put('/api/attachments/:id', async (c) => {
    const user = requireUser(c)
    if (!user) return c.json({ error: 'not signed in' }, 401)
    const id = c.req.param('id')
    const att = attachmentRow(db, user.id, id)
    if (!att) return c.json({ error: 'unknown attachment' }, 404)
    const body = c.req.raw.body
    if (!body) return c.json({ error: 'empty body' }, 400)
    const size = await store.save(user.id, id, body)
    if (size !== att.size) {
      await store.remove(user.id, id)
      return c.json({ error: `expected ${att.size} bytes, got ${size}` }, 400)
    }
    markUploaded(db, id)
    return c.body(null, 204)
  })

  app.get('/api/attachments/:id', async (c) => {
    const user = requireUser(c)
    if (!user) return c.json({ error: 'not signed in' }, 401)
    const id = c.req.param('id')
    const att = attachmentRow(db, user.id, id)
    if (!att || !att.uploaded) return c.json({ error: 'not available' }, 404)
    const size = await store.size(user.id, id)
    if (size === null) return c.json({ error: 'not available' }, 404)
    return new Response(store.open(user.id, id), {
      headers: {
        'Content-Type': att.type,
        'Content-Length': String(size),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(att.name)}`,
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    })
  })

  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404))

  // ------------------------------------------------------------ client

  if (staticDir && existsSync(staticDir)) {
    app.use('/*', serveStatic({ root: staticDir }))
    app.get('*', serveStatic({ path: `${staticDir}/index.html` }))
  }

  return app
}
