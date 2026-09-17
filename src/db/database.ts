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

const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS app_kv (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
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
);
CREATE TABLE IF NOT EXISTS messages (
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
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_client ON messages(client_message_id);
CREATE TABLE IF NOT EXISTS message_attachments (
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
);
CREATE INDEX IF NOT EXISTS idx_attachments_msg ON message_attachments(message_id);
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS pending_ops (
  op_id TEXT PRIMARY KEY NOT NULL,
  operation TEXT NOT NULL,
  client_message_id TEXT,
  conversation_id TEXT,
  payload TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_ops_created ON pending_ops(created_at);
`;

const MIGRATIONS: string[] = [MIGRATION_V1];

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;

  for (let i = version; i < MIGRATIONS.length; i += 1) {
    await db.execAsync(MIGRATIONS[i]!);
    version = i + 1;
    await db.execAsync(`PRAGMA user_version = ${version}`);
  }
}

export async function resetDatabase(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    DROP TABLE IF EXISTS message_reactions;
    DROP TABLE IF EXISTS message_attachments;
    DROP TABLE IF EXISTS messages;
    DROP TABLE IF EXISTS conversations;
    DROP TABLE IF EXISTS pending_ops;
    DROP TABLE IF EXISTS app_kv;
  `);
  dbPromise = null;
}

export function isDatabaseReady(): boolean {
  return dbPromise !== null;
}