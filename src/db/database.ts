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
    last_message_created_at TEXT,
    last_message_has_attachments INTEGER NOT NULL DEFAULT 0,
    unread_count INTEGER NOT NULL DEFAULT 0,
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
];

const INDEX_DDL: string[] = [
  'CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_messages_client ON messages(client_message_id)',
  'CREATE INDEX IF NOT EXISTS idx_attachments_msg ON message_attachments(message_id)',
  'CREATE INDEX IF NOT EXISTS idx_pending_ops_created ON pending_ops(created_at)',
];

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

  for (const ddl of INDEX_DDL) await db.execAsync(ddl);
}

const MIGRATIONS: MigrationStep[] = [MIGRATION_V1, migrationV2];

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

export async function resetDatabase(): Promise<void> {
  const db = await getDb();
  await db.execAsync('PRAGMA foreign_keys = OFF;');
  await db.execAsync(`
    DROP TABLE IF EXISTS message_reactions;
    DROP TABLE IF EXISTS message_attachments;
    DROP TABLE IF EXISTS messages;
    DROP TABLE IF EXISTS conversations;
    DROP TABLE IF EXISTS pending_ops;
    DROP TABLE IF EXISTS app_kv;
  `);
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync('PRAGMA user_version = 0;');
  dbPromise = null;
}

export function isDatabaseReady(): boolean {
  return dbPromise !== null;
}