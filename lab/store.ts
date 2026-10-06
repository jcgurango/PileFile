/**
 * Stand-in for the app's data layer. Every note is its own "data source": an editor reports
 * the new text of one note at a time, and after a quiet moment that note alone is written back.
 * Nothing here touches IndexedDB; `save` is where `editMessage` would be called.
 */
export interface Note {
  id: string
  text: string
  createdAt: number
  stream: string | null
}

export interface LogEntry {
  n: number
  at: number
  kind: 'saved' | 'created' | 'deleted' | 'restored'
  id: string
  title: string
  detail: string
}

const LOG_MAX = 200

export const titleOf = (text: string) => text.trim().split('\n')[0].slice(0, 48) || '(empty)'

export class NoteStore {
  notes: Note[] = []
  log: LogEntry[] = []
  /** Milliseconds of quiet before a changed note is written back. */
  private debounce = 600
  /** Where the caret was, so switching approach lands in the same place. */
  cursor: { id: string; offset: number } | null = null

  private byId = new Map<string, Note>()
  private pending = new Map<string, { text: string; timer: number }>()
  private listeners = new Set<() => void>()
  private version = 0
  /** Bumped only when notes are added, removed or reloaded. */
  private structure = 0
  private logN = 0

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getVersion = () => this.version
  getStructure = () => this.structure
  private bump() {
    this.version++
    for (const fn of this.listeners) fn()
  }

  setDebounce(ms: number) {
    this.debounce = ms
  }

  load(notes: Note[]) {
    for (const p of this.pending.values()) clearTimeout(p.timer)
    this.pending.clear()
    this.notes = notes
    this.byId = new Map(notes.map((n) => [n.id, n]))
    this.log = []
    this.cursor = null
    this.structure++
    this.bump()
  }

  get(id: string) {
    return this.byId.get(id)
  }

  /** The text an editor should show: the unsaved edit when there is one. */
  textOf(id: string) {
    return this.pending.get(id)?.text ?? this.byId.get(id)?.text ?? ''
  }

  isDirty(id: string) {
    return this.pending.has(id)
  }

  /** An editor changed this note. Cheap; the write-back happens after the debounce. */
  edit(id: string, text: string) {
    const note = this.byId.get(id)
    if (!note) return
    const was = this.pending.get(id)
    if (was) clearTimeout(was.timer)
    else paintStatus(id, true)
    if (text === note.text) {
      this.pending.delete(id)
      paintStatus(id, false)
      return
    }
    this.pending.set(id, { text, timer: window.setTimeout(() => this.save(id), this.debounce) })
  }

  private save(id: string) {
    const p = this.pending.get(id)
    const note = this.byId.get(id)
    if (!p || !note) return
    clearTimeout(p.timer)
    this.pending.delete(id)
    const delta = p.text.length - note.text.length
    note.text = p.text
    paintStatus(id, false)
    this.addLog('saved', note, `${delta >= 0 ? '+' : ''}${delta} chars`)
  }

  flush() {
    for (const id of [...this.pending.keys()]) this.save(id)
  }

  /** Inserts an empty note after `afterId` (or first). Returns it. */
  create(afterId: string | null, id: string = crypto.randomUUID()): Note {
    const after = afterId ? this.byId.get(afterId) : undefined
    const note: Note = { id, text: '', createdAt: Date.now(), stream: after?.stream ?? null }
    const at = after ? this.notes.indexOf(after) + 1 : 0
    this.notes.splice(at, 0, note)
    this.byId.set(id, note)
    this.structure++
    this.addLog('created', note, after ? `after “${titleOf(after.text)}”` : 'at the top')
    return note
  }

  remove(id: string) {
    const note = this.byId.get(id)
    if (!note) return
    const p = this.pending.get(id)
    if (p) clearTimeout(p.timer)
    this.pending.delete(id)
    this.notes.splice(this.notes.indexOf(note), 1)
    this.byId.delete(id)
    this.structure++
    this.addLog('deleted', note, '')
  }

  /** Makes the store's order and membership match what an editor holds (after undo/redo of a structural change). */
  reconcile(ids: string[], removed: Map<string, Note>) {
    const have = new Set(ids)
    for (const n of [...this.notes]) {
      if (!have.has(n.id)) {
        removed.set(n.id, n)
        this.remove(n.id)
      }
    }
    for (const [i, id] of ids.entries()) {
      if (this.byId.has(id)) continue
      const back = removed.get(id)
      if (back) {
        this.notes.splice(i, 0, back)
        this.byId.set(id, back)
        this.structure++
        this.addLog('restored', back, '')
      } else {
        this.create(i > 0 ? ids[i - 1] : null, id)
      }
    }
  }

  private addLog(kind: LogEntry['kind'], note: Note, detail: string) {
    this.log.unshift({ n: ++this.logN, at: Date.now(), kind, id: note.id, title: titleOf(note.text), detail })
    if (this.log.length > LOG_MAX) this.log.length = LOG_MAX
    this.bump()
  }
}

/** Flips the unsaved dot on a note's header wherever it is on screen. Headers come and go with virtualization. */
export function paintStatus(id: string, dirty: boolean) {
  for (const el of document.querySelectorAll(`[data-status-for="${id}"]`)) el.classList.toggle('dirty', dirty)
}
