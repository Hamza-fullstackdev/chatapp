# Chat App

A WhatsApp-style, offline-first chat application.

- **`api/`** — Express 5 + TypeScript + Socket.IO backend on Supabase PostgreSQL (Supabase Storage for media).
- **`app/`** — Expo SDK 57 / React Native mobile client with local SQLite, offline queue, WebRTC calls and push notifications.

There is no Next.js and no MongoDB. Redis is intentionally **not** used — presence and the Socket.IO hub are in-memory (`api/src/sockets/presence.ts`), which is fine for a single-node deployment.

## Feature set

| Area | Details |
| --- | --- |
| Auth | OTP-based login (dev OTP `1234`), register/login, JWT access + refresh tokens, refresh-on-401 in the client, logout, profile update, change password |
| Chat | 1:1 and group conversations, realtime delivery over Socket.IO, typing indicators, read receipts, presence |
| Messages | text, image, video, audio, file, GIF, sticker; replies, edits, soft deletes, emoji reactions |
| Groups | create groups, add/remove members, promote/demote admins, rename, description |
| Media | Supabase Storage via signed upload URLs (client PUTs directly), signed download URLs cached on device |
| Calls | voice/video WebRTC with socket relayed offer/answer/ICE, call history, missed/rejected/cancelled states |
| Notifications | Expo push tokens per device, push skipped for users with an active socket, tap-to-open routing |
| Offline | SQLite cache, pending-op queue, batch push, cursor-based pull, idempotent retries |

## Getting started

### 1. Backend (`api/`)

```bash
cd api
cp .env.example .env      # fill in Supabase + JWT values
npm install
npm run db:migrate        # apply database/postgres/migrations/*.sql
npm run dev               # http://localhost:5000
```

Useful scripts:

```bash
npm run db:migrate        # apply PostgreSQL migrations
npm run db:reset          # drop + recreate (empty) schema
npm run db:schema         # regenerate database/postgres/schema.sql from migrations
npm run storage:setup     # create the Supabase Storage bucket + policies
npm run typecheck         # tsc --noEmit
npm run lint              # eslint
npm run test              # vitest
```

### 2. Mobile app (`app/`)

```bash
cd app
cp .env.example .env      # set EXPO_PUBLIC_API_URL (use your LAN IP on a physical device)
npm install
npx expo start            # dev build recommended (WebRTC + notifications need native modules)
```

Verification commands:

```bash
npx tsc --noEmit
npm run lint
```

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — system layout, request flows, socket events, auth and push.
- [`docs/database.md`](docs/database.md) — PostgreSQL and SQLite schemas, relationships, indexes, migrations, seeds.
- [`docs/offline-sync.md`](docs/offline-sync.md) — local writes, queue, batching, retries, idempotency, cursors, conflicts.

## Environment variables

### API (`api/.env`)

| Variable | Purpose |
| --- | --- |
| `NODE_ENV`, `PORT` | runtime |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL` | Supabase project + server secret + JWKS verification |
| `DATABASE_URL` | Supabase PostgreSQL connection string |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL` | token signing |
| `EXPO_ACCESS_TOKEN` | optional Expo push auth |
| `TURN_SERVER_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL_SECRET` | optional TURN for calls (STUN-only by default) |
| `CORS_ORIGIN` | allowed origin |
| `REDIS_URL` | **reserved/unused** — presence is in-memory |

### App (`app/.env`)

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | backend base URL |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public Supabase values |

Never put server secrets in `app/.env` — everything there ships inside the bundle.
