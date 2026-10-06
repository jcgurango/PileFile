import { useState, type FormEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { ensureStreamPath, flattenTree, moveMessage, type Message, type Stream } from '../db'
import IconButton from './IconButton'

interface Props {
  message: Message
  streams: Stream[]
  onClose: () => void
}

/** Single-choice picker: a message is filed in exactly one stream, or none. */
export default function MovePicker({ message, streams, onClose }: Props) {
  const [name, setName] = useState('')
  const rows = flattenTree(streams)
  const current = message.streamId
  const group = `move-${message.id}`

  const addNew = async (e: FormEvent) => {
    e.preventDefault()
    // A stream created from here is nested under the message's current stream.
    const id = await ensureStreamPath(name, current)
    if (!id) return
    await moveMessage(message.id, id)
    setName('')
  }

  return (
    <div className="picker" role="radiogroup" aria-label="Move this message to a stream">
      <div className="picker-head">
        <span>Move to</span>
        <IconButton icon={X} label="Done" hint="Close" align="end" onClick={onClose} />
      </div>

      <label className="picker-row picker-check">
        <input
          type="radio"
          name={group}
          checked={current === null}
          onChange={() => moveMessage(message.id, null)}
        />
        <span className="picker-name">No stream</span>
        <span className="muted small">All and Inbox only</span>
      </label>

      {rows.map(({ stream, depth }) => (
        <label
          key={stream.id}
          className="picker-row picker-check"
          style={{ paddingLeft: `${depth * 18}px` }}
        >
          <input
            type="radio"
            name={group}
            checked={current === stream.id}
            onChange={() => moveMessage(message.id, stream.id)}
          />
          <span className="picker-name">{stream.name}</span>
        </label>
      ))}

      <form className="picker-new" onSubmit={addNew}>
        <input
          value={name}
          placeholder={current ? 'New stream inside the current one…' : 'New stream…'}
          aria-label="New stream name"
          onChange={(e) => setName(e.target.value)}
        />
        <IconButton icon={Plus} label="Add" hint="Create and move here" type="submit" align="end" disabled={!name.trim()} />
      </form>

      <p className="hint">
        A message lives in one stream. It also shows in every stream above that one, and always in
        All.
      </p>
    </div>
  )
}
