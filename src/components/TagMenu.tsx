import type { TagSummary } from '../db'

interface Props {
  items: TagSummary[]
  active: number
  onPick: (tag: TagSummary) => void
  id: string
}

/** Dropdown of tag suggestions under a search box. */
export default function TagMenu({ items, active, onPick, id }: Props) {
  return (
    <ul className="tag-menu" role="listbox" id={id} aria-label="Tags">
      {items.map((t, i) => (
        <li
          key={t.name}
          role="option"
          aria-selected={i === active}
          className={i === active ? 'active' : undefined}
          // mousedown so the input keeps focus and the blur does not close anything first
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(t)
          }}
        >
          <span className="tag-menu-name">#{t.display}</span>
          <span className="tag-menu-count">{t.count}</span>
        </li>
      ))}
    </ul>
  )
}
