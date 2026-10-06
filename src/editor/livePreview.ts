import { syntaxTree } from '@codemirror/language'
import type { Extension, Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common'
import { isEmbedText } from './embeds'

/**
 * Live Markdown preview over the raw source, after seam-writer's editor: content is styled in
 * place and syntax marks are hidden until the caret or selection touches the construct, when
 * they come back (dimmed) and the text is plain source. The document is never transformed;
 * everything here is a decoration. Task markers become real checkboxes.
 */

const hide = Decoration.replace({})
const markStyle = Decoration.mark({ class: 'lp-mark' })

const inlineStyle: Record<string, Decoration> = {
  Emphasis: Decoration.mark({ class: 'lp-em' }),
  StrongEmphasis: Decoration.mark({ class: 'lp-strong' }),
  InlineCode: Decoration.mark({ class: 'lp-inline-code' }),
  Strikethrough: Decoration.mark({ class: 'lp-strike' }),
}

const headingLine = [1, 2, 3, 4, 5, 6].map((level) => Decoration.line({ class: `lp-heading lp-h${level}` }))
const codeLine = Decoration.line({ class: 'lp-codeline' })
const quoteLine = Decoration.line({ class: 'lp-quoteline' })
const taskLine = Decoration.line({ class: 'lp-task' })
const doneStyle = Decoration.mark({ class: 'lp-done' })
const linkStyle = Decoration.mark({ class: 'lp-link' })

class HrWidget extends WidgetType {
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'lp-hr'
    return el
  }

  override eq(): boolean {
    return true
  }
}

const hrWidget = Decoration.replace({ widget: new HrWidget() })

/** A task's `[ ]` or `[x]`, shown as a checkbox. Ticking it rewrites the one character between the brackets. */
class CheckboxWidget extends WidgetType {
  readonly checked: boolean

  constructor(checked: boolean) {
    super()
    this.checked = checked
  }

  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'lp-checkbox'
    box.checked = this.checked
    box.disabled = view.state.readOnly
    box.setAttribute('aria-label', this.checked ? 'Done' : 'To do')
    // Keep the caret where it is: a click on the box is not a click into the text.
    box.addEventListener('mousedown', (e) => e.preventDefault())
    box.addEventListener('click', (e) => {
      e.preventDefault()
      const at = view.posAtDOM(box)
      const marker = view.state.sliceDoc(at, at + 3)
      if (!/^\[[ xX]\]$/.test(marker)) return
      view.dispatch({ changes: { from: at + 1, to: at + 2, insert: marker[1] === ' ' ? 'x' : ' ' }, userEvent: 'input' })
    })
    return box
  }

  override ignoreEvent(): boolean {
    return true
  }
}

function markChildren(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name.endsWith('Mark')) out.push(child)
  }
  return out
}

