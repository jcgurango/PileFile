import { useRef, useState, type DragEvent } from 'react'

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

/** Drag-and-drop file handling for a container. Spread `handlers` onto the element. */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  const handlers = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current++
      setOver(true)
    },
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver(false)
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setOver(false)
      const files = Array.from(e.dataTransfer.files)
      if (files.length) onFiles(files)
    },
  }

  return { over, handlers }
}
