const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' })

const DAY = 24 * 60 * 60 * 1000

/** Short, context-aware timestamp: "14:32", "Yesterday 14:32", "Oct 3, 14:32", "Oct 3, 2025, 14:32". */
export function formatTimestamp(ts: number, now: Date = new Date()): string {
  const d = new Date(ts)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ts >= startOfToday) return timeFmt.format(d)
  if (ts >= startOfToday - DAY) return `Yesterday ${timeFmt.format(d)}`
  if (d.getFullYear() === now.getFullYear()) return `${dayFmt.format(d)}, ${timeFmt.format(d)}`
  return `${dateFmt.format(d)}, ${timeFmt.format(d)}`
}

export function formatFull(ts: number): string {
  return fullFmt.format(new Date(ts))
}

/** A window of text around the first occurrence of any term. */
export function snippet(text: string, terms: string[], width = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const lower = flat.toLowerCase()
  let idx = -1
  for (const t of terms) {
    const i = lower.indexOf(t)
    if (i !== -1 && (idx === -1 || i < idx)) idx = i
  }
  if (idx === -1) idx = 0
  const start = Math.max(0, idx - Math.floor(width / 4))
  const end = Math.min(flat.length, start + width)
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '')
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Splits text into [plain, match, plain, match, ...] so matches can be wrapped in <mark>. */
export function splitHighlights(text: string, terms: string[]): string[] {
  if (terms.length === 0) return [text]
  const re = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
  return text.split(re)
}

/** Rough Markdown-to-plain-text for one-line previews such as reply quotes. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+/gm, (_, state: string) => (state === ' ' ? '☐ ' : '☑ '))
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** One-line preview of a message: its text, or a note about its attachments when there is no text. */
export function messagePreview(text: string, attachmentCount: number): string {
  const t = plainText(text)
  if (t) return t
  if (attachmentCount > 0) return `${attachmentCount} ${attachmentCount === 1 ? 'attachment' : 'attachments'}`
  return '(empty message)'
}
