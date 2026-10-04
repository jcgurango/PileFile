import { useState, type KeyboardEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listTags, type TagSummary } from './db'

/** The "#partial" token being typed at the end of the value, if any. */
const TAIL = /(^|\s)#([^\s#]*)$/u

/**
 * Autocomplete for #tags in a search box. When the text ends in a "#" token, offers
 * matching tags; picking one replaces that token with the tag and a trailing space.
 */
export function useTagSuggest(value: string, onChange: (next: string) => void) {
  const tags = useLiveQuery(listTags, []) ?? []
  const [cursor, setCursor] = useState(0)
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)

  const m = TAIL.exec(value)
  const partial = m ? m[2] : null
  const typed = partial?.toLowerCase() ?? null
  const items: TagSummary[] =
    typed === null || dismissedFor === value ? [] : tags.filter((t) => t.name.startsWith(typed))
  // Nothing to offer when the only match is exactly what has been typed.
  const open = items.length > 0 && !(items.length === 1 && items[0].name === typed)
  const active = open ? ((cursor % items.length) + items.length) % items.length : 0

  const pick = (tag: TagSummary) => {
    if (partial === null) return
    onChange(`${value.slice(0, value.length - partial.length - 1)}#${tag.display} `)
    setCursor(0)
  }

  /** Call before any other key handling. Returns true when the key was consumed by the menu. */
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    if (!open) return false
    if (e.key === 'ArrowDown') setCursor((c) => c + 1)
    else if (e.key === 'ArrowUp') setCursor((c) => c - 1)
    else if (e.key === 'Enter' || e.key === 'Tab') pick(items[active])
    else if (e.key === 'Escape') setDismissedFor(value)
    else return false
    e.preventDefault()
    e.stopPropagation()
    return true
  }

  return { open, items, active, pick, onKeyDown }
}
