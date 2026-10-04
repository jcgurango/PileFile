import { useEffect, useRef, type KeyboardEvent } from 'react'
import { SendHorizontal } from 'lucide-react'
import { autosize } from '../autosize'
import type { Message } from '../db'
import { useIsTouch } from '../useMediaQuery'
import IconButton from './IconButton'
import Quote from './Quote'

interface Props {
  streamId: string
  target: string
  value: string
  onChange: (text: string) => void
  onSubmit: (text: string) => Promise<unknown>
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
  replyTo,
  onCancelReply,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const touch = useIsTouch()

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
    if (!text) return
    await onSubmit(text)
    onChange('')
    ref.current?.focus()
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
    <div className="composer">
      {replyTo && <Quote message={replyTo} onCancel={onCancelReply} />}
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder={`Write to ${target}…`}
        aria-label={`Write to ${target}`}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="composer-foot">
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
          disabled={!value.trim()}
        />
      </div>
    </div>
  )
}
