import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { History } from 'lucide-react'
import { loadEmbedded, pageVersionsOf, savePage, type Message, type Stream, type StreamViewData } from '../db'
import type { EmbedLine, EmbedSlot } from '../editor/embeds'
import { dissolved } from '../page'
import { buildThreads } from '../threads'
import IconButton from './IconButton'
import PageEditor, { type EmbedApi } from './PageEditor'
import Quote from './Quote'
import ThreadList from './ThreadList'
import VersionCalendar from './VersionCalendar'
import VersionNav from './VersionNav'

/** What it takes to draw one embedded message; the stream view owns the wiring. */
export interface EmbedCard {
  message: Message
  data: StreamViewData
  /** Set for a `message` embed: the action that turns it into page text. */
  onDissolve?: () => void
  /** A reply shown under its original inside a `thread` embed. */
  nested: boolean
}

interface Props {
  stream: Stream
  renderCard: (card: EmbedCard) => ReactNode
  onJumpTo: (message: Message) => void
}

/** Quiet time after the last keystroke before the page is written. */
const SAVE_MS = 800
/** Typing keeps rewriting one version for this long, then starts the next: history gets a step every few minutes, not every pause. */
const BURST_MS = 5 * 60_000

/** A stream's page: a live Markdown editor with messages set into it, saved as you type and kept as versions. */
export default function PageView({ stream, renderCard, onJumpTo }: Props) {
  const versions = useLiveQuery(() => pageVersionsOf(stream.id), [stream.id])
  // Version browsing, as on a message: index into the newest-first list; null is closed.
  const [viewIdx, setViewIdx] = useState<number | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [unsaved, setUnsaved] = useState(false)
  const [embeds, setEmbeds] = useState<EmbedLine[]>([])

  const pending = useRef<{ text: string; timer: number } | null>(null)
  const burst = useRef<{ id: string; startedAt: number; saved: boolean } | null>(null)
  const latestId = useRef<string | undefined>(undefined)
  useEffect(() => {
    latestId.current = versions?.[0]?.id
  }, [versions])

  const flush = useCallback(() => {
    const p = pending.current
    if (!p) return
    clearTimeout(p.timer)
    pending.current = null
    // Keep writing the same version while this burst of typing lasts and nothing newer has landed on top of it.
    let b = burst.current
    const overtaken = b?.saved && latestId.current !== undefined && latestId.current !== b.id
    if (!b || overtaken || Date.now() - b.startedAt > BURST_MS) {
      b = burst.current = { id: crypto.randomUUID(), startedAt: Date.now(), saved: false }
    }
    const { id } = b
    void savePage(stream.id, p.text, id).then(() => {
      if (burst.current?.id === id) burst.current.saved = true
      setUnsaved(pending.current !== null)
    })
  }, [stream.id])

  const onChange = useCallback(
    (text: string) => {
      if (pending.current) clearTimeout(pending.current.timer)
      pending.current = { text, timer: window.setTimeout(flush, SAVE_MS) }
      setUnsaved(true)
    },
    [flush],
  )

  // Leaving the page, the stream or the tab writes whatever is still waiting.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  const ids = embeds.filter((e) => e.kind !== 'thread').map((e) => e.id)
  const roots = embeds.filter((e) => e.kind === 'thread').map((e) => e.id)
  const key = `${ids.join(',')}|${roots.join(',')}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useLiveQuery(() => loadEmbedded(ids, roots, stream.id), [key, stream.id])
  const byId = useMemo(() => new Map(data?.messages.map((m) => [m.id, m])), [data])

  if (!versions) return <div className="page" />

  const earlier = versions.length - 1
  const asVersions = versions.map((v) => ({ id: v.id, messageId: v.streamId, text: v.text, createdAt: v.createdAt }))
  const old = viewIdx !== null && viewIdx > 0 ? versions[Math.min(viewIdx, versions.length - 1)] : undefined

  const renderEmbed = (slot: EmbedSlot, api: EmbedApi) => {
    if (!data) return null
    const message = byId.get(slot.id)
    if (slot.kind === 'summary' || !message) {
      return <Quote message={message ?? null} onOpen={message ? () => onJumpTo(message) : undefined} />
    }
    if (slot.kind === 'message') {
      const onDissolve = old ? undefined : () => api.replaceWith(dissolved(slot.id, message.text))
      return renderCard({ message, data, onDissolve, nested: false })
    }
    // A thread: the message, then everything replied under it.
    return (
      <ThreadList
        nodes={buildThreads(threadMembers(data.messages, slot.id))}
        renderCard={(m, nested) => renderCard({ message: m, data, nested })}
      />
    )
  }

  return (
    <div className="page">
      <div className="page-bar">
        <span className="hint" role="status">
          {old ? 'Viewing an earlier version' : unsaved ? 'Saving…' : versions.length === 0 ? 'Page' : 'Saved'}
        </span>
        {earlier > 0 && (
          <IconButton
            icon={History}
            label={`History · ${earlier}`}
            hint={`${earlier} earlier ${earlier === 1 ? 'version' : 'versions'}`}
            badge={earlier}
            size={18}
            tip="bottom"
            align="end"
            active={viewIdx !== null}
            onClick={() => {
              flush()
              setCalendarOpen(false)
              setViewIdx(viewIdx === null ? 0 : null)
            }}
          />
        )}
      </div>

      {viewIdx !== null && asVersions.length > 0 && (
        <div className="page-history">
          <VersionNav
            versions={asVersions}
            index={Math.min(viewIdx, asVersions.length - 1)}
            onChange={(i) => {
              flush()
              setViewIdx(i)
            }}
            onOpenCalendar={() => setCalendarOpen(true)}
          />
        </div>
      )}
      {calendarOpen && viewIdx !== null && (
        <VersionCalendar
          versions={asVersions}
          initialIndex={Math.min(viewIdx, asVersions.length - 1)}
          onPick={(i) => {
            setViewIdx(i)
            setCalendarOpen(false)
          }}
          onClose={() => setCalendarOpen(false)}
        />
      )}

      {old ? (
        <PageEditor key={old.id} text={old.text} readOnly onEmbeds={setEmbeds} renderEmbed={renderEmbed} />
      ) : (
        <PageEditor
          key={stream.id}
          text={versions[0]?.text ?? ''}
          onChange={onChange}
          onEmbeds={setEmbeds}
          renderEmbed={renderEmbed}
        />
      )}
    </div>
  )
}

/** The root and everything replied under it, at any depth. */
function threadMembers(all: Message[], rootId: string): Message[] {
  const members = new Set<string>([rootId])
  let grew = true
  while (grew) {
    grew = false
    for (const m of all) {
      if (!members.has(m.id) && m.replyToId && members.has(m.replyToId)) {
        members.add(m.id)
        grew = true
      }
    }
  }
  return all.filter((m) => members.has(m.id))
}
