import { BASE, checker, launch, shotPath } from './helpers.mjs'
const { check, finish } = checker()
const browser = await launch()
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const card = (t) => page.locator('.msg', { has: page.locator('.msg-text', { hasText: t }) })
const row = (name) => page.locator('.stream-list .stream-row', { has: page.locator('.stream-name', { hasText: new RegExp(`^${name}$`) }) })
const title = (name) => page.getByRole('heading', { name, level: 2, exact: true })
const go = async (name) => { await row(name).first().locator('.stream-btn').click(); await title(name).waitFor() }
const path = () => new URL(page.url()).pathname
const waitPath = (want) => page.waitForFunction((want) => location.pathname === want, want, { timeout: 5000 }).then(() => true, () => false)
const names = () => page.locator('.stream-list .stream-name').allInnerTexts().then((t) => t.slice(2).join(','))
const crumbs = () => page.locator('.crumb-btn').allInnerTexts().then((t) => t.join('/'))
const addStream = async (typed, opens) => { await page.getByRole('button', { name: 'New stream' }).click(); await page.getByLabel('New stream name').fill(typed); await page.getByLabel('New stream name').press('Enter'); await title(opens).waitFor() }
const post = async (target, text) => { const c = page.getByLabel(`Write to ${target}`); await c.fill(text); await c.press('Enter'); await card(text).waitFor() }
const reload = async (expect) => { await page.reload(); await title(expect).waitFor() }
const history = async (dir, expect) => { await page.evaluate((d) => (d === 'back' ? history.back() : history.forward()), dir); await title(expect).waitFor() }
const header = page.locator('header')

// The two fixed views
await page.goto(BASE)
await title('All').waitFor()
check('/ is All', path() === '/')
await go('Inbox')
check('the Inbox lives at /inbox', path() === '/inbox')
await reload('Inbox')
check('refreshing /inbox stays in the Inbox', (await row('Inbox').getAttribute('class')).includes('selected'))

// Streams by name
await addStream('Work', 'Work')
check('a stream lives at /s/<name>', path() === '/s/Work', path())
await post('Work', 'Work note')
await reload('Work')
await card('Work note').waitFor()
check('refreshing a stream address reopens that stream', path() === '/s/Work')

// "/" in a new stream's name is a path: missing levels are created, existing ones reused
await addStream('Work/Projects/Alpha Beta', 'Alpha Beta')
check('a path creates every missing level under the existing stream', (await names()) === 'Work,Projects,Alpha Beta' && (await crumbs()) === 'Work/Projects', await names())
check('nested streams live at /s/<stream>/<substream>', path() === '/s/Work/Projects/Alpha%20Beta', path())
await reload('Alpha Beta')
check('refreshing a nested address reopens it with its breadcrumbs', (await crumbs()) === 'Work/Projects')
await addStream('work / PROJECTS', 'Projects')
check('an existing path is opened, not duplicated (case and spacing ignored)', (await names()) === 'Work,Projects,Alpha Beta' && path() === '/s/Work/Projects', `${await names()} ${path()}`)
await addStream(' Home // Chores / ', 'Chores')
check('empty path levels are skipped', (await names()) === 'Work,Projects,Alpha Beta,Home,Chores' && path() === '/s/Home/Chores', `${await names()} ${path()}`)
await go('Home')
await header.getByRole('button', { name: 'Nest new' }).click()
await page.getByLabel('New stream name').fill('Garden/Tools'); await page.getByLabel('New stream name').press('Enter')
await title('Tools').waitFor()
check('a path typed into Nest new is created below the open stream', path() === '/s/Home/Garden/Tools' && (await crumbs()) === 'Home/Garden', path())
await page.screenshot({ path: shotPath('v10-routes.png') })

// Back and Forward
await history('back', 'Home')
check('Back returns to the previous view', path() === '/s/Home' && (await row('Home').getAttribute('class')).includes('selected'))
await history('back', 'Chores')
await history('forward', 'Home')
await history('forward', 'Tools')
check('Forward goes ahead again', path() === '/s/Home/Garden/Tools')

