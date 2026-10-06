import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useTagSuggest } from '../useTagSuggest'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ALL_ID,
  ancestorsOf,
  byActivity,
  ensureStreamPath,
  flattenTree,
  INBOX_ID,
  isVirtual,
  lastMessageAt,
  search,
  streamPath,
  unreadCounts,
  type Stream,
} from '../db'
import { ChevronDown, ChevronRight, Hash, Inbox, Layers, Plus, Search as SearchIcon, X } from 'lucide-react'
import { formatFull, formatTimestamp, messagePreview, snippet } from '../format'
import AccountPanel from './AccountPanel'
import Highlighted from './Highlighted'
import IconButton from './IconButton'
import TagMenu from './TagMenu'

interface Props {
  streams: Stream[]
  selectedId: string
  onSelect: (streamId: string, messageId?: string) => void
  open: boolean
  onClose: () => void
  /** The search query lives in App so a tag click anywhere can open the search panel with it. */
  query: string
  onQueryChange: (query: string) => void
  /** Bumped when something outside the sidebar sets the query and wants the box focused. */
  focusNonce: number
}

export default function Sidebar({
  streams,
  selectedId,
  onSelect,
  open,
  onClose,
  query,
  onQueryChange,
  focusNonce,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const searching = query.trim().length > 0
  const searchRef = useRef<HTMLInputElement>(null)
  const suggest = useTagSuggest(query, onQueryChange)

  useEffect(() => {
    if (focusNonce && !window.matchMedia('(pointer: coarse)').matches) searchRef.current?.focus()
  }, [focusNonce])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Selecting a nested stream (e.g. from search) expands the branches above it.
  const select = useCallback(
    (streamId: string, messageId?: string) => {
      if (!isVirtual(streamId)) {
        const above = ancestorsOf(streams, streamId).map((s) => s.id)
        if (above.length) {
          setCollapsed((prev) => {
            const next = new Set(prev)
            for (const id of above) next.delete(id)
            return next
          })
        }
      }
      onSelect(streamId, messageId)
    },
    [streams, onSelect],
  )

  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <>
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Streams and search">
        <div className="sidebar-head">
          <div className="brand-row">
            <h1 className="brand">
              <img className="brand-icon" src="/pilefile-icon.svg" alt="" width={22} height={22} />
              PileFile
            </h1>
            <IconButton
              icon={X}
              label="Close streams"
              size={20}
              tip="bottom"
              align="end"
              className="drawer-only"
              onClick={onClose}
            />
          </div>
          <div className="search-wrap search-field">
            <SearchIcon size={16} strokeWidth={1.75} aria-hidden="true" className="search-icon" />
            <input
              ref={searchRef}
              type="search"
              className="search"
              placeholder="Search messages and streams"
              aria-label="Search"
              aria-autocomplete="list"
              aria-expanded={suggest.open}
              aria-controls="sidebar-tag-menu"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (suggest.onKeyDown(e)) return
                if (e.key === 'Escape' && query) {
                  e.stopPropagation()
                  onQueryChange('')
                }
              }}
            />
            {suggest.open && (
              <TagMenu id="sidebar-tag-menu" items={suggest.items} active={suggest.active} onPick={suggest.pick} />
            )}
          </div>
        </div>
        {searching ? (
          <SearchResultsList query={query} streams={streams} onSelect={select} />
        ) : (
          <StreamTree
            streams={streams}
            selectedId={selectedId}
            collapsed={collapsed}
            onToggle={toggleCollapsed}
            onSelect={select}
          />
        )}
        <AccountPanel />
      </aside>
      {open && <div className="scrim" onClick={onClose} />}
    </>
  )
}

// --------------------------------------------------------------- tree

interface TreeProps {
  streams: Stream[]
  selectedId: string
  collapsed: Set<string>
  onToggle: (id: string) => void
  onSelect: (streamId: string) => void
}

