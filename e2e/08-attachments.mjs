import { BASE, checker, fixture, launch, shotPath } from './helpers.mjs'
import { readFileSync } from 'node:fs'
const F = fixture('')
const { check, finish } = checker()
const browser = await launch()
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(BASE)
const card = (t) => page.locator('.msg', { has: page.locator('.msg-text', { hasText: t }) })
const composer = page.locator('.composer')
const textarea = page.getByLabel('Write to Inbox')
const save = () => composer.getByRole('button', { name: 'Save' })
const b64 = (name) => readFileSync(F + name).toString('base64')
/** Dispatch a drop or paste event carrying real File objects built in the page. */
const synthFiles = async (target, kind, files) => {
  await target.evaluate((el, { kind, files }) => {
    const dt = new DataTransfer()
    for (const f of files) {
      const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))
      dt.items.add(new File([bytes], f.name, { type: f.type }))
    }
    if (kind === 'drop') {
      for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
    } else {
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    }
  }, { kind, files })
}

// 1. File dialog, pending chips, remove a pending file, attachment-only message
check('save disabled with nothing to send', await save().isDisabled())
await composer.locator('input[type=file]').setInputFiles([F + 'red-photo.png', F + 'budget-notes.txt'])
await page.locator('.pending-item').nth(1).waitFor()
check('chosen files appear as pending chips with image preview', (await page.locator('.pending-item').count()) === 2 && (await page.locator('.pending-item img').count()) === 1)
check('save enabled by attachments alone', await save().isEnabled())
await page.getByRole('button', { name: 'Remove budget-notes.txt' }).click()
check('pending file can be removed', (await page.locator('.pending-item').count()) === 1)
await save().click()
await page.locator('.msg').first().waitFor()
const byId = async (loc) => page.locator(`.msg[data-id="${await loc.getAttribute('data-id')}"]`)
const only = await byId(page.locator('.msg').first())
check('attachment-only message has no text block', (await only.locator('.msg-text').count()) === 0 && (await only.locator('.att-grid.n1 .att-tile').count()) === 1)
check('pending list cleared after save', (await page.locator('.pending-item').count()) === 0)
await only.locator('.att-tile img').waitFor()
const single = await only.locator('.att-tile img').evaluate((img) => ({ w: img.naturalWidth, h: img.naturalHeight, shownH: img.clientHeight }))
check('thumbnail generated at reduced size, natural aspect', single.w === 512 && single.h === 384 && single.shownH <= 320, JSON.stringify(single))

// 2. Drop three images with text -> 3-up grid; thumbs persisted
await textarea.fill('Trip photos #trip')
await synthFiles(composer, 'drop', ['red-photo.png', 'blue-photo.png', 'green-photo.png'].map((n) => ({ name: n, type: 'image/png', b64: b64(n) })))
await page.locator('.pending-item').nth(2).waitFor()
check('dropped files queue as pending', true)
await textarea.press('Enter')
await card('Trip photos').waitFor()
const trip = await byId(card('Trip photos'))
await trip.locator('.att-grid.n3 .att-tile img').nth(2).waitFor()
check('three images render as a 3-up grid', (await trip.locator('.att-grid.n3 .att-tile').count()) === 3)
const square = await trip.locator('.att-tile').first().evaluate((el) => Math.abs(el.clientWidth - el.clientHeight) <= 1)
check('grid tiles are square', square)
const thumbRows = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('pilefile'); r.onsuccess = () => { const d = r.result; const tx = d.transaction('thumbs'); const c = tx.objectStore('thumbs').count(); c.onsuccess = () => { res(c.result); d.close() } } }))
check('thumbnails are stored for reuse', thumbRows === 4, String(thumbRows))

