import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { Annotation, EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { embedExtension, EmbedHost, embedLines, type EmbedLine, type EmbedSlot } from '../editor/embeds'
import { livePreview } from '../editor/livePreview'

export interface EmbedApi {
  /** Swaps the embed's line for other text (dissolve). */
  replaceWith: (text: string) => void
}

interface Props {
  /** The page as stored. A change from outside is taken over only while there are no unsaved edits here. */
  text: string
  readOnly?: boolean
  /** Called with the whole text after every edit made in this editor. */
  onChange?: (text: string) => void
  /** Called with the embeds the text holds, on mount and whenever that set changes. */
  onEmbeds: (embeds: EmbedLine[]) => void
  renderEmbed: (slot: EmbedSlot, api: EmbedApi) => ReactNode
}

/** Marks a change that came from storage, so it is not reported back as an edit. */
const external = Annotation.define<boolean>()

/**
 * The page editor: raw Markdown underneath, shown as live preview (see editor/livePreview.ts),
 * with message embeds drawn as cards. Enter is a plain newline, as everywhere else in the app.
 */
export default function PageEditor({ text, readOnly = false, onChange, onEmbeds, renderEmbed }: Props) {
  const parent = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [host] = useState(() => new EmbedHost())
  // What storage last said. While the document still equals it, nothing here is unsaved.
  const stored = useRef(text)
  const callbacks = useRef({ onChange, onEmbeds })
  useEffect(() => {
    callbacks.current = { onChange, onEmbeds }
  })

  useEffect(() => {
    const embeds = embedExtension(host)
    const keyOf = (state: EditorState) => embedLines(state, embeds.field).map((e) => e.key).join('|')
    const view = new EditorView({
      parent: parent.current!,
      state: EditorState.create({
        doc: stored.current,
        extensions: [
          history(),
          // markdownKeymap first: Enter continues lists and quotes, Backspace removes their markup.
          // indentWithTab keeps Tab in the editor, where it nests and un-nests list items.
          keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.lineWrapping,
          // No setext headings: a line of `---` is always a rule, never an underline for the line above.
          markdown({ base: markdownLanguage, extensions: [{ remove: ['SetextHeading'] }] }),
          livePreview(),
          embeds.extension,
          placeholder('Write the page…'),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ 'aria-label': 'Page' }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            if (keyOf(u.startState) !== keyOf(u.state)) callbacks.current.onEmbeds(embedLines(u.state, embeds.field))
            if (u.transactions.some((tr) => tr.docChanged && !tr.annotation(external))) {
              callbacks.current.onChange?.(u.state.doc.toString())
            }
          }),
        ],
      }),
    })
    viewRef.current = view
    host.setReplacer((key, replacement) => {
      const line = embedLines(view.state, embeds.field).find((e) => e.key === key)
      if (line) view.dispatch({ changes: { from: line.from, to: line.to, insert: replacement }, userEvent: 'input' })
    })
    callbacks.current.onEmbeds(embedLines(view.state, embeds.field))
    return () => {
      viewRef.current = null
      host.setReplacer(null)
      view.destroy()
    }
  }, [host, readOnly])

  useEffect(() => {
    const view = viewRef.current
    const was = stored.current
    stored.current = text
    if (!view) return
    const doc = view.state.doc.toString()
    if (doc === text || doc !== was) return
    view.dispatch({ changes: { from: 0, to: doc.length, insert: text }, annotations: external.of(true) })
  }, [text])

  const slots = useSyncExternalStore(host.subscribe, host.getSlots)
  return (
    <div className={`page-editor${readOnly ? ' read-only' : ''}`} ref={parent}>
      {slots.map((slot) =>
        createPortal(
          <div className="page-embed-box">
            {renderEmbed(slot, { replaceWith: (replacement) => host.replace(slot.key, replacement) })}
          </div>,
          slot.el,
          slot.key,
        ),
      )}
    </div>
  )
}
