import { readFileSync } from 'node:fs'
import { PROD_BASE, checker, fixture, launch } from './helpers.mjs'

// Runs against the production build (real service worker), served by the API server.
const { check, finish } = checker()
const browser = await launch()
const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

// Manifest advertises the share target
const manifest = await (await page.request.get(PROD_BASE + '/manifest.webmanifest')).json()
check('manifest declares a share target', manifest.share_target?.action === '/share' && manifest.share_target?.method === 'POST' && manifest.share_target?.params?.files?.[0]?.name === 'files')

// Install the service worker by loading the app once
await page.goto(PROD_BASE + '/')
await page.getByRole('heading', { name: 'Inbox', level: 2 }).waitFor()
const swState = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready
  const sw = reg.active
  if (!sw) return 'none'
  if (sw.state !== 'activated') await new Promise((r) => sw.addEventListener('statechange', r, { once: true }))
  return sw.state
})
check('service worker is active after first load', swState === 'activated', String(swState))

// Simulate the OS share sheet: a multipart POST navigation to /share with text, a link and a file
const png = readFileSync(fixture('red-photo.png')).toString('base64')
await page.evaluate((b64) => {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = '/share'
  form.enctype = 'multipart/form-data'
  const add = (name, value) => { const i = document.createElement('input'); i.name = name; i.value = value; form.appendChild(i) }
  add('title', 'Shared title')
  add('text', 'Some shared text')
  add('url', 'https://example.com/article')
  const files = document.createElement('input'); files.type = 'file'; files.name = 'files'
  const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'shared-photo.png', { type: 'image/png' }))
  files.files = dt.files
  form.appendChild(files)
  document.body.appendChild(form)
  form.submit()
}, png)
await page.waitForURL((u) => !u.pathname.startsWith('/share'), { timeout: 15000 })
const composer = page.getByLabel('Write to Inbox')
await page.waitForFunction(() => /Shared title/.test(document.querySelector('textarea')?.value ?? ''), null, { timeout: 15000 })
check('share redirects into the app and prefills the composer', (await composer.inputValue()) === 'Shared title\nSome shared text\nhttps://example.com/article', JSON.stringify(await composer.inputValue()))
check('share flag is stripped from the URL', !page.url().includes('share='))
await page.locator('.pending-item').waitFor()
check('shared file is queued as a pending attachment', (await page.locator('.pending-name').innerText()) === 'shared-photo.png')
check('composer waits for the user instead of auto-posting', (await page.locator('.msg').count()) === 0)
await page.getByRole('button', { name: 'Save' }).click()
await page.locator('.msg .att-tile img').waitFor({ timeout: 15000 })
check('saving the share posts text with the attachment', (await page.locator('.msg .md').innerText()).includes('Shared title') && (await page.locator('.msg .att-tile').count()) === 1)
check('stash is cleared after intake', (await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('pilefile-share'); r.onsuccess = () => { const d = r.result; const c = d.transaction('shares').objectStore('shares').count(); c.onsuccess = () => { res(c.result); d.close() } } }))) === 0)

// A second share while the app is already open is appended, not lost
await page.evaluate(() => {
  const form = document.createElement('form'); form.method = 'POST'; form.action = '/share'; form.enctype = 'multipart/form-data'
  const i = document.createElement('input'); i.name = 'text'; i.value = 'Second share'; form.appendChild(i); document.body.appendChild(form); form.submit()
})
await page.waitForFunction(() => (document.querySelector('textarea')?.value ?? '') === 'Second share', null, { timeout: 15000 })
check('text-only share prefills just the text', true)

// Without a service worker (e.g. iOS), the server answers the POST by opening the app
const direct = await page.request.post(PROD_BASE + '/share', { multipart: { text: 'no worker' }, maxRedirects: 0 })
check('server fallback redirects a bare share POST to the app', direct.status() === 303 && direct.headers()['location'] === '/', `${direct.status()} ${direct.headers()['location']}`)

check('no console/page errors', errors.length === 0, errors.join(' | '))
await finish(browser)
