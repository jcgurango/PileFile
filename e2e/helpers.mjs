import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

/** Base URL of the app under test (the Vite dev server that proxies /api to the API server). */
export const BASE = process.env.E2E_BASE ?? 'http://localhost:5173'

/** The production build served by the API server; set by the runner only for specs named *prod*. */
export const PROD_BASE = process.env.E2E_PROD_BASE ?? ''

/** Server data directory for the current run, when a spec needs to look at files on disk. */
export const DATA_DIR = process.env.E2E_DATA ?? ''

/** Launches Chromium. Prefers the installed Chrome (E2E_CHANNEL), falls back to Playwright's own build. */
export async function launch() {
  const channel = process.env.E2E_CHANNEL ?? 'chrome'
  try {
    return await chromium.launch({ channel })
  } catch {
    return chromium.launch()
  }
}

/** Collects PASS/FAIL lines and exits non-zero if anything failed. */
export function checker() {
  const results = []
  const check = (name, ok, extra = '') => {
    results.push(Boolean(ok))
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
  }
  const finish = async (browser) => {
    await browser?.close()
    const passed = results.filter(Boolean).length
    console.log(`${passed}/${results.length} passed`)
    process.exit(passed === results.length ? 0 : 1)
  }
  return { check, finish }
}

/** Screenshots land in e2e/.shots (git-ignored). */
export function shotPath(name) {
  const dir = new URL('./.shots/', import.meta.url).pathname
  mkdirSync(dir, { recursive: true })
  return dir + name
}

export const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url).pathname

/**
 * A stream's page as stored in the browser: the newest tip, read back through its chain of
 * patches (a ChangeSet in JSON is a list of kept lengths and [deleted, ...insertedLines]).
 * Also returns the raw rows, oldest first.
 */
export const storedPage = (page) => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('pilefile'); r.onsuccess = () => { r.result.transaction('pageVersions').objectStore('pageVersions').getAll().onsuccess = (e) => {
  const rows = e.target.result.sort((a, b) => a.createdAt - b.createdAt); const byId = new Map(rows.map((v) => [v.id, v]))
  const textOf = (v) => { if (!v) return null; if (v.text !== undefined) return v.text; const base = textOf(byId.get(v.parentId)); if (base === null) return null; let out = ''; let pos = 0; for (const sec of JSON.parse(v.patch)) { if (typeof sec === 'number') { out += base.slice(pos, pos + sec); pos += sec } else { pos += sec[0]; out += sec.slice(1).join('\n') } } return out }
  const used = new Set(rows.flatMap((v) => [v.parentId, v.mergeOf].filter(Boolean)))
  const tip = rows.filter((v) => !used.has(v.id) && textOf(v) !== null).sort((a, b) => b.createdAt - a.createdAt)[0]
  res({ text: tip ? textOf(tip) : '', rows: rows.map((v) => ({ id: v.id, parentId: v.parentId, mergeOf: v.mergeOf, kind: v.text !== undefined ? 'snapshot' : 'patch' })) })
} } }))
