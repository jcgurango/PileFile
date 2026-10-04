import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

/**
 * Caps content at the shared --clamp-h height. When the content is taller, it is clipped
 * with a fade and a Show more / Show less toggle appears.
 */
export default function Clamp({ children }: { children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const box = boxRef.current
    const inner = innerRef.current
    if (!box || !inner) return
    const measure = () => {
      const cap = parseFloat(getComputedStyle(box).getPropertyValue('--clamp-h')) || Infinity
      setOverflowing(inner.getBoundingClientRect().height > cap + 1)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(inner)
    return () => ro.disconnect()
  }, [])

  const toggle = () => {
    setExpanded((e) => !e)
    if (expanded) boxRef.current?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div className={`clamp${expanded ? ' expanded' : ''}${overflowing ? ' overflowing' : ''}`}>
      <div className="clamp-box" ref={boxRef}>
        <div ref={innerRef}>{children}</div>
      </div>
      {overflowing && (
        <button className="clamp-btn" onClick={toggle} aria-expanded={expanded}>
          {expanded ? (
            <>
              <ChevronUp size={14} strokeWidth={2} aria-hidden="true" /> Show less
            </>
          ) : (
            <>
              <ChevronDown size={14} strokeWidth={2} aria-hidden="true" /> Show more
            </>
          )}
        </button>
      )}
    </div>
  )
}
