import { useEffect, useRef } from 'react'
import { FileIcon, Film, Music, X } from 'lucide-react'
import { formatBytes, kindOf } from '../attachments'
import IconButton from './IconButton'

interface Props {
  files: File[]
  onRemove: (index: number) => void
}

/** Files queued in the composer, shown as small tiles before the message is saved. */
export default function PendingAttachments({ files, onRemove }: Props) {
  if (files.length === 0) return null
  return (
    <ul className="pending" aria-label="Files to attach">
      {files.map((f, i) => (
        <li key={`${f.name}-${f.size}-${i}`} className="pending-item" title={`${f.name} · ${formatBytes(f.size)}`}>
          <PendingPreview file={f} />
          <span className="pending-name">{f.name}</span>
          <IconButton icon={X} label={`Remove ${f.name}`} hint="Remove" size={14} className="pending-remove" onClick={() => onRemove(i)} />
        </li>
      ))}
    </ul>
  )
}

function PendingPreview({ file }: { file: File }) {
  const kind = kindOf(file.type)
  const imgRef = useRef<HTMLImageElement>(null)
  // The object URL is created and revoked inside one effect, so it is never revoked while shown.
  useEffect(() => {
    if (kind !== 'image') return
    const url = URL.createObjectURL(file)
    if (imgRef.current) imgRef.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [file, kind])
  if (kind === 'image') return <img ref={imgRef} className="pending-thumb" alt="" />
  const Icon = kind === 'video' ? Film : kind === 'audio' ? Music : FileIcon
  return (
    <span className="pending-thumb icon">
      <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
    </span>
  )
}