class LivePreview {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = this.build(view)
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
      this.decorations = this.build(update.view)
    }
  }

  private build(view: EditorView): DecorationSet {
    const ranges: Range<Decoration>[] = []
    const { state } = view
    const selection = state.selection
    // Nothing is "touched" in a read-only view or while the editor is not focused: the page reads as rendered.
    const live = view.hasFocus && !state.readOnly
    const touches = (from: number, to: number): boolean => live && selection.ranges.some((r) => r.from <= to && r.to >= from)

    const hideOrDim = (from: number, to: number, revealed: boolean): void => {
      if (to <= from) return
      ranges.push((revealed ? markStyle : hide).range(from, to))
    }
    // Hidden task bullets, so the generic ListMark rule below leaves them alone.
    const taskMarks = new Set<number>()

    for (const { from, to } of view.visibleRanges) {
      syntaxTree(state).iterate({
        from,
        to,
        enter: (ref: SyntaxNodeRef) => {
          const name = ref.name

          const inline = inlineStyle[name]
          if (inline) {
            ranges.push(inline.range(ref.from, ref.to))
            const revealed = touches(ref.from, ref.to)
            for (const mark of markChildren(ref.node)) hideOrDim(mark.from, mark.to, revealed)
            return
          }

          const headingMatch = /^ATXHeading([1-6])$/.exec(name)
          if (headingMatch) {
            const line = state.doc.lineAt(ref.from)
            ranges.push(headingLine[Number(headingMatch[1]) - 1].range(line.from))
            const mark = ref.node.getChild('HeaderMark')
            if (mark) {
              // Take the space after the `#`s along with them.
              let end = mark.to
              if (state.sliceDoc(end, end + 1) === ' ') end++
              hideOrDim(mark.from, end, touches(line.from, line.to))
            }
            return
          }

          if (name === 'Link' || name === 'Image') {
            // `![[message:…]]` parses as a link inside an image; it is an embed, shown by editor/embeds.ts.
            if (isEmbedText(state.doc.lineAt(ref.from).text)) return false
            ranges.push(linkStyle.range(ref.from, ref.to))
            const revealed = touches(ref.from, ref.to)
            const marks = markChildren(ref.node)
            if (marks.length >= 2) {
              // `[` (or `![`) before the text; everything from `]` to the end of the node after it.
              hideOrDim(marks[0].from, marks[0].to, revealed)
              hideOrDim(marks[1].from, ref.to, revealed)
            }
            return
          }

          if (name === 'FencedCode' || name === 'CodeBlock') {
            const first = state.doc.lineAt(ref.from).number
            const last = state.doc.lineAt(ref.to).number
            for (let n = first; n <= last; n++) ranges.push(codeLine.range(state.doc.line(n).from))
            return
          }

          if (name === 'HorizontalRule') {
            const line = state.doc.lineAt(ref.from)
            ranges.push((touches(line.from, line.to) ? markStyle : hrWidget).range(ref.from, ref.to))
            return
          }

          if (name === 'Escape') {
            hideOrDim(ref.from, ref.from + 1, touches(ref.from, ref.to))
            return
          }

          if (name === 'Blockquote') {
            const first = state.doc.lineAt(ref.from).number
            const last = state.doc.lineAt(ref.to).number
            for (let n = first; n <= last; n++) ranges.push(quoteLine.range(state.doc.line(n).from))
            return
          }

          if (name === 'QuoteMark') {
            const line = state.doc.lineAt(ref.from)
            let end = ref.to
            if (state.sliceDoc(end, end + 1) === ' ') end++
            hideOrDim(ref.from, end, touches(line.from, line.to))
            return
          }

          if (name === 'Task') {
            // `- [ ] text`: the bullet goes, the marker becomes a checkbox. Both come back as
            // source only while the caret is on the marker itself, so the rest of the line can
            // be edited with the checkbox still in view.
            const marker = ref.node.getChild('TaskMarker')
            const bullet = ref.node.parent?.getChild('ListMark')
            if (!marker) return
            const line = state.doc.lineAt(marker.from)
            const start = bullet ? bullet.from : marker.from
            const done = state.sliceDoc(marker.from + 1, marker.from + 2) !== ' '
            ranges.push(taskLine.range(line.from))
            if (done && marker.to + 1 < line.to) ranges.push(doneStyle.range(marker.to + 1, line.to))
            if (touches(start, marker.to)) {
              ranges.push(markStyle.range(start, marker.to))
            } else {
              if (bullet) ranges.push(hide.range(bullet.from, marker.from))
              ranges.push(Decoration.replace({ widget: new CheckboxWidget(done) }).range(marker.from, marker.to))
            }
            if (bullet) taskMarks.add(bullet.from)
            return
          }

          if (name === 'ListMark' || name === 'CodeMark') {
            // Marks not swallowed by a handled parent stay visible but dimmed.
            if (!taskMarks.has(ref.from)) ranges.push(markStyle.range(ref.from, ref.to))
          }
        },
      })
    }

    return Decoration.set(ranges, true)
  }
}

export function livePreview(): Extension {
  return ViewPlugin.fromClass(LivePreview, { decorations: (plugin) => plugin.decorations })
}
