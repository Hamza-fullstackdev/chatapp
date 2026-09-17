# Offline Sync

The app is offline-first: every action writes to SQLite immediately and is reconciled with the
server in the background. Nothing in the UI waits on the network.

Key modules:

| File | Role |
| --- | --- |
| `app/src/db/database.ts` | SQLite open + `PRAGMA user_version` migrations |
| `app/src/db/repositories.ts` | typed reads/writes for messages, conversations, reactions, queue |
| `app/src/lib/offline-queue.ts` | in-memory + persisted outbound op queue |
| `app/src/lib/pull-sync.ts` | applies server changelog entries to SQLite |
| `app/src/context/sync-context.tsx` | drives flush + pull on connect, interval and foreground |
| `app/src/lib/socket.ts` | realtime writes straight into SQLite |

## 1. Local writes

An action (send/edit/delete/react/read) performs an **optimistic SQLite write first**, so the chat
screen re-renders instantly, then enqueues a pending operation.

- New messages get a **client-generated id** (`clientMessageId`, a UUID) at creation time. The UI
  keys on it, so the placeholder and the later server-confirmed row are the same logical message.
- Messages are created with `status = 'pending'`. On successful server ack they become
  `sent`/`delivered`; a permanent failure sets `sync_error` and `status = 'failed'`.
- Failed sends stay visible in the list with an error indicator; tapping retries **using the same
  `clientMessageId`**, so a retry can never duplicate the message.

Conversations and members are cached the same way, with denormalized last-message fields so the
list renders without joins.

## 2. Sync queue

`sync_queue` (SQLite) persists every outbound operation:

```
id | operation | entity_type | entity_id | payload | status
   | retry_count | next_retry_at | error | created_at
```

- `status`: `pending → in_flight → done`, or `failed` when retries are exhausted.
- Supported operations sent to the server: `CREATE_MESSAGE`, `MARK_READ`, `EDIT_MESSAGE`,
  `DELETE_MESSAGE`, `CREATE_REACTION`, `DELETE_REACTION`. (The SQLite check constraint also lists
  `CREATE_CONVERSATION`, `ADD_MEMBER`, `REMOVE_MEMBER`, `CREATE_GROUP`, `UPDATE_PROFILE` for
  forward compatibility; the server currently reports those as `unsupported`.)
- `offline-queue.ts` keeps an in-memory mirror for fast UI reads, and re-persists the queue on every
  change (`truncatePendingOps` + re-insert), capped at 500 ops.
- Duplicate enqueues of the same `(type, clientMessageId)` overwrite the existing entry instead of
  appending.

## 3. Batch synchronization

The queue is flushed as a **single batch** to `POST /api/sync/push`:

```jsonc
{
  "operations": [
    { "operation": "CREATE_MESSAGE", "clientMessageId": "…", "conversationId": "…",
      "payload": { "text": "hi", "type": "text", "attachment": { … } } }
  ]
}
```

The response reports per-operation results (`ok`, `duplicate`, `unsupported`, `error`), so **partial
success is expected**: successful ops are removed from the queue, failed ones stay for retry.

Pulling uses `POST /api/sync/pull` with the stored cursor and a limit (200 from the client, capped
at 100 per response server-side), and loops until the server returns no more changes.

## 4. Retry mechanism

- Each failed op increments `retry_count` and sets `next_retry_at` (exponential backoff); the
  queue only flushes ops whose `next_retry_at` has passed.
- A network/connection error leaves ops `pending`; they flush when the socket reconnects, on the
  periodic sync interval, and when the app returns to the foreground.
- `sync-context.tsx` owns the flush cycle, so retries survive navigation and screen unmounts.
- Ops are never silently dropped: exhausted ops surface as `failed` messages/reactions in the UI.

## 5. Idempotency

Two independent layers prevent duplicates:

1. **Server `sync_ops`** — unique `(user_id, idempotency_key)`. The key is the client's
   `idempotencyKey` when provided, otherwise derived as `<operation_lowercase>:<clientMessageId>`.
   A replayed op returns `status: 'duplicate'` without re-applying.
2. **`messages.client_message_id` unique constraint** — even a direct `sendMessage` call cannot
   insert the same client-generated message twice.

Because keys are derived from the client message id, a retry after a timeout (where the server may
have applied the op but the response was lost) is safe.

## 6. Client-generated IDs

- Message ids for the wire protocol are UUIDs generated on the device (`clientMessageId`).
- The server assigns its own primary-key `id`; the client maps the two on ack and keeps
  `clientMessageId` on the row permanently for dedup.
- Reactions, edits and deletes reference the **server message id** once the message is confirmed
  (the client re-reads it from SQLite after ack).

## 7. Sync cursor

- The cursor is `sync_changelog.id` (`bigserial`) per user, stored in
  `sync_state.last_sync_cursor`.
- The server writes one changelog row per user-visible change and returns rows with
  `id > cursor` in ascending order; the client advances the cursor to the last applied id, but
  **only when at least one change was applied**.
- A pull that returns zero changes leaves the cursor untouched, so nothing is skipped.
- Unknown `entityType` values are ignored (forward compatibility) and still advance the cursor.

## 8. Conflict handling

- **Server wins.** The PostgreSQL row is authoritative; the local row is overwritten by the pulled
  changelog entry or the realtime socket event.
- `mergeBase(base, optimistic)` in the chat screen keeps server entries authoritative and only
  appends an optimistic placeholder when its `clientMessageId`/`id` is absent from the base set.
- Optimistic mutations are written to **both** the base and optimistic collections, so the base
  stays authoritative while the optimistic copy is still in flight.
- Deletes are soft (`deleted_at`), so a delete broadcast never destroys local context.
- A rejected sync op (e.g. `unsupported` or a validation error) is dropped from the queue and the
  local optimistic row is cleaned up — the server's state simply wins.

## 9. Reconnection behavior

1. Socket reconnects → `sync-context` triggers a flush of the pending queue, then a pull.
2. Realtime events received while online are applied to SQLite directly, so the socket is the fast
   path and the pull is the safety net for anything missed while disconnected.
3. Pull loops until the changelog is drained, then updates the cursor.
4. The chat screen subscribes to SQLite changes (`useSyncDb`), so cached data reloads as soon as a
   flush or pull lands — no manual refresh.
