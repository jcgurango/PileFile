import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { openView, useAddressSync, useCurrentView } from './route'
import { SHARE_FLAG, shareText, takeShares, type SharePayload } from './share-store'
import Sidebar from './components/Sidebar'
import StreamView from './components/StreamView'

/** Text and files handed to the composer from the OS share sheet. */
export interface IncomingShare {
  text: string
  files: File[]
  nonce: number
}

/** A request to scroll to and briefly highlight one message. `nonce` lets the same message be re-focused. */
export interface Focus {
  messageId: string
  nonce: number
}

export default function App() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [focus, setFocus] = useState<Focus | null>(null)
  const [query, setQuery] = useState('')
  const [searchFocusNonce, setSearchFocusNonce] = useState(0)
  const [share, setShare] = useState<IncomingShare | null>(null)

  // Shares stashed by the service worker: collect on launch and whenever the app comes back to the front.
  useEffect(() => {
    let alive = true
    const collect = async () => {
      let shares: SharePayload[] = []
      try {
        shares = await takeShares()
      } catch {
        return
      }
      if (!alive || shares.length === 0) return
      setShare({
        text: shares.map(shareText).filter(Boolean).join('\n\n'),
        files: shares.flatMap((s) => s.files),
        nonce: Date.now(),
      })
      const url = new URL(location.href)
      if (url.searchParams.has(SHARE_FLAG)) {
        url.searchParams.delete(SHARE_FLAG)
        history.replaceState(history.state, '', url.pathname + url.search + url.hash)
      }
    }
    void collect()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void collect()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const streams = useLiveQuery(
    () => db.streams.toArray().then((all) => all.sort((a, b) => a.name.localeCompare(b.name))),
    [],
  )

  // The address bar holds the open view, so a refresh or a link lands in the same place.
  const view = useCurrentView(streams)
  useAddressSync(streams)

  const openStream = useCallback(
    (id: string, messageId?: string) => {
      void openView(id, streams ?? [])
      setFocus(messageId ? { messageId, nonce: Date.now() } : null)
      setDrawerOpen(false)
    },
    [streams],
  )

  // Back and Forward change the view without going through openStream.
  useEffect(() => {
    const onPop = () => {
      setFocus(null)
      setDrawerOpen(false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  /** A #tag was clicked in a message: open the search panel with that tag. */
  const openTagSearch = useCallback((tag: string) => {
    // Trailing space: the tag is complete, so the suggestion menu stays closed.
    setQuery(`#${tag} `)
    setSearchFocusNonce((n) => n + 1)
    setDrawerOpen(true)
  }, [])

  if (!streams || !view) return null

  // An address that names no stream (deleted, or not synced yet) shows All.
  const effectiveId = view.id
  const stream = streams.find((s) => s.id === effectiveId)

  return (
    <div className="app">
      <Sidebar
        streams={streams}
        selectedId={effectiveId}
        onSelect={openStream}
        open={drawerOpen}
        onClose={closeDrawer}
        query={query}
        onQueryChange={setQuery}
        focusNonce={searchFocusNonce}
      />
      <StreamView
        streamId={effectiveId}
        stream={stream}
        streams={streams}
        focus={focus}
        onOpenStream={openStream}
        onOpenDrawer={() => setDrawerOpen(true)}
        onTagClick={openTagSearch}
        share={share}
        onShareConsumed={() => setShare(null)}
      />
    </div>
  )
}
