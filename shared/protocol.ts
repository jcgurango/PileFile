/**
 * Sync protocol shared by the client and the server.
 *
 * Rules kept deliberately simple:
 * - Every entity has a client-generated UUID, so creates are idempotent and merges never collide.
 * - Text edits are versions. The current text of a message is its newest version by timestamp,
 *   and every version is kept. Other fields are last-writer-wins in arrival order.
 * - The server keeps a per-account change log with a monotonically increasing `seq`.
 *   Clients remember the last `seq` they applied and pull everything after it.
 */

export const PROTOCOL_VERSION = 1

// ----------------------------------------------------------------- rows

export interface StreamRow {
  id: string
  name: string
  parentId: string | null
  createdAt: number
  updatedAt: number
}

export interface MessageRow {
  id: string
  streamId: string | null
  createdAt: number
  /** Timestamp of the newest version. */
  updatedAt: number
  text: string
  versionCount: number
  replyToId: string | null
  unread: 0 | 1
  attachmentCount: number
}

export interface VersionRow {
  id: string
  messageId: string
  text: string
  createdAt: number
}

export interface PinRow {
  messageId: string
  /** A stream id, or the 'inbox' / 'all' view sentinels. */
  streamId: string
  pinnedAt: number
}

export interface AttachmentRow {
  id: string
  messageId: string
  name: string
  type: string
  size: number
  createdAt: number
  order: number
}

// -------------------------------------------------------------- actions

/** A client mutation. `id` makes it idempotent; `at` is the client clock when it happened. */
export type ActionBody =
  | { type: 'stream.put'; stream: StreamRow }
  | { type: 'stream.delete'; streamId: string }
  | { type: 'message.create'; message: MessageRow; version: VersionRow; attachments: AttachmentRow[] }
  | { type: 'message.edit'; version: VersionRow }
  | { type: 'message.move'; messageId: string; streamId: string | null }
  | { type: 'message.read'; messageId: string; unread: 0 | 1 }
  | { type: 'message.delete'; messageId: string }
  | { type: 'pin.put'; pin: PinRow }
  | { type: 'pin.remove'; messageId: string; streamId: string }
  | { type: 'read.all' }

export type Action = ActionBody & { id: string; at: number }

// -------------------------------------------------------------- changes

/** One entry of the account's change log, as delivered to clients. */
export type ChangeBody =
  | { op: 'stream.put'; data: StreamRow }
  | { op: 'stream.delete'; id: string }
  | { op: 'message.put'; data: MessageRow }
  | { op: 'message.delete'; id: string }
  | { op: 'version.put'; data: VersionRow }
  | { op: 'pin.put'; data: PinRow }
  | { op: 'pin.remove'; messageId: string; streamId: string }
  | { op: 'attachment.put'; data: AttachmentRow }
  | { op: 'attachment.delete'; id: string }
  | { op: 'read.all'; at: number }

export type Change = ChangeBody & { seq: number }

// ------------------------------------------------------------------ api

export interface UserInfo {
  id: string
  name: string
}

export interface LoginRequest {
  name: string
  password: string
}

export interface ActionsRequest {
  actions: Action[]
}

export interface ActionsResponse {
  /** Highest change seq after applying, so the client can pull its own echoes cheaply. */
  seq: number
}

export interface SyncResponse {
  changes: Change[]
  /** Highest seq included; pass as `since` next time. */
  seq: number
  /** True when there are more changes after `seq`; pull again. */
  more: boolean
}

/** SSE event name and payload used to nudge clients to pull. */
export const POKE_EVENT = 'poke'
export interface PokePayload {
  seq: number
}
