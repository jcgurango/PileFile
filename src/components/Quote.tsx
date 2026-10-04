import { CornerUpLeft, X } from 'lucide-react'
import type { Message } from '../db'
import { formatFull, formatTimestamp, messagePreview } from '../format'
import IconButton from './IconButton'

interface Props {
  /** The quoted message, or null when it has been deleted. */
  message: Message | null
  /** Shown when the quote is clickable: jumps to the original. */
  onOpen?: () => void
  /** Shown while composing: removes the reply link. */
  onCancel?: () => void
}

/** The small quotation of a replied-to message, used above the composer and above a reply. */
export default function Quote({ message, onOpen, onCancel }: Props) {
  const body = message ? (
    <>
      <span className="quote-text">{messagePreview(message.text, message.attachmentCount)}</span>
      <time className="quote-time" title={formatFull(message.createdAt)}>
        {formatTimestamp(message.createdAt)}
      </time>
    </>
  ) : (
    <span className="quote-text muted">Original message was deleted</span>
  )

  return (
    <div className={`quote${onCancel ? ' composing' : ''}`}>
      <CornerUpLeft size={14} strokeWidth={2} aria-hidden="true" className="quote-icon" />
      {message && onOpen ? (
        <button className="quote-body" onClick={onOpen} title="Go to the original message">
          {body}
        </button>
      ) : (
        <div className="quote-body">{body}</div>
      )}
      {onCancel && <IconButton icon={X} label="Cancel reply" hint="Cancel reply" align="end" onClick={onCancel} />}
    </div>
  )
}