// "/" cannot be part of a name; the address follows a rename or a move
await header.getByRole('button', { name: 'Rename' }).click()
await page.getByLabel('Stream name').fill('She/ds')
check('"/" cannot be typed into a stream name', (await page.getByLabel('Stream name').inputValue()) === 'Sheds')
await page.getByLabel('Stream name').press('Enter')
await title('Sheds').waitFor()
check('renaming the open stream updates its address', await waitPath('/s/Home/Garden/Sheds'), path())
await reload('Sheds')
await header.getByRole('button', { name: 'Move' }).click()
await page.locator('#move-parent').selectOption({ label: 'Work' })
await page.locator('.crumb-btn', { hasText: 'Work' }).waitFor()
check('moving the open stream updates its address', await waitPath('/s/Work/Sheds'), path())
await history('back', 'Home')
check('rename and move did not add history entries', path() === '/s/Home')

// Typed or pasted addresses
await page.goto(BASE + '/s/work/projects/alpha%20beta/')
await title('Alpha Beta').waitFor()
check('an address is matched ignoring case and gets tidied to the real names', await waitPath('/s/Work/Projects/Alpha%20Beta'), path())
await addStream('v1.2 & co? #1', 'v1.2 & co? #1')
check('names with dots and punctuation are encoded in the address', path() === '/s/' + encodeURIComponent('v1.2 & co? #1'), path())
await reload('v1.2 & co? #1')
check('and such an address survives a refresh', true)
await page.goto(BASE + '/s/Nope/Nada')
await title('All').waitFor()
check('an address that names no stream shows All and is left as typed', path() === '/s/Nope/Nada' && (await row('All').getAttribute('class')).includes('selected'))
await go('Inbox')
check('navigation carries on from an unknown address', path() === '/inbox')

// Two streams can still end up with one name (rename, move, another device): the view remembers which one it is
await addStream('Twin', 'Twin')
await post('Twin', 'first twin')
await addStream('Other', 'Other')
await post('Other', 'second twin')
await header.getByRole('button', { name: 'Rename' }).click()
await page.getByLabel('Stream name').fill('Twin'); await page.getByLabel('Stream name').press('Enter')
await title('Twin').waitFor()
await waitPath('/s/Twin')
await reload('Twin')
await card('second twin').waitFor()
check('a refresh keeps the exact stream even when its name is shared', (await card('first twin').count()) === 0)
await go('All')
await page.goto(BASE + '/s/Twin')
await title('Twin').waitFor()
await card('first twin').waitFor()
check('a pasted address goes to the older of two namesakes', (await card('second twin').count()) === 0)

// Deleting the open stream leaves its address
page.once('dialog', (d) => d.accept())
await header.getByRole('button', { name: 'Delete' }).click()
await title('All').waitFor()
check('deleting the open stream goes to All at /, not to its namesake', await waitPath('/'), path())

// Other ways in
await page.getByRole('searchbox', { name: 'Search' }).fill('work note')
await page.locator('.result-row').first().click()
await title('Work').waitFor()
check('a search result opens the stream at its address', path() === '/s/Work')
await page.getByRole('searchbox', { name: 'Search' }).fill('')
await go('All')
await post('All', 'loose page')
await card('loose page').hover(); await card('loose page').getByRole('button', { name: 'Move', exact: true }).click()
await card('loose page').getByLabel('New stream name').fill('Archive/2026'); await card('loose page').getByLabel('New stream name').press('Enter')
await card('loose page').locator('.chip', { hasText: '#2026' }).waitFor()
check('a path typed into the move picker is created and the message filed at its end', (await row('Archive').count()) === 1 && (await row('2026').count()) === 1 && path() === '/')

check('no console errors', errors.length === 0, errors.join(' | '))
await finish(browser)
