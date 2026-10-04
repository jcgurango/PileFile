/**
 * Tags are written inline as #Name. A tag starts with a letter or underscore and may
 * contain letters, digits, underscores and hyphens. It must not be glued to a preceding
 * word character, so "C#" and "a#b" are not tags, and "# Heading" is a heading, not a tag.
 */
export const TAG_RE = /(?<![\p{L}\p{N}_#&/])#([\p{L}_][\p{L}\p{N}_-]*)/gu

export interface TagRef {
  /** Lowercased key used for matching and indexing. */
  name: string
  /** As first written, for display. */
  display: string
}

export const tagKey = (display: string) => display.toLowerCase()

/** Code spans and fenced blocks are left out: "#fff" in a snippet is not a tag. */
function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')
}

/** Distinct tags in a message, in order of first appearance. */
export function extractTags(text: string): TagRef[] {
  const seen = new Map<string, TagRef>()
  for (const m of stripCode(text).matchAll(TAG_RE)) {
    const display = m[1]
    const name = tagKey(display)
    if (!seen.has(name)) seen.set(name, { name, display })
  }
  return [...seen.values()]
}

export interface ParsedQuery {
  /** Exact tag names (lowercased) that must all be present. */
  tags: string[]
  /** Word prefixes that must all match some word. */
  terms: string[]
  /** Strings to highlight in results: the terms plus "#tag" for each tag. */
  highlights: string[]
}

/** Splits a search query into exact #tags and prefix words. */
export function parseQuery(query: string, tokenize: (s: string) => string[]): ParsedQuery {
  const tags: string[] = []
  const rest: string[] = []
  for (const token of query.trim().split(/\s+/).filter(Boolean)) {
    const m = /^#([\p{L}_][\p{L}\p{N}_-]*)$/u.exec(token)
    if (m) tags.push(tagKey(m[1]))
    else rest.push(token)
  }
  const terms = tokenize(rest.join(' '))
  return { tags: [...new Set(tags)], terms, highlights: [...terms, ...tags.map((t) => `#${t}`)] }
}
