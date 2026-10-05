import { useEffect, useRef } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface SheetItem {
  key: string
  icon: LucideIcon
  label: string
  /** Secondary text on the right, such as a count. */
  detail?: string
  danger?: boolean
  active?: boolean
  onSelect: () => void
}

interface Props {
  title?: string
  items: SheetItem[]
  onClose: () => void
}

/** Bottom sheet of large, labelled actions for touch devices. Native <dialog>, so Escape and backdrop close it. */
export default function ActionSheet({ title, items, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && !el.open) el.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title ?? 'Actions'}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="sheet-grip" aria-hidden="true" />
      {title && <div className="sheet-title">{title}</div>}
      <ul className="sheet-list">
        {items.map(({ key, icon: Icon, label, detail, danger, active, onSelect }) => (
          <li key={key}>
            <button
              className={`sheet-item${danger ? ' danger' : ''}${active ? ' active' : ''}`}
              onClick={() => {
                onClose()
                onSelect()
              }}
            >
              <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
              <span className="sheet-label">{label}</span>
              {detail && <span className="sheet-detail">{detail}</span>}
            </button>
          </li>
        ))}
      </ul>
      <button className="sheet-cancel" onClick={onClose}>
        Cancel
      </button>
    </dialog>
  )
}
