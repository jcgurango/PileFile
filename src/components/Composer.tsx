import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Paperclip, SendHorizontal } from 'lucide-react'
import { autosize } from '../autosize'
import type { Message } from '../db'
import { useFileDrop } from '../useFileDrop'
import { useIsTouch } from '../useMediaQuery'
import IconButton from './IconButton'
import PendingAttachments from './PendingAttachments'
import Quote from './Quote'

interface Props {
  streamId: string
  target: string
  value: string
  onChange: (text: string) => void
  onSubmit: (text: string, files: File[]) => Promise<unknown>
  /** Files queued for the next message. */
  files: File[]
  onFilesChange: (files: File[]) => void
  /** The message being replied to, shown as a quote above the box. */
  replyTo?: Message | null
  onCancelReply?: () => void
}

export default function Composer({
  streamId,
  target,
  value,
  onChange,
  onSubmit,
  files,
  onFilesChange,
  replyTo,
  onCancelReply,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const touch = useIsTouch()
  const addFiles = (more: File[]) => onFilesChange([...files, ...more])
  const drop = useFileDrop(addFiles)
  const canSend = value.trim().length > 0 || files.length > 0

  // Grow with content; there is no cap, the pane scrolls if a draft gets very tall.
  useEffect(() => autosize(ref.current), [value])

  // Focus when switching streams, but not on touch devices, where that would
  // pop the keyboard on every navigation.
  useEffect(() => {
    if (!touch) ref.current?.focus()
  }, [streamId, touch])

  // Starting a reply puts the cursor in the box.
  useEffect(() => {
    if (replyTo && !touch) ref.current?.focus()
  }, [replyTo, touch])

  const submit = async () => {
    const text = value.trim()
    if (!text && files.length === 0) return
    await onSubmit(text, files)
    onChange('')
    onFilesChange([])
    ref.current?.focus()
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(e.clipboardData.files)
    if (pasted.length === 0) return
    e.preventDefault()
    addFiles(pasted)
  }

  // Desktop: Enter saves, Shift+Enter breaks the line. Touch: Enter always breaks the line.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (touch) return
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className={`composer${drop.over ? ' drop-over' : ''}`} {...drop.handlers}>
      {replyTo && <Quote message={replyTo} onCancel={onCancelReply} />}
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder={`Write to ${target}…`}
        aria-label={`Write to ${target}`}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
      <PendingAttachments files={files} onRemove={(i) => onFilesChange(files.filter((_, j) => j !== i))} />
      <div className="composer-foot">
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          aria-label="Choose files to attach"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
        <IconButton
          icon={Paperclip}
          label="Attach files"
          hint="Attach files (or drop / paste them)"
          size={18}
          onClick={() => fileInput.current?.click()}
        />
        <span className="hint">
          {touch ? 'Markdown supported' : 'Enter to save · Shift+Enter for a new line · Markdown supported'}
        </span>
        <IconButton
          icon={SendHorizontal}
          label="Save"
          hint="Save (Enter)"
          size={18}
          align="end"
          className="send-btn"
          onClick={submit}
          disabled={!canSend}
        />
      </div>
      {drop.over && <div className="drop-hint">Drop to attach</div>}
    </div>
  )
}
