import { useCallback, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, INBOX_ID, isVirtual } from './db'
import Sidebar from './components/Sidebar'
import StreamView from './components/StreamView'

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
      />
    </div>
  )
}