function StreamTree({ streams, selectedId, collapsed, onToggle, onSelect }: TreeProps) {
  const counts = useLiveQuery(() => unreadCounts(streams), [streams]) ?? {}
  // Most recently written-to streams first. Nothing is listed until the dates are in, so rows do not jump.
  const lastAt = useLiveQuery(() => lastMessageAt(streams), [streams])
  const rows = useMemo(() => (lastAt ? flattenTree(streams, byActivity(lastAt)) : []), [streams, lastAt])
  const visible = rows.filter(
    ({ stream }) => !ancestorsOf(streams, stream.id).some((a) => collapsed.has(a.id)),
  )

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    // "Work/Projects" creates both levels, or opens what is already there.
    const id = await ensureStreamPath(name)
    if (!id) return
    setName('')
    setAdding(false)
    onSelect(id)
  }
  const cancel = () => {
    setAdding(false)
    setName('')
  }

  return (
    <nav className="stream-list">
      <StreamRow
        name="All"
        kind="all"
        selected={selectedId === ALL_ID}
        onClick={() => onSelect(ALL_ID)}
      />
      <StreamRow
        name="Inbox"
        kind="inbox"
        count={counts[INBOX_ID]}
        selected={selectedId === INBOX_ID}
        onClick={() => onSelect(INBOX_ID)}
      />
      {streams.length > 0 && <div className="list-label">Streams</div>}
      {visible.map(({ stream, depth, hasChildren }) => (
        <StreamRow
          key={stream.id}
          name={stream.name}
          depth={depth}
          count={counts[stream.id]}
          selected={selectedId === stream.id}
          onClick={() => onSelect(stream.id)}
          toggle={
            hasChildren
              ? { collapsed: collapsed.has(stream.id), onToggle: () => onToggle(stream.id) }
              : undefined
          }
        />
      ))}
      {adding ? (
        <form className="new-stream" onSubmit={submit}>
          <input
            ref={inputRef}
            value={name}
            placeholder="Name, or Parent/Child"
            aria-label="New stream name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancel()
            }}
            onBlur={() => {
              if (!name.trim()) cancel()
            }}
          />
        </form>
      ) : (
        <button className="new-stream-btn" onClick={() => setAdding(true)}>
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          New stream
        </button>
      )}
    </nav>
  )
}

interface StreamRowProps {
  name: string
  /** Unread messages in this view, shown as a badge when there are any. */
  count?: number
  selected: boolean
  kind?: 'inbox' | 'all' | 'stream'
  depth?: number
  toggle?: { collapsed: boolean; onToggle: () => void }
  onClick: () => void
}

const ROW_ICONS = {
  inbox: Inbox,
  all: Layers,
  stream: Hash,
}

function StreamRow({
  name,
  count,
  selected,
  kind = 'stream',
  depth = 0,
  toggle,
  onClick,
}: StreamRowProps) {
  const Icon = ROW_ICONS[kind]
  return (
    <div
      className={`stream-row${selected ? ' selected' : ''}`}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
    >
      {toggle ? (
        <button
          className="tree-toggle"
          onClick={toggle.onToggle}
          aria-label={toggle.collapsed ? `Expand ${name}` : `Collapse ${name}`}
          aria-expanded={!toggle.collapsed}
        >
          {toggle.collapsed ? (
            <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
          )}
        </button>
      ) : (
        <span className="stream-icon" aria-hidden="true">
          <Icon size={15} strokeWidth={1.75} />
        </span>
      )}
      <button className="stream-btn" onClick={onClick} aria-current={selected ? 'page' : undefined}>
        <span className="stream-name">{name}</span>
        {count ? (
          <span className="stream-count" title={`${count} unread`}>
            {count}
          </span>
        ) : null}
      </button>
    </div>
  )
}

// ------------------------------------------------------------------- search

interface SearchProps {
  query: string
  streams: Stream[]
  onSelect: (streamId: string, messageId?: string) => void
}

function SearchResultsList({ query, streams, onSelect }: SearchProps) {
  // useLiveQuery keeps the previous result while a new query runs, so typing does not flicker.
  const results = useLiveQuery(() => search(query), [query])
  const q = query.trim().toLowerCase()
  const showInbox = 'inbox'.includes(q)
  const showAll = 'all'.includes(q)

  if (!results) return <div className="results" />

  const { highlights, streams: matchedStreams, messages } = results
  const anyStreams = showInbox || showAll || matchedStreams.length > 0

  return (
    <div className="results">
      <section>
        <div className="list-label">Streams</div>
        {!anyStreams && <p className="muted small pad">No matching streams</p>}
        {showAll && <StreamRow name="All" kind="all" selected={false} onClick={() => onSelect(ALL_ID)} />}
        {showInbox && (
          <StreamRow name="Inbox" kind="inbox" selected={false} onClick={() => onSelect(INBOX_ID)} />
        )}
        {matchedStreams.map((s) => (
          <StreamRow
            key={s.id}
            name={streamPath(streams, s.id)}
            selected={false}
            onClick={() => onSelect(s.id)}
          />
        ))}
      </section>
      <section>
        <div className="list-label">
          Messages{messages.length ? ` · ${messages.length}` : ''}
        </div>
        {messages.length === 0 && <p className="muted small pad">No matching messages</p>}
        {messages.map((m) => {
          const where = m.streamId ? streamPath(streams, m.streamId) || 'Unknown stream' : 'Not filed'
          return (
            <button
              key={m.id}
              className="result-row"
              onClick={() => onSelect(m.streamId ?? ALL_ID, m.id)}
            >
              <span className="result-text">
                <Highlighted
                  text={m.text ? snippet(m.text, highlights) : messagePreview('', m.attachmentCount)}
                  terms={highlights}
                />
              </span>
              <span className="result-meta">
                <time title={formatFull(m.createdAt)}>{formatTimestamp(m.createdAt)}</time> · {where}
              </span>
            </button>
          )
        })}
      </section>
    </div>
  )
}
