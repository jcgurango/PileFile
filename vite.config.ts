import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Custom worker (src/sw.ts): precaching plus the share-target POST handler.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['pilefile-icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'PileFile',
        short_name: 'PileFile',
        description: 'Messages to yourself, filed in streams.',
        theme_color: '#ffffff',
        background_color: '#f4f4f6',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Appear in the OS share sheet once installed (Android, Windows, ChromeOS). The worker turns
        // the POST into a prefilled composer.
        share_target: {
          action: '/share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [
              {
                name: 'files',
                accept: ['image/*', 'video/*', 'audio/*', 'application/pdf', 'text/*'],
              },
            ],
          },
        },
      },
      injectManifest: {
        // The app shell is precached; data lives in IndexedDB and syncs through /api, never the SW cache.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  server: {
    proxy: {
      '/api': { target: `http://localhost:${process.env.API_PORT ?? 8787}`, changeOrigin: false },
    },
  },
})
