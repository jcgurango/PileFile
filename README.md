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

## Develop

```sh
npm install
npm run dev
```

`npm run build` type-checks and produces a static bundle in `dist/`.

## Later

Cloud sync, attachments and voice notes, PWA install, MCP server.
