/**
 * Approach B: one CodeMirror editor per note, stacked in a single scrolling column.
 *
 * Each editor is its own data source, so write-back needs no bookkeeping. What has to be built
 * instead is the illusion of one page: the keys that would leave an editor (arrows at its edge,
 * paging, start and end of document) are caught and carried into the neighbour. Editors are
 * only mounted near the viewport; elsewhere a note is plain text of the same shape.
 */
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { EditorSelection, EditorState, Facet, Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap, type Command } from '@codemirror/view'
import { baseExtensions, headerDOM, type LabOptions, type Mounted } from './shared'
import type { Note, NoteStore } from './store'

/** How far outside the viewport editors are kept alive. */
const MOUNT_MARGIN = 1200
const RETRY_FRAMES = 30

type Target = 'start' | 'end' | { offset: number } | { edge: 'top' | 'bottom'; x: number }

class Controller {
  readonly views = new Map<string, EditorView>()
  /** Last measured height of a note's editor, so its plain-text stand-in takes the same room. */
  readonly heights = new Map<string, number>()
  focusedId: string | null = null
  private readonly near = new Map<string, boolean>()
  private readonly setters = new Map<string, (mounted: boolean) => void>()
  private readonly io: IntersectionObserver
  readonly store: NoteStore
  readonly scroller: HTMLElement
  private readonly opts: LabOptions

