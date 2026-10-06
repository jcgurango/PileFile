import { BASE, checker, launch, shotPath } from './helpers.mjs'
const { check, finish } = checker()
const browser = await launch()
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(BASE)
const card = (t) => page.locator('.msg', { has: page.locator('.msg-text', { hasText: t }) })
const row = (name) => page.locator('.stream-list .stream-row', { has: page.locator('.stream-name', { hasText: new RegExp(`^${name}$`) }) })
const go = async (name) => { await row(name).locator('.stream-btn').click(); await page.getByRole('heading', { name, level: 2 }).waitFor() }
const act = async (t, name) => { await card(t).first().hover(); await card(t).first().getByRole('button', { name, exact: true }).click() }
const tab = (name) => page.getByRole('tab', { name })
const selectedTab = () => page.locator('.view-tab.selected').innerText()
const texts = () => page.locator('.msg .msg-text').allInnerTexts().then((t) => t.join(','))
const waitTexts = (want) => page.waitForFunction((want) => [...document.querySelectorAll('.msg .msg-text')].map((e) => e.innerText).join(',') === want, want, { timeout: 5000 }).then(() => true, () => false)
const post = async (text, shown = text) => { const c = page.locator('.composer textarea'); await c.fill(text); await c.press('Enter'); await card(shown).first().waitFor(); await page.waitForTimeout(15) }
const reply = async (to, text) => { await act(to, 'Reply'); await page.locator('.composer .quote').waitFor(); await post(text) }
const idOf = (t) => card(t).first().getAttribute('data-id')
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const editor = page.locator('.page-editor .cm-content')
/** The page as stored: what the editor has written back. */
const pageText = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('pilefile'); r.onsuccess = () => { r.result.transaction('pageVersions').objectStore('pageVersions').getAll().onsuccess = (e) => res(e.target.result.sort((a, b) => b.createdAt - a.createdAt)[0]?.text ?? '') } }))
const versionCount = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('pilefile'); r.onsuccess = () => { r.result.transaction('pageVersions').objectStore('pageVersions').count().onsuccess = (e) => res(e.target.result) } }))
const saved = () => page.locator('.page-bar .hint', { hasText: /^Saved$/ }).waitFor()
/** Types at the very end of the page. insertText goes in as one paste-like input, so list continuation does not interfere. */
const appendToPage = async (text) => { await editor.click(); await page.keyboard.press(`${MOD}+End`); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'); await page.keyboard.insertText(text); await saved() }
const lineOf = (text) => page.locator('.page-editor .cm-line', { hasText: text })

await page.getByRole('heading', { name: 'All', level: 2 }).waitFor()
check('All has no view tabs', (await page.locator('.view-tabs').count()) === 0)
await page.getByRole('button', { name: 'New stream' }).click()
await page.getByLabel('New stream name').fill('Work'); await page.getByLabel('New stream name').press('Enter')
await page.getByRole('heading', { name: 'Work', level: 2 }).waitFor()
check('a stream offers Page, Messages and Threaded, and opens on Messages', (await page.locator('.view-tab').allInnerTexts()).join(',') === 'Page,Messages,Threaded' && (await selectedTab()) === 'Messages')

// ---------------------------------------------------------------- threaded
await post('Root one')
await post('Root two')
await reply('Root one', 'Reply A')
await reply('Reply A', 'Reply B')
await post('Root three')
check('Messages view is flat, newest first', await waitTexts('Root three,Reply B,Reply A,Root two,Root one'), await texts())
await tab('Threaded').click()
check('Threaded orders threads by their latest message and replies oldest first', await waitTexts('Root three,Root one,Reply A,Reply B,Root two'), await texts())
check('replies nest under the message they answer, to any depth', (await page.locator('.thread-replies > .msg', { hasText: 'Reply A' }).count()) === 1 && (await page.locator('.thread-replies .thread-replies > .msg', { hasText: 'Reply B' }).count()) === 1)
check('a nested reply does not repeat its original as a quotation', (await card('Reply A').locator('.quote').count()) === 0)
await page.screenshot({ path: shotPath('v11-threaded.png') })
await reply('Root two', 'Reply C')
check('a new reply lifts its whole thread to the top, and sending keeps the Threaded view', (await waitTexts('Root two,Reply C,Root three,Root one,Reply A,Reply B')) && (await selectedTab()) === 'Threaded', await texts())
await page.locator('header').getByRole('button', { name: 'Unread only' }).click()
check('the unread filter shows a flat list even in Threaded', (await page.locator('.thread').count()) === 0 && (await page.locator('.msg').count()) === 6)
await page.locator('header').getByRole('button', { name: 'Unread only' }).click()

// ---------------------------------------------------------------- remembered view
await go('All')
await go('Work')
check('coming back to a stream reopens the view it was left in', (await selectedTab()) === 'Threaded')
await page.reload()
await page.getByRole('heading', { name: 'Work', level: 2 }).waitFor()
await page.locator('.view-tab.selected').waitFor()
check('and so does a reload', (await selectedTab()) === 'Threaded')

// ---------------------------------------------------------------- the page
await tab('Page').click()
await editor.waitFor()
check('a new stream\'s page is an empty editor, with the composer still on top', (await page.locator('.composer textarea').count()) === 1 && (await page.locator('.page-editor .cm-placeholder').count()) === 1 && (await page.locator('header').getByRole('button', { name: 'Search' }).count()) === 0)
await appendToPage('# Plan\n\nSome **bold** intro\n- [ ] task one\n- plain item')
check('typing saves by itself', (await pageText()) === '# Plan\n\nSome **bold** intro\n- [ ] task one\n- plain item')

// Live preview: marks hide away from the caret and come back under it
await lineOf('plain item').click()
check('a heading is styled and its # is hidden while the caret is elsewhere', (await lineOf('Plan').first().getAttribute('class')).includes('lp-h1') && (await lineOf('Plan').first().innerText()) === 'Plan')
check('bold is styled with its ** hidden', (await page.locator('.page-editor .lp-strong').innerText()) === 'bold')
await lineOf('Plan').first().click()
check('the caret on a heading reveals its #', (await lineOf('Plan').first().innerText()) === '# Plan')
await page.locator('.page-editor .lp-strong').click()
check('the caret inside bold text reveals the **', (await page.locator('.page-editor .lp-strong').innerText()) === '**bold**')
await page.screenshot({ path: shotPath('v12-live-preview.png') })

// Tasks are real checkboxes
await lineOf('plain item').click()
const box = page.locator('.page-editor input.lp-checkbox')
check('"- [ ]" is a real checkbox and the source marker is hidden', (await box.count()) === 1 && !(await box.isChecked()) && (await lineOf('task one').innerText()).trim() === 'task one')
await box.click()
await page.waitForFunction(() => document.querySelector('.page-editor input.lp-checkbox')?.checked === true)
await saved()
check('ticking it rewrites the marker in the page text', (await pageText()).includes('- [x] task one'))
check('a done task is struck through', (await page.locator('.page-editor .lp-done').innerText()) === 'task one')
check('one burst of typing is one version, not one per pause', (await versionCount()) === 1, String(await versionCount()))
await page.reload()
await page.getByRole('heading', { name: 'Work', level: 2 }).waitFor()
await editor.waitFor()
check('the page and the Page view survive a reload', (await selectedTab()) === 'Page' && (await page.locator('.page-editor input.lp-checkbox').isChecked()))
check('an untouched page reads as rendered: no marks shown before the editor is focused', (await lineOf('Plan').first().innerText()) === 'Plan')
await appendToPage('\nAfter reload')
await page.getByRole('button', { name: /History/ }).waitFor()
check('a later editing session starts a new version', (await versionCount()) === 2)
await page.getByRole('button', { name: /History/ }).click()
await page.locator('.page .vnav').waitFor()
await page.locator('.page .vnav').getByRole('button').first().click()
await page.locator('.page-editor.read-only').waitFor()
check('page history steps back to the earlier version, read-only', (await page.locator('.page-editor.read-only .cm-content').getAttribute('contenteditable')) === 'false' && !(await page.locator('.page-editor').innerText()).includes('After reload') && (await page.locator('.page-editor input.lp-checkbox').isDisabled()) && (await page.locator('.page-bar .hint').innerText()) === 'Viewing an earlier version')
await page.getByRole('button', { name: /History/ }).click()
await page.locator('.page-editor:not(.read-only)').waitFor()

// Add to page from the other views
await tab('Messages').click()
await act('Root three', 'Add to page')
await card('Root three').getByRole('button', { name: 'On page' }).waitFor()
check('Add to page marks the message as on the page', true)
await card('Root three').getByRole('button', { name: 'On page' }).click()
const embedded = page.locator('[data-embed^="message:"] .msg')
await embedded.waitFor()
check('On page opens the Page view, where the message is embedded as its card', (await selectedTab()) === 'Page' && (await embedded.locator('.msg-text').innerText()) === 'Root three')
await embedded.hover()
check('an embedded message offers Dissolve and Copy but not Add to page', (await embedded.getByRole('button', { name: 'Dissolve' }).count()) === 1 && (await embedded.getByRole('button', { name: 'Copy' }).count()) === 1 && (await embedded.getByRole('button', { name: /page/i }).count()) === 0)

// A card inside the page is not part of the editable text
await saved()
const beforeClick = await pageText()
await embedded.locator('.msg-text').click()
await page.keyboard.type('zzz')
await page.keyboard.press('Backspace')
await page.keyboard.press('Enter')
await page.waitForTimeout(1000)
check('clicking into an embedded card and typing does not edit the page', (await pageText()) === beforeClick && (await embedded.locator('.msg-text').innerText()) === 'Root three' && (await page.evaluate(() => document.activeElement?.classList.contains('page-embed'))))
check('and no embed source is revealed by it', (await page.locator('.page-editor .lp-embed-src:not(.lp-embed-collapsed)').count()) === 0)

// Thread and summary embeds, written by hand
await tab('Messages').click()
const rootOne = await idOf('Root one')
const rootTwo = await idOf('Root two')
await tab('Page').click()
await editor.waitFor()
await appendToPage(`\n![[thread:${rootOne}]]\n\nSee also:\n![[summary:${rootTwo}]]\n\n\`\`\`\n![[message:${rootOne}]]\n\`\`\`\n`)
await lineOf('After reload').click()
await page.locator('.page-embed-thread .msg').first().waitFor()
check('a thread embed shows the message with its replies nested', (await page.locator('.page-embed-thread .msg .msg-text').allInnerTexts()).join(',') === 'Root one,Reply A,Reply B' && (await page.locator('.page-embed-thread .thread-replies .thread-replies > .msg').count()) === 1)
check('a summary embed is a one-line quotation', (await page.locator('.page-embed-summary .quote-text').innerText()) === 'Root two')
check('an embed line inside a code block stays text', (await page.locator('.page-editor .lp-codeline', { hasText: `![[message:${rootOne}]]` }).count()) === 1)
check('an embed\'s own line is collapsed while the caret is elsewhere', (await page.locator('.page-editor .lp-embed-collapsed').count()) === 3)
await lineOf('See also').click()
await page.keyboard.press('ArrowDown')
check('moving the caret onto an embed reveals its source line above the card', (await page.locator('.page-editor .lp-embed-src:not(.lp-embed-collapsed)').innerText()) === `![[summary:${rootTwo}]]` && (await page.locator('.page-embed-summary .quote-text').innerText()) === 'Root two')
await page.keyboard.press('ArrowDown')
check('and the caret walks on past the card', (await page.locator('.page-editor .lp-embed-src:not(.lp-embed-collapsed)').count()) === 0)
await page.keyboard.press('ArrowUp')
check('coming back up stops on the embed again', (await page.locator('.page-editor .lp-embed-src:not(.lp-embed-collapsed)').count()) === 1)
await lineOf('After reload').click()
await page.screenshot({ path: shotPath('v11-page.png'), fullPage: false })

// Editing an embedded message is editing the message
const replyA = page.locator('.page-embed-thread .msg', { has: page.locator('.msg-text', { hasText: 'Reply A' }) })
const replyAId = await replyA.getAttribute('data-id')
await replyA.hover(); await replyA.getByRole('button', { name: 'Edit', exact: true }).click()
const ed = page.getByLabel('Edit message'); await ed.press('End'); await ed.type(' (edited on the page)'); await ed.press('Enter')
await page.locator(`.page-embed-thread .msg[data-id="${replyAId}"] time`, { hasText: 'edited' }).waitFor()
check('editing an embedded message edits the message itself', (await page.locator(`.msg[data-id="${replyAId}"] .msg-text`).innerText()) === 'Reply A (edited on the page)')

// Dissolve
await embedded.hover(); await embedded.getByRole('button', { name: 'Dissolve' }).click()
await page.waitForFunction(() => !document.querySelector('[data-embed^="message:"]'))
await saved()
check('Dissolve writes the text into the page and leaves a summary behind', (await lineOf('Root three').count()) === 1 && (await page.locator('.page-embed-summary .quote-text').allInnerTexts()).join(',') === 'Root three,Root two' && (await pageText()).includes('\nRoot three\n'))

// The summary links to the message; the composer sends into the Messages view
await page.locator('.page-embed-summary button.quote-body').last().click()
await card('Root two').first().waitFor()
check('a summary opens its message in the Messages view', (await selectedTab()) === 'Messages')
await tab('Page').click()
await editor.waitFor()
await post('**Bold** from the page', 'Bold from the page')
check('sending from the Page view flips to Messages', (await selectedTab()) === 'Messages')

// Copy
await act('Bold from the page', 'Copy')
await card('Bold from the page').getByRole('button', { name: 'Copied' }).waitFor()
check('Copy puts the message\'s Markdown on the clipboard', (await page.evaluate(() => navigator.clipboard.readText())) === '**Bold** from the page')

// A deleted message leaves a placeholder on the page
page.once('dialog', (d) => d.accept())
await act('Root two', 'Delete')
await card('Root two').first().waitFor({ state: 'detached' })
await tab('Page').click()
await page.locator('.page-embed-summary').first().waitFor()
check('an embed of a deleted message says so', (await page.locator('.page-embed-summary').last().innerText()).includes('Original message was deleted'))

// Add to page from All goes to the message's own stream; unfiled messages have no page
await go('All')
await post('Loose thought')
await card('Root one').first().hover()
check('in All, a filed message knows it is on its stream\'s page', (await card('Root one').first().getByRole('button', { name: 'On page' }).count()) === 1)
await card('Loose thought').hover()
check('an unfiled message has no page to be added to', (await card('Loose thought').getByRole('button', { name: /page/i }).count()) === 0 && (await card('Loose thought').getByRole('button', { name: 'Copy' }).count()) === 1)

// Narrow screens: tabs and the sheet
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Open streams' }).click()
await row('Work').locator('.stream-btn').click()
await page.getByRole('heading', { name: 'Work', level: 2 }).waitFor()
await editor.waitFor()
const fits = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth, tabs: Math.round(document.querySelector('.view-tabs').lastElementChild.getBoundingClientRect().right) }))
check('the Page view fits a phone screen', fits.doc <= fits.win && fits.tabs <= fits.win, JSON.stringify(fits))
await page.screenshot({ path: shotPath('v11-page-narrow.png') })
await tab('Messages').click()
await card('Root one').first().getByRole('button', { name: 'More actions' }).click()
check('the action sheet lists the new actions', ['On page', 'Copy'].every(async (l) => (await page.locator('dialog.sheet .sheet-label', { hasText: l }).count()) === 1) && (await page.locator('dialog.sheet .sheet-label').allInnerTexts()).includes('Copy') && (await page.locator('dialog.sheet .sheet-label').allInnerTexts()).includes('On page'))
await page.locator('dialog.sheet').getByRole('button', { name: 'Cancel' }).click()

// Deleting the stream says what happens to the page
await page.setViewportSize({ width: 1200, height: 900 })
await page.waitForTimeout(300)
let said = ''
page.once('dialog', (d) => { said = d.message(); d.dismiss() })
await page.locator('header').getByRole('button', { name: 'Delete' }).click()
await page.waitForTimeout(100)
check('deleting a stream warns that its page goes with it', said.includes('Its page is deleted with it'), said)

check('no console errors', errors.length === 0, errors.join(' | '))
await finish(browser)
