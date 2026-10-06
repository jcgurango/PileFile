import { BASE, DATA_DIR, checker, fixture, launch } from './helpers.mjs'
import { readdirSync, existsSync } from 'node:fs'
const DATA = DATA_DIR
const F = fixture('')
const { check, finish } = checker()
const browser = await launch()
const errors = []
const newPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()) })
  await page.goto(BASE)
  await page.getByRole('heading', { name: 'All', level: 2 }).waitFor()
  return { ctx, page }
}
const card = (page, t) => page.locator('.msg', { has: page.locator('.msg-text', { hasText: t }) })
const post = async (page, text) => { const c = page.getByLabel('Write to All'); await c.fill(text); await c.press('Enter'); await card(page, text).waitFor() }
const login = async (page, name, pw) => {
  await page.getByRole('button', { name: 'Log in' }).click()
  const dlg = page.locator('dialog.login-dialog')
  await dlg.getByLabel('Username').fill(name); await dlg.getByLabel('Password').fill(pw)
  await dlg.getByRole('button', { name: 'Log in' }).click()
}
const status = (page) => page.locator('.account-status').innerText()
const waitSynced = (page) => page.waitForFunction(() => /^Synced/.test(document.querySelector('.account-status')?.textContent ?? ''), null, { timeout: 15000 })
const open = async (page, name) => { await page.locator('.stream-list .stream-row', { has: page.locator('.stream-name', { hasText: new RegExp(`^${name}$`) }) }).locator('.stream-btn').click(); await page.getByRole('heading', { name, level: 2 }).waitFor() }
const serverFiles = () => { const root = DATA + '/attachments'; if (!existsSync(root)) return 0; return readdirSync(root).flatMap((u) => readdirSync(root + '/' + u)).length }

// A: local-only first, then log in (merge-up)
const A = await newPage()
await A.page.getByRole('button', { name: 'Log in' }).waitFor()
check('starts local-only with a Log in button', true)
await post(A.page, 'Local before login')
await A.page.getByRole('button', { name: 'Log in' }).click()
const dlg = A.page.locator('dialog.login-dialog')
await dlg.getByLabel('Username').fill('alice'); await dlg.getByLabel('Password').fill('nope'); await dlg.getByRole('button', { name: 'Log in' }).click()
await dlg.getByRole('alert').waitFor()
check('bad password shows an error', (await dlg.getByRole('alert').innerText()).includes('invalid credentials'))
await dlg.getByLabel('Password').fill('correct horse'); await dlg.getByRole('button', { name: 'Log in' }).click()
await dlg.waitFor({ state: 'detached' })
await waitSynced(A.page)
check('A signed in and synced', (await A.page.locator('.account-name').innerText()) === 'alice', await status(A.page))

// B: second device logs in, receives A's merged-up note
const B = await newPage()
await login(B.page, 'alice', 'correct horse')
await card(B.page, 'Local before login').waitFor({ timeout: 15000 })
check('B receives the note A had before logging in (merge-up)', true)
await waitSynced(B.page)
check('B reports live connection', (await status(B.page)).includes('live'))

// Live propagation A -> B and B -> A
await post(A.page, 'From A')
await card(B.page, 'From A').waitFor({ timeout: 10000 })
check('new message from A appears on B live', true)
await card(B.page, 'From A').hover(); await card(B.page, 'From A').getByRole('button', { name: 'Edit' }).click()
const ed = B.page.getByLabel('Edit message'); await ed.press('End'); await ed.type(' (edited on B)'); await ed.press('Enter')
await card(A.page, 'edited on B').waitFor({ timeout: 10000 })
check('edit on B appears on A with edited marker', await card(A.page, 'edited on B').locator('time', { hasText: 'edited' }).isVisible())
await card(A.page, 'edited on B').hover(); await card(A.page, 'edited on B').getByRole('button', { name: /History/ }).click()
await card(A.page, 'edited on B').locator('.vnav').waitFor()
check('A has both versions after sync', (await card(A.page, 'edited on B').locator('.vnav-pos').innerText()).includes('2 of 2'))

// Streams + move + pin + read state
await B.page.getByRole('button', { name: 'New stream' }).click()
await B.page.getByLabel('New stream name').fill('Work'); await B.page.getByLabel('New stream name').press('Enter')
await B.page.getByRole('heading', { name: 'Work', level: 2 }).waitFor()
await A.page.locator('.stream-list .stream-name', { hasText: /^Work$/ }).waitFor({ timeout: 10000 })
check('stream created on B appears on A', true)
await open(B.page, 'All')
await card(B.page, 'From A').hover(); await card(B.page, 'From A').getByRole('button', { name: 'Move' }).click()
await card(B.page, 'From A').getByRole('radio', { name: 'Work' }).click()
await card(A.page, 'From A').locator('.chip', { hasText: '#Work' }).waitFor({ timeout: 10000 })
check('move on B shows on A', true)
await card(A.page, 'From A').hover(); await card(A.page, 'From A').getByRole('button', { name: 'Pin', exact: true }).click()
await card(B.page, 'From A').locator('.pin-badge', { hasText: /^Pinned$/ }).waitFor({ timeout: 10000 })
check('pin on A shows on B', true)
await open(B.page, 'Inbox')
await B.page.waitForFunction(() => document.querySelectorAll('.msg').length === 1)
await card(B.page, 'Local before login').waitFor()
check('B\'s Inbox holds the unfiled note but not the one filed in Work', (await card(B.page, 'From A').count()) === 0)
await card(A.page, 'Local before login').hover(); await card(A.page, 'Local before login').getByRole('button', { name: 'Mark read' }).click()
await card(B.page, 'Local before login').waitFor({ state: 'detached', timeout: 10000 })
check('mark read on A clears it from B\'s Inbox', true)

