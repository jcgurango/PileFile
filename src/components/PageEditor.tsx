import { useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { Annotation, type ChangeSet, EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { embedExtension, EmbedHost, embedLines, type EmbedLine, type EmbedSlot } from '../editor/embeds'
import { livePreview } from '../editor/livePreview'
import { clearCompletedChanges, completedTasks } from '../editor/tasks'

export interface EmbedApi {
  /** Swaps the embed's line for other text (dissolve). */
  replaceWith: (text: string) => void
}

export interface PageEditorHandle {
  /** Applies changes that came from storage (another device's edits, a merge). Not reported as an edit. */
  apply: (changes: ChangeSet) => void
  /** Deletes every completed task's line, as an edit of the editor's own (undoable, saved like typing). */
  clearCompleted: () => void
}

interface Props {
  ref?: Ref<PageEditorHandle>
  /** The text to start from. Later changes from storage come in through `apply`. */
  text: string
  readOnly?: boolean
  /**
   * Called after every change of the document: with the edit's ChangeSet when it was made here,
   * with null when a text from storage was taken over.
   */
  onDocChange?: (text: string, changes: ChangeSet | null) => void
  /** Called with the embeds the text holds, on mount and whenever that set changes. */
  onEmbeds: (embeds: EmbedLine[]) => void
  /** Called with the number of completed tasks, on mount and whenever it changes. */
  onTasks?: (completed: number) => void
  renderEmbed: (slot: EmbedSlot, api: EmbedApi) => ReactNode
}

/** Marks a change that came from storage, so it is not reported back as an edit. */
const external = Annotation.define<boolean>()

/**
 * The page editor: raw Markdown underneath, shown as live preview (see editor/livePreview.ts),
 * with message embeds drawn as cards. Enter is a plain newline, as everywhere else in the app.
 */
export default function PageEditor({ ref, text, readOnly = false, onDocChange, onEmbeds, onTasks, renderEmbed }: Props) {
  const parent = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [host] = useState(() => new EmbedHost())
  const initial = useRef(text)
  const callbacks = useRef({ onDocChange, onEmbeds, onTasks })
  useEffect(() => {
    callbacks.current = { onDocChange, onEmbeds, onTasks }
  })

  useEffect(() => {
    const embeds = embedExtension(host)
    const keyOf = (state: EditorState) => embedLines(state, embeds.field).map((e) => e.key).join('|')
    const view = new EditorView({
      parent: parent.current!,
      state: EditorState.create({
        doc: initial.current,
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
            const done = completedTasks(u.state)
            if (done !== completedTasks(u.startState)) callbacks.current.onTasks?.(done)
            const own = u.transactions.every((tr) => !tr.annotation(external))
            callbacks.current.onDocChange?.(u.state.doc.toString(), own ? u.changes : null)
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
    callbacks.current.onTasks?.(completedTasks(view.state))
    callbacks.current.onDocChange?.(view.state.doc.toString(), null)
    return () => {
      viewRef.current = null
      host.setReplacer(null)
      view.destroy()
    }
  }, [host, readOnly])

  useImperativeHandle(ref, () => ({
    apply: (changes) => {
      const view = viewRef.current
      if (view && changes.length === view.state.doc.length) view.dispatch({ changes, annotations: external.of(true) })
    },
    clearCompleted: () => {
      const view = viewRef.current
      if (!view || view.state.readOnly) return
      const changes = clearCompletedChanges(view.state)
      if (changes.length) view.dispatch({ changes, userEvent: 'delete', scrollIntoView: true })
    },
  }))

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