  constructor(store: NoteStore, scroller: HTMLElement, opts: LabOptions) {
    this.store = store
    this.scroller = scroller
    this.opts = opts
    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.noteId!
          this.near.set(id, e.isIntersecting)
          // The editor with the caret stays alive however far the page is scrolled, as it would in one document.
          this.setters.get(id)?.(e.isIntersecting || id === this.focusedId)
        }
      },
      { root: scroller, rootMargin: `${MOUNT_MARGIN}px 0px` },
    )
  }

  observe(id: string, el: HTMLElement, set: (mounted: boolean) => void) {
    this.setters.set(id, set)
    this.io.observe(el)
    return () => {
      this.io.unobserve(el)
      this.setters.delete(id)
      this.near.delete(id)
    }
  }

  dispose() {
    this.io.disconnect()
  }

  private neighbour(id: string, dir: 1 | -1): string | undefined {
    const notes = this.store.notes
    return notes[notes.findIndex((n) => n.id === id) + dir]?.id
  }

  /** Puts the caret in a note, waiting a few frames if its editor is not mounted yet. */
  enter(id: string, target: Target, tries = 0): void {
    const view = this.views.get(id)
    if (!view) {
      if (tries === 0) this.scroller.querySelector(`[data-note-id="${id}"]`)?.scrollIntoView({ block: 'nearest' })
      if (tries < RETRY_FRAMES) requestAnimationFrame(() => this.enter(id, target, tries + 1))
      return
    }
    const length = view.state.doc.length
    let selection = EditorSelection.cursor(0)
    if (target === 'end') selection = EditorSelection.cursor(length)
    else if (typeof target === 'object' && 'offset' in target) selection = EditorSelection.cursor(Math.min(target.offset, length))
    else if (typeof target === 'object') {
      // Arriving from above or below: land on the nearest line, at the column the caret was travelling in.
      const edge = view.coordsAtPos(target.edge === 'top' ? 0 : length)
      const left = view.contentDOM.getBoundingClientRect().left
      const pos = edge ? view.posAtCoords({ x: target.x, y: (edge.top + edge.bottom) / 2 }, false) : target.edge === 'top' ? 0 : length
      selection = EditorSelection.cursor(pos, 1, undefined, target.x - left)
    }
    view.focus()
    view.dispatch({ selection, scrollIntoView: true, userEvent: 'select' })
  }

  /** Up or Down on the first or last visual line carries on into the neighbouring note. */
  private vertical(dir: 1 | -1): Command {
    return (view) => {
      const sel = view.state.selection.main
      if (!sel.empty) return false
      const id = idOf(view)
      const next = this.neighbour(id, dir)
      const cur = view.coordsAtPos(sel.head, sel.assoc < 0 ? -1 : 1)
      const edge = view.coordsAtPos(dir > 0 ? view.state.doc.length : 0)
      if (!next || !cur || !edge) return false
      const onEdgeLine = dir > 0 ? cur.bottom > edge.bottom - 2 : cur.top < edge.top + 2
      if (!onEdgeLine) return false
      const left = view.contentDOM.getBoundingClientRect().left
      this.enter(next, { edge: dir > 0 ? 'top' : 'bottom', x: sel.goalColumn !== undefined ? left + sel.goalColumn : cur.left })
      return true
    }
  }

  /** Left at the very start, Right at the very end. */
  private horizontal(dir: 1 | -1): Command {
    return (view) => {
      const sel = view.state.selection.main
      const next = this.neighbour(idOf(view), dir)
      if (!sel.empty || !next || sel.head !== (dir > 0 ? view.state.doc.length : 0)) return false
      this.enter(next, dir > 0 ? 'start' : 'end')
      return true
    }
  }

  /** Start/end of document: first to the edge of this note, then to the edge of the whole page. */
  private docEdge(dir: 1 | -1): Command {
    return (view) => {
      const sel = view.state.selection.main
      const notes = this.store.notes
      const last = dir > 0 ? notes[notes.length - 1] : notes[0]
      if (!sel.empty || sel.head !== (dir > 0 ? view.state.doc.length : 0) || !last) return false
      this.scroller.scrollTop = dir > 0 ? this.scroller.scrollHeight : 0
      this.enter(last.id, dir > 0 ? 'end' : 'start')
      return true
    }
  }

  /** Page Up/Down scroll the page and keep the caret where it was on screen, in whichever note is now there. */
  private page(dir: 1 | -1): Command {
    return (view) => {
      const sel = view.state.selection.main
      const cur = view.coordsAtPos(sel.head)
      if (!cur) return false
      const sc = this.scroller
      const want = dir * sc.clientHeight * 0.85
      const before = sc.scrollTop
      sc.scrollTop += want
      const moved = sc.scrollTop - before
      const notes = this.store.notes
      if (Math.abs(moved) < 1) {
        const last = dir > 0 ? notes[notes.length - 1] : notes[0]
        if (last) this.enter(last.id, dir > 0 ? 'end' : 'start')
        return true
      }
      const box = sc.getBoundingClientRect()
      const y = Math.max(box.top + 12, Math.min(box.bottom - 12, (cur.top + cur.bottom) / 2 + want - moved))
      const left = view.contentDOM.getBoundingClientRect().left
      this.placeAt(sel.goalColumn !== undefined ? left + sel.goalColumn : cur.left, y, 0)
      return true
    }
  }

  private placeAt(x: number, y: number, tries: number): void {
    requestAnimationFrame(() => {
      // Between two notes the point is on a header or a gap: nudge to the nearest text.
      let el: HTMLElement | null = null
      for (const dy of [0, 16, 32, 48, -16, -32]) {
        const hit = document.elementFromPoint(x, y + dy)
        if (!hit?.closest('.lab-editor, .lab-static')) continue
        el = hit.closest<HTMLElement>('[data-note-id]')
        y += dy
        break
      }
      const view = el ? this.views.get(el.dataset.noteId!) : undefined
      if (!view) {
        if (tries < RETRY_FRAMES) this.placeAt(x, y, tries + 1)
        return
      }
      const left = view.contentDOM.getBoundingClientRect().left
      const pos = view.posAtCoords({ x, y }, false)
      view.focus()
      view.dispatch({ selection: EditorSelection.cursor(pos, 1, undefined, x - left), userEvent: 'select' })
    })
  }

  private newBelow: Command = (view) => {
    const note = this.store.create(idOf(view))
    this.enter(note.id, 'start')
    return true
  }

  private removeEmpty: Command = (view) => {
    const id = idOf(view)
    if (view.state.doc.length > 0 || this.store.notes.length < 2) return false
    const prev = this.neighbour(id, -1)
    const next = this.neighbour(id, 1)
    this.store.remove(id)
    if (prev) this.enter(prev, 'end')
    else if (next) this.enter(next, 'start')
    return true
  }

  private extensions(id: string): Extension[] {
    return [
      noteId.of(id),
      Prec.high(
        keymap.of([
          { key: 'ArrowDown', run: this.vertical(1) },
          { key: 'ArrowUp', run: this.vertical(-1) },
          { key: 'ArrowRight', run: this.horizontal(1) },
          { key: 'ArrowLeft', run: this.horizontal(-1) },
          { key: 'PageDown', run: this.page(1) },
          { key: 'PageUp', run: this.page(-1) },
          { key: 'Mod-End', mac: 'Cmd-ArrowDown', run: this.docEdge(1) },
          { key: 'Mod-Home', mac: 'Cmd-ArrowUp', run: this.docEdge(-1) },
          { key: 'Mod-Enter', run: this.newBelow },
          { key: 'Backspace', run: this.removeEmpty },
        ]),
      ),
      baseExtensions(this.opts),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) this.store.edit(id, u.state.doc.toString())
        if (u.focusChanged) {
          if (u.view.hasFocus) this.focusedId = id
          else if (this.focusedId === id) {
            this.focusedId = null
            // Released once the caret is elsewhere and the note is far off screen.
            if (this.near.get(id) === false) this.setters.get(id)?.(false)
          }
        }
        if (u.view.hasFocus && (u.selectionSet || u.docChanged || u.focusChanged)) {
          this.store.cursor = { id, offset: u.state.selection.main.head }
        }
      }),
    ]
  }

  mount(id: string, host: HTMLElement): () => void {
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: this.store.textOf(id), extensions: this.extensions(id) }),
    })
    this.views.set(id, view)
    return () => {
      this.heights.set(id, host.offsetHeight)
      this.views.delete(id)
      view.destroy()
    }
  }
}

