# PileFile — notes for Claude

PileFile is a local-first notes app shaped like a messaging app's "saved messages": you write messages to yourself, file them in nested streams, tag them inline, and sync them to a small server you run yourself.

## Working agreements

- **The user commits and pushes.** Never run `git commit` or `git push` unless asked. Leave the working tree ready.
- **The project is stable (since 2026-10-04).** Schema changes must migrate data, never wipe it: add a new Dexie version with an `.upgrade()` in `src/db.ts`, append a SQL migration in `server/src/db.ts`. Protocol changes in `shared/protocol.ts` must be additive; bump `PROTOCOL_VERSION` if a client and server could disagree.
- **Keep it simple, refine as needed.** Prefer the small obvious change over a framework. No new dependencies without a reason worth a sentence.
- **Verify in a real browser.** Every UI or sync change gets exercised through the e2e suites (below) or a short Playwright script, plus `npm run typecheck` and `npm run lint`. Screenshots are worth looking at: layout bugs have hidden in passing tests more than once.
- **Mid-turn messages from the user are requirements.** Read them and fold them in before finishing.

## Layout

```
src/                 React client (Vite). Components in src/components, sync engine in src/sync.
src/db.ts            Dexie schema, all local mutations (each one also enqueues a sync action), queries.
src/sync/engine.ts   Outbox drain, SSE pokes, pulls, login/logout, merge-up on first login.
src/sync/apply.ts    Applies server changes to IndexedDB (direct table writes, never via db.ts mutations).
shared/protocol.ts   Row types, Action and Change unions, API shapes. Imported by both sides.
server/src/          Hono API: db.ts (SQLite + migrations), auth.ts, sync.ts (apply/pull/change log), app.ts, cli.ts.
e2e/                 Playwright specs (NN-*.mjs) + run.mjs runner + fixtures. Plain scripts, PASS/FAIL lines.
scripts/icons.mjs    Renders public/icons/*.png from public/pilefile-icon.svg.
```

## Commands

```sh
npm run dev:server        # API on :8787, data in ./data
npm run dev               # Vite on :5173, proxies /api (API_PORT overrides the target port)
npm run cli -- user create <name> [--password <pw>]   # also passwd | delete | list
npm run typecheck         # tsc -b over client, server, shared
npm run lint              # oxlint
npm run test:e2e [filter] # boots a throwaway server (:8790) + Vite (:5174), runs e2e/NN-*.mjs
npm run build             # dist/; `npm start` serves dist/ and /api from one process
npm run icons             # regenerate PNG icons from the SVG
```

Server runs TypeScript directly on Node 22.13+ (type stripping): server code must be erasable TS (no enums, no parameter properties) and use explicit `.ts` import extensions.

## Product rules worth knowing (not obvious from the code)

- **Views.** Inbox = every unread message across all streams; the triage zone. All = everything. A stream shows its own messages plus every nested stream's. Composing in Inbox or All creates an unfiled message.
- **Read state.** Only new messages are unread. Editing or ticking a task does NOT mark a message unread (that was tried and reverted). Mark read/unread per card, or Mark all as read in the Inbox header (with confirmation).
- **Ordering.** By creation time, newest first. Editing never reorders (also tried and reverted). Pins sit on top only in the exact view they were pinned in; a pin is a (message, view) record, where the view is a stream id or the `inbox`/`all` sentinel. Elsewhere a pinned message keeps its place but shows "Pinned in …".
- **Streams.** Nested; a message lives in exactly one stream or none. Deleting a stream moves its children and messages up to its parent. The cascade is sent as explicit sync actions.
- **Versions.** Every text edit is a version; newest timestamp is current; all kept. History UI steps in place (‹ time ›) and the timestamp opens a calendar of change days. Attachments are immutable and not versioned: no adding/removing on an existing message, by decision.
- **Markdown.** GitHub flavoured, single newlines are line breaks, raw HTML is shown as text. Task checkboxes are live and write back to the exact `[ ]` character by source offset. `#Tag` runs are clickable and indexed (exact match, case-insensitive; a word prefix search still finds the word). Typing `#` in either search box offers tag completions.
- **Input.** Keyboard: Enter saves, Shift+Enter newline, Esc cancels. Touch (`pointer: coarse`): Enter inserts a newline, the send button saves. On touch or narrow screens (`max-width: 760px`) a card shows one "More actions" button that opens a bottom sheet (`ActionSheet`) with the labelled actions; desktop keeps the hover icon row. Icon buttons grow to 38px on coarse pointers.
- **Layout.** Messages are flush full-width rows with hairline separators, no cards. Composer, inline editor and collapsed messages share one height cap (`--clamp-h`); long messages get Show more. Tooltips are `display:none` until hover so they never widen a scroll container.
- **Search.** Sidebar search is global (streams + messages, split sections). Each view also has its own Search in the header that filters in memory and highlights matches, including inside rendered Markdown.

## Sync model (keep these invariants)

- Every entity id is a client-generated UUID. Creates are idempotent; replaying is harmless (this is what makes merge-up on first login safe).
- Client mutation = local write + `enqueue(action)` in the same Dexie transaction. Remote changes are applied with direct table writes in `src/sync/apply.ts` so they never re-enter the outbox.
- Server: `POST /api/actions` applies each action once (by action id), appends to `changes` (per-user `seq`), pokes SSE listeners. `GET /api/sync?since=N` returns the log after N, or a snapshot for N=0. Text is LWW by version timestamp; other fields are last-arrival-wins.
- Attachment bytes travel separately: metadata on `message.create`, bytes via an `upload` outbox item to `PUT /api/attachments/:id`, fetched lazily by other devices (`getFileBlob` falls back to the server). Thumbnails are generated locally and retried while bytes are still arriving.
- `/api/me` returns 200 with `user: null` when signed out, on purpose (no console noise at startup).
- Known soft spots: no log compaction, no login rate limiting, a brief flicker if an older echo overwrites a newer pending move/read change.

## Testing habits

- `e2e/helpers.mjs` has `launch()`, `checker()`, `fixture()`, `shotPath()`. Specs print PASS/FAIL and exit non-zero on failure. The runner restarts the server on a clean database before any spec whose name contains `sync`.
- Locate cards by `.msg[data-id=…]` when the test edits them: text-based locators break while the editor replaces the body.
- `check()` strings are the spec's documentation; keep them descriptive.
- When adding a feature, extend the matching spec rather than starting a new file, unless it is a new area.

## Deferred / ideas

Voice notes in the composer, MCP server, change-log compaction, moving thumbnail generation server-side if large videos become common, code-splitting the Markdown pipeline for the PWA.
