import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { myNotes, sampleNotes, stressNotes } from './data'
import Multi from './Multi'
import type { LabOptions, Mounted } from './shared'
import { mountSingle } from './single'
import { NoteStore, type Note } from './store'

type Mode = 'single' | 'multi'
type Dataset = 'sample' | 'mine' | 'stress'

const isMac = navigator.platform.toLowerCase().includes('mac')
const MOD = isMac ? '⌘' : 'Ctrl'

const KEYS: Array<[string, string, string]> = [
  ['↑ ↓ ← →', 'cross from one note into the next', 'carried across by hand; the travelling column is kept'],
  ['Shift + arrows', 'select across notes', 'stops at the edge of the note'],
  [`${MOD} A`, 'selects the whole page', 'selects one note'],
  ['Page Up / Down', 'native', 'page scrolls, caret keeps its place on screen'],
  [isMac ? '⌘ ↑ / ⌘ ↓' : 'Ctrl Home / End', 'top / bottom of the page', 'edge of the note, then of the page'],
  [`${MOD} Z`, 'one history for the page', 'one history per note'],
  [`${MOD} Enter`, 'new note below', 'new note below'],
  ['Backspace', 'in an empty note removes it; never joins two notes', 'same'],
]

function Single({ store, opts, onReady }: { store: NoteStore; opts: LabOptions; onReady: (m: Mounted | null) => void }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const mounted = mountSingle(host.current!, store, opts)
    onReady(mounted)
    return () => {
      onReady(null)
      mounted.destroy()
    }
  }, [store, opts, onReady])
  return <div className="lab-single" ref={host} />
}

function LogPanel({ store }: { store: NoteStore }) {
  useSyncExternalStore(store.subscribe, store.getVersion)
  if (store.log.length === 0) return <p className="lab-empty">Type in a note. After a pause, that note alone is written back and shows up here.</p>
  return (
    <ol className="lab-log">
      {store.log.map((e) => (
        <li key={e.n} className={`lab-log-${e.kind}`}>
          <span className="lab-log-kind">{e.kind}</span>
          <span className="lab-log-title">{e.title}</span>
          <span className="lab-log-detail">
            {e.detail} · {new Date(e.at).toLocaleTimeString()}
          </span>
        </li>
      ))}
    </ol>
  )
}

export default function Lab() {
  const store = useMemo(() => new NoteStore(), [])
  // For poking at from the console, and for lab/check.mjs: the DOM only ever holds what is near the viewport.
  useEffect(() => void Object.assign(window, { labStore: store }), [store])
  const [mode, setMode] = useState<Mode>('single')
  const [dataset, setDataset] = useState<Dataset>('sample')
  const [oldestFirst, setOldestFirst] = useState(false)
  const [markdown, setMarkdown] = useState(true)
  const [debounce, setDebounce] = useState(600)
  /** Bumped whenever the notes are replaced, so the editors start over. */
  const [loaded, setLoaded] = useState(0)
  const [note, setNote] = useState('')
  const [stats, setStats] = useState<string[]>([])
  const mounted = useRef<Mounted | null>(null)
  const onReady = useCallback((m: Mounted | null) => {
    mounted.current = m
  }, [])
  const opts = useMemo<LabOptions>(() => ({ markdown }), [markdown])

  useEffect(() => {
    let alive = true
    const load = async () => {
      let notes: Note[]
      let message = ''
      if (dataset === 'mine') {
        notes = await myNotes().catch(() => [])
        message = notes.length ? 'A copy of your messages. Edits stay in this page.' : 'No messages in this browser yet; showing nothing.'
      } else {
        notes = dataset === 'stress' ? stressNotes() : sampleNotes()
      }
      if (!alive) return
      store.load(oldestFirst ? notes.reverse() : notes)
      setNote(message)
      setLoaded((n) => n + 1)
    }
    void load()
    return () => {
      alive = false
    }
  }, [store, dataset, oldestFirst])

  useEffect(() => {
    store.setDebounce(debounce)
  }, [store, debounce])

  useEffect(() => {
    const timer = setInterval(() => setStats(mounted.current?.stats() ?? []), 400)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="lab">
      <header className="lab-bar">
        <strong>One page of notes</strong>
        <div className="lab-seg" role="group" aria-label="Approach">
          <button aria-pressed={mode === 'single'} onClick={() => setMode('single')}>
            A · One editor
          </button>
          <button aria-pressed={mode === 'multi'} onClick={() => setMode('multi')}>
            B · Editor per note
          </button>
        </div>
        <label>
          Notes{' '}
          <select value={dataset} onChange={(e) => setDataset(e.target.value as Dataset)}>
            <option value="sample">Sample (13, one long)</option>
            <option value="mine">My messages (copy)</option>
            <option value="stress">Stress (3,000)</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={oldestFirst} onChange={(e) => setOldestFirst(e.target.checked)} /> Oldest first
        </label>
        <label>
          <input type="checkbox" checked={markdown} onChange={(e) => setMarkdown(e.target.checked)} /> Markdown colours
        </label>
        <label>
          Write back after{' '}
          <select value={debounce} onChange={(e) => setDebounce(Number(e.target.value))}>
            <option value={200}>0.2 s</option>
            <option value={600}>0.6 s</option>
            <option value={2000}>2 s</option>
          </select>
        </label>
        {note && <span className="lab-note-msg">{note}</span>}
      </header>

      <div className="lab-main">
        {loaded > 0 &&
          (mode === 'single' ? (
            <Single key={`s${loaded}`} store={store} opts={opts} onReady={onReady} />
          ) : (
            <Multi key={`m${loaded}`} store={store} opts={opts} onReady={onReady} />
          ))}
      </div>

      <aside className="lab-side">
        <h3>{mode === 'single' ? 'A · One editor, protected seams' : 'B · One editor per note'}</h3>
        <p className="lab-blurb">
          {mode === 'single'
            ? 'All notes are one CodeMirror document. The line breaks between notes cannot be edited, and each change is routed to the note it happened in.'
            : 'Every note has its own CodeMirror in one scrolling column. Keys that would leave an editor are carried into its neighbour. Editors exist only near the viewport.'}
        </p>
        <h3>Keys</h3>
        <table className="lab-keys">
          <tbody>
            {KEYS.map(([key, a, b]) => (
              <tr key={key}>
                <th>{key}</th>
                <td>{mode === 'single' ? a : b}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Live</h3>
        <ul className="lab-stats">
          {stats.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <h3>Write-back log</h3>
        <LogPanel store={store} />
      </aside>
    </div>
  )
}
