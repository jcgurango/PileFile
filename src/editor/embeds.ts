import { EditorSelection, type EditorState, type Extension, Prec, type Range, StateField, type Text } from '@codemirror/state'
import { type Command, Decoration, type DecorationSet, EditorView, keymap, WidgetType } from '@codemirror/view'
import type { EmbedKind } from '../page'

/**
 * Message embeds inside the page editor. A line that is nothing but `![[message:<id>]]`
 * (or thread / summary) gets the message drawn under it as a block; the line's own text is
 * collapsed away unless the caret is on it, in keeping with the rest of the live preview.
 *
 * CodeMirror owns the block's element; what goes inside is React's business. The editor tells
 * an `EmbedHost` which elements exist, and the page renders the cards into them as portals.
 */
export interface EmbedSlot {
  /** Stable across edits elsewhere in the page: kind, id and which occurrence of that pair this is. */
  key: string
  kind: EmbedKind
  id: string
  el: HTMLElement
}

export class EmbedHost {
  private slots = new Map<string, EmbedSlot>()
  private listeners = new Set<() => void>()
  private snapshot: EmbedSlot[] = []
  private replacer: ((key: string, text: string) => void) | null = null

  /** The editor registers how to swap an embed's line for other text; cards call `replace` (dissolve). */
  setReplacer(fn: ((key: string, text: string) => void) | null) {
    this.replacer = fn
  }
  replace = (key: string, text: string) => this.replacer?.(key, text)

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSlots = () => this.snapshot

  private changed() {
    this.snapshot = [...this.slots.values()]
    for (const fn of this.listeners) fn()
  }

  mount(slot: EmbedSlot) {
    this.slots.set(slot.key, slot)
    this.changed()
  }

  unmount(key: string, el: HTMLElement) {
    // A widget can be redrawn before the old element is destroyed; only forget the element being removed.
    if (this.slots.get(key)?.el !== el) return
    this.slots.delete(key)
    this.changed()
  }
}

export interface EmbedLine {
  key: string
  kind: EmbedKind
  id: string
  from: number
  to: number
}

