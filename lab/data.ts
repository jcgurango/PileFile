import { db } from '../src/db'
import type { Note } from './store'

const MIN = 60_000

const SAMPLE: Array<[string | null, string]> = [
  [null, 'Call the plumber about the kitchen tap before Friday'],
  ['Work', '## Standup\n- shipped the sync fix\n- **blocked** on the design review\n- [ ] ask Dana about the export format\n- [x] book the room'],
  ['Work/Projects', 'Idea: the inbox could be a *filter* rather than a place.\n\nIf every view has the same shape, the special cases go away.'],
  [null, 'Books\nThe Timeless Way of Building\nA Pattern Language\nNotes on the Synthesis of Form'],
  ['Home', 'Groceries: oat milk, lemons, rye bread, coffee, the good olive oil'],
  ['Work', 'Reading the CodeMirror docs. Things to try:\n\n```ts\nEditorState.changeFilter.of((tr) => protectedRanges(tr))\n```\n\nBlock widgets for the separators, a state field for the section starts.'],
  [null, 'A very short one'],
  ['Journal', 'Walked to the reservoir. The light at four was something else: low and gold across the water, the kind that makes the far bank look painted on. Thought about how much of the week was spent reacting rather than choosing, and how the notes I keep are mostly reactions too. Maybe that is fine. Maybe the choosing happens later, when I read them back and see what kept coming up.'],
  ['Work/Projects', 'https://example.com/a/rather/long/link/that/should/wrap/somewhere/sensible/when/the/pane/is/narrow'],
  ['Home', '- [ ] renew passport\n- [ ] dentist\n- [ ] fix the bike light\n- [x] return the drill'],
  [null, 'Quote of the day:\n> Simplicity is prerequisite for reliability.'],
  ['Work', '#Retro went well. Keep: short demos. Drop: the status round. Try: writing things down first. #process'],
]

const WORDS =
  'note stream inbox filter message archive draft idea later plan review sync offline pin search tag version history share stack pile sort merge quiet morning list call fix send read write keep drop try'.split(
    ' ',
  )

/** Small seeded generator so the stress set is the same on every load. */
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function sentence(rand: () => number, words: number) {
  const out = Array.from({ length: words }, () => WORDS[Math.floor(rand() * WORDS.length)])
  out[0] = out[0][0].toUpperCase() + out[0].slice(1)
  return out.join(' ') + '.'
}

function longNote(rand: () => number, lines: number, label: string) {
  const out = [`## ${label} (${lines} lines)`]
  for (let i = 1; i < lines; i++) out.push(i % 9 === 0 ? '' : `${i}. ${sentence(rand, 4 + Math.floor(rand() * 14))}`)
  return out.join('\n')
}

export function sampleNotes(): Note[] {
  const now = Date.now()
  const rand = rng(7)
  const notes = SAMPLE.map(([stream, text], i) => ({ id: `s${i}`, text, stream, createdAt: now - i * 47 * MIN }))
  notes.splice(6, 0, {
    id: 'long',
    text: longNote(rand, 400, 'A long note'),
    stream: 'Journal',
    createdAt: now - 5.5 * 47 * MIN,
  })
  return notes
}

export function stressNotes(count = 3000): Note[] {
  const now = Date.now()
  const rand = rng(42)
  const streams = [null, 'Work', 'Work/Projects', 'Home', 'Journal']
  return Array.from({ length: count }, (_, i) => {
    const monster = i % 400 === 7
    const lines = 1 + Math.floor(rand() * rand() * 12)
    const text = monster
      ? longNote(rand, 800, `Monster ${i}`)
      : Array.from({ length: lines }, () => sentence(rand, 3 + Math.floor(rand() * 16))).join('\n')
    return { id: `x${i}`, text: `${i + 1} · ${text}`, stream: streams[Math.floor(rand() * streams.length)], createdAt: now - i * 13 * MIN }
  })
}

/** A copy of what is in this browser's PileFile database. Read only: edits stay in the lab. */
export async function myNotes(): Promise<Note[]> {
  const [messages, streams] = await Promise.all([db.messages.toArray(), db.streams.toArray()])
  const byId = new Map(streams.map((s) => [s.id, s]))
  const pathOf = (id: string | null): string | null => {
    const parts: string[] = []
    for (let s = id ? byId.get(id) : undefined; s && parts.length < 20; s = s.parentId ? byId.get(s.parentId) : undefined) {
      parts.unshift(s.name)
    }
    return parts.length ? parts.join('/') : null
  }
  return messages
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((m) => ({ id: m.id, text: m.text, createdAt: m.createdAt, stream: pathOf(m.streamId) }))
}
