import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { Version } from '../db'
import { formatFull, plainText } from '../format'
import IconButton from './IconButton'

interface Props {
  /** Newest first; index 0 is the current version. */
  versions: Version[]
  initialIndex: number
  onPick: (index: number) => void
  onClose: () => void
}

const dayKey = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' })
// Sunday-first; 4 Jan 1970 was a Sunday.
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => weekdayFmt.format(new Date(1970, 0, 4 + i)))

/** Modal: a month calendar of the days this message changed, and the versions on a chosen day. */
export default function VersionCalendar({ versions, initialIndex, onPick, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // versions is never empty here; the fallback only keeps the types honest.
  const startTs = versions[initialIndex]?.createdAt ?? 0
  const [cursor, setCursor] = useState(() => {
    const d = new Date(startTs)
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const [selectedDay, setSelectedDay] = useState(() => dayKey(startTs))

  useEffect(() => {
    const el = dialogRef.current
    if (el && !el.open) el.showModal()
  }, [])

  // Day -> indices of versions on that day (still newest first).
  const byDay = useMemo(() => {
    const map = new Map<string, number[]>()
    versions.forEach((v, i) => {
      const k = dayKey(v.createdAt)
      const list = map.get(k)
      if (list) list.push(i)
      else map.set(k, [i])
    })
    return map
  }, [versions])

  const firstOfMonth = new Date(cursor.year, cursor.month, 1)
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate()
  const leading = firstOfMonth.getDay()
  const cells: Array<number | null> = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7) cells.push(null)

  const shiftMonth = (delta: number) =>
    setCursor(({ year, month }) => {
      const d = new Date(year, month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })

  const dayVersions = byDay.get(selectedDay) ?? []
  const selectedDate = (() => {
    const [y, m, d] = selectedDay.split('-').map(Number)
    return new Date(y, m, d)
  })()

  return (
    <dialog
      ref={dialogRef}
      className="cal-dialog"
      aria-label="Version history calendar"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="cal">
        <div className="cal-month">
          <div className="cal-month-head">
            <IconButton icon={ChevronLeft} label="Previous month" onClick={() => shiftMonth(-1)} />
            <span className="cal-month-name">{monthFmt.format(firstOfMonth)}</span>
            <IconButton icon={ChevronRight} label="Next month" onClick={() => shiftMonth(1)} />
          </div>
          <div className="cal-grid" role="grid">
            {WEEKDAYS.map((w, i) => (
              <span key={i} className="cal-weekday" aria-hidden="true">
                {w}
              </span>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <span key={`e${i}`} />
              const key = `${cursor.year}-${cursor.month}-${day}`
              const n = byDay.get(key)?.length ?? 0
              return (
                <button
                  key={key}
                  className={`cal-day${n ? ' has' : ''}${key === selectedDay ? ' selected' : ''}`}
                  disabled={n === 0}
                  aria-pressed={key === selectedDay}
                  aria-label={`${new Date(cursor.year, cursor.month, day).toDateString()}${n ? `, ${n} ${n === 1 ? 'version' : 'versions'}` : ''}`}
                  onClick={() => setSelectedDay(key)}
                >
                  {day}
                </button>
              )
            })}
          </div>
        </div>
        <div className="cal-list-pane">
          <div className="cal-list-head">
            <span>
              {selectedDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
              <span className="muted"> · {dayVersions.length} {dayVersions.length === 1 ? 'version' : 'versions'}</span>
            </span>
            <IconButton icon={X} label="Close" hint="Close (Esc)" align="end" onClick={onClose} />
          </div>
          <ol className="cal-list" aria-label="Versions on this day">
            {dayVersions.map((i) => {
              const v = versions[i]
              return (
                <li key={v.id}>
                  <button className="cal-version" onClick={() => onPick(i)} title={formatFull(v.createdAt)}>
                    <span className="cal-version-time">
                      {timeFmt.format(new Date(v.createdAt))}
                      {i === 0 && <span className="badge">current</span>}
                      {i === versions.length - 1 && <span className="badge">original</span>}
                    </span>
                    <span className="cal-version-text">{plainText(v.text) || '(empty)'}</span>
                  </button>
                </li>
              )
            })}
            {dayVersions.length === 0 && <li className="muted small pad">No versions on this day.</li>}
          </ol>
        </div>
      </div>
    </dialog>
  )
}
