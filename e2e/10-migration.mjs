import { BASE, checker, launch } from './helpers.mjs'
const browser = await launch()
const { check, finish } = checker()
const seedAndLoad = async (label, idbVersion, seed) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 300)) })
  await page.goto(`${BASE}/pilefile-icon.svg`)
  await page.evaluate(seed, idbVersion)
  await page.goto(BASE)
  const ok = await page.getByRole('heading', { name: 'All', level: 2 }).waitFor({ timeout: 8000 }).then(() => true, () => false)
  const info = ok ? await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('pilefile'); r.onsuccess = () => { const d = r.result; const out = { version: d.version, stores: [...d.objectStoreNames].sort() }; const tx = d.transaction(['streams', 'messages']); tx.objectStore('streams').getAll().onsuccess = (e) => { out.streams = e.target.result; tx.objectStore('messages').getAll().onsuccess = (e2) => { out.messages = e2.target.result.map((m) => ({ text: m.text, words: m.words })); res(out); d.close() } } } })) : null
  const relevant = errors.filter((e) => !/404/.test(e)) // the raw-SVG seeding page requests a favicon.ico
  const shown = ok ? { streams: await page.locator('.stream-list .stream-name').allInnerTexts(), messages: await page.locator('.msg').count() } : null
  await ctx.close()
  return { ok, info, shown, errors: relevant }
}
// Pre-stable v1 database: must at least open (it is wiped)
const legacy = await seedAndLoad('legacy v1', 10, (v) => new Promise((resolve, reject) => {
  const req = indexedDB.open('pilefile', v)
  req.onupgradeneeded = () => { const d = req.result; d.createObjectStore('streams', { keyPath: 'id' }); const m = d.createObjectStore('messages', { keyPath: 'id' }); m.createIndex('streamIds', 'streamIds', { multiEntry: true }); d.createObjectStore('versions', { keyPath: 'id' }) }
  req.onsuccess = () => { const d = req.result; const tx = d.transaction(['messages', 'streams'], 'readwrite'); tx.objectStore('messages').put({ id: 'old', text: 'legacy', streamIds: ['x'], words: ['legacy'], createdAt: 1, updatedAt: 1, versionCount: 1 }); tx.objectStore('streams').put({ id: 'x', name: 'Legacy', createdAt: 1 }); tx.oncomplete = () => { d.close(); resolve() }; tx.onerror = () => reject(tx.error) }
  req.onerror = () => reject(req.error)
}))
check('legacy pre-stable database opens', legacy.ok && legacy.errors.length === 0, legacy.errors.join(' | '))
// Realistic: the first stable schema (Dexie 9 => IDB 90), with data that must survive every later migration
const current = await seedAndLoad('v9 -> latest', 90, (v) => new Promise((resolve, reject) => {
  const req = indexedDB.open('pilefile', v)
  req.onupgradeneeded = () => {
    const d = req.result
    const mk = (name, key, idx = []) => { const s = d.createObjectStore(name, { keyPath: key }); for (const [n, kp, o] of idx) s.createIndex(n, kp, o); return s }
    mk('streams', 'id', [['name', 'name'], ['createdAt', 'createdAt'], ['parentId', 'parentId']])
    mk('messages', 'id', [['createdAt', 'createdAt'], ['updatedAt', 'updatedAt'], ['streamId', 'streamId'], ['replyToId', 'replyToId'], ['unread', 'unread'], ['words', 'words', { multiEntry: true }], ['tags', 'tags', { multiEntry: true }]])
    mk('versions', 'id', [['messageId', 'messageId']])
    mk('pins', ['messageId', 'streamId'], [['messageId', 'messageId'], ['streamId', 'streamId']])
    mk('tags', 'name'); mk('attachments', 'id', [['messageId', 'messageId']]); mk('files', 'id'); mk('thumbs', 'id')
  }
  req.onsuccess = () => {
    const d = req.result; const tx = d.transaction(['streams', 'messages', 'versions'], 'readwrite')
    tx.objectStore('streams').put({ id: 's1', name: 'Kept stream', createdAt: 5, parentId: null })
    tx.objectStore('messages').put({ id: 'm1', text: 'Kept message #tag', createdAt: 6, updatedAt: 6, streamId: 's1', words: ['kept', 'message', 'tag'], tags: ['tag'], unread: 1, versionCount: 1, replyToId: null, attachmentCount: 0 })
    tx.objectStore('versions').put({ id: 'v1', messageId: 'm1', text: 'Kept message #tag', createdAt: 6 })
    tx.oncomplete = () => { d.close(); resolve() }; tx.onerror = () => reject(tx.error)
  }
  req.onerror = () => reject(req.error)
}))
check('v9 database upgrades without errors', current.ok && current.errors.length === 0, current.errors.join(' | '))
check('stream and message survive the upgrade', current.shown?.streams.includes('Kept stream') && current.shown?.messages === 1, JSON.stringify(current.shown))
check('stream gains updatedAt backfilled from createdAt', current.info?.streams[0]?.updatedAt === 5)
check('sync tables exist after upgrade', ['outbox', 'meta'].every((t) => current.info?.stores.includes(t)))
await finish(browser)