/** Lets a key handler ask which note its editor belongs to. */
const noteId = Facet.define<string, string>({ combine: (values) => values[0] ?? '' })
const idOf = (view: EditorView) => view.state.facet(noteId)

const NoteBlock = memo(function NoteBlock({ note, ctrl }: { note: Note; ctrl: Controller }) {
  const section = useRef<HTMLElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => ctrl.observe(note.id, section.current!, setMounted), [ctrl, note.id])
  useEffect(() => (mounted && host.current ? ctrl.mount(note.id, host.current) : undefined), [ctrl, note.id, mounted])

  return (
    <section className="lab-note" data-note-id={note.id} ref={section}>
      <div ref={(el) => el?.replaceChildren(headerDOM(note, ctrl.store))} />
      {mounted ? (
        <div className="lab-editor" ref={host} />
      ) : (
        <div className="lab-static" style={{ minHeight: ctrl.heights.get(note.id) }}>
          {ctrl.store.textOf(note.id) || '​'}
        </div>
      )}
    </section>
  )
})

interface Props {
  store: NoteStore
  opts: LabOptions
  onReady: (mounted: Mounted | null) => void
}

export default function Multi({ store, opts, onReady }: Props) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const ctrl = useMemo(() => (scroller ? new Controller(store, scroller, opts) : null), [store, scroller, opts])
  // Only the list of notes matters here; text changes stay inside the editors.
  useSyncExternalStore(store.subscribe, store.getStructure)

  useEffect(() => {
    if (!ctrl) return
    onReady({
      destroy: () => {},
      stats: () => [
        `${store.notes.length.toLocaleString()} notes, ${ctrl.views.size} editors mounted`,
        `${ctrl.scroller.querySelectorAll('.cm-line').length} lines in the DOM`,
        `${ctrl.scroller.querySelectorAll('.lab-static').length.toLocaleString()} notes as plain text`,
      ],
    })
    const first = store.cursor ?? (store.notes[0] ? { id: store.notes[0].id, offset: 0 } : null)
    if (first) {
      ctrl.scroller.querySelector(`[data-note-id="${first.id}"]`)?.scrollIntoView({ block: 'center' })
      ctrl.enter(first.id, { offset: first.offset }, 1)
    }
    return () => {
      onReady(null)
      ctrl.dispose()
    }
  }, [ctrl, store, onReady])

  return (
    <div className="lab-scroll" ref={setScroller}>
      <div className="lab-col">{ctrl && store.notes.map((n) => <NoteBlock key={n.id} note={n} ctrl={ctrl} />)}</div>
    </div>
  )
}
