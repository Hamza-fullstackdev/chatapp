# Database

Two databases are used, with distinct responsibilities:

| | PostgreSQL (Supabase) | SQLite (per device) |
| --- | --- | --- |
| Role | permanent source of truth | offline cache + outbound queue |
| Scope | all users, all conversations | one device, one signed-in user |
| Driver | `postgres` + Drizzle ORM (`api/src/db`) | `expo-sqlite` (`app/src/db`) |
| Authoritative SQL | `api/database/postgres/migrations/*.sql` | `api/database/sqlite/migrations/*.sql` |

The SQL files are the authoritative artifacts and are committed to the repository. Drizzle schemas
(`api/src/db/schema.ts`) must stay synchronized with the PostgreSQL SQL.

## PostgreSQL schema

Migrations live in `api/database/postgres/migrations/`:

| File | Tables |
| --- | --- |
| `001_create_users.sql` | `users` |
| `002_create_conversations.sql` | `conversations` |
| `003_create_conversation_members.sql` | `conversation_members`, `groups` |
| `004_create_messages.sql` | `messages` |
| `005_create_attachments.sql` | `message_attachments` |
| `006_create_reactions.sql` | `message_reactions` |
| `007_create_calls.sql` | `calls`, `call_participants` |
| `008_create_devices.sql` | `devices`, `push_tokens` |
| `009_create_sync_metadata.sql` | `sync_ops`, `sync_changelog` |
| `010_add_calls_deleted_for.sql` | `calls` (per-user delete marker) |
| `011_rework_users.sql` | `users` (drop email/phone/OTP, rename `name` → `full_name`) |

### Tables and key columns

- **`users`** — `id uuid pk`, `full_name`, `username`, `password_hash`, `bio`, `avatar_url`,
  `last_seen_at`, timestamps. There is no email, phone or OTP: login is username + password.
- **`conversations`** — `type` (`private` | `group`), optional `name`/`avatar_url`, `created_by`,
  denormalized `last_message_id` + `last_message_at`.
- **`conversation_members`** — pk `(conversation_id, user_id)`, `role` (`member` | `admin`),
  `muted`, `archived`, `last_read_message_id`. This is the membership + per-user state table.
- **`groups`** — one row per group conversation: `conversation_id` pk, `name`, `description`,
  `avatar_url`.
- **`messages`** — `client_message_id` is **unique** and client-generated (idempotency anchor),
  `type` (`text|image|video|audio|file|gif|sticker`), `text`, `reply_to`, `status`
  (`pending|syncing|sent|delivered|read|failed`), `edited_at`, `deleted_at` (soft delete),
  `server_received_at`.
- **`message_attachments`** — metadata only; binaries live in Supabase Storage
  (`storage_path`), plus GIF provider fields (`provider`, `provider_id`, `preview_url`, `gif_url`).
- **`message_reactions`** — unique `(message_id, user_id, emoji)`.
- **`calls`** — `conversation_id` (nullable), `caller_id`, `callee_id`, `call_type`
  (`voice|video`), `status` (`ringing|ongoing|ended|missed|rejected|cancelled`), `started_at`,
  `answered_at`, `ended_at`.
- **`call_participants`** — unique `(call_id, user_id)`, `role` (`caller|callee`), `joined_at`,
  `left_at`.
- **`devices`** — unique `(user_id, device_identifier)`, `platform`, `last_seen_at`.
- **`push_tokens`** — unique `(user_id, token)`, optional `device_id`, `provider` (default `expo`).
- **`sync_ops`** — unique `(user_id, idempotency_key)`; dedupes retried client operations.
- **`sync_changelog`** — `id bigserial` **is the sync cursor**, plus `user_id`, `entity_type`,
  `entity_id`, `operation`, `payload jsonb`. One row per user-visible change.

### Relationships

