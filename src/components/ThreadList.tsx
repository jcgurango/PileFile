import type { ReactNode } from 'react'
import type { Message } from '../db'
import type { ThreadNode } from '../threads'

interface Props {
  nodes: ThreadNode[]
  /** Renders one message. `nested` is true for a reply shown under the message it answers. */
  renderCard: (message: Message, nested: boolean) => ReactNode
}

/** Messages as discussions: each reply indented under the message it answers, oldest reply first. */
export default function ThreadList({ nodes, renderCard }: Props) {
  return (
    <>
      {nodes.map((node) => (
        <div className="thread" key={node.message.id}>
          <Branch node={node} nested={false} renderCard={renderCard} />
        </div>
      ))}
    </>
  )
}

function Branch({ node, nested, renderCard }: { node: ThreadNode; nested: boolean; renderCard: Props['renderCard'] }) {
  return (
    <>
      {renderCard(node.message, nested)}
      {node.replies.length > 0 && (
        <div className="thread-replies">
          {node.replies.map((reply) => (
            <Branch key={reply.message.id} node={reply} nested renderCard={renderCard} />
          ))}
        </div>
      )}
    </>
  )
}
