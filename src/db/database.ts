import * as SQLite from 'expo-sqlite';

const DB_NAME = 'chat.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openDatabase();
  }
  return dbPromise;
}

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await migrate(db);
  return db;
}

// ---------------------------------------------------------------------------
// Canonical schema. Every statement is idempotent (IF NOT EXISTS) so it can be
// replayed safely on any migration path, including self-healing old databases.
// ---------------------------------------------------------------------------

const TABLE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS app_kv (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    other_user_id TEXT,
    other_user_name TEXT,
    other_user_avatar_url TEXT,
    last_message_id TEXT,
    last_message_type TEXT,
    last_message_text TEXT,
    last_message_sender_id TEXT,
    last_message_status TEXT,
    last_message_created_at TEXT,
    last_message_has_attachments INTEGER NOT NULL DEFAULT 0,
    unread_count INTEGER NOT NULL DEFAULT 0,
    last_read_message_id TEXT,
    updated_at TEXT,
    member_count INTEGER NOT NULL DEFAULT 0,
    is_group_admin INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY NOT NULL,
    client_message_id TEXT,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    text TEXT,
    reply_to TEXT,
    status TEXT NOT NULL DEFAULT 'sent',
    created_at TEXT NOT NULL,
    edited_at TEXT,
    deleted_at TEXT,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS message_attachments (
    id TEXT PRIMARY KEY NOT NULL,
    message_id TEXT NOT NULL,
    type TEXT NOT NULL,
    storage_path TEXT,
    mime_type TEXT,
    size INTEGER,
    width INTEGER,
    height INTEGER,
    duration_ms INTEGER,
    thumbnail_path TEXT,
    provider TEXT,
    provider_id TEXT,
    preview_url TEXT,
    gif_url TEXT,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS message_reactions (
    message_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji),
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS pending_ops (
    op_id TEXT PRIMARY KEY NOT NULL,
    operation TEXT NOT NULL,
    client_message_id TEXT,
    conversation_id TEXT,
    payload TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS media_cache (
    storage_key TEXT PRIMARY KEY NOT NULL,
    attachment_id TEXT NOT NULL,
    message_id TEXT,
    conversation_id TEXT,
    storage_path TEXT,
    mime_type TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    local_uri TEXT NOT NULL,
    downloaded_at TEXT NOT NULL,
    saved_to_photos INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS user_profiles (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT,
    username TEXT,
    email TEXT,
    phone TEXT,
    bio TEXT,
    avatar_url TEXT,
    last_seen_at TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT,
    username TEXT,
    avatar_url TEXT,
    role TEXT,
    last_seen_at TEXT,
    PRIMARY KEY (conversation_id, user_id),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY NOT NULL,
    conversation_id TEXT,
    caller_id TEXT NOT NULL,
    callee_id TEXT NOT NULL,
    call_type TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT,
    answered_at TEXT,
    ended_at TEXT,
    created_at TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    peer_name TEXT,
    peer_avatar_url TEXT,
    is_outgoing INTEGER NOT NULL DEFAULT 0
  )`,
];

type IndexDef = { name: string; table: string; columns: string[] };

const INDEX_DEFS: IndexDef[] = [
  { name: 'idx_messages_conv', table: 'messages', columns: ['conversation_id', 'created_at DESC'] },
  { name: 'idx_messages_client', table: 'messages', columns: ['client_message_id'] },
  { name: 'idx_attachments_msg', table: 'message_attachments', columns: ['message_id'] },
  { name: 'idx_pending_ops_created', table: 'pending_ops', columns: ['created_at'] },
  { name: 'idx_media_cache_msg', table: 'media_cache', columns: ['message_id'] },
  { name: 'idx_media_cache_attachment', table: 'media_cache', columns: ['attachment_id'] },
  { name: 'idx_calls_created', table: 'calls', columns: ['created_at DESC'] },
  { name: 'idx_conv_members_conv', table: 'conversation_members', columns: ['conversation_id'] },
  { name: 'idx_user_profiles_name', table: 'user_profiles', columns: ['name'] },
];

const INDEX_DDL: string[] = INDEX_DEFS.map(
  (i) => `CREATE INDEX IF NOT EXISTS ${i.name} ON ${i.table}(${i.columns.join(', ')})`,
);

/**
 * Create the app's indexes, skipping any whose table is missing a referenced
 * column. Older dev builds shipped a `media_cache` table without `message_id`;
 * blindly running `CREATE INDEX ... ON media_cache(message_id)` crashes SQLite
 * with "no such column". Column-aware creation keeps startup self-healing.
 */
async function createIndexes(db: SQLite.SQLiteDatabase): Promise<void> {
  for (const idx of INDEX_DEFS) {
    const cols = await tableColumns(db, idx.table);
    const base = idx.columns.map((c) => c.split(' ')[0]);
    if (base.every((c) => cols.has(c.toLowerCase()))) {
      await db.execAsync(`CREATE INDEX IF NOT EXISTS ${idx.name} ON ${idx.table}(${idx.columns.join(', ')})`);
    }
  }
}

const MIGRATION_V1 = `${TABLE_DDL.join(';\n')};\n${INDEX_DDL.join(';\n')};`;

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

type MigrationStep = string | ((db: SQLite.SQLiteDatabase) => Promise<void>);

async function tableColumns(db: SQLite.SQLiteDatabase, table: string): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((r) => r.name.toLowerCase()));
}

async function ensureColumns(
  db: SQLite.SQLiteDatabase,
  table: string,
  columns: [name: string, ddl: string][],
): Promise<void> {
  const existing = await tableColumns(db, table);
  for (const [name, ddl] of columns) {
    if (!existing.has(name.toLowerCase())) {
      await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
    }
  }
}

/**
 * Migration 2 — self-healing.
 *
 * Older builds shipped a leaner schema but already persisted `user_version = 1`,
 * so `CREATE TABLE IF NOT EXISTS` alone never added the missing columns and
 * every query referencing them failed with "no such column". Reconciles the
 * local schema with the canonical one above. Every step is a no-op on a schema
 * that is already up to date.
 */
async function migrationV2(db: SQLite.SQLiteDatabase): Promise<void> {
  for (const ddl of TABLE_DDL) await db.execAsync(ddl);

  await ensureColumns(db, 'conversations', [
    ['name', 'TEXT'],
    ['avatar_url', 'TEXT'],
    ['other_user_id', 'TEXT'],
    ['other_user_name', 'TEXT'],
    ['other_user_avatar_url', 'TEXT'],
    ['last_message_id', 'TEXT'],
    ['last_message_type', 'TEXT'],
    ['last_message_text', 'TEXT'],
    ['last_message_sender_id', 'TEXT'],
    ['last_message_created_at', 'TEXT'],
    ['unread_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['updated_at', 'TEXT'],
    ['last_message_has_attachments', 'INTEGER NOT NULL DEFAULT 0'],
    ['member_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['is_group_admin', 'INTEGER NOT NULL DEFAULT 0'],
  ]);
  await ensureColumns(db, 'messages', [
    ['client_message_id', 'TEXT'],
    ["type", "TEXT NOT NULL DEFAULT 'text'"],
    ['text', 'TEXT'],
    ['reply_to', 'TEXT'],
    ["status", "TEXT NOT NULL DEFAULT 'sent'"],
    ['edited_at', 'TEXT'],
    ['deleted_at', 'TEXT'],
    ['has_attachments', 'INTEGER NOT NULL DEFAULT 0'],
  ]);
  await ensureColumns(db, 'message_attachments', [
    ['storage_path', 'TEXT'],
    ['mime_type', 'TEXT'],
    ['size', 'INTEGER'],
    ['width', 'INTEGER'],
    ['height', 'INTEGER'],
    ['duration_ms', 'INTEGER'],
    ['thumbnail_path', 'TEXT'],
    ['provider', 'TEXT'],
    ['provider_id', 'TEXT'],
    ['preview_url', 'TEXT'],
    ['gif_url', 'TEXT'],
  ]);

  await createIndexes(db);
}

async function migrationV3(db: SQLite.SQLiteDatabase): Promise<void> {
  await ensureColumns(db, 'conversations', [
    ['last_message_status', 'TEXT'],
  ]);
}

async function migrationV4(db: SQLite.SQLiteDatabase): Promise<void> {
  for (const ddl of TABLE_DDL) await db.execAsync(ddl);
  await createIndexes(db);
}

function tableNameOf(ddl: string): string {
  const m = /CREATE TABLE IF NOT EXISTS (\w+)/.exec(ddl);
  return m?.[1] ?? '';
}

function canonicalColumnsOf(ddl: string): string[] {
  const open = ddl.indexOf('(');
  const close = ddl.lastIndexOf(')');
  const body = open >= 0 && close > open ? ddl.slice(open + 1, close) : '';
  const cols: string[] = [];
  const skip = new Set(['primary', 'foreign', 'unique', 'constraint', 'check']);
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const token = trimmed.split(/\s+/)[0].replace(/,/g, '').toLowerCase();
    if (!token || skip.has(token)) continue;
    cols.push(token);
  }
  return cols;
}

/**
 * Repair the schema: any table whose live column set doesn't match the
 * canonical DDL is dropped and recreated. Dev builds drifted across many
 * iterations (a `media_cache` without `message_id`, `conversations` lacking
 * `member_count`/`is_group_admin`, `messages` lacking `client_message_id`, …),
 * which made index creation AND upserts fail with "no such column" /
 * compile (prepareSync) errors. These are server-backed caches, so dropping
 * them is safe — they repopulate on the next sync.
 */
async function repairSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = OFF;');
  try {
    for (const ddl of TABLE_DDL) {
      const table = tableNameOf(ddl);
      const canonical = canonicalColumnsOf(ddl);
      if (!table || canonical.length === 0) continue;
      const cols = await tableColumns(db, table);
      if (cols.size > 0 && !canonical.every((c) => cols.has(c))) {
        await db.execAsync(`DROP TABLE IF EXISTS ${table}`);
      }
    }
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON;');
  }
}

async function migrationV5(db: SQLite.SQLiteDatabase): Promise<void> {
  await repairSchema(db);
  for (const ddl of TABLE_DDL) await db.execAsync(ddl);
  await ensureColumns(db, 'user_profiles', [
    ['email', 'TEXT'],
    ['phone', 'TEXT'],
    ['bio', 'TEXT'],
  ]);
  await createIndexes(db);
}

async function migrationV6(db: SQLite.SQLiteDatabase): Promise<void> {
  // Full-coverage re-heal for databases that already reached V5 before the
  // repair covered every table (conversations/messages/attachments could still
  // be missing newer columns, surfacing as prepareSync rejections on chat).
  await repairSchema(db);
  for (const ddl of TABLE_DDL) await db.execAsync(ddl);
  await createIndexes(db);
}

/**
 * Migration 7 — local read markers.
 *
 * The unread badge was previously a *counter* incremented by every applied
 * message while separate delivery paths (socket sink + pull changelog, plus
 * the insert/delivered changelog pairs the server writes per message) could
 * all touch it — a single duplicate application doubled the badge (4 sent,
 * "8 incoming"). unread_count is now derived from the messages table against
 * a per-conversation last-read marker, so reapplying a message is idempotent.
 */
async function migrationV7(db: SQLite.SQLiteDatabase): Promise<void> {
  await ensureColumns(db, 'conversations', [
    ['last_read_message_id', 'TEXT'],
  ]);
}

/**
 * Migration 8 — "saved to Photos" flag on media cache entries.
 *
 * The manual Download button now persists viewable media into the device
 * photo library (WhatsApp-style). `saved_to_photos` records that export so
 * the chip disappears only once the file really lives in the gallery, and is
 * never asked about again.
 */
async function migrationV8(db: SQLite.SQLiteDatabase): Promise<void> {
  await ensureColumns(db, 'media_cache', [
    ['saved_to_photos', 'INTEGER NOT NULL DEFAULT 0'],
  ]);
}

const MIGRATIONS: MigrationStep[] = [
  MIGRATION_V1,
  migrationV2,
  migrationV3,
  migrationV4,
  migrationV5,
  migrationV6,
  migrationV7,
  migrationV8,
];

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;

  for (let i = version; i < MIGRATIONS.length; i += 1) {
    const step = MIGRATIONS[i];
    if (typeof step === 'function') {
      await step(db);
    } else {
      await db.execAsync(step);
    }
    version = i + 1;
    await db.execAsync(`PRAGMA user_version = ${version}`);
  }
}

const DROP_ALL_TABLES = `
  DROP TABLE IF EXISTS message_reactions;
  DROP TABLE IF EXISTS message_attachments;
  DROP TABLE IF EXISTS messages;
  DROP TABLE IF EXISTS conversation_members;
  DROP TABLE IF EXISTS conversations;
  DROP TABLE IF EXISTS pending_ops;
  DROP TABLE IF EXISTS media_cache;
  DROP TABLE IF EXISTS user_profiles;
  DROP TABLE IF EXISTS calls;
  DROP TABLE IF EXISTS app_kv;
`;

export async function resetDatabase(): Promise<void> {
  const db = await getDb();
  await db.execAsync('PRAGMA foreign_keys = OFF;');
  await db.execAsync(DROP_ALL_TABLES);
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync('PRAGMA user_version = 0;');
  dbPromise = null;
}

/**
 * Fully wipes the on-device database: drops every table, closes the shared
 * connection, and deletes the database FILE. Deleting the file guarantees that
 * in-flight async writers holding the previous connection can never repopulate
 * a just-wiped DB with another account's data. Called when the account is
 * deleted or when a different user signs in on this device.
 */
export async function purgeDatabase(): Promise<void> {
  const existing = dbPromise;
  dbPromise = null;
  if (existing) {
    try {
      const db = await existing;
      await db.execAsync('PRAGMA foreign_keys = OFF;');
      await db.execAsync(DROP_ALL_TABLES);
      await db.execAsync('PRAGMA foreign_keys = ON;');
      await db.execAsync('PRAGMA user_version = 0;');
      await db.closeAsync().catch(() => undefined);
    } catch {
      // best effort — file deletion below still clears most datastores
    }
  }
  try {
    await SQLite.deleteDatabaseAsync(DB_NAME);
  } catch {
    // best effort
  }
}

export function isDatabaseReady(): boolean {
  return dbPromise !== null;
}