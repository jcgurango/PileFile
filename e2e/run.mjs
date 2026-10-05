#!/usr/bin/env node
/**
 * Runs the browser end-to-end suites against a fresh API server and a Vite dev server.
 *
 *   npm run test:e2e              # everything
 *   npm run test:e2e -- sync      # only specs whose file name contains "sync"
 *
 * Needs Chrome installed (or `npx playwright install chromium`). Uses ports 8790 and 5174
 * by default (E2E_API_PORT / E2E_WEB_PORT), so it does not collide with `npm run dev`.
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const e2eDir = dirname(fileURLToPath(import.meta.url))
const root = join(e2eDir, '..')
const API_PORT = Number(process.env.E2E_API_PORT ?? 8790)
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174)
const BASE = `http://localhost:${WEB_PORT}`
const only = process.argv.slice(2)

const children = new Set()
function start(cmd, args, env) {
  const child = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))
  child.getLog = () => log
  children.add(child)
  child.on('exit', () => children.delete(child))
  return child
}
/** SIGTERM everything we started and wait briefly; the exit handler SIGKILLs any survivor. */
async function stopAll() {
  const exits = [...children].map((c) => new Promise((r) => c.on('exit', r)))
  for (const c of children) c.kill()
  await Promise.race([Promise.all(exits), new Promise((r) => setTimeout(r, 3000))])
}
process.on('exit', () => {
  for (const c of children) c.kill('SIGKILL')
})
process.on('SIGINT', async () => {
  await stopAll()
  process.exit(130)
})

/** A stale server from an earlier run would answer our health checks and mask failures. */
function portFree(port) {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, () => probe.close(() => resolve(true)))
  })
}
for (const port of [API_PORT, WEB_PORT]) {
  if (!(await portFree(port))) {
    console.error(`Port ${port} is already in use. Stop whatever holds it (lsof -ti:${port}) or set E2E_API_PORT / E2E_WEB_PORT.`)
    process.exit(2)
  }
}

async function waitFor(url, label, ms = 40000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      await fetch(url)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  throw new Error(`Timed out waiting for ${label} at ${url}`)
}

let server = null
let dataDir = null
/** (Re)starts the API server on an empty database with one account: alice / "correct horse". */
async function freshServer() {
  if (server) {
    const exited = new Promise((r) => server.on('exit', r))
    server.kill()
    await exited
  }
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  dataDir = mkdtempSync(join(tmpdir(), 'pilefile-e2e-'))
  execFileSync('node', ['server/src/cli.ts', 'user', 'create', 'alice', '--password', 'correct horse'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir },
    stdio: 'ignore',
  })
  server = start('node', ['server/src/index.ts'], { DATA_DIR: dataDir, PORT: String(API_PORT) })
  await waitFor(`http://localhost:${API_PORT}/api/me`, 'API server')
}

function runSpec(file) {
  return new Promise((resolve) => {
    const child = spawn('node', [join(e2eDir, file)], {
      cwd: root,
      env: { ...process.env, E2E_BASE: BASE, E2E_PROD_BASE: `http://localhost:${API_PORT}`, E2E_DATA: dataDir },
      stdio: 'inherit',
    })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

const viteBin = join(root, 'node_modules', '.bin', 'vite')
const specs = readdirSync(e2eDir)
  .filter((f) => /^\d+-.*\.mjs$/.test(f))
  .filter((f) => only.length === 0 || only.some((o) => f.includes(o)))
  .sort()
if (specs.length === 0) {
  console.error('No specs matched', only)
  process.exit(2)
}

// Specs with "prod" in the name run against the built app served by the API server itself,
// which is the only way to exercise the real service worker (share target, precache).
const needsProd = specs.some((f) => /prod/.test(f))
if (needsProd) {
  console.log('building production bundle for prod specs…')
  execFileSync(viteBin, ['build'], { cwd: root, stdio: 'ignore' })
}
await freshServer()
const vite = start(viteBin, ['--port', String(WEB_PORT), '--strictPort'], {
  API_PORT: String(API_PORT),
})
await waitFor(BASE, 'Vite').catch((err) => {
  console.error(err.message, '\n', vite.getLog())
  process.exit(1)
})

const summary = []
for (const spec of specs) {
  // Sync specs assume an empty account; everything else is local-only and does not care.
  if (/sync/.test(spec)) await freshServer()
  console.log(`\n▶ ${spec}`)
  const code = await runSpec(spec)
  summary.push({ spec, ok: code === 0 })
}

console.log('\n=== e2e summary')
for (const { spec, ok } of summary) console.log(`${ok ? 'ok  ' : 'FAIL'} ${spec}`)
const failed = summary.filter((s) => !s.ok).length
if (failed) {
  console.log(`\n--- server exit code: ${server?.exitCode} · log tail\n` + (server?.getLog() ?? '').split('\n').slice(-20).join('\n'))
  console.log('\n--- vite log tail\n' + vite.getLog().split('\n').slice(-20).join('\n'))
}
await stopAll()
if (dataDir) rmSync(dataDir, { recursive: true, force: true })
if (needsProd) rmSync(join(root, 'dist'), { recursive: true, force: true })
process.exit(failed ? 1 : 0)
