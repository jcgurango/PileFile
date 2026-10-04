import { serve } from '@hono/node-server'
import { join, resolve } from 'node:path'
import { openDb } from './db.ts'
import { createApp } from './app.ts'
import { AttachmentStore } from './attachments.ts'
import { Hub } from './sync.ts'

const port = Number(process.env.PORT ?? 8787)
const dataDir = resolve(process.env.DATA_DIR ?? './data')
const staticDir = resolve(process.env.STATIC_DIR ?? './dist')
const secureCookies = process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production'

const db = openDb(join(dataDir, 'pilefile.sqlite'))
const store = new AttachmentStore(join(dataDir, 'attachments'))
const app = createApp({ db, store, hub: new Hub(), staticDir, secureCookies })

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`PileFile server on http://localhost:${info.port}  data: ${dataDir}`)
})
