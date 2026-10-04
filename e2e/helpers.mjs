import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

/** Base URL of the app under test (the Vite dev server that proxies /api to the API server). */
export const BASE = process.env.E2E_BASE ?? 'http://localhost:5173'

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
