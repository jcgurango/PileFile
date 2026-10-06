import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { drawSelection, EditorView, keymap } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { formatFull, formatTimestamp } from '../src/format'
import type { Note, NoteStore } from './store'

export interface LabOptions {
  /** Colour Markdown as you type. Sizes never change, so lines keep their height. */
  markdown: boolean
}

/** What an approach hands back to the shell. */
export interface Mounted {
  destroy(): void
  /** A few live numbers for the side panel, mostly to see virtualization at work. */
  stats(): string[]
}

const theme = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.5' },
  '.cm-content': { padding: '0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 var(--lab-inset)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    background: 'var(--accent-soft)',
  },
})

const markdownColours = HighlightStyle.define([
  { tag: t.heading, fontWeight: '600' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.92em' },
  { tag: [t.processingInstruction, t.meta, t.quote], color: 'var(--muted)' },
])

/** Everything both approaches share: look, wrapping, history and the standard keys. */
export function baseExtensions(opts: LabOptions): Extension[] {
  return [
    theme,
    EditorView.lineWrapping,
    drawSelection(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    opts.markdown ? [markdown(), syntaxHighlighting(markdownColours)] : [],
  ]
}

/** The line above each note: unsaved dot, when it was written, where it is filed. Same markup in both approaches. */
export function headerDOM(note: Note | undefined, store: NoteStore): HTMLElement {
  const el = document.createElement('div')
  el.className = 'lab-head'
  if (!note) return el
  const row = document.createElement('div')
  row.className = 'lab-head-row'
  el.append(row)
  const dot = document.createElement('span')
  dot.className = `lab-dot${store.isDirty(note.id) ? ' dirty' : ''}`
  dot.dataset.statusFor = note.id
  dot.title = 'Unsaved while lit'
  const time = document.createElement('time')
  time.textContent = formatTimestamp(note.createdAt)
  time.title = formatFull(note.createdAt)
  row.append(dot, time)
  if (note.stream) {
    const chip = document.createElement('span')
    chip.className = 'lab-stream'
    chip.textContent = `#${note.stream}`
    row.append(chip)
  }
  return el
}
