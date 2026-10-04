import { BASE, checker, launch, shotPath } from './helpers.mjs'
const { check, finish } = checker()
const browser = await launch()
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(BASE)
const card = (t) => page.locator('.msg', { has: page.locator('.msg-text', { hasText: t }) })
const row = (name) => page.locator('.stream-list .stream-row', { has: page.locator('.stream-name', { hasText: new RegExp(`^${name}$`) }) })
const go = async (name) => { await row(name).locator('.stream-btn').click(); await page.getByRole('heading', { name, level: 2 }).waitFor() }
const count = (name) => row(name).locator('.stream-count').innerText().catch(() => '')
const act = async (t, name) => { await card(t).hover(); await card(t).getByRole('button', { name, exact: true }).click() }
const waitCount = (n) => page.waitForFunction((n) => document.querySelectorAll('.msg').length === n, n)
const header = page.locator('header')

check('Inbox is the landing view', (await page.getByRole('heading', { level: 2 }).innerText()) === 'Inbox')
check('sidebar lists Inbox then All', (await page.locator('.stream-list .stream-name').allInnerTexts()).join(',') === 'Inbox,All')
check('mark-all disabled when empty', await header.getByRole('button', { name: 'Mark all as read' }).isDisabled())
check('empty inbox says caught up', (await page.locator('.empty').innerText()).includes('caught up'))

await page.getByRole('button', { name: 'New stream' }).click()
await page.getByLabel('New stream name').fill('Work'); await page.getByLabel('New stream name').press('Enter')
await page.getByRole('heading', { name: 'Work', level: 2 }).waitFor()
const cw = page.getByLabel('Write to Work'); await cw.fill('In work'); await cw.press('Enter'); await card('In work').waitFor()
await go('Inbox')
const ci = page.getByLabel('Write to Inbox'); await ci.fill('Loose note'); await ci.press('Enter'); await card('Loose note').waitFor()
await waitCount(2)
check('new messages from any stream land in Inbox', true)
check('unread cards show a dot', (await page.locator('.msg .unread-dot').count()) === 2 && (await page.locator('.msg.unread').count()) === 2)
await page.waitForFunction(() => document.querySelector('.badge-count')?.textContent === '2')
check('Inbox badge shows unread count, All shows total', (await count('Inbox')) === '2' && (await count('All')) === '2')
check('stream chip visible in Inbox for filed message', await card('In work').locator('.chip', { hasText: '#Work' }).isVisible())
await page.screenshot({ path: shotPath('v7-inbox.png') })

// Mark read in Inbox removes the card
await act('Loose note', 'Mark read')
await waitCount(1)
check('Mark read removes it from the Inbox', (await card('Loose note').count()) === 0)
check('Inbox count drops', (await count('Inbox')) === '1')
await go('All')
await waitCount(2)
check('All keeps every message', true)
check('read card has no dot and offers Mark unread', (await card('Loose note').locator('.unread-dot').count()) === 0 && (await card('Loose note').getByRole('button', { name: 'Mark unread' }).count()) === 1)
check('unread card in All still shows dot and Mark read', (await card('In work').locator('.unread-dot').count()) === 1)

// Mark read from a stream view: stays there, leaves Inbox
await go('Work')
await act('In work', 'Mark read')
await page.waitForFunction(() => !document.querySelector('.msg .unread-dot'))
check('stream view: mark read keeps the card, clears dot', (await card('In work').count()) === 1)
await page.waitForFunction(() => !document.querySelector('.badge-count'))
check('Inbox badge hidden at zero', (await count('Inbox')) === '')
await act('In work', 'Mark unread')
await card('In work').locator('.unread-dot').waitFor()
check('stream view: mark unread brings the dot back', true)
await page.waitForFunction(() => document.querySelector('.badge-count')?.textContent === '1')
check('Inbox count back to 1', true)

// Editing a read message leaves it read
await go('All')
await act('Loose note', 'Edit')
const ed = page.getByLabel('Edit message'); await ed.press('End'); await ed.type(' edited'); await ed.press('Enter')
await card('Loose note').locator('time', { hasText: 'edited' }).waitFor()
check('editing content keeps it read', (await card('Loose note').locator('.unread-dot').count()) === 0 && (await count('Inbox')) === '1')
await act('Loose note', 'Mark unread')
await page.waitForFunction(() => document.querySelector('.badge-count')?.textContent === '2')

// Mark all as read with confirmation
await go('Inbox')
await waitCount(2)
let dialogText = ''
page.once('dialog', (d) => { dialogText = d.message(); d.dismiss() })
await header.getByRole('button', { name: 'Mark all as read' }).click()
await page.waitForTimeout(100)
check('confirmation names the count', dialogText === 'Mark 2 messages as read?', dialogText)
check('dismissing keeps the Inbox', (await page.locator('.msg').count()) === 2)
page.once('dialog', (d) => d.accept())
await header.getByRole('button', { name: 'Mark all as read' }).click()
await page.locator('.empty').waitFor()
check('accepting clears the Inbox', (await page.locator('.msg').count()) === 0)
await go('All')
await waitCount(2)
check('All unaffected, no dots left', (await page.locator('.unread-dot').count()) === 0)

// Task checkbox toggle does not change read state
const ca = page.getByLabel('Write to All'); await ca.fill('- [ ] follow up'); await ca.press('Enter'); await card('follow up').waitFor()
check('posting from All lands in Inbox', (await count('Inbox')) === '1')
await act('follow up', 'Mark read')
await page.waitForFunction(() => !document.querySelector('.badge-count'))
await card('follow up').locator('input[type=checkbox]').click()
await card('follow up').locator('time', { hasText: 'edited' }).waitFor()
check('ticking a task keeps it read', (await card('follow up').locator('.unread-dot').count()) === 0 && (await count('Inbox')) === '')

// Search result for an unfiled read message opens All
await page.getByRole('searchbox', { name: 'Search' }).fill('loose')
await page.locator('.result-row').first().click()
check('search result for unfiled message opens All', (await page.getByRole('heading', { level: 2 }).innerText()) === 'All')
await page.getByRole('searchbox', { name: 'Search' }).fill('')

check('no console errors', errors.length === 0, errors.join(' | '))
await finish(browser)
