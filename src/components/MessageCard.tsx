import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  deleteMessage,
  editMessage,
  pinMessage,
  setRead,
  streamPath,
  unpinMessage,
  versionsOf,
  viewName,
  type Attachment,
  type Message,
  type Pin,
  type Stream,
} from '../db'
import { formatFull, formatTimestamp } from '../format'
import {
  ArrowUpToLine,
  Check,
  Copy,
  Ellipsis,
  FileCheck,
  FilePlus,
  FolderInput,
  History,
  Mail,
  Pencil,
  Pin as PinIcon,
  PinOff,
  Reply,
  Trash2,
  Unlink,
  X,
} from 'lucide-react'
import { autosize } from '../autosize'
import { useIsTouch, useMediaQuery } from '../useMediaQuery'
import type { Focus } from '../App'
import ActionSheet, { type SheetItem } from './ActionSheet'
import AttachmentList from './AttachmentList'
import Clamp from './Clamp'
import IconButton from './IconButton'
import MessageBody from './MessageBody'
import MovePicker from './MovePicker'
import Quote from './Quote'
import VersionCalendar from './VersionCalendar'
import VersionNav from './VersionNav'

type Panel = 'none' | 'edit' | 'move' | 'history'

interface Props {
  message: Message
  streams: Stream[]
  /** The view this card is rendered in: a stream id, INBOX_ID or ALL_ID. Pins are scoped to it. */
  currentStreamId: string
  /** Every pin of this message, in any context. */
  pins: Pin[]
  /** Active in-stream search terms, highlighted in the text. */
  terms?: string[]
  focus: Focus | null
  /** The replied-to message: a Message, null when it was deleted, undefined when this is not a reply. */
  replyTarget?: Message | null
  attachments: Attachment[]
  onOpenStream: (streamId: string) => void
  onTagClick: (tag: string) => void
  onReply: (message: Message) => void
  onJumpTo: (message: Message) => void
  /** No Show more: the whole text is always shown (messages embedded in a page). */
  unclamped?: boolean
  /** Leave out the quotation of the replied-to message, when that message is shown right above (threads). */
  hideQuote?: boolean
  /** The page this message can be added to, when there is one: whether it is on it already, and how to add or go there. */
  page?: { has: boolean; add: () => void; open: () => void }
  /** Given for a message embedded in a page: turns the embed into page text. */
  onDissolve?: () => void
}

