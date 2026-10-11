import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChangeSet } from '@codemirror/state'
import { useLiveQuery } from 'dexie-react-hooks'
import { History } from 'lucide-react'
import { loadEmbedded, loadPage, savePage, type Message, type PageVersion, type Stream, type StreamViewData } from '../db'
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
/** Versions closer together than this are one step of history: a stretch of typing, not every pause in it. */
const GROUP_MS = 5 * 60_000

/** The newest version of each stretch of editing, newest first. */
function historySteps(chain: PageVersion[]): PageVersion[] {
  const steps: PageVersion[] = []
  let last: PageVersion | undefined
  for (const v of chain) {
    if (!last || last.createdAt - v.createdAt > GROUP_MS) steps.push(v)
    last = v
  }
  return steps
}

/** A stream's page: a live Markdown editor with messages set into it, saved as you type and kept as versions. */
export default function PageView({ stream, renderCard, onJumpTo }: Props) {
  const page = useLiveQuery(() => loadPage(stream.id), [stream.id])
  const currentText = page?.current ? (page.textOf(page.current.id) ?? '') : ''
  // Version browsing, as on a message: index into the newest-first steps; null is closed.
  const [viewIdx, setViewIdx] = useState<number | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [unsaved, setUnsaved] = useState(false)
  const [embeds, setEmbeds] = useState<EmbedLine[]>([])

  // What the editor shows, and the version it was built on: the parent of the next save.
  const doc = useRef(currentText)
  const base = useRef<{ id: string | null; text: string }>({ id: page?.current?.id ?? null, text: currentText })
  const pending = useRef<{ text: string; changes: ChangeSet; timer: number } | null>(null)
  // Saves go out one after another, each on top of the one before.
  const queue = useRef(Promise.resolve())

  useEffect(() => {
    // Storage moved under an editor with nothing unsaved (its own save landed, or another device's):
    // that version is the new base.
    if (page && doc.current === currentText) base.current = { id: page.current?.id ?? null, text: currentText }
  }, [page, currentText])

  const flush = useCallback(() => {
    const p = pending.current
    if (!p) return
    clearTimeout(p.timer)
    pending.current = null
    const { text, changes } = p
    queue.current = queue.current.then(async () => {
      const parent = base.current
      if (parent.text === text) return
      const id = await savePage(stream.id, parent.id, text, changes)
      base.current = { id, text }
      setUnsaved(pending.current !== null)
    })
  }, [stream.id])

  const onDocChange = useCallback(
    (text: string, changes: ChangeSet | null) => {
      doc.current = text
      if (!changes) return
      if (pending.current) clearTimeout(pending.current.timer)
      pending.current = {
        text,
        changes: pending.current ? pending.current.changes.compose(changes) : changes,
        timer: window.setTimeout(flush, SAVE_MS),
      }
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

  if (!page) return <div className="page" />

  const steps = historySteps(page.chain)
  const earlier = Math.max(0, steps.length - 1)
  const asVersions = steps.map((v) => ({ id: v.id, messageId: v.streamId, text: page.textOf(v.id) ?? '', createdAt: v.createdAt }))
  const old = viewIdx !== null && viewIdx > 0 ? asVersions[Math.min(viewIdx, asVersions.length - 1)] : undefined

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
          {old ? 'Viewing an earlier version' : unsaved ? 'Saving…' : page.current ? 'Saved' : 'Page'}
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
        <PageEditor key={stream.id} text={currentText} onDocChange={onDocChange} onEmbeds={setEmbeds} renderEmbed={renderEmbed} />
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
