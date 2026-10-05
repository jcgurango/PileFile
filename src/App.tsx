import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, INBOX_ID, isVirtual } from './db'
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
  const [streamId, setStreamId] = useState(INBOX_ID)
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
        history.replaceState(null, '', url.pathname + url.search + url.hash)
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

  const openStream = useCallback((id: string, messageId?: string) => {
    setStreamId(id)
    setFocus(messageId ? { messageId, nonce: Date.now() } : null)
    setDrawerOpen(false)
  }, [])

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  /** A #tag was clicked in a message: open the search panel with that tag. */
  const openTagSearch = useCallback((tag: string) => {
    // Trailing space: the tag is complete, so the suggestion menu stays closed.
    setQuery(`#${tag} `)
    setSearchFocusNonce((n) => n + 1)
    setDrawerOpen(true)
  }, [])

  if (!streams) return null

  // If the selected stream disappears (deleted), show the Inbox instead.
  const stream = streams.find((s) => s.id === streamId)
  const effectiveId = stream || isVirtual(streamId) ? streamId : INBOX_ID

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
