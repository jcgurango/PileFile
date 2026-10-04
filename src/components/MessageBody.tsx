import { useMemo, type ComponentProps } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import type { Element, Parents, Root, RootContent, Text } from 'hast'
import { TAG_RE } from '../tags'

interface Props {
  text: string
  /** Search terms to wrap in <mark> inside the rendered output. */
  terms?: string[]
  /** When given, task checkboxes are live: clicking one calls this with the updated source. */
  onChange?: (text: string) => void
  /** Called with the tag's display name when a #tag in the text is clicked. */
  onTagClick?: (tag: string) => void
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** rehype plugin: splits text nodes so every term occurrence becomes a <mark> element. */
function rehypeHighlight(terms: string[]) {
  const re = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
  const walk = (node: { children: RootContent[] }) => {
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i]
      if (child.type === 'text') {
        const parts = child.value.split(re)
        if (parts.length === 1) continue
        const replacement: RootContent[] = []
        parts.forEach((part, idx) => {
          if (!part) return
          const textNode: Text = { type: 'text', value: part }
          replacement.push(
            idx % 2 === 1
              ? { type: 'element', tagName: 'mark', properties: {}, children: [textNode] }
              : textNode,
          )
        })
        node.children.splice(i, 1, ...replacement)
      } else if ('children' in child) {
        walk(child)
      }
    }
  }
  return (tree: Root) => walk(tree)
}

const NO_TAGS_INSIDE = new Set(['code', 'pre', 'a', 'button'])

/** rehype plugin: turns "#tag" runs in text into <button class="tag" data-tag> elements. */
function rehypeTags() {
  const walk = (node: { children: RootContent[] }) => {
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i]
      if (child.type === 'text') {
        const re = new RegExp(TAG_RE.source, TAG_RE.flags)
        const out: RootContent[] = []
        let last = 0
        for (const m of child.value.matchAll(re)) {
          const start = m.index
          if (start > last) out.push({ type: 'text', value: child.value.slice(last, start) })
          out.push({
            type: 'element',
            tagName: 'button',
            properties: { className: ['tag'], type: 'button', dataTag: m[1] },
            children: [{ type: 'text', value: m[0] }],
          })
          last = start + m[0].length
        }
        if (out.length === 0) continue
        if (last < child.value.length) out.push({ type: 'text', value: child.value.slice(last) })
        node.children.splice(i, 1, ...out)
      } else if (child.type === 'element' && !NO_TAGS_INSIDE.has(child.tagName)) {
        walk(child)
      }
    }
  }
  return (tree: Root) => walk(tree)
}

/** The task marker at the start of a list item: "- [ ] " / "1. [x] ". Group 1 ends just before the state char. */
const TASK_MARKER = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])\]/

/** The item's own checkbox, not one belonging to a nested list. */
function ownCheckbox(node: Element): Element | null {
  for (const child of node.children) {
    if (child.type !== 'element') continue
    if (child.tagName === 'input' && child.properties.type === 'checkbox') return child
    if (child.tagName === 'ul' || child.tagName === 'ol') continue
    const found = ownCheckbox(child)
    if (found) return found
  }
  return null
}

/**
 * rehype plugin: tags each task checkbox with the source offset of its "[ ]" state
 * character, so a click can flip exactly that character.
 */
function rehypeTaskOffsets(source: string) {
  const walk = (node: Parents) => {
    for (const child of node.children) {
      if (child.type !== 'element') continue
      const classes = child.properties.className
      const isTask =
        child.tagName === 'li' && Array.isArray(classes) && classes.includes('task-list-item')
      const start = child.position?.start.offset
      if (isTask && start !== undefined) {
        const input = ownCheckbox(child)
        const m = input ? TASK_MARKER.exec(source.slice(start)) : null
        if (input && m) input.properties.dataOffset = start + m[1].length
      }
      walk(child)
    }
  }
  return (tree: Root) => walk(tree)
}

function toggleTaskAt(text: string, offset: number): string {
  const state = text[offset]
  const next = state === ' ' ? 'x' : ' '
  return text.slice(0, offset) + next + text.slice(offset + 1)
}

const remarkPlugins = [remarkGfm, remarkBreaks]

type InputProps = ComponentProps<'input'> & { node?: unknown; 'data-offset'?: number | string }
type ButtonProps = ComponentProps<'button'> & { node?: unknown; 'data-tag'?: string }

function buildComponents(
  text: string,
  onChange?: (text: string) => void,
  onTagClick?: (tag: string) => void,
): Components {
  return {
    a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
    button: (raw) => {
      const { node: _node, 'data-tag': tag, ...props } = raw as ButtonProps
      if (tag === undefined) return <button {...props} />
      return (
        <button
          {...props}
          className="tag"
          title={`Search for #${tag}`}
          onClick={onTagClick ? () => onTagClick(tag) : undefined}
          disabled={!onTagClick}
        />
      )
    },
    input: (raw) => {
      const { node: _node, 'data-offset': offset, ...props } = raw as InputProps
      if (props.type === 'checkbox' && offset !== undefined && onChange) {
        return (
          <input
            type="checkbox"
            checked={Boolean(props.checked)}
            aria-label={props.checked ? 'Mark task not done' : 'Mark task done'}
            onChange={() => onChange(toggleTaskAt(text, Number(offset)))}
          />
        )
      }
      return <input {...props} readOnly />
    },
  }
}

/** Renders a message's text as Markdown. Single newlines are line breaks, like a chat message. */
export default function MessageBody({ text, terms = [], onChange, onTagClick }: Props) {
  const rehypePlugins = useMemo(() => {
    const plugins: Array<
      typeof rehypeTags | [typeof rehypeTaskOffsets, string] | [typeof rehypeHighlight, string[]]
    > = [[rehypeTaskOffsets, text], rehypeTags]
    if (terms.length) plugins.push([rehypeHighlight, terms])
    return plugins
  }, [text, terms])
  const components = useMemo(
    () => buildComponents(text, onChange, onTagClick),
    [text, onChange, onTagClick],
  )

  return (
    <div className="md">
      <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {text}
      </Markdown>
    </div>
  )
}
