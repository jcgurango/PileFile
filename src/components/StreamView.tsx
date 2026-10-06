import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  addMessage,
  ALL_ID,
  ancestorsOf,
  createStream,
  deleteStream,
  descendantIds,
  flattenTree,
  INBOX_ID,
  loadStreamView,
  markRead,
  matchesQuery,
  moveStream,
  parseSearch,
  renameStream,
  viewName,
  type Message,
  type Stream,
} from '../db'
import { useMediaQuery } from '../useMediaQuery'
import { useTagSuggest } from '../useTagSuggest'
import {
  CheckCheck,
  ChevronRight,
  Ellipsis,
  FolderInput,
  FolderPlus,
  ListFilter,
  Menu,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import type { Focus, IncomingShare } from '../App'
import ActionSheet from './ActionSheet'
import Composer from './Composer'
import IconButton from './IconButton'
import MessageCard from './MessageCard'
import TagMenu from './TagMenu'

type HeaderMode = 'rename' | 'child' | 'move'

interface Props {
  streamId: string
  stream?: Stream
  streams: Stream[]
  focus: Focus | null
  onOpenStream: (streamId: string, messageId?: string) => void
  onOpenDrawer: () => void
  onTagClick: (tag: string) => void
  /** From the OS share sheet: appended to the current composer's draft and pending files. */
  share?: IncomingShare | null
  onShareConsumed?: () => void
}

export default function StreamView({
  streamId,
  stream,
  streams,
  focus,
  onOpenStream,
  onOpenDrawer,
  onTagClick,
  share,
  onShareConsumed,
}: Props) {
  const view = useLiveQuery(() => loadStreamView(streamId, streams), [streamId, streams])
  const title = viewName(streamId) ?? stream?.name ?? ''
  const crumbs = stream ? ancestorsOf(streams, stream.id) : []

  // In-stream search is tied to a stream id, so switching streams closes it.
  const [searchFor, setSearchFor] = useState<{ streamId: string; query: string } | null>(null)
  const searching = searchFor?.streamId === streamId
  const query = searching ? searchFor.query : ''
  const parsed = useMemo(() => parseSearch(query), [query])
  const openSearch = () => setSearchFor({ streamId, query: '' })
  const closeSearch = () => setSearchFor(null)
  const setQuery = (q: string) => setSearchFor({ streamId, query: q })
  const suggest = useTagSuggest(query, setQuery)

  // The unread-only filter is remembered per view, as the time it was switched on (null: switched off).
  // The Inbox starts with it on, which is what makes it a triage tray; everything else starts with it off.
  const [unreadOnlySince, setUnreadOnlySince] = useState<Record<string, number | null>>({})
  const storedSince = unreadOnlySince[streamId]
  const unreadSince = storedSince !== undefined ? storedSince : streamId === INBOX_ID ? 0 : null
  const unreadOnly = unreadSince !== null
  const toggleUnreadOnly = () => setUnreadOnlySince((u) => ({ ...u, [streamId]: unreadOnly ? null : Date.now() }))

  // What the view holds once the unread filter is applied. A message opened from a search result
  // or a quote after the filter went on stays listed even when read, so there is something to scroll to.
  const keepId = focus && unreadSince !== null && focus.nonce > unreadSince ? focus.messageId : undefined
  const listed = useMemo(() => {
    if (!view) return undefined
    if (!unreadOnly) return view.messages
    return view.messages.filter((m) => m.unread === 1 || m.id === keepId)
  }, [view, unreadOnly, keepId])

  // While searching, show only matches, newest first; pins do not reorder results.
  const hasQuery = parsed.terms.length > 0 || parsed.tags.length > 0
  const messages = useMemo(() => {
    if (!listed) return undefined
    if (!searching || !hasQuery) return listed
    return listed.filter((m) => matchesQuery(m, parsed)).sort((a, b) => b.createdAt - a.createdAt)
  }, [listed, searching, hasQuery, parsed])

  // Unsent drafts and pending replies are kept per stream so switching around does not lose them.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const draft = drafts[streamId] ?? ''
  const setDraft = (text: string) => setDrafts((d) => ({ ...d, [streamId]: text }))
  const [pendingFiles, setPendingFiles] = useState<Record<string, File[]>>({})
  const files = pendingFiles[streamId] ?? []
  const setFiles = (list: File[]) => setPendingFiles((p) => ({ ...p, [streamId]: list }))
  const [replies, setReplies] = useState<Record<string, Message>>({})
  const replyTo = replies[streamId] ?? null
  const setReplyTo = (m: Message | null) =>
    setReplies((r) => {
      const next = { ...r }
      if (m) next[streamId] = m
      else delete next[streamId]
      return next
    })

  // Consume a share once, after render, into whichever view is open.
  useEffect(() => {
    if (!share) return
    let cancelled = false
    void Promise.resolve().then(() => {
      if (cancelled) return
      setDrafts((d) => {
        const current = d[streamId] ?? ''
        return { ...d, [streamId]: current ? `${current}\n${share.text}` : share.text }
      })
      if (share.files.length) setPendingFiles((p) => ({ ...p, [streamId]: [...(p[streamId] ?? []), ...share.files] }))
      onShareConsumed?.()
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [share?.nonce])

  const submit = async (text: string, attach: File[]) => {
    await addMessage(text, streamId, replyTo?.id ?? null, attach)
    setReplyTo(null)
  }

  /** Go to a message: stay in this view when it is already shown here, else open its home stream. */
  const jumpTo = (target: Message) => {
    const here = view?.messages.some((m) => m.id === target.id)
    onOpenStream(here ? streamId : (target.streamId ?? ALL_ID), target.id)
  }

  /** Marks what is on screen: with a search or the unread filter active, only what they show. */
  const unreadShown = useMemo(() => (messages ?? []).filter((m) => m.unread === 1).map((m) => m.id), [messages])
  const markShownRead = async () => {
    const n = unreadShown.length
    if (n === 0) return
    if (confirm(`Mark ${n} ${n === 1 ? 'message' : 'messages'} as read?`)) await markRead(unreadShown)
  }

  // Header editing state is tied to a stream id, so switching streams implicitly cancels it.
  const [modeFor, setModeFor] = useState<{ streamId: string; mode: HeaderMode } | null>(null)
  const mode = modeFor?.streamId === streamId ? modeFor.mode : null
  const [field, setField] = useState('')
  const openMode = (m: HeaderMode) => {
    setField(m === 'rename' && stream ? stream.name : '')
    setModeFor({ streamId, mode: m })
  }
  const closeMode = () => setModeFor(null)

  const commitRename = async () => {
    const name = field.trim()
    closeMode()
    if (stream && name && name !== stream.name) await renameStream(stream.id, name)
  }

  const commitChild = async () => {
    const name = field.trim()
    closeMode()
    if (stream && name) onOpenStream(await createStream(name, stream.id))
  }

  const commitMove = async (parentId: string | null) => {
    closeMode()
    if (stream) await moveStream(stream.id, parentId)
  }

  const removeStream = async () => {
    if (!stream) return
    const parent = streams.find((s) => s.id === stream.parentId)
    const dest = parent ? `"${parent.name}"` : 'the top level'
    const ok = confirm(
      `Delete the stream "${stream.name}"?\n\nIts messages and any streams nested inside it move up to ${dest}.`,
    )
    if (ok) await deleteStream(stream.id)
  }

  // Fingers and narrow screens get one "Stream actions" button and a bottom sheet, like message cards do.
  const compactActions = useMediaQuery('(pointer: coarse), (max-width: 760px)')
  const [sheetOpen, setSheetOpen] = useState(false)
  const streamActions = [
    { key: 'rename', icon: Pencil, label: 'Rename', hint: 'Rename stream', onSelect: () => openMode('rename') },
    {
      key: 'child',
      icon: FolderPlus,
      label: 'Nest new',
      hint: 'New stream inside this one',
      onSelect: () => openMode('child'),
    },
    {
      key: 'move',
      icon: FolderInput,
      label: 'Move',
      hint: 'Move stream under another',
      onSelect: () => openMode('move'),
    },
    {
      key: 'delete',
      icon: Trash2,
      label: 'Delete',
      hint: 'Delete stream',
      danger: true,
      onSelect: () => void removeStream(),
    },
  ]

  // Candidate parents for "Move": any stream that is not this one or below it.
  const blocked = stream ? new Set([stream.id, ...descendantIds(streams, stream.id)]) : new Set()
  const parentOptions = flattenTree(streams).filter((r) => !blocked.has(r.stream.id))

  const count = messages?.length ?? 0
  const total = listed?.length ?? 0
  const totalLabel = unreadOnly ? `${total} unread` : `${total} ${total === 1 ? 'message' : 'messages'}`
  const filtering = searching && hasQuery

  return (
    <main className="main">
      <header className="main-head">
        <IconButton
          icon={Menu}
          label="Open streams"
          size={20}
          tip="bottom"
          className="drawer-only"
          onClick={onOpenDrawer}
        />

        {mode === 'rename' || mode === 'child' ? (
          <form
            className="rename"
            onSubmit={(e) => {
              e.preventDefault()
              void (mode === 'rename' ? commitRename() : commitChild())
            }}
          >
            <input
              autoFocus
              aria-label={mode === 'rename' ? 'Stream name' : 'New stream name'}
              placeholder={mode === 'child' ? `New stream inside ${title}` : undefined}
              value={field}
              onChange={(e) => setField(e.target.value)}
              onBlur={() => (mode === 'rename' ? commitRename() : closeMode())}
              onKeyDown={(e) => {
                if (e.key === 'Escape') closeMode()
              }}
            />
          </form>
        ) : mode === 'move' ? (
          <div className="rename move-row">
            <label className="muted small" htmlFor="move-parent">
              Move {title} under
            </label>
            <select
              id="move-parent"
              autoFocus
              defaultValue={stream?.parentId ?? ''}
              onChange={(e) => commitMove(e.target.value || null)}
              onBlur={closeMode}
              onKeyDown={(e) => {
                if (e.key === 'Escape') closeMode()
              }}
            >
              <option value="">Top level</option>
              {parentOptions.map(({ stream: s, depth }) => (
                <option key={s.id} value={s.id}>
                  {'  '.repeat(depth)}
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <nav className="crumbs" aria-label="Stream path">
              {crumbs.map((c) => (
                <span key={c.id} className="crumb">
                  <button className="crumb-btn" onClick={() => onOpenStream(c.id)}>
                    {c.name}
                  </button>
                  <ChevronRight size={14} strokeWidth={2} aria-hidden="true" className="crumb-sep" />
                </span>
              ))}
              <h2 className="main-title">{title}</h2>
            </nav>
            <span className="main-count">{view ? totalLabel : ''}</span>
          </>
        )}

        {mode === null && (
          <div className="head-actions">
            <IconButton
              icon={Search}
              label="Search"
              hint={`Search in ${title}`}
              size={18}
              tip="bottom"
              align="end"
              active={searching}
              onClick={searching ? closeSearch : openSearch}
            />
            <IconButton
              icon={ListFilter}
              label="Unread only"
              hint={unreadOnly ? 'Show all messages' : 'Show unread only'}
              size={18}
              tip="bottom"
              align="end"
              active={unreadOnly}
              onClick={toggleUnreadOnly}
            />
            <IconButton
              icon={CheckCheck}
              label="Mark all as read"
              size={18}
              tip="bottom"
              align="end"
              disabled={unreadShown.length === 0}
              onClick={markShownRead}
            />
            {stream &&
              (compactActions ? (
                <IconButton
                  icon={Ellipsis}
                  label="Stream actions"
                  size={20}
                  tip="bottom"
                  align="end"
                  onClick={() => setSheetOpen(true)}
                />
              ) : (
                streamActions.map(({ key, icon, label, hint, danger, onSelect }) => (
                  <IconButton
                    key={key}
                    icon={icon}
                    label={label}
                    hint={hint}
                    size={18}
                    tip="bottom"
                    align="end"
                    danger={danger}
                    onClick={onSelect}
                  />
                ))
              ))}
          </div>
        )}
      </header>
      {sheetOpen && stream && (
        <ActionSheet
          title={stream.name}
          items={streamActions.map((a) => ({ ...a, label: a.hint }))}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {searching ? (
        <div className="stream-search" role="search">
          <div className="search-field">
            <input
              type="search"
              autoFocus
              value={query}
              placeholder={`Search in ${title}… (# for tags)`}
              aria-label={`Search in ${title}`}
              aria-autocomplete="list"
              aria-expanded={suggest.open}
              aria-controls="stream-tag-menu"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (suggest.onKeyDown(e)) return
                if (e.key === 'Escape') closeSearch()
              }}
            />
            {suggest.open && (
              <TagMenu id="stream-tag-menu" items={suggest.items} active={suggest.active} onPick={suggest.pick} />
            )}
          </div>
          <span className="muted small stream-search-count">
            {filtering ? `${count} of ${total}` : totalLabel}
          </span>
          <IconButton icon={X} label="Done" hint="Close search (Esc)" size={18} align="end" onClick={closeSearch} />
        </div>
      ) : (
        <Composer
          streamId={streamId}
          target={title}
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          files={files}
          onFilesChange={setFiles}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
        />
      )}

      <div className="messages">
        {messages && messages.length === 0 && filtering && (
          <div className="empty">
            <p>No matches.</p>
            <p className="muted">
              Nothing{unreadOnly ? ' unread' : ''} in {title}
              {stream && descendantIds(streams, stream.id).length ? ' or its nested streams' : ''} contains
              “{query.trim()}”.
            </p>
          </div>
        )}
        {messages && messages.length === 0 && !filtering && (
          <div className="empty">
            {unreadOnly && streamId === INBOX_ID ? (
              <>
                <p>You're all caught up.</p>
                <p className="muted">
                  New messages without a stream land here until you mark them read or move them into one.
                </p>
              </>
            ) : unreadOnly ? (
              <>
                <p>No unread messages.</p>
                <p className="muted">Everything in {title} has been read.</p>
              </>
            ) : (
              <>
                <p>Nothing here yet.</p>
                <p className="muted">
                  {streamId === ALL_ID
                    ? 'Every message you write shows up here, whatever stream it is filed in.'
                    : streamId === INBOX_ID
                      ? 'Messages that are not filed in a stream show up here.'
                      : `Write something above to add it to ${title}.`}
                </p>
              </>
            )}
          </div>
        )}
        {messages?.map((m) => (
          <MessageCard
            key={m.id}
            message={m}
            streams={streams}
            currentStreamId={streamId}
            pins={view?.pinsByMessage.get(m.id) ?? []}
            terms={filtering ? parsed.highlights : undefined}
            focus={focus?.messageId === m.id ? focus : null}
            replyTarget={m.replyToId ? (view?.replyTargets.get(m.replyToId) ?? null) : undefined}
            attachments={view?.attachmentsByMessage.get(m.id) ?? []}
            onOpenStream={onOpenStream}
            onTagClick={onTagClick}
            onReply={setReplyTo}
            onJumpTo={jumpTo}
          />
        ))}
      </div>
    </main>
  )
}
