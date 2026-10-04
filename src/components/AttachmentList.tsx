import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, FileIcon, ImageOff, Play, X } from 'lucide-react'
import { formatBytes, kindOf } from '../attachments'
import { getFileBlob, getThumbBlob, type Attachment } from '../db'
import IconButton from './IconButton'

interface Props {
  items: Attachment[]
}

/** Media grid for images and videos, a player list for audio, and chips for anything else. */
export default function AttachmentList({ items }: Props) {
  const [open, setOpen] = useState<number | null>(null)
  if (items.length === 0) return null
  const media = items.filter((a) => kindOf(a.type) === 'image' || kindOf(a.type) === 'video')
  const audio = items.filter((a) => kindOf(a.type) === 'audio')
  const files = items.filter((a) => kindOf(a.type) === 'file')

  return (
    <div className="atts">
      {media.length > 0 && (
        <div className={`att-grid n${Math.min(media.length, 3)}`}>
          {media.map((a, i) => (
            <MediaTile key={a.id} att={a} onOpen={() => setOpen(i)} />
          ))}
        </div>
      )}
      {audio.length > 0 && (
        <ul className="att-audio">
          {audio.map((a) => (
            <AudioPlayer key={a.id} att={a} />
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="att-files">
          {files.map((a) => (
            <FileChip key={a.id} att={a} />
          ))}
        </ul>
      )}
      {open !== null && media[open] && (
        <Lightbox media={media} index={open} onChange={setOpen} onClose={() => setOpen(null)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- helpers

/**
 * Object URL for an attachment's thumbnail: undefined while loading, null when none can be made.
 * Keyed by id and type (not the row object), so live-query refreshes do not revoke a URL in use.
 */
function useThumbUrl(att: Attachment): string | null | undefined {
  const { id, messageId, name, type, size, createdAt, order } = att
  const [loaded, setLoaded] = useState<{ id: string; url: string | null } | null>(null)
  useEffect(() => {
    let alive = true
    let created: string | null = null
    getThumbBlob({ id, messageId, name, type, size, createdAt, order }).then((blob) => {
      if (!alive) return
      created = blob ? URL.createObjectURL(blob) : null
      setLoaded({ id, url: created })
    })
    return () => {
      alive = false
      if (created) URL.revokeObjectURL(created)
    }
    // Only the identity and media type matter for the thumbnail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, type])
  return loaded?.id === id ? loaded.url : undefined
}

/** Object URL for the original file, loaded on demand. Keyed by id for the same reason as above. */
function useFileUrl(att: Attachment | null): string | null {
  const id = att?.id ?? null
  const [loaded, setLoaded] = useState<{ id: string; url: string } | null>(null)
  useEffect(() => {
    if (!id) return
    let alive = true
    let created: string | null = null
    getFileBlob(id).then((blob) => {
      if (!alive || !blob) return
      created = URL.createObjectURL(blob)
      setLoaded({ id, url: created })
    })
    return () => {
      alive = false
      if (created) URL.revokeObjectURL(created)
    }
  }, [id])
  // A stale URL from a previous attachment is never returned, even before the new one loads.
  return id && loaded?.id === id ? loaded.url : null
}

// ------------------------------------------------------------------ media

function MediaTile({ att, onOpen }: { att: Attachment; onOpen: () => void }) {
  const thumb = useThumbUrl(att)
  const isVideo = kindOf(att.type) === 'video'
  return (
    <div className="att-tile-wrap">
      <button className="att-tile" onClick={onOpen} title={`${att.name} · ${formatBytes(att.size)}`} aria-label={`Open ${att.name}`}>
        {thumb ? (
          <img src={thumb} alt={att.name} loading="lazy" />
        ) : (
          <span className={`att-tile-fallback${thumb === undefined ? ' loading' : ''}`}>
            {thumb === null && <ImageOff size={22} strokeWidth={1.5} aria-hidden="true" />}
          </span>
        )}
        {isVideo && (
          <span className="att-play" aria-hidden="true">
            <Play size={18} strokeWidth={2} fill="currentColor" />
          </span>
        )}
      </button>
    </div>
  )
}

function Lightbox({
  media,
  index,
  onChange,
  onClose,
}: {
  media: Attachment[]
  index: number
  onChange: (i: number) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const att = media[index]
  const url = useFileUrl(att)
  const isVideo = kindOf(att.type) === 'video'
  const [brokenId, setBrokenId] = useState<string | null>(null)
  const broken = brokenId === att.id

  useEffect(() => {
    const el = dialogRef.current
    if (el && !el.open) el.showModal()
  }, [])

  const prev = () => onChange((index - 1 + media.length) % media.length)
  const next = () => onChange((index + 1) % media.length)

  return (
    <dialog
      ref={dialogRef}
      className="lightbox"
      aria-label={att.name}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={(e) => {
        if (media.length < 2) return
        if (e.key === 'ArrowLeft') prev()
        if (e.key === 'ArrowRight') next()
      }}
    >
      <div className="lightbox-top">
        <span className="lightbox-name">
          {att.name} <span className="muted">· {formatBytes(att.size)}</span>
          {media.length > 1 && (
            <span className="muted">
              {' '}
              · {index + 1} / {media.length}
            </span>
          )}
        </span>
        <span className="lightbox-actions">
          {url && (
            <a className="ibtn" href={url} download={att.name} aria-label="Download" data-tip="Download" data-tip-pos="bottom" data-tip-align="end">
              <Download size={18} strokeWidth={1.75} aria-hidden="true" />
            </a>
          )}
          <IconButton icon={X} label="Close" hint="Close (Esc)" size={18} tip="bottom" align="end" onClick={onClose} />
        </span>
      </div>
      <div className="lightbox-stage">
        {media.length > 1 && (
          <IconButton icon={ChevronLeft} label="Previous" size={22} className="lightbox-nav prev" onClick={prev} />
        )}
        {url && !broken ? (
          isVideo ? (
            <video key={att.id} src={url} controls autoPlay playsInline onError={() => setBrokenId(att.id)} />
          ) : (
            <img key={att.id} src={url} alt={att.name} onError={() => setBrokenId(att.id)} />
          )
        ) : url && broken ? (
          <div className="lightbox-broken">
            <ImageOff size={32} strokeWidth={1.5} aria-hidden="true" />
            <p>This browser cannot display {att.name}.</p>
            <a href={url} download={att.name}>
              Download it instead
            </a>
          </div>
        ) : null}
        {media.length > 1 && (
          <IconButton icon={ChevronRight} label="Next" size={22} className="lightbox-nav next" onClick={next} />
        )}
      </div>
    </dialog>
  )
}

// ------------------------------------------------------------------ audio

function AudioPlayer({ att }: { att: Attachment }) {
  const url = useFileUrl(att)
  return (
    <li className="att-audio-item">
      <span className="att-audio-name" title={att.name}>
        {att.name} <span className="muted">· {formatBytes(att.size)}</span>
      </span>
      {url ? <audio controls preload="metadata" src={url} aria-label={att.name} /> : <span className="muted small">Loading…</span>}
    </li>
  )
}

// ------------------------------------------------------------------ files

function FileChip({ att }: { att: Attachment }) {
  const [url, setUrl] = useState<string | null>(null)
  // The blob URL is created only when the chip is activated, so idle chips cost nothing.
  const prepare = async () => {
    if (url) return
    const blob = await getFileBlob(att.id)
    if (blob) setUrl(URL.createObjectURL(blob))
  }
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])
  return (
    <li className="att-file">
      <a
        className="att-file-link"
        href={url ?? '#'}
        download={att.name}
        title={`${att.name} · ${formatBytes(att.size)}`}
        onMouseEnter={prepare}
        onFocus={prepare}
        onClick={(e) => {
          if (!url) {
            e.preventDefault()
            void prepare().then(() => (e.target as HTMLAnchorElement).click())
          }
        }}
      >
        <FileIcon size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className="att-file-name">{att.name}</span>
        <span className="muted small">{formatBytes(att.size)}</span>
      </a>
    </li>
  )
}
