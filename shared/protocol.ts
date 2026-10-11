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

export const PROTOCOL_VERSION = 2

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

/**
 * One saved state of a stream's page. Rows are immutable and form a chain: each one names its
 * parent and carries either the whole text (a snapshot) or a patch that turns the parent's text
 * into its own. The page is the newest row whose chain can be read back to a snapshot.
 */
export interface PageVersionRow {
  id: string
  streamId: string
  createdAt: number
  /** Null for the first version of a page. */
  parentId: string | null
  /** The full text, for a snapshot. */
  text?: string
  /** A CodeMirror ChangeSet as JSON, applied to the parent's text. Snapshots carry one too when it is known. */
  patch?: string
  /**
   * For a merge: the other version it reconciles, the tip of the branch that `parentId` was not on.
   * Both are its parents when asking what descends from what; `patch` is relative to `parentId`.
   */
  mergeOf?: string
}

export type StreamViewMode = 'page' | 'messages' | 'threaded'

/** Which of a stream's views was open last. The newest `at` wins. */
export interface StreamViewRow {
  streamId: string
  view: StreamViewMode
  at: number
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
  | { type: 'page.edit'; version: PageVersionRow }
  | { type: 'view.set'; view: StreamViewRow }

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
  | { op: 'page.put'; data: PageVersionRow }
  | { op: 'view.put'; data: StreamViewRow }

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
