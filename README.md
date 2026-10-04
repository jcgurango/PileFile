# PileFile

A local-first notes app that works like the "saved messages" chat you keep with yourself.

- **Streams** organise messages and can be nested. A message lives in one stream (or none). Opening a stream shows its own messages plus those of every stream nested under it. **All** shows everything. The **Inbox** is a triage tray: every new message lands there, whatever its stream, until you mark it read (one at a time, or all at once).
- Messages are full-width boxes, newest first. On a keyboard, Enter saves and Shift+Enter adds a line; on touch devices Enter adds a line and the send button saves. Text renders as Markdown (GitHub flavoured: lists, task lists, tables, strikethrough, code, links). Single line breaks are kept, like a chat message. Clicking a task checkbox flips it in the source and records a new version. A line starting with `[ ]` or `[x]` outside a list renders as a bare checkbox with a label.
- Editing a message records a new **version**; every version is kept, and the card shows both the creation time and the latest edit time without reordering. The History control steps back and forth through versions in place; clicking its timestamp opens a calendar of the days the message changed, listing every version on a chosen day.
- The composer, the inline editor, and messages share one height cap; longer messages collapse with a Show more toggle.
- A message can be moved between streams.
- Pinned messages stay at the top of their streams, most recently pinned first. Re-pin one to bubble it back up. The Inbox marks pins but keeps strict chronological order.
- Search is full-text over message words (prefix match on every term) plus stream names, with results split into Streams and Messages. Each stream also has its own Search that filters just that stream and its nested streams, with matches highlighted.
- All data lives in the browser's IndexedDB via Dexie. Nothing leaves the device.

## Sync and accounts

The app is local-first: everything works without an account, in IndexedDB. Log in (button at the bottom of the sidebar) and the device syncs with the server:

- Every local change is queued in an **outbox** and sent in order over HTTP. The server applies each action once (ids are idempotent), appends to a per-account **change log**, and pokes other open clients over **SSE** so they pull. Clients also pull on reconnect, when the tab becomes visible, and every minute.
- Text edits are **versions**; the newest by timestamp is the current text and all are kept. Everything else is last-writer-wins.
- The first login on a device that already has notes **merges them up** into the account.
- Attachment bytes upload after their message and download on demand to other devices; thumbnails are built locally.
- Server storage is a **SQLite** file plus an `attachments/` folder. There is no registration: accounts are managed from the CLI.

Installable as a **PWA** (manifest + service worker precache the app shell; data never goes through the SW cache).

## Develop

```sh
npm install
npm run dev:server   # API on :8787, data in ./data (DATA_DIR to change)
npm run dev          # Vite on :5173, proxies /api to the server
npm run cli -- user create alice     # prompts for a password
```

`npm run build` type-checks client and server and produces `dist/`. `npm start` runs the server, which serves `dist/` and the API from one process. Requires Node 22.13+ (built-in SQLite).

Environment: `PORT` (8787), `DATA_DIR` (./data), `STATIC_DIR` (./dist), `COOKIE_SECURE=1` behind HTTPS (automatic when `NODE_ENV=production`).

### End-to-end tests

```sh
npm run test:e2e            # all suites
npm run test:e2e -- sync    # just the ones matching "sync"
```

`e2e/run.mjs` starts a throwaway API server (temp data dir, account `alice` / `correct horse`) and a Vite dev server on ports 8790 and 5174, then runs each `e2e/NN-*.mjs` spec in its own browser. Specs are plain Playwright scripts that print PASS/FAIL lines. They use the installed Chrome, falling back to Playwright's Chromium (`npx playwright install chromium`). Screenshots go to `e2e/.shots/`.

CLI: `user create <name>`, `user passwd <name>` (signs out existing sessions), `user delete <name>` (removes all their data), `user list`. Pass `--password <pw>` to skip the prompt.

## Later

Voice notes, MCP server, log compaction, change-log pagination for very large accounts.
