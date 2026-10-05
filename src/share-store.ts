/**
 * Hand-off between the service worker and the app for OS share-sheet payloads.
 * Plain IndexedDB (no Dexie) so the worker stays small; the store is separate from the app's database.
 */

export const SHARE_FLAG = 'share'

export interface SharePayload {
  title: string
  text: string
  url: string
  files: File[]
  at: number
}

const DB = 'pilefile-share'
const STORE = 'shares'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { autoIncrement: true })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function putShare(share: SharePayload): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).add(share)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

/** Returns every stashed share, oldest first, and clears the store. */
export async function takeShares(): Promise<SharePayload[]> {
  const db = await open()
  const shares = await new Promise<SharePayload[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const all = store.getAll()
    all.onsuccess = () => {
      store.clear()
      resolve(all.result as SharePayload[])
    }
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  return shares
}

/** Composer text for a share: title, text and link on separate lines, blanks dropped. */
export function shareText(s: SharePayload): string {
  return [s.title, s.text, s.url].map((p) => p.trim()).filter(Boolean).join('\n')
}
