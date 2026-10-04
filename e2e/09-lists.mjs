import { BASE, checker, launch, shotPath } from './helpers.mjs'
const { check, finish } = checker()
const browser = await launch()
const page = await (await browser.newContext({ viewport: { width: 900, height: 900 } })).newPage()
await page.goto(BASE)
const c = page.getByLabel('Write to Inbox')
const cases = [
  ['tight mixed', '- [ ] Test\n- Work Backlog\n  - Pepsi'],
  ['tight two', '- [ ] Test\n- Work Backlog'],
  ['plain nested', '- Work Backlog\n    - Pepsi'],
  ['loose mixed', '- [ ] Test\n\n- Work Backlog\n    - Pepsi'],
  ['loose tasks', '- [ ] One\n\n- [x] Two\n\n    - [ ] Nested'],
]
for (const [, src] of cases) { await c.fill(src); await c.press('Enter'); await page.waitForTimeout(30) }
await page.waitForFunction((n) => document.querySelectorAll('.msg').length === n, cases.length)
const cards = page.locator('.msg')
// newest first, so reverse the case order
for (let i = 0; i < cases.length; i++) {
  const [name] = cases[i]
  const card = cards.nth(cases.length - 1 - i)
  const info = await card.locator('.md').evaluate((md) => {
    const items = [...md.querySelectorAll('li')]
    return items.map((li) => {
      // First real content of the item: a non-blank text node, or the leading <p> in a loose list.
      const node = [...li.childNodes].find((n) => (n.nodeType === 3 && n.textContent.trim()) || (n.nodeType === 1 && n.tagName === 'P'))
      const range = document.createRange(); range.selectNodeContents(node)
      const r = range.getBoundingClientRect()
      const li_r = li.getBoundingClientRect()
      const cb = li.querySelector(':scope > input, :scope > p > input')
      return { label: li.textContent.trim().split('\n')[0].slice(0, 12), textTop: Math.round(r.top - li_r.top), textLeft: Math.round(r.left), liLeft: Math.round(li_r.left), cb: cb ? Math.round(cb.getBoundingClientRect().left) : null, depth: (() => { let d = 0, p = li.parentElement; while (p && p !== md) { if (p.tagName === 'UL' || p.tagName === 'OL') d++; p = p.parentElement } return d })() }
    })
  })
  const sameLine = info.every((x) => x.textTop <= 4)
  const indentOk = info.every((x) => x.depth === 1 || info.find((y) => y.depth === x.depth - 1).textLeft < x.textLeft)
  check(`${name}: text on the marker line, nesting indented`, sameLine && indentOk, JSON.stringify(info))
}
// checkbox sits left of the text, in the gutter
const gutter = await cards.last().locator('.md li.task-list-item').first().evaluate((li) => { const cb = li.querySelector('input'); return cb.getBoundingClientRect().right <= li.getBoundingClientRect().left })
check('checkbox occupies the bullet gutter', gutter)
await page.screenshot({ path: shotPath('v10-lists.png') })
await finish(browser)
