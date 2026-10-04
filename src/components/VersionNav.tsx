import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Version } from '../db'
import { formatFull, formatTimestamp } from '../format'
import IconButton from './IconButton'

interface Props {
  /** Newest first; index 0 is the current version. */
  versions: Version[]
  index: number
  onChange: (index: number) => void
  onOpenCalendar: () => void
}

/** The little "‹ timestamp ›" block for stepping through a message's versions. */
export default function VersionNav({ versions, index, onChange, onOpenCalendar }: Props) {
  const v = versions[index]
  if (!v) return null
  const total = versions.length
  const number = total - index
  const oldest = index >= total - 1

  return (
    <div className="vnav" role="group" aria-label="Version history">
      <IconButton
        icon={ChevronLeft}
        label="Older version"
        hint="Back in time"
        disabled={oldest}
        onClick={() => onChange(index + 1)}
      />
      <button className="vnav-time" onClick={onOpenCalendar} title={`${formatFull(v.createdAt)} · pick a date`}>
        <CalendarDays size={14} strokeWidth={1.75} aria-hidden="true" />
        <time dateTime={new Date(v.createdAt).toISOString()}>{formatTimestamp(v.createdAt)}</time>
      </button>
      <IconButton
        icon={ChevronRight}
        label="Newer version"
        hint="Forward in time"
        disabled={index === 0}
        onClick={() => onChange(index - 1)}
      />
      <span className="vnav-pos">
        {number} of {total}
        {index === 0 && <span className="badge">current</span>}
        {oldest && <span className="badge">original</span>}
      </span>
      {index > 0 && <span className="vnav-note">Viewing an earlier version</span>}
    </div>
  )
}