```
users ─┬─< conversation_members >─┬─ conversations ──< messages ──< message_attachments
       │                          │                     │  └─< message_reactions
       │                          └─ groups (1:1 conv)  └─ reply_to → messages.id
       ├─< calls (caller/callee) ──< call_participants
       ├─< devices ──< push_tokens
       └─< sync_ops / sync_changelog
```

All child rows cascade on delete; `messages.sender_id`, `conversations.created_by` and
`calls.conversation_id` use `on delete set null` so history survives user removal.

### Indexes

- `users`: unique lower-case username, created-at.
- `conversations`: `created_by`, `last_message_at desc`.
- `conversation_members`: `(user_id, conversation_id)`.
- `messages`: `(conversation_id, created_at desc)`, `sender_id`, `reply_to`, and the unique
  `client_message_id`.
- `message_attachments`: `message_id`. `message_reactions`: `message_id`.
- `calls`: `(callee_id, status, created_at desc)`, `(caller_id, created_at desc)`.
- `push_tokens`: `user_id`.
- `sync_ops`: `(user_id, idempotency_key)`. `sync_changelog`: `(user_id, id)` — the pull path.

## SQLite schema (device)

Migrations live in `api/database/sqlite/migrations/`:

| File | Tables |
| --- | --- |
| `001_create_users.sql` | `users` (local mirror, `is_me` flag) |
| `002_create_conversations.sql` | `conversations`, `conversation_members` |
| `003_create_messages.sql` | `messages` (adds `sync_error`) |
| `004_create_attachments.sql` | `message_attachments` (adds `local_uri`), `message_reactions` |
| `005_create_sync_queue.sql` | `sync_queue` |
| `006_create_sync_state.sql` | `sync_state` (`last_sync_cursor`, `last_full_sync_at`, `push_token`) |

Differences from PostgreSQL, all deliberate:

- Ids are `text` (UUID strings), timestamps are ISO-8601 `text`.
- Booleans are `integer` with `check (x in (0, 1))`.
- `message_attachments.local_uri` stores the on-device copy for optimistic rendering.
- `messages.sync_error` records why a local send failed.
- `sync_queue` holds outbound operations with `status` (`pending|in_flight|failed|done`),
  `retry_count`, `next_retry_at`, `error`.
- `sync_state.last_sync_cursor` mirrors the server `sync_changelog.id` high-water mark.

The shipped app currently applies an equivalent runtime subset through
`app/src/db/database.ts` (tables `app_kv`, `conversations`, `messages`, `message_attachments`,
`message_reactions`, `pending_ops`) using `PRAGMA user_version` migrations. The SQLite SQL files
remain the canonical device schema; keep the two in step when changing either.

## Migration process

Connection strings (Supabase dashboard → Project Settings → Database):

- `DATABASE_URL` — transaction-mode pooler (port `6543`, `?pgbouncer=true`). Used by the running API.
- `DIRECT_URL` — session-mode pooler (port `5432`). Used by migrations/seeds when present.

Passwords with literal special characters (`/`, `*`, `#`, `?`, `@`) work as-is: the app
(`api/src/db/connection.ts`) percent-encodes the credentials before handing the URL to
`postgres-js`, requires TLS for hosted Supabase, and disables prepared statements automatically for
the transaction pooler.

PostgreSQL:

```bash
npm run db:migrate   # applies every unapplied database/postgres/migrations/*.sql in order
npm run db:reset     # destructive: drop schema (run db:migrate afterwards for an empty DB)
npm run db:schema    # regenerate database/postgres/schema.sql (consolidated view)
```

- `scripts/db/migrate.ts` tracks applied files, so migrations are additive and re-runnable.
- **SQL is the single migration workflow.** Do not introduce a second, competing migration system;
  keep Drizzle's schema in sync instead of generating duplicate migrations.
- `api/database.sql` is the consolidated dump of all migrations for quick reference.

SQLite: migrations are embedded in the app and applied with `PRAGMA user_version` at first open
(`app/src/db/database.ts`). Bump the version and append a migration string to change the device
schema.
