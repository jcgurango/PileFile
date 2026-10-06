/**
 * Approach A: one CodeMirror document holding every note.
 *
 * The document is the notes joined by a single newline. A state field remembers where each
 * note starts; those boundary newlines are protected, so no edit can merge two notes or move
 * text from one into another. Every change is traced back to the notes it touched and only
 * those are written back. Caret movement, selection and scrolling are simply CodeMirror's.
 */
import { EditorState, Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, keymap, WidgetType, type DecorationSet } from '@codemirror/view'
import { invertedEffects } from '@codemirror/commands'
import { baseExtensions, headerDOM, type LabOptions, type Mounted } from './shared'
import type { Note, NoteStore } from './store'

interface Section {
  id: string
  /** Start of the note's text. The character before it (for all but the first) is its boundary newline. */
  from: number
}

/** Replaces the section list when notes are added or removed. Positions are in the new document. */
const setSections = StateEffect.define<Section[]>()

const sectionsField = StateField.define<Section[]>({
  create: () => [],
  update(sections, tr) {
    for (const e of tr.effects) if (e.is(setSections)) return e.value
    if (!tr.docChanged) return sections
    // Text typed at the very start of a note belongs to that note, so its start stays put (assoc -1).
    return sections.map((s, i) => (i === 0 ? s : { id: s.id, from: tr.changes.mapPos(s.from, -1) }))
  },
})

/** Index of the section holding `pos`. */
function sectionAt(sections: Section[], pos: number): number {
  let lo = 0
  let hi = sections.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (sections[mid].from <= pos) lo = mid
    else hi = mid - 1
  }
  return lo
}

const sectionEnd = (sections: Section[], i: number, docLength: number) =>
  i + 1 < sections.length ? sections[i + 1].from - 1 : docLength

