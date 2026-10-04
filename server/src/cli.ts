#!/usr/bin/env node
/**
 * Account administration. There is no self-service registration.
 *
 *   npm run cli -- user create <name> [--password <pw>]
 *   npm run cli -- user passwd <name> [--password <pw>]
 *   npm run cli -- user delete <name>
 *   npm run cli -- user list
 */
import { join, resolve } from 'node:path'
import { stdin, stdout } from 'node:process'
import { openDb } from './db.ts'
import { createUser, deleteUser, listUsers, setPassword } from './auth.ts'

const dataDir = resolve(process.env.DATA_DIR ?? './data')

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolvePw, reject) => {
    if (!stdin.isTTY) {
      let buf = ''
      stdin.setEncoding('utf8')
      stdin.on('data', (d) => (buf += d))
      stdin.on('end', () => resolvePw(buf.replace(/\r?\n$/, '')))
      return
    }
    stdout.write(prompt)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let value = ''
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          stdout.write('\n')
          resolvePw(value)
        } else if (c === '\u0003') {
          stdin.setRawMode(false)
          reject(new Error('cancelled'))
        } else if (c === '\u007f' || c === '\b') {
          value = value.slice(0, -1)
        } else {
          value += c
        }
      }
    }
    stdin.on('data', onData)
  })
}

async function askPassword(args: string[]): Promise<string> {
  const i = args.indexOf('--password')
  if (i !== -1 && args[i + 1]) return args[i + 1]
  const first = await readHidden('Password: ')
  if (first.length < 8) throw new Error('Password must be at least 8 characters.')
  const second = await readHidden('Again: ')
  if (first !== second) throw new Error('Passwords do not match.')
  return first
}

async function main(argv: string[]): Promise<number> {
  const [scope, cmd, name, ...rest] = argv
  if (scope !== 'user' || !cmd) {
    console.log('Usage: cli user <create|passwd|delete|list> [name] [--password <pw>]')
    return 2
  }
  const db = openDb(join(dataDir, 'pilefile.sqlite'))
  switch (cmd) {
    case 'create': {
      if (!name) throw new Error('name required')
      const user = createUser(db, name, await askPassword(rest))
      console.log(`Created user ${user.name} (${user.id})`)
      return 0
    }
    case 'passwd': {
      if (!name) throw new Error('name required')
      const ok = setPassword(db, name, await askPassword(rest))
      console.log(ok ? `Password updated for ${name}; existing sessions signed out.` : `No such user: ${name}`)
      return ok ? 0 : 1
    }
    case 'delete': {
      if (!name) throw new Error('name required')
      const ok = deleteUser(db, name)
      console.log(ok ? `Deleted ${name} and all their data.` : `No such user: ${name}`)
      return ok ? 0 : 1
    }
    case 'list': {
      for (const u of listUsers(db)) console.log(`${u.name}\t${u.id}\t${new Date(u.createdAt).toISOString()}`)
      return 0
    }
    default:
      console.log(`Unknown command: ${cmd}`)
      return 2
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: Error) => {
    console.error(err.message)
    process.exit(1)
  },
)
