import { splitHighlights } from '../format'

/** Text with every occurrence of any term wrapped in <mark>. */
export default function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>
  const parts = splitHighlights(text, terms)
  return <>{parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : p))}</>
}