export function mountSingle(parent: HTMLElement, store: NoteStore, opts: LabOptions): Mounted {
  class HeadWidget extends WidgetType {
    readonly id: string
    constructor(id: string) {
      super()
      this.id = id
    }
    eq(other: HeadWidget) {
      return other.id === this.id
    }
    toDOM() {
      return headerDOM(store.get(this.id), store)
    }
    get estimatedHeight() {
      return 40
    }
  }

  const buildHeads = (sections: Section[]): DecorationSet =>
    Decoration.set(
      sections.map((s) => Decoration.widget({ widget: new HeadWidget(s.id), block: true, side: -1 }).range(s.from)),
    )

  // Block widgets change the layout, so they have to come from a state field rather than a view plugin.
  const headsField = StateField.define<DecorationSet>({
    create: (state) => buildHeads(state.field(sectionsField)),
    update(heads, tr) {
      if (tr.effects.some((e) => e.is(setSections))) return buildHeads(tr.state.field(sectionsField))
      return tr.docChanged ? heads.map(tr.changes) : heads
    },
    provide: (f) => EditorView.decorations.from(f),
  })

  /** The boundary newlines an edit would run over are left out of it: text goes, the seams stay. */
  const protectBoundaries = EditorState.changeFilter.of((tr) => {
    const sections = tr.startState.field(sectionsField)
    const keep: number[] = []
    tr.changes.iterChangedRanges((fromA, toA) => {
      for (let i = sectionAt(sections, fromA) + 1; i < sections.length && sections[i].from - 1 < toA; i++) {
        keep.push(sections[i].from - 1, sections[i].from)
      }
    })
    return keep.length ? keep : true
  })

  /**
   * A delete that was nothing but a seam (Backspace at the start of a note, Delete at its end) has
   * no change left, only the caret move that would have followed it. Drop it, so the caret stays
   * put instead of slipping into the neighbouring note where the next Backspace would eat real text.
   */
  const stopAtSeam = EditorState.transactionFilter.of((tr) => (tr.isUserEvent('delete') && !tr.docChanged ? [] : tr))

  /** Mod-Enter: an empty note below the one the caret is in. */
  const newBelow = (view: EditorView) => {
    const sections = view.state.field(sectionsField)
    const i = sectionAt(sections, view.state.selection.main.head)
    const end = sectionEnd(sections, i, view.state.doc.length)
    const next = [
      ...sections.slice(0, i + 1),
      { id: crypto.randomUUID(), from: end + 1 },
      ...sections.slice(i + 1).map((s) => ({ id: s.id, from: s.from + 1 })),
    ]
    view.dispatch({
      changes: { from: end, insert: '\n' },
      selection: { anchor: end + 1 },
      effects: setSections.of(next),
      scrollIntoView: true,
      userEvent: 'input',
    })
    return true
  }

  /** Backspace in an empty note removes the note; anywhere else it is an ordinary Backspace. */
  const removeEmpty = (view: EditorView) => {
    const { state } = view
    const sections = state.field(sectionsField)
    const sel = state.selection.main
    if (!sel.empty || sections.length < 2) return false
    const i = sectionAt(sections, sel.head)
    const { from } = sections[i]
    if (sectionEnd(sections, i, state.doc.length) !== from) return false
    const cut = i === 0 ? { from: 0, to: 1 } : { from: from - 1, to: from }
    const next = [
      ...sections.slice(0, i),
      ...sections.slice(i + 1).map((s) => ({ id: s.id, from: s.from - 1 })),
    ]
    view.dispatch({
      changes: cut,
      selection: { anchor: cut.from },
      effects: setSections.of(next),
      filter: false,
      scrollIntoView: true,
      userEvent: 'delete',
    })
    return true
  }

  // Notes removed in this session, so undoing the removal brings the same note back.
  const removed = new Map<string, Note>()

  const writeBack = EditorView.updateListener.of((u) => {
    const sections = u.state.field(sectionsField)
    if (u.transactions.some((tr) => tr.effects.some((e) => e.is(setSections)))) {
      store.reconcile(
        sections.map((s) => s.id),
        removed,
      )
    }
    if (u.docChanged) {
      const touched = new Set<number>()
      u.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
        for (let i = sectionAt(sections, fromB), last = sectionAt(sections, toB); i <= last; i++) touched.add(i)
      })
      for (const i of touched) {
        store.edit(sections[i].id, u.state.sliceDoc(sections[i].from, sectionEnd(sections, i, u.state.doc.length)))
      }
    }
    if (u.docChanged || u.selectionSet) {
      const head = u.state.selection.main.head
      const s = sections[sectionAt(sections, head)]
      if (s) store.cursor = { id: s.id, offset: head - s.from }
    }
  })

  const texts = store.notes.map((n) => store.textOf(n.id))
  const sections: Section[] = []
  let at = 0
  for (const [i, n] of store.notes.entries()) {
    sections.push({ id: n.id, from: at })
    at += texts[i].length + 1
  }
  const doc = texts.join('\n')

  let anchor = 0
  if (store.cursor) {
    const i = sections.findIndex((s) => s.id === store.cursor!.id)
    if (i >= 0) anchor = Math.min(sections[i].from + store.cursor.offset, sectionEnd(sections, i, doc.length))
  }

  const extensions: Extension[] = [
    sectionsField.init(() => sections),
    headsField,
    protectBoundaries,
    stopAtSeam,
    // Undo and redo of "new note" / "remove note" have to restore the section list along with the text.
    invertedEffects.of((tr) =>
      tr.effects.some((e) => e.is(setSections)) ? [setSections.of(tr.startState.field(sectionsField))] : [],
    ),
    Prec.high(
      keymap.of([
        { key: 'Mod-Enter', run: newBelow },
        { key: 'Backspace', run: removeEmpty },
      ]),
    ),
    baseExtensions(opts),
    writeBack,
  ]

  const view = new EditorView({ parent, state: EditorState.create({ doc, selection: { anchor }, extensions }) })
  view.dispatch({ effects: EditorView.scrollIntoView(anchor, { y: 'center' }) })
  view.focus()

  return {
    destroy: () => view.destroy(),
    stats: () => [
      `${view.state.field(sectionsField).length.toLocaleString()} notes in one document`,
      `${view.state.doc.lines.toLocaleString()} lines, ${view.contentDOM.querySelectorAll('.cm-line').length} in the DOM`,
      `${parent.querySelectorAll('.lab-head').length} note headers in the DOM`,
    ],
  }
}
