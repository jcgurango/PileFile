/// <reference lib="webworker" />
/**
 * Service worker: precaches the app shell and receives OS share-sheet posts.
 *
 * A file share arrives as a multipart POST to /share, which only a service worker can
 * intercept. The payload is stashed in a small IndexedDB store and the browser is sent to
 * the app with ?share=1, where the composer picks it up.
 */
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { putShare, SHARE_FLAG } from './share-store'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0] }

self.skipWaiting()
clientsClaim()

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'POST' || url.pathname !== '/share') return
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData()
        await putShare({
          title: String(form.get('title') ?? ''),
          text: String(form.get('text') ?? ''),
          url: String(form.get('url') ?? ''),
          files: form.getAll('files').filter((f): f is File => f instanceof File),
          at: Date.now(),
        })
      } catch (err) {
        console.error('share intake failed', err)
      }
      return Response.redirect(`/?${SHARE_FLAG}=1`, 303)
    })(),
  )
})

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
// Data goes through /api and never the cache; /share is handled above.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//, /^\/share$/] }))
