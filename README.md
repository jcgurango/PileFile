<p align="center">
  <img src="public/pilefile-icon.svg" alt="PileFile icon" width="112" height="112">
</p>

# PileFile

A local-first notes app that works like the "saved messages" chat you keep with yourself.

- **Streams** organise messages and can be nested. A message lives in one stream (or none). Opening a stream shows its own messages plus those of every stream nested under it. **All** shows everything and is where the app opens. The **Inbox** is a triage tray: a new message that is not in any stream sits there until you mark it read (one at a time, or all at once) or move it into a stream; switch its unread filter off to see everything that is not filed. Editing does not mark a message unread again. Every view can mark all of what it shows as read and filter down to unread only; the sidebar shows how many unread messages each stream holds, and lists the streams you wrote to most recently first.
- Messages are flush, full-width rows, newest first by creation time. On a keyboard, Enter saves and Shift+Enter adds a line; on touch devices Enter adds a line and the send button saves. On phones and narrow windows each message has a single "More" button that opens a sheet of actions; on desktop the actions appear as icons on hover.
- Text renders as Markdown (GitHub flavoured: lists, task lists, tables, strikethrough, code, links). Single line breaks are kept, like a chat message. Clicking a task checkbox flips it in the source and records a new version. Raw HTML is shown as text.
- Write `#Tag` anywhere to tag a message. Tags are clickable (they open the search panel with that tag), indexed, and matched exactly (`#MyTa` does not find `#MyTag`). Typing `#` in either search box lists matching tags to pick from.
- Editing a message records a new **version**; every version is kept, and the card shows both the creation time and the latest edit time without reordering. The History control steps back and forth through versions in place; clicking its timestamp opens a calendar of the days the message changed, listing every version on a chosen day.
- Attach files with the paperclip, by dropping them on the composer, or by pasting. Images and videos show in a grid with lazily generated thumbnails and open full-size in a lightbox; audio files get players; anything else is a download chip. A message can be attachments only. Attachments are fixed when a message is posted and are not part of the version history.
- Reply to a message to post a new one with a backlink: the reply shows a small quote of the original, and clicking it jumps there.
- The composer, the inline editor, and messages share one height cap; longer messages collapse with a Show more toggle.
- A message can be moved between streams.
- Pins are per view. Pin a message in a stream, the Inbox, or All and it stays at the top of that view, most recently pinned first; re-pin to bubble it back up. Other views show it as "Pinned in …" but keep it in chronological order unless it is pinned there too.
- Search is full-text over message words (prefix match on every term) and exact `#tags`, plus stream names, with results split into Streams and Messages. Each view also has its own Search in the header that filters just that view (including nested streams), with matches highlighted.
- Data lives in the browser's IndexedDB via Dexie. Without an account nothing leaves the device; log in and it syncs as described below.

## Sync and accounts

The app is local-first: everything works without an account, in IndexedDB. Log in (button at the bottom of the sidebar) and the device syncs with the server:

- Every local change is queued in an **outbox** and sent in order over HTTP. The server applies each action once (ids are idempotent), appends to a per-account **change log**, and pokes other open clients over **SSE** so they pull. Clients also pull on reconnect, when the tab becomes visible, and every minute.
- Text edits are **versions**; the newest by timestamp is the current text and all are kept. Everything else is last-writer-wins.
- The first login on a device that already has notes **merges them up** into the account.
- Attachment bytes upload after their message and download on demand to other devices; thumbnails are built locally.
- Server storage is a **SQLite** file plus an `attachments/` folder. There is no registration: accounts are managed from the CLI.

Installable as a **PWA** (manifest + service worker precache the app shell; data never goes through the SW cache). Once installed it is a **share target**: on Android, Windows and ChromeOS it appears in the OS share sheet, and shared text, links and files land in the composer of the current view for you to file and save. iOS has no web share target, so this does not apply there.

## Develop

```sh
npm install
npm run dev:server   # API on :8787, data in ./data (DATA_DIR to change)
npm run dev          # Vite on :5173, proxies /api to the server
npm run cli -- user create alice     # prompts for a password
```

`npm run build` type-checks client and server and produces `dist/`. `npm run icons` re-renders the PNG app icons in `public/icons/` from `public/pilefile-icon.svg`. `npm start` runs the server, which serves `dist/` and the API from one process. Requires Node 22.13+ (built-in SQLite).

Environment: `PORT` (8787), `DATA_DIR` (./data), `STATIC_DIR` (./dist), `COOKIE_SECURE=1` behind HTTPS (automatic when `NODE_ENV=production`).

### Docker

```sh
docker build -t jcgurango/pilefile:latest .
docker run -d --name pilefile -p 8787:8787 -v pilefile-data:/data jcgurango/pilefile:latest
docker exec -it pilefile node server/src/cli.ts user create alice   # prompts for a password
```

The image serves the built client and the API on port 8787, stores the database and attachments in `/data`, and runs as the unprivileged `node` user (bind mounts must be writable by uid 1000). Set `-e COOKIE_SECURE=1` when it sits behind HTTPS.

### End-to-end tests

```sh
npm run test:e2e            # all suites
npm run test:e2e -- sync    # just the ones matching "sync"
```

`e2e/run.mjs` starts a throwaway API server (temp data dir, account `alice` / `correct horse`) and a Vite dev server on ports 8790 and 5174, then runs each `e2e/NN-*.mjs` spec in its own browser. Specs with `prod` in the name run against a production build served by the API server, which is how the real service worker (share target, precache) gets tested. Specs are plain Playwright scripts that print PASS/FAIL lines. They use the installed Chrome, falling back to Playwright's Chromium (`npx playwright install chromium`). Screenshots go to `e2e/.shots/`.

CLI: `user create <name>`, `user passwd <name>` (signs out existing sessions), `user delete <name>` (removes all their data), `user list`. Pass `--password <pw>` to skip the prompt.

## Later

Voice notes, MCP server, change-log compaction, a paginated first-login snapshot for very large accounts, login rate limiting.
