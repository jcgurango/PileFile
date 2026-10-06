/**
 * A stream's page is plain Markdown. A line that holds nothing but an embed reference is
 * replaced, when the page is shown, by the message it names:
 *
 *   ![[message:<id>]]   the message as it looks in the Messages view
 *   ![[thread:<id>]]    the message and the replies under it
 *   ![[summary:<id>]]   a one-line quotation that links to the message
 */
export type EmbedKind = 'message' | 'thread' | 'summary'

export type PageBlock =
  | { type: 'markdown'; text: string; from: number; to: number }
  | { type: 'embed'; kind: EmbedKind; id: string; line: number }

const EMBED_RE = /^!\[\[(message|thread|summary):([0-9A-Za-z-]+)\]\]$/
const FENCE_RE = /^\s*(```|~~~)/

export const embedLine = (kind: EmbedKind, id: string) => `![[${kind}:${id}]]`

/** Splits a page into runs of Markdown and embed lines. `from`/`to`/`line` are line numbers, for writing back. */
export function parsePage(text: string): PageBlock[] {
  const lines = text.split('\n')
  const blocks: PageBlock[] = []
  let start = 0
  let fenced = false
  const flush = (end: number) => {
    const chunk = lines.slice(start, end).join('\n')
    if (chunk.trim()) blocks.push({ type: 'markdown', text: chunk, from: start, to: end })
  }
  lines.forEach((line, i) => {
    if (FENCE_RE.test(line)) fenced = !fenced
    const m = fenced ? null : EMBED_RE.exec(line.trim())
    if (!m) return
    flush(i)
    blocks.push({ type: 'embed', kind: m[1] as EmbedKind, id: m[2], line: i })
    start = i + 1
  })
  flush(lines.length)
  return blocks
}

/** Message ids a page embeds, in any form. */
export function embeddedIds(text: string): Set<string> {
  const ids = new Set<string>()
  for (const b of parsePage(text)) if (b.type === 'embed') ids.add(b.id)
  return ids
}

/** Adds an embed as a paragraph of its own at the end of the page. */
export function appendEmbed(text: string, kind: EmbedKind, id: string): string {
  const body = text.trimEnd()
  return `${body}${body ? '\n\n' : ''}${embedLine(kind, id)}\n`
}

/**
 * What a dissolved message embed turns into: the message's text as part of the page, under a
 * summary embed that stays as the reference to where the text came from.
 */
export const dissolved = (id: string, messageText: string) => `${embedLine('summary', id)}\n\n${messageText}`