export default function MessageCard({
  message,
  streams,
  currentStreamId,
  pins,
  terms = [],
  focus,
  replyTarget,
  attachments,
  onOpenStream,
  onTagClick,
  onReply,
  onJumpTo,
  unclamped,
  hideQuote,
  page,
  onDissolve,
}: Props) {
  const [panel, setPanel] = useState<Panel>('none')
  const [draft, setDraft] = useState(message.text)
  const [expanded, setExpanded] = useState(false)
  // Version browsing: index into the newest-first version list; 0 is the current text.
  const [viewIdx, setViewIdx] = useState(0)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const versions = useLiveQuery(
    () => (panel === 'history' ? versionsOf(message.id) : Promise.resolve(undefined)),
    [panel, message.id],
  )
  const viewing = panel === 'history' && versions?.length ? versions[Math.min(viewIdx, versions.length - 1)] : undefined
  const showingOld = viewing !== undefined && viewIdx > 0
  const cardRef = useRef<HTMLElement>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const touch = useIsTouch()
  // Fingers and narrow screens get one "More" button and a bottom sheet instead of a row of small icons.
  const compactActions = useMediaQuery('(pointer: coarse), (max-width: 760px)')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access denied or unavailable: nothing was copied, so say nothing.
    }
  }

  // Scroll into view and glow briefly when opened from a search result.
  useEffect(() => {
    const el = cardRef.current
    if (!focus || !el) return
    el.scrollIntoView({ block: 'center' })
    const styles = getComputedStyle(el)
    const glow = styles.getPropertyValue('--accent-soft').trim()
    const resting = styles.backgroundColor
    const anim = el.animate(
      [
        { backgroundColor: glow },
        { backgroundColor: glow, offset: 0.6 },
        { backgroundColor: resting },
      ],
      { duration: 1600, easing: 'ease-out' },
    )
    return () => anim.cancel()
  }, [focus])

  useEffect(() => {
    if (panel !== 'edit') return
    const el = editRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [panel])

  useEffect(() => {
    if (panel === 'edit') autosize(editRef.current)
  }, [draft, panel])

  const toggle = (next: Panel) => {
    if (next === 'edit') setDraft(message.text)
    if (next === 'history') {
      setViewIdx(0)
      setCalendarOpen(false)
    }
    setPanel((prev) => (prev === next ? 'none' : next))
  }

  const save = async () => {
    const text = draft.trim()
    if (text || message.attachmentCount > 0) await editMessage(message.id, text)
    setPanel('none')
  }

  const onEditKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      setPanel('none')
    } else if (!touch && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void save()
    }
  }

  const remove = async () => {
    if (confirm('Delete this message and all of its versions?')) await deleteMessage(message.id)
  }

  const edited = message.versionCount > 1
  const pinnedHere = pins.find((p) => p.streamId === currentStreamId)
  const contextName = (id: string) => viewName(id) ?? (streamPath(streams, id) || 'a deleted stream')
  const pinnedElsewhere = pins
    .filter((p) => p.streamId !== currentStreamId)
    .sort((a, b) => contextName(a.streamId).localeCompare(contextName(b.streamId)))
  const home = message.streamId ? streams.find((s) => s.id === message.streamId) : undefined
  const showHomeChip = home && home.id !== currentStreamId

  type CardAction = SheetItem & { hint?: string; badge?: number }
  const earlier = message.versionCount - 1
  const actions: CardAction[] = [
    message.unread === 1
      ? {
          key: 'read',
          icon: Check,
          label: 'Mark read',
          onSelect: () => void setRead(message.id, true),
        }
      : {
          key: 'unread',
          icon: Mail,
          label: 'Mark unread',
          onSelect: () => void setRead(message.id, false),
        },
    { key: 'reply', icon: Reply, label: 'Reply', hint: 'Reply with a backlink', onSelect: () => onReply(message) },
    ...(pinnedHere
      ? [
          {
            key: 'repin',
            icon: ArrowUpToLine,
            label: 'Re-pin',
            hint: 'Re-pin: move back to the top',
            onSelect: () => void pinMessage(message.id, currentStreamId),
          },
          { key: 'unpin', icon: PinOff, label: 'Unpin', onSelect: () => void unpinMessage(message.id, currentStreamId) },
        ]
      : [
          {
            key: 'pin',
            icon: PinIcon,
            label: 'Pin',
            hint: `Pin in ${viewName(currentStreamId) ?? 'this stream'}`,
            onSelect: () => void pinMessage(message.id, currentStreamId),
          },
        ]),
    { key: 'edit', icon: Pencil, label: 'Edit', active: panel === 'edit', onSelect: () => toggle('edit') },
    {
      key: 'move',
      icon: FolderInput,
      label: 'Move',
      hint: 'Move to another stream',
      active: panel === 'move',
      onSelect: () => toggle('move'),
    },
    ...(page
      ? [
          page.has
            ? { key: 'onpage', icon: FileCheck, label: 'On page', hint: 'On the page: go to it', active: true, onSelect: page.open }
            : { key: 'addpage', icon: FilePlus, label: 'Add to page', hint: "Add to this stream's page", onSelect: page.add },
        ]
      : []),
    {
      key: 'copy',
      icon: copied ? Check : Copy,
      label: copied ? 'Copied' : 'Copy',
      hint: copied ? 'Copied' : 'Copy Markdown to clipboard',
      onSelect: () => void copy(),
    },
    ...(onDissolve
      ? [
          {
            key: 'dissolve',
            icon: Unlink,
            label: 'Dissolve',
            hint: 'Dissolve: write the text into the page, keep a summary',
            onSelect: onDissolve,
          },
        ]
      : []),
    ...(edited
      ? [
          {
            key: 'history',
            icon: History,
            label: `History · ${earlier}`,
            hint: `${earlier} earlier ${earlier === 1 ? 'version' : 'versions'}`,
            detail: `${earlier} earlier`,
            badge: earlier,
            active: panel === 'history',
            onSelect: () => toggle('history'),
          },
        ]
      : []),
    { key: 'delete', icon: Trash2, label: 'Delete', danger: true, onSelect: () => void remove() },
  ]

  const body = (
    <MessageBody
      text={viewing ? viewing.text : message.text}
      terms={terms}
      onChange={showingOld ? undefined : (next) => editMessage(message.id, next)}
      onTagClick={onTagClick}
    />
  )

  return (
    <article
      ref={cardRef}
      data-id={message.id}
      className={`msg${pins.length ? ' pinned' : ''}${message.unread ? ' unread' : ''}${showingOld ? ' viewing-old' : ''}`}
    >
      {message.replyToId && !hideQuote && (
        <Quote
          message={replyTarget ?? null}
          onOpen={replyTarget ? () => onJumpTo(replyTarget) : undefined}
        />
      )}
      {panel === 'edit' ? (
        <div className="msg-edit">
          <textarea
            ref={editRef}
            rows={1}
            value={draft}
            aria-label="Edit message"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onEditKey}
          />
          <div className="msg-edit-foot">
            <span className="hint">{touch ? 'Markdown supported' : 'Enter to save · Esc to cancel'}</span>
            <IconButton icon={X} label="Cancel" hint="Cancel (Esc)" size={18} onClick={() => setPanel('none')} />
            <IconButton
              icon={Check}
              label="Save"
              hint="Save (Enter)"
              size={18}
              align="end"
              className="send-btn"
              onClick={save}
              disabled={!draft.trim() && message.attachmentCount === 0}
            />
          </div>
        </div>
      ) : (
        (viewing ? viewing.text : message.text).length > 0 && (
          <div className="msg-text">
            {unclamped ? body : <Clamp expanded={expanded} onExpandedChange={setExpanded}>{body}</Clamp>}
          </div>
        )
      )}
      <AttachmentList items={attachments} />

      <footer className="msg-foot">
        <span className="msg-meta">
          {message.unread === 1 && <span className="unread-dot" role="img" aria-label="Unread" title="Unread" />}
          {pinnedHere ? (
            <span className="pin-badge" title={`Pinned here ${formatFull(pinnedHere.pinnedAt)}`}>
              <PinIcon size={11} strokeWidth={2} aria-hidden="true" />
              Pinned
            </span>
          ) : pinnedElsewhere.length > 0 ? (
            <span
              className="pin-badge elsewhere"
              title={pinnedElsewhere
                .map((p) => `Pinned in ${contextName(p.streamId)} ${formatFull(p.pinnedAt)}`)
                .join('\n')}
            >
              <PinIcon size={11} strokeWidth={2} aria-hidden="true" />
              Pinned in {pinnedElsewhere.map((p) => contextName(p.streamId)).join(', ')}
            </span>
          ) : null}
          <time dateTime={new Date(message.createdAt).toISOString()} title={formatFull(message.createdAt)}>
            {formatTimestamp(message.createdAt)}
          </time>
          {edited && (
            <>
              <span aria-hidden="true">·</span>
              <time
                dateTime={new Date(message.updatedAt).toISOString()}
                title={`Edited ${formatFull(message.updatedAt)}`}
              >
                edited {formatTimestamp(message.updatedAt)}
              </time>
            </>
          )}
          {showHomeChip && (
            <button
              className="chip"
              onClick={() => onOpenStream(home.id)}
              title={streamPath(streams, home.id)}
            >
              #{home.name}
            </button>
          )}
        </span>
        <span className="msg-actions">
          {compactActions ? (
            <IconButton icon={Ellipsis} label="More actions" size={20} align="end" onClick={() => setSheetOpen(true)} />
          ) : (
            actions.map(({ key, icon, label, hint, danger, active, badge, onSelect }) => (
              <IconButton
                key={key}
                icon={icon}
                label={label}
                hint={hint}
                danger={danger}
                active={active}
                badge={badge}
                align={key === 'delete' ? 'end' : 'center'}
                onClick={onSelect}
              />
            ))
          )}
        </span>
      </footer>

      {sheetOpen && <ActionSheet title="Message" items={actions} onClose={() => setSheetOpen(false)} />}
      {panel === 'move' && (
        <MovePicker message={message} streams={streams} onClose={() => setPanel('none')} />
      )}
      {panel === 'history' && versions && versions.length > 0 && (
        <VersionNav
          versions={versions}
          index={Math.min(viewIdx, versions.length - 1)}
          onChange={setViewIdx}
          onOpenCalendar={() => setCalendarOpen(true)}
        />
      )}
      {calendarOpen && versions && versions.length > 0 && (
        <VersionCalendar
          versions={versions}
          initialIndex={Math.min(viewIdx, versions.length - 1)}
          onPick={(i) => {
            setViewIdx(i)
            setCalendarOpen(false)
          }}
          onClose={() => setCalendarOpen(false)}
        />
      )}
    </article>
  )
}