// Offline queue on A
await A.ctx.setOffline(true)
await post(A.page, 'Written offline')
await A.page.waitForFunction(() => /Offline|pending/.test(document.querySelector('.account-status')?.textContent ?? ''))
check('A shows offline / pending while disconnected', true, await status(A.page))
await B.page.waitForTimeout(2000)
check('B does not get the offline note yet', (await card(B.page, 'Written offline').count()) === 0)
await A.ctx.setOffline(false)
await card(B.page, 'Written offline').waitFor({ timeout: 20000 })
check('queued note reaches B after reconnect', true)
await waitSynced(A.page)
check('A back to synced with nothing pending', !(await status(A.page)).includes('pending'))

// Mark all as read clears only the Inbox; the unread message filed in Work keeps its dot everywhere
await A.page.waitForFunction(() => document.querySelector('.badge-count')?.textContent === '1')
B.page.once('dialog', (d) => d.accept())
await B.page.locator('header').getByRole('button', { name: 'Mark all as read' }).click()
await B.page.locator('.empty').waitFor()
await A.page.waitForFunction(() => !document.querySelector('.badge-count'), null, { timeout: 10000 })
check('mark all as read on B empties A\'s Inbox', (await card(A.page, 'Written offline').locator('.unread-dot').count()) === 0)
await waitSynced(B.page)
check('mark all as read leaves the unread message filed in Work unread on both devices', (await card(A.page, 'From A').locator('.unread-dot').count()) === 1 && (await B.page.evaluate(() => new Promise((res) => { const r = indexedDB.open('pilefile'); r.onsuccess = () => { r.result.transaction('messages').objectStore('messages').getAll().onsuccess = (e) => res(e.target.result.filter((m) => m.unread === 1).map((m) => m.text).join('|')) } }))).startsWith('From A'))

// Attachment transfer
await A.page.locator('.composer input[type=file]').setInputFiles([F + 'red-photo.png'])
await A.page.locator('.pending-item').waitFor()
await A.page.getByLabel('Write to All').fill('Photo from A'); await A.page.getByLabel('Write to All').press('Enter')
await card(B.page, 'Photo from A').locator('.att-tile img').waitFor({ timeout: 20000 })
const nat = await card(B.page, 'Photo from A').locator('.att-tile img').evaluate((i) => i.naturalWidth)
check('attachment bytes reach B and render a thumbnail', nat === 512, String(nat))
await card(B.page, 'Photo from A').locator('.att-tile').click()
await B.page.locator('dialog.lightbox img').waitFor()
check('B opens the full-size original from the server', (await B.page.locator('dialog.lightbox img').evaluate((i) => i.naturalWidth)) === 640)
await B.page.keyboard.press('Escape')
await B.page.locator('dialog.lightbox').waitFor({ state: 'detached' })
await A.page.waitForFunction(() => !/pending/.test(document.querySelector('.account-status')?.textContent ?? ''), null, { timeout: 15000 })
check('server holds the uploaded file', serverFiles() === 1, String(serverFiles()))
B.page.once('dialog', (d) => d.accept())
await card(B.page, 'Photo from A').hover(); await card(B.page, 'Photo from A').getByRole('button', { name: 'Delete' }).click()
await card(A.page, 'Photo from A').waitFor({ state: 'detached', timeout: 10000 })
await B.page.waitForTimeout(500)
check('delete on B removes it on A and the file on disk', serverFiles() === 0, String(serverFiles()))

// Reload persistence, third device snapshot
await A.page.reload()
await A.page.getByRole('heading', { name: 'All', level: 2 }).waitFor()
await waitSynced(A.page)
check('A restores its session and state after reload', (await A.page.locator('.account-name').innerText()) === 'alice' && (await card(A.page, 'Written offline').count()) === 1)
const C = await newPage()
await login(C.page, 'alice', 'correct horse')
await card(C.page, 'Written offline').waitFor({ timeout: 15000 })
await open(B.page, 'All')
await card(B.page, 'From A').waitFor()
const texts = (page) => page.locator('.msg').evaluateAll((els) => els.map((e) => (e.querySelector('.msg-text')?.textContent ?? '(no text)').slice(0, 30)))
try {
  await C.page.waitForFunction((n) => document.querySelectorAll('.msg').length === n, await B.page.locator('.msg').count(), { timeout: 8000 })
} catch {
  console.log('B:', JSON.stringify(await texts(B.page)), 'C:', JSON.stringify(await texts(C.page)), 'C status:', await status(C.page))
}
check('fresh device gets the full snapshot', (await C.page.locator('.msg').count()) === (await B.page.locator('.msg').count()) && (await C.page.locator('.stream-list .stream-name', { hasText: /^Work$/ }).count()) === 1)
check('fresh device keeps version history', (await C.page.locator('.msg', { hasText: 'edited on B' }).getByRole('button', { name: /History/ }).count()) === 1)

// Logout keeps local data
await A.page.getByRole('button', { name: 'Log out' }).click()
await A.page.getByRole('button', { name: 'Log in' }).waitFor()
check('logout returns to local-only with data intact', (await card(A.page, 'Written offline').count()) === 1)

check('no console/page errors', errors.length === 0, errors.join(' | ').slice(0, 300))
await finish(browser)
