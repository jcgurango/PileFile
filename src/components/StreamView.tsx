import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  addMessage,
  ALL_ID,
  ancestorsOf,
  db,
  deleteStream,
  descendantIds,
  editPage,
  ensureStreamPath,
  flattenTree,
  INBOX_ID,
  loadStreamView,
  markRead,
  matchesQuery,
  moveStream,
  pageTexts,
  parseSearch,
  renameStream,
  setStreamView,
  viewName,
  type Message,
  type Stream,
  type StreamViewData,
  type StreamViewMode,
} from '../db'
import { appendEmbed, embeddedIds } from '../page'
import { buildThreads } from '../threads'
import { useMediaQuery } from '../useMediaQuery'
import { useTagSuggest } from '../useTagSuggest'
import {
  CheckCheck,
  ChevronRight,
  Ellipsis,
  FileText,
  FolderInput,
  FolderPlus,
  ListFilter,
  ListTree,
  Menu,
  MessagesSquare,
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
import PageView from './PageView'
import TagMenu from './TagMenu'
import ThreadList from './ThreadList'

const VIEWS: Array<{ id: StreamViewMode; label: string; icon: typeof FileText }> = [
  { id: 'page', label: 'Page', icon: FileText },
  { id: 'messages', label: 'Messages', icon: MessagesSquare },
  { id: 'threaded', label: 'Threaded', icon: ListTree },
]

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

  // A stream opens in the view it was last left in, on any device. The choice is read once, on arriving:
  // a change made elsewhere while this stream is open must not switch the view under the reader.
  const choices = useLiveQuery(() => db.streamViews.toArray().then((rows) => new Map(rows.map((r) => [r.streamId, r.view]))), [])
  const [latched, setLatched] = useState<{ streamId: string; mode: StreamViewMode } | null>(null)
  if (choices && latched?.streamId !== streamId) {
    setLatched({ streamId, mode: (stream && choices.get(streamId)) || 'messages' })
  }
  const ready = latched?.streamId === streamId
  const mode: StreamViewMode = ready && stream ? latched.mode : 'messages'
  const setMode = (next: StreamViewMode) => {
    if (!stream || next === mode) return
    setLatched({ streamId, mode: next })
    setSearchFor(null)
    void setStreamView(stream.id, next)
  }
  // A message opened from search or a quote has to be on screen, which the page cannot promise.
  const [seenFocus, setSeenFocus] = useState(focus?.nonce)
  if (focus?.nonce !== seenFocus) {
    setSeenFocus(focus?.nonce)
    if (focus && ready && mode === 'page') setLatched({ streamId, mode: 'messages' })
  }

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
    // A message sent from the page is shown where messages live.
    if (mode === 'page') setMode('messages')
  }

  /** Go to a message: stay in this view when it is already shown here, else open its home stream. */
  const jumpTo = (target: Message) => {
    const here = view?.messages.some((m) => m.id === target.id)
    onOpenStream(here ? streamId : (target.streamId ?? ALL_ID), target.id)
  }

  // "Add to page" goes to the page of the stream being viewed, or in All and the Inbox to the message's own stream.
  const pageStreams = stream
    ? [stream.id]
    : [...new Set((view?.messages ?? []).flatMap((m) => (m.streamId ? [m.streamId] : [])))].sort()
  const pageKey = pageStreams.join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pages = useLiveQuery(() => pageTexts(pageStreams), [pageKey])
  const onPage = useMemo(() => new Map([...(pages ?? [])].map(([id, text]) => [id, embeddedIds(text)])), [pages])
  const pageFor = (m: Message) => {
    const target = stream?.id ?? m.streamId
    if (!target) return undefined
    return {
      has: onPage.get(target)?.has(m.id) ?? false,
      add: () => void editPage(target, (text) => appendEmbed(text, 'message', m.id)),
      open: () => (target === streamId ? setMode('page') : onOpenStream(target)),
    }
  }

  /** One message card, wherever it is shown: the flat list, a thread, or embedded in the page. */
  const card = (
    m: Message,
    data: StreamViewData,
    opts: { nested?: boolean; embedded?: boolean; onDissolve?: () => void } = {},
  ) => (
    <MessageCard
      key={m.id}
      message={m}
      streams={streams}
      currentStreamId={streamId}
      pins={data.pinsByMessage.get(m.id) ?? []}
      terms={filtering ? parsed.highlights : undefined}
      focus={focus?.messageId === m.id ? focus : null}
      replyTarget={m.replyToId ? (data.replyTargets.get(m.replyToId) ?? null) : undefined}
      attachments={data.attachmentsByMessage.get(m.id) ?? []}
      onOpenStream={onOpenStream}
      onTagClick={onTagClick}
      onReply={setReplyTo}
      onJumpTo={jumpTo}
      hideQuote={opts.nested}
      unclamped={opts.embedded}
      page={opts.embedded ? undefined : pageFor(m)}
      onDissolve={opts.onDissolve}
    />
  )

  /** Marks what is on screen: with a search or the unread filter active, only what they show. */
  const unreadShown = useMemo(() => (messages ?? []).filter((m) => m.unread === 1).map((m) => m.id), [messages])
  const markShownRead = async () => {
    const n = unreadShown.length
    if (n === 0) return
    if (confirm(`Mark ${n} ${n === 1 ? 'message' : 'messages'} as read?`)) await markRead(unreadShown)
  }

  // Header editing state is tied to a stream id, so switching streams implicitly cancels it.
  const [modeFor, setModeFor] = useState<{ streamId: string; mode: HeaderMode } | null>(null)
  const headerMode = modeFor?.streamId === streamId ? modeFor.mode : null
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
    closeMode()
    // A path such as "Projects/Alpha" is created level by level below this stream.
    const id = stream ? await ensureStreamPath(field, stream.id) : null
    if (id) onOpenStream(id)
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
      `Delete the stream "${stream.name}"?\n\nIts messages and any streams nested inside it move up to ${dest}. Its page is deleted with it.`,
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
  // Search results and the unread filter are flat lists; threads only make sense with every message present.
  const threaded = mode === 'threaded' && !filtering && !unreadOnly
  const threads = threaded && messages ? buildThreads(messages) : []

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

        {headerMode === 'rename' || headerMode === 'child' ? (
          <form
            className="rename"
            onSubmit={(e) => {
              e.preventDefault()
              void (headerMode === 'rename' ? commitRename() : commitChild())
            }}
          >
            <input
              autoFocus
              aria-label={headerMode === 'rename' ? 'Stream name' : 'New stream name'}
              placeholder={headerMode === 'child' ? `New stream inside ${title}` : undefined}
              value={field}
              // A name cannot hold "/": it separates the levels of a path.
              onChange={(e) => setField(headerMode === 'rename' ? e.target.value.replaceAll('/', '') : e.target.value)}
              onBlur={() => (headerMode === 'rename' ? commitRename() : closeMode())}
              onKeyDown={(e) => {
                if (e.key === 'Escape') closeMode()
              }}
            />
          </form>
        ) : headerMode === 'move' ? (
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

        {headerMode === null && (
          <div className="head-actions">
            {mode !== 'page' && (
              <>
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
              </>
            )}
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

      {stream && (
        <div className="view-tabs" role="tablist" aria-label="View">
          {VIEWS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={mode === id}
              className={`view-tab${mode === id ? ' selected' : ''}`}
              onClick={() => setMode(id)}
            >
              <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
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

      {!ready ? (
        <div className="messages" />
      ) : mode === 'page' && stream ? (
        <PageView
          stream={stream}
          onJumpTo={jumpTo}
          renderCard={({ message, data, onDissolve, nested }) => card(message, data, { embedded: true, nested, onDissolve })}
        />
      ) : (
        <div className={`messages${threaded ? ' threaded' : ''}`}>
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
          {view &&
            (threaded ? (
              <ThreadList nodes={threads} renderCard={(m, nested) => card(m, view, { nested })} />
            ) : (
              messages?.map((m) => card(m, view))
            ))}
        </div>
      )}
    </main>
  )
}
