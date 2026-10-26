import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

/** The number of `- [x]` tasks in the document, counted the way the preview draws them. */
export function completedTasks(state: EditorState): number {
  return completedTaskLines(state).length
}

/**
 * Deletions that remove every completed task's line, newline included, so the lines around close up.
 * Runs of adjacent lines come out as one range; a run ending the document takes the newline before it instead.
 */
export function clearCompletedChanges(state: EditorState): { from: number; to: number }[] {
  const lines = completedTaskLines(state)
  const ranges: { from: number; to: number }[] = []
  for (const n of lines) {
    const line = state.doc.line(n)
    const last = ranges[ranges.length - 1]
    if (last && last.to === line.from) last.to = line.to
    else ranges.push({ from: line.from, to: line.to })
  }
  const end = state.doc.length
  for (const r of ranges) {
    if (r.to < end) r.to += 1
    else if (r.from > 0) r.from -= 1
  }
  return ranges
}

/** Line numbers (1-based, ascending) of lines holding a task whose marker is ticked. Fenced code holds no tasks. */
function completedTaskLines(state: EditorState): number[] {
  // The parser works in the background on long documents; wait for it, briefly, rather than miss lines.
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state)
  const lines: number[] = []
  tree.iterate({
    enter: (ref) => {
      if (ref.name !== 'Task') return
      const marker = ref.node.getChild('TaskMarker')
      if (!marker || state.sliceDoc(marker.from + 1, marker.from + 2) === ' ') return
      const n = state.doc.lineAt(marker.from).number
      if (lines[lines.length - 1] !== n) lines.push(n)
    },
  })
  return lines
}
