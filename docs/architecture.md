# Architecture

## Overview

```
┌────────────────────────────┐        HTTPS / JSON         ┌───────────────────────────┐
│  Expo mobile app (app/)    │ ─────────────────────────▶ │  Express 5 API (api/)     │
│  React Native + expo-router│ ◀───────────────────────── │  Socket.IO + Drizzle      │
│                            │        WebSocket            │                           │
│  SQLite cache + queue      │                             │  Supabase PostgreSQL      │
│  SecureStore tokens        │                             │  Supabase Storage         │
└────────────────────────────┘                             └───────────────────────────┘
                                                                     │
                                                                     ▼
                                                          Expo push service (notifications)
```

The mobile app is the offline-first client: the UI **always renders from SQLite**, never from an
in-flight network response. The server is the permanent source of truth and broadcasts changes to
every connected member.

## Backend layout (`api/src`)

| Path | Responsibility |
| --- | --- |
| `index.ts` / `app.ts` | HTTP server bootstrap, Socket.IO attach, middleware wiring |
| `config/env.ts` | validated environment (zod) |
| `config/supabase.ts` | Supabase admin/storage clients |
| `db/client.ts` | `postgres` connection + raw SQL helper (`getSql`) |
| `db/schema.ts` | Drizzle schema kept in sync with `database/postgres` SQL |
| `middleware/` | JWT auth, error handling, 404 |
| `routes/` | Express routers: auth, users, conversations, messages, groups, uploads, calls, devices, stickers, sync, health |
| `services/` | business logic; routes stay thin; DTO shaping lives in `services/dto.ts` |
| `sockets/index.ts` | authenticated Socket.IO server, room joins, typing, read, call signaling relay |
| `sockets/hub.ts` | `emitToUser` / `emitToConversation` helpers |
| `sockets/presence.ts` | in-memory online/offline tracking (no Redis) |

### REST surface

| Route group | Highlights |
| --- | --- |
| `/api/auth` | `login` (username + password), `register`, `refresh`, `logout`, `me`, `updateMe`, `changePassword` |
| `/api/users` | list/search users |
| `/api/conversations` | list, detail (with messages), create private, mark read |
| `/api/messages` | send (with attachment passthrough), `PATCH` edit, `DELETE`, `POST/DELETE /reactions` |
| `/api/groups` | create, detail, update, add/remove members, promote/demote |
| `/api/uploads` | `POST /sign` (signed upload URL) and `POST /url` (signed download URL); no multipart uploads |
| `/api/calls` | create, update status (`accepted\|rejected\|ended\|cancelled\|missed`), history |
| `/api/devices` | register device, `POST/DELETE /push-token` |
| `/api/stickers` | sticker catalogue |
| `/api/sync` | `POST /pull` (cursor) and `POST /push` (batch operations) |

## Socket.IO events

Every connection authenticates with a JWT in the handshake (`auth.token` or `Authorization`).
The server joins each socket to `user:<id>` for targeted events and to
`conversation:<id>` after a verified `conversation:join`.

### Client → server

| Event | Payload | Notes |
| --- | --- | --- |
| `conversation:join` / `conversation:leave` | `{ conversationId }` | membership checked server-side |
| `typing:start` / `typing:stop` | `{ conversationId }` | broadcast to the conversation room |
| `message:read` | `{ conversationId, messageId }` | persists read state |
| `call:signal` | `{ to, callId, type: 'offer'\|'answer'\|'ice', data }` | relayed verbatim to `user:<to>`; never inspected |

### Server → client

| Event | Payload | Source |
| --- | --- | --- |
| `message:new`, `message:update`, `message:delete`, `message:reaction` | message/reaction payload | message service |
| `message:read` | `{ conversationId, messageId, userId, readAt }` | read receipt |
| `typing:update` | `{ conversationId, userId, isTyping }` | typing broadcast |
| `presence:update` | `{ userId, online, updatedAt }` | sent to conversation peers only |
| `conversation:update` | conversation payload | group/membership changes |
| `call:<status>` | call payload | `call:ongoing` / `call:rejected` / `call:cancelled` / `call:missed` / `call:ended` to the peer |
| `call:update` | call payload | conversation room, keeps history in sync |
| `call:signal` | `{ from, callId, type, data }` | WebRTC relay |

## Auth flow

1. `POST /api/auth/login` with a username and password. The password is bcrypt-verified against
   `password_hash`; the username is matched case-insensitively (unique lower-case index).
2. The API returns an access token (short TTL) and a refresh token (long TTL).
3. The app stores the refresh token and device id in **SecureStore** (`app/src/lib/secure.ts`);
   on web it falls back to `AsyncStorage`.
4. `app/src/lib/api-client.ts` attaches the access token, and on a `401` calls
   `POST /api/auth/refresh`, retries once, and invokes `onSessionExpired` if the refresh fails.
5. Socket and REST both authenticate with the same access token.

## Calls

- `POST /api/calls` creates a `ringing` call and pushes a notification with
  `kind: 'incoming-call'` to the callee when they have no active socket.
- Status transitions are accepted as `accepted | rejected | ended | cancelled | missed`; the
  serializer maps `accepted → ongoing`.
- WebRTC is peer-to-peer. The server only relays `call:signal` packets, so SDP/ICE never touches
  the database. STUN is Google's public STUN; configure TURN env vars for restrictive networks.
- The caller re-sends its offer on an interval until an `answer` arrives, which makes the handshake
  resilient to a callee that connects late.

## Push notifications

- `app/src/lib/notifications.ts` registers an Expo push token and `POST`s it to
  `/api/devices/push-token`; `signOut` deletes it.
- The server skips push when the target user has an active socket (`sendPushToUser`).
- Payloads embed `kind`, `callId` and `conversationId`, which `NotificationsBridge` and
  `use-notification-response.ts` use for tap navigation.
- `expo-notifications` needs an EAS `projectId`; registration fails gracefully when it is absent.

## Offline-first data flow

```
UI action ──▶ optimistic write to SQLite ──▶ enqueue op ──▶ UI updates immediately
                                                   │
                                     (connection available)
                                                   ▼
                              POST /api/sync/push (batch, idempotent)
                                                   │
                        server applies + appends changelog + emits sockets
                                                   ▼
                    POST /api/sync/pull(cursor) ──▶ apply changes to SQLite
```

Realtime socket events are also written straight into SQLite, so a foregrounded device stays
consistent without polling. See [`offline-sync.md`](offline-sync.md).