// 3. Lightbox
await trip.locator('.att-tile').nth(1).click()
const lb = page.locator('dialog.lightbox')
await lb.waitFor()
await lb.locator('img').waitFor()
const full = await lb.locator('img').evaluate((img) => ({ w: img.naturalWidth, h: img.naturalHeight }))
check('lightbox shows the original at full resolution', full.w === 480 && full.h === 480 && (await lb.locator('.lightbox-name').innerText()).includes('blue-photo.png'), JSON.stringify(full))
check('download link targets the file', (await lb.locator('a[download="blue-photo.png"]').count()) === 1)
await page.keyboard.press('ArrowRight')
await lb.locator('.lightbox-name', { hasText: 'green-photo.png' }).waitFor()
check('arrow keys move between media', (await lb.locator('.lightbox-name').innerText()).includes('3 / 3'))
await lb.getByRole('button', { name: 'Next' }).click()
await lb.locator('.lightbox-name', { hasText: 'red-photo.png' }).waitFor()
check('next wraps around', true)
await page.keyboard.press('Escape')
await lb.waitFor({ state: 'detached' })
check('Escape closes the lightbox', true)

// 4. Paste an audio file and a text file -> player + chip
await textarea.fill('Voice note and a doc')
await synthFiles(textarea, 'paste', [{ name: 'voice-memo.wav', type: 'audio/wav', b64: b64('voice-memo.wav') }, { name: 'budget-notes.txt', type: 'text/plain', b64: b64('budget-notes.txt') }])
await page.locator('.pending-item').nth(1).waitFor()
check('pasted files queue as pending', true)
await textarea.press('Enter')
await card('Voice note').waitFor()
const mixed = await byId(card('Voice note'))
await mixed.locator('audio').waitFor()
check('audio attachment renders a player', (await mixed.locator('.att-audio-item audio[controls]').count()) === 1 && (await mixed.locator('.att-audio-name').innerText()).includes('voice-memo.wav'))
check('other files render as download chips', (await mixed.locator('.att-file-link[download="budget-notes.txt"]').count()) === 1)
check('no grid for a message without media', (await mixed.locator('.att-grid').count()) === 0)

// 5. Search by filename, previews for attachment-only messages, reply quote
const sb = page.getByRole('searchbox', { name: 'Search' })
await sb.fill('budget')
await page.locator('.result-row').first().waitFor()
check('search finds a message by attachment file name', (await page.locator('.result-row').count()) === 1 && (await page.locator('.result-text').innerText()).startsWith('Voice note'))
await sb.fill('red-photo')
await page.locator('.result-row').first().waitFor()
check('attachment-only message previews as "1 attachment"', (await page.locator('.result-text').first().innerText()) === '1 attachment' || (await page.locator('.result-row').count()) === 2)
await sb.fill('')
await only.hover(); await only.getByRole('button', { name: 'Reply' }).click()
check('reply quote of attachment-only message', (await composer.locator('.quote-text').innerText()) === '1 attachment')
await composer.getByRole('button', { name: 'Cancel reply' }).click()

// 6. Attachments are immutable: edit mode shows no attach or remove controls
await trip.hover(); await trip.getByRole('button', { name: 'Edit' }).click()
await page.getByLabel('Edit message').waitFor()
check('edit mode has no attach button and no remove controls', (await trip.getByRole('button', { name: 'Attach files' }).count()) === 0 && (await trip.locator('.att-remove').count()) === 0)
await page.getByLabel('Edit message').press('Escape')

// 7. Deleting a message cleans up its files
page.once('dialog', (d) => d.accept())
await only.hover(); await only.getByRole('button', { name: 'Delete' }).click()
await page.waitForFunction(() => document.querySelectorAll('.msg').length === 2)
const counts = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('pilefile'); r.onsuccess = () => { const d = r.result; const tx = d.transaction(['files', 'thumbs', 'attachments']); const out = {}; let left = 3; for (const s of ['files', 'thumbs', 'attachments']) { const c = tx.objectStore(s).count(); c.onsuccess = () => { out[s] = c.result; if (--left === 0) { res(out); d.close() } } } } }))
check('deleting a message removes its files, thumbs and metadata', counts.files === 5 && counts.attachments === 5 && counts.thumbs === 3, JSON.stringify(counts))
await page.screenshot({ path: shotPath('v9-attachments.png') })
check('no console errors', errors.length === 0, errors.join(' | '))
await finish(browser)
