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
  const info = ok ? await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('pilefile'); r.onsuccess = () => { const d = r.result; const out = { version: d.version, stores: [...d.objectStoreNames].sort() }; const tx = d.transaction(['streams', 'messages']); tx.objectStore('streams').getAll().onsuccess = (e) => { out.streams = e.target.result; tx.objectStore('messages').getAll().onsuccess = (e2) => { out.messages = e2.target.result.map((m) => ({ text: m.text, words: m.words })); const done = () => { res(out); d.close() }; if (d.objectStoreNames.contains('pageVersions')) d.transaction('pageVersions').objectStore('pageVersions').getAll().onsuccess = (e3) => { out.pages = e3.target.result.sort((a, b) => a.createdAt - b.createdAt).map((v) => ({ id: v.id, parentId: v.parentId, text: v.text })); done() }; else done() } } } })) : null
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

// v12 (Dexie 12 => IDB 120) left pre-chain page versions as parentless roots and the merge logic joined them;
// v13 drops those merges and chains the old rows by time.
const chained = await seedAndLoad('v12 -> latest', 120, (v) => new Promise((resolve, reject) => {
  const req = indexedDB.open('pilefile', v)
  req.onupgradeneeded = () => {
    const d = req.result
    const mk = (name, key, idx = [], opts = {}) => { const s = d.createObjectStore(name, { keyPath: key, ...opts }); for (const [n, kp, o] of idx) s.createIndex(n, kp, o); return s }
    mk('streams', 'id', [['name', 'name'], ['createdAt', 'createdAt'], ['parentId', 'parentId']])
    mk('messages', 'id', [['createdAt', 'createdAt'], ['updatedAt', 'updatedAt'], ['streamId', 'streamId'], ['replyToId', 'replyToId'], ['unread', 'unread'], ['words', 'words', { multiEntry: true }], ['tags', 'tags', { multiEntry: true }]])
    mk('versions', 'id', [['messageId', 'messageId']])
    mk('pins', ['messageId', 'streamId'], [['messageId', 'messageId'], ['streamId', 'streamId']])
    mk('tags', 'name'); mk('attachments', 'id', [['messageId', 'messageId']]); mk('files', 'id'); mk('thumbs', 'id')
    mk('outbox', 'seq', [], { autoIncrement: true }); mk('meta', 'key')
    mk('pageVersions', 'id', [['streamId', 'streamId']]); mk('streamViews', 'streamId')
  }
  req.onsuccess = () => {
    const d = req.result; const tx = d.transaction(['streams', 'pageVersions'], 'readwrite')
    tx.objectStore('streams').put({ id: 's1', name: 'Todo', createdAt: 5, updatedAt: 5, parentId: null })
    const pv = tx.objectStore('pageVersions')
    pv.put({ id: 'a', streamId: 's1', createdAt: 10, parentId: null, text: 'first' })
    pv.put({ id: 'b', streamId: 's1', createdAt: 20, parentId: null, text: 'second' })
    pv.put({ id: 'c', streamId: 's1', createdAt: 30, parentId: null, text: 'third' })
    pv.put({ id: 'merge:a:b', streamId: 's1', createdAt: 40, parentId: 'b', mergeOf: 'a', text: 'second\n\nfirst', patch: '[]' })
    pv.put({ id: 'd', streamId: 's1', createdAt: 50, parentId: 'merge:a:b', patch: '[]' })
    tx.oncomplete = () => { d.close(); resolve() }; tx.onerror = () => reject(tx.error)
  }
  req.onerror = () => reject(req.error)
}))
check('v12 database upgrades without errors', chained.ok && chained.errors.length === 0, chained.errors.join(' | '))
check('pre-chain page versions are chained by time and the joined merges are gone', JSON.stringify(chained.info?.pages) === JSON.stringify([{ id: 'a', parentId: null, text: 'first' }, { id: 'b', parentId: 'a', text: 'second' }, { id: 'c', parentId: 'b', text: 'third' }]), JSON.stringify(chained.info?.pages))
await finish(browser)
