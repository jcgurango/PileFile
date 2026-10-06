import { useEffect, useRef, useSyncExternalStore } from 'react'
import { ALL_ID, ancestorsOf, db, findChild, INBOX_ID, isVirtual, type Stream } from './db'

/**
 * The address bar says which view is open: `/` is All, `/inbox` the Inbox and
 * `/s/Work/Projects` a stream, by the names on the way down to it.
 *
 * Names can repeat and change, so every history entry also remembers the view's id. The id
 * wins while it is still valid; a pasted or hand-typed address has none and goes by name.
 */
interface RouteState {
  streamId?: string
}

const STREAM_PREFIX = '/s/'
const INBOX_PATH = '/inbox'

const stateId = () => (history.state as RouteState | null)?.streamId

export function pathFor(viewId: string, streams: Stream[]): string {
  if (viewId === INBOX_ID) return INBOX_PATH
  const self = streams.find((s) => s.id === viewId)
  if (!self) return '/'
  return STREAM_PREFIX + [...ancestorsOf(streams, viewId), self].map((s) => encodeURIComponent(s.name)).join('/')
}

/** The view an address names, or null when it names nothing that exists. */
export function resolvePath(pathname: string, streams: Stream[]): string | null {
  const path = pathname.replace(/\/+$/, '')
  if (path === '') return ALL_ID
  if (path.toLowerCase() === INBOX_PATH) return INBOX_ID
  if (!path.startsWith(STREAM_PREFIX)) return null
  let parentId: string | null = null
  for (const segment of path.slice(STREAM_PREFIX.length).split('/')) {
    let name: string
    try {
      name = decodeURIComponent(segment)
    } catch {
      return null
    }
    const next = findChild(streams, parentId, name)
    if (!next) return null
    parentId = next.id
  }
  return parentId
}

const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener('popstate', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('popstate', onChange)
  }
}

const snapshot = () => `${location.pathname}\n${stateId() ?? ''}`

export interface CurrentView {
  id: string
  /** False when the address names nothing that exists (yet), and All is shown in its place. */
  known: boolean
}

function readView(streams: Stream[]): CurrentView {
  // An entry made in the app goes by id alone: once its stream is gone, a namesake must not take its place.
  const id = stateId() ?? resolvePath(location.pathname, streams)
  const exists = id !== null && (isVirtual(id) || streams.some((s) => s.id === id))
  return exists ? { id, known: true } : { id: ALL_ID, known: false }
}

/** The view the address bar points at. Re-renders on navigation, including Back and Forward. */
export function useCurrentView(streams: Stream[] | undefined): CurrentView | null {
  useSyncExternalStore(subscribe, snapshot)
  return streams ? readView(streams) : null
}

/**
 * Opens a view as a new history entry (none when it is already the open one).
 * `streams` may be a step behind for a stream created a moment ago; then the database is asked.
 */
export async function openView(viewId: string, streams: Stream[]): Promise<void> {
  const known = isVirtual(viewId) || streams.some((s) => s.id === viewId)
  const path = pathFor(viewId, known ? streams : await db.streams.toArray())
  if (path !== location.pathname || stateId() !== viewId) {
    history.pushState({ streamId: viewId } satisfies RouteState, '', path)
  }
  for (const notify of listeners) notify()
}

function replaceAddress(viewId: string, streams: Stream[]): void {
  const path = pathFor(viewId, streams)
  if (path === location.pathname && stateId() === viewId) return
  history.replaceState({ ...history.state, streamId: viewId }, '', path + location.search + location.hash)
}

/**
 * Keeps the address true to the open view: a renamed or moved stream gets its new path, and a
 * stream that was open and has been deleted (here or on another device) gives way to All.
 * An address that never resolved is left alone, so a stream that is still arriving can claim it.
 */
export function useAddressSync(streams: Stream[] | undefined): void {
  const lastKnown = useRef<string | null>(null)
  useEffect(() => {
    if (!streams) return
    // Read the address now, not at render time: a navigation may have happened in between.
    const view = readView(streams)
    if (view.known) {
      lastKnown.current = view.id
      replaceAddress(view.id, streams)
    } else if (lastKnown.current && lastKnown.current === stateId()) {
      lastKnown.current = ALL_ID
      replaceAddress(ALL_ID, streams)
    }
  })
}
