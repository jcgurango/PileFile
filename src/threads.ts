import type { Message } from './db'

export interface ThreadNode {
  message: Message
  /** Replies, oldest first. */
  replies: ThreadNode[]
  /** When this message or anything below it was last written. */
  lastAt: number
}

/**
 * Arranges messages as discussions: a reply sits under the message it answers. A message whose
 * original is not in the set (deleted, or filed elsewhere) starts a thread of its own.
 * Threads come newest activity first, where activity is the latest message anywhere in the thread.
 * Nothing is stored for this: the set is already in memory, so the order is always current.
 */
export function buildThreads(messages: Message[]): ThreadNode[] {
  const nodes = new Map<string, ThreadNode>(messages.map((m) => [m.id, { message: m, replies: [], lastAt: m.createdAt }]))
  const roots: ThreadNode[] = []
  for (const node of nodes.values()) {
    const parent = node.message.replyToId ? nodes.get(node.message.replyToId) : undefined
    if (parent && parent !== node) parent.replies.push(node)
    else roots.push(node)
  }
  const settle = (node: ThreadNode, seen: Set<ThreadNode>): number => {
    if (seen.has(node)) return node.lastAt
    seen.add(node)
    node.replies.sort((a, b) => a.message.createdAt - b.message.createdAt)
    for (const reply of node.replies) node.lastAt = Math.max(node.lastAt, settle(reply, seen))
    return node.lastAt
  }
  const seen = new Set<ThreadNode>()
  for (const root of roots) settle(root, seen)
  return roots.sort((a, b) => b.lastAt - a.lastAt || b.message.createdAt - a.message.createdAt)
}

/** How many messages a thread holds below its first one. */
export const replyCount = (node: ThreadNode): number => node.replies.reduce((n, r) => n + 1 + replyCount(r), 0)