const EMBED_RE = /^!\[\[(message|thread|summary):([0-9A-Za-z-]+)\]\]$/
const FENCE_RE = /^\s*(```|~~~)/

/** True for a line that is an embed reference, so the Markdown preview leaves its brackets alone. */
export const isEmbedText = (line: string) => EMBED_RE.test(line.trim())

/** Every embed line of the document, skipping fenced code. Same rules as `parsePage`. */
export function findEmbeds(doc: Text): EmbedLine[] {
  const out: EmbedLine[] = []
  const seen = new Map<string, number>()
  let fenced = false
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (FENCE_RE.test(line.text)) fenced = !fenced
    const m = fenced ? null : EMBED_RE.exec(line.text.trim())
    if (!m) continue
    const pair = `${m[1]}:${m[2]}`
    const nth = seen.get(pair) ?? 0
    seen.set(pair, nth + 1)
    out.push({ key: `${pair}:${nth}`, kind: m[1] as EmbedKind, id: m[2], from: line.from, to: line.to })
  }
  return out
}

class EmbedWidget extends WidgetType {
  readonly embed: EmbedLine
  readonly host: EmbedHost

  constructor(embed: EmbedLine, host: EmbedHost) {
    super()
    this.embed = embed
    this.host = host
  }

  override eq(other: EmbedWidget): boolean {
    return other.embed.key === this.embed.key
  }

  toDOM(): HTMLElement {
    const { key, kind, id } = this.embed
    // Spacing is padding on this element, never margin: CodeMirror measures a block by its box.
    const el = document.createElement('div')
    el.className = `page-embed page-embed-${kind}`
    el.dataset.embed = `${kind}:${id}`
    // Focusable in its own right: a click on the card then takes focus away from the editor
    // (the card is not editable, but it sits inside the editable area, which would otherwise keep
    // focus, put its caret on the embed's line and send the next keystrokes there).
    el.tabIndex = -1
    this.host.mount({ key, kind, id, el })
    return el
  }

  override destroy(dom: HTMLElement): void {
    this.host.unmount(this.embed.key, dom)
  }

  /** Clicks, typing and focus inside a card are the card's own. */
  override ignoreEvent(): boolean {
    return true
  }

  override get estimatedHeight(): number {
    return this.embed.kind === 'summary' ? 44 : 96
  }
}

const hidden = Decoration.replace({})
const collapsedLine = Decoration.line({ class: 'lp-embed-src lp-embed-collapsed' })
const revealedLine = Decoration.line({ class: 'lp-embed-src' })

interface EmbedState {
  embeds: EmbedLine[]
  decorations: DecorationSet
}

function decorate(state: EditorState, embeds: EmbedLine[], host: EmbedHost, focused: boolean): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const live = focused && !state.readOnly
  for (const e of embeds) {
    const touched = live && state.selection.ranges.some((r) => r.from <= e.to && r.to >= e.from)
    ranges.push((touched ? revealedLine : collapsedLine).range(e.from))
    if (!touched && e.to > e.from) ranges.push(hidden.range(e.from, e.to))
    // The card always sits below the line as the same widget, so moving the caret on and off
    // the line never rebuilds it.
    ranges.push(Decoration.widget({ widget: new EmbedWidget(e, host), block: true, side: 1 }).range(e.to))
  }
  return Decoration.set(ranges, true)
}

/** The embed lines of a state, for callers that need to act on one (dissolve). */
export const embedLines = (state: EditorState, field: StateField<EmbedState>) => state.field(field).embeds

export function embedExtension(host: EmbedHost): { extension: Extension; field: StateField<EmbedState> } {
  // Focus is not part of the editor state, so the field is told about it through this flag,
  // which the focus listener below flips before nudging the state.
  let focused = false
  const field: StateField<EmbedState> = StateField.define<EmbedState>({
    create(state) {
      const embeds = findEmbeds(state.doc)
      return { embeds, decorations: decorate(state, embeds, host, focused) }
    },
    update(value, tr) {
      const embeds = tr.docChanged ? findEmbeds(tr.state.doc) : value.embeds
      return { embeds, decorations: decorate(tr.state, embeds, host, focused) }
    },
    // Block widgets change the layout, so they have to come from a state field, not a view plugin.
    provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
  })
  const focus = EditorView.focusChangeEffect.of((_state, focusing) => {
    focused = focusing
    return null
  })
  // An empty transaction after the focus change makes the field recompute with the new flag.
  const refresh = EditorView.updateListener.of((u) => {
    if (u.focusChanged) {
      queueMicrotask(() => {
        // The view may have been torn down in the meantime (leaving the page blurs it).
        if (u.view.dom.isConnected) u.view.dispatch({})
      })
    }
  })
  /**
   * A collapsed embed line has no height, so ordinary Up and Down step straight over it and its
   * card. Stop on it instead: the caret then sits on the embed's line, which shows its source.
   */
  const vertical =
    (forward: boolean): Command =>
    (view) => {
      const { state } = view
      const sel = state.selection.main
      if (!sel.empty) return false
      const here = state.doc.lineAt(sel.head)
      const landing = state.doc.lineAt(view.moveVertically(sel, forward).head)
      const { embeds } = state.field(field)
      const skipped = forward
        ? embeds.find((e) => e.from > here.to && e.to < landing.from)
        : embeds.findLast((e) => e.to < here.from && e.from > landing.to)
      if (!skipped) return false
      view.dispatch({ selection: EditorSelection.cursor(skipped.to), scrollIntoView: true, userEvent: 'select' })
      return true
    }
  const keys = Prec.high(
    keymap.of([
      { key: 'ArrowDown', run: vertical(true) },
      { key: 'ArrowUp', run: vertical(false) },
    ]),
  )
  return { extension: [field, focus, refresh, keys], field }
}
