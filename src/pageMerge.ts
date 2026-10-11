import { ChangeSet, Text } from '@codemirror/state'
import type { PageVersion } from './db'

/**
 * Reconciling page versions that were written on different devices.
 *
 * Versions form a graph: each names the version it was written on top of, and a merge names a
 * second one. Two tips that do not descend from each other are a fork. A fork is merged by
 * taking the changes each side made since their common ancestor and mapping one over the other
 * with CodeMirror's change mapping, so both sides' edits land. The merge is deterministic: the
 * same pair of tips gives the same id and the same text on every device, so devices that merge
 * at the same moment produce one version, not a fight.
 */

const toText = (s: string) => Text.of(s.split('\n'))

/** The change from `from` to `to` when only the texts are known: one splice between the common prefix and suffix. */
export function spliceChange(from: string, to: string): ChangeSet {
  let head = 0
  while (head < from.length && head < to.length && from[head] === to[head]) head++
  let tail = 0
  while (tail < from.length - head && tail < to.length - head && from[from.length - 1 - tail] === to[to.length - 1 - tail]) tail++
  return ChangeSet.of({ from: head, to: from.length - tail, insert: to.slice(head, to.length - tail) }, from.length)
}

export interface Graph {
  byId: Map<string, PageVersion>
  textOf: (id: string) => string | null
}

/** The version and every version it was built from, through both kinds of parent. */
export function ancestry(g: Graph, id: string): Set<string> {
  const out = new Set<string>()
  const todo = [id]
  while (todo.length) {
    const cur = todo.pop()!
    if (out.has(cur)) continue
    out.add(cur)
    const v = g.byId.get(cur)
    if (v?.parentId) todo.push(v.parentId)
    if (v?.mergeOf) todo.push(v.mergeOf)
  }
  return out
}

/** Readable versions nothing was built on top of: the tips of the graph, newest first. */
export function tips(g: Graph, versions: PageVersion[]): PageVersion[] {
  const readable = versions.filter((v) => g.textOf(v.id) !== null)
  // Only a readable child takes a version out of the running: an orphan waiting for its parent does not.
  const used = new Set<string>()
  for (const v of readable) {
    if (v.parentId) used.add(v.parentId)
    if (v.mergeOf) used.add(v.mergeOf)
  }
  return readable.filter((v) => !used.has(v.id)).sort((a, b) => b.createdAt - a.createdAt)
}

/** Whether the `parentId` line from `to` passes through `from`. */
export function onLine(g: Graph, from: string, to: string): boolean {
  return lineage(g, to).includes(from)
}

/** The straight line of `parentId` links from a version back to its root, nearest first. */
function lineage(g: Graph, id: string | null): string[] {
  const out: string[] = []
  for (let v = id ? g.byId.get(id) : undefined; v && !out.includes(v.id); v = v.parentId ? g.byId.get(v.parentId) : undefined) {
    out.push(v.id)
  }
  return out
}

/** The nearest version both lines of descent pass through, or null when the two pages began separately. */
export function commonAncestor(g: Graph, a: string | null, b: string | null): string | null {
  const mine = lineage(g, a)
  const theirs = new Set(lineage(g, b))
  return mine.find((id) => theirs.has(id)) ?? null
}

/**
 * The changes that lead from `from` (null: the empty page) down the `parentId` line to `to`.
 * A version without a patch contributes the splice between its parent's text and its own.
 */
export function changesBetween(g: Graph, from: string | null, to: string | null): ChangeSet {
  const path: PageVersion[] = []
  for (let v = to ? g.byId.get(to) : undefined; v && v.id !== from; v = v.parentId ? g.byId.get(v.parentId) : undefined) {
    path.unshift(v)
  }
  let text = from ? (g.textOf(from) ?? '') : ''
  let changes = ChangeSet.empty(text.length)
  for (const v of path) {
    const next = g.textOf(v.id) ?? text
    let step: ChangeSet | null = null
    if (v.patch) {
      try {
        step = ChangeSet.fromJSON(JSON.parse(v.patch))
      } catch {
        step = null
      }
    }
    if (!step || step.length !== text.length) step = spliceChange(text, next)
    changes = changes.compose(step)
    text = next
  }
  return changes
}

/** Which of two tips goes first where both inserted at the same spot: the lower id, on every device alike. */
export const goesFirst = (a: string, b: string) => a < b

/** The id every device gives the merge of the same two tips. */
export const mergeId = (a: string, b: string) => (goesFirst(a, b) ? `merge:${a}:${b}` : `merge:${b}:${a}`)

export interface Merge {
  /** The merged text. */
  text: string
  /** From `mine`'s text to the merged text: what an editor sitting on `mine` has to apply. */
  ontoMine: ChangeSet
  /** From `theirs`' text to the merged text: the merge version's patch when `theirs` is its parent. */
  ontoTheirs: ChangeSet
}

/**
 * Merges two tips. When the pages began separately there is nothing to map, so the texts are
 * joined, lower id first.
 */
export function merge(g: Graph, mine: string, theirs: string): Merge {
  const mineText = g.textOf(mine) ?? ''
  const theirsText = g.textOf(theirs) ?? ''
  const ancestor = commonAncestor(g, mine, theirs)
  if (ancestor === null && mineText && theirsText) {
    const text = goesFirst(mine, theirs) ? `${mineText}\n\n${theirsText}` : `${theirsText}\n\n${mineText}`
    return { text, ontoMine: spliceChange(mineText, text), ontoTheirs: spliceChange(theirsText, text) }
  }
  const a = changesBetween(g, ancestor, mine)
  const b = changesBetween(g, ancestor, theirs)
  const mineFirst = goesFirst(mine, theirs)
  // b over a: b's insertions go after a's where they coincide iff a goes first. And the other way round.
  const ontoMine = b.map(a, !mineFirst)
  const ontoTheirs = a.map(b, mineFirst)
  const text = ontoMine.apply(toText(mineText)).toString()
  return { text, ontoMine, ontoTheirs }
}
