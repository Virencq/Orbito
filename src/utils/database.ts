import Database from '@tauri-apps/plugin-sql'
import type { KiloMessage, MessagePart } from '../types'

let db: Database | null = null
let dbInitPromise: Promise<Database> | null = null

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  pi_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  parts TEXT NOT NULL DEFAULT '[]',
  info TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

export async function initDatabase(): Promise<Database> {
  if (db) return db
  if (dbInitPromise) return dbInitPromise

  dbInitPromise = (async () => {
    const connection = await Database.load('sqlite:snotra.db')
    await connection.execute(SCHEMA)
    const sessionColumns = await connection.select<{ name: string }[]>('PRAGMA table_info(sessions)')
    if (!sessionColumns.some((column) => column.name === 'pi_id')) {
      await connection.execute('ALTER TABLE sessions ADD COLUMN pi_id TEXT')
    }
    await connection.execute('PRAGMA journal_mode=WAL')
    db = connection
    return connection
  })()

  try {
    return await dbInitPromise
  } catch (error) {
    dbInitPromise = null
    throw error
  }
}

export async function getDatabase(): Promise<Database> {
  if (!db) return initDatabase()
  return db
}

// ---- Sessions ----

export interface SessionRow {
  id: string
  title: string
  model: string
  pi_id: string | null
  created_at: number
  updated_at: number
}

export async function getAllSessions(): Promise<SessionRow[]> {
  const d = await getDatabase()
  return d.select<SessionRow[]>('SELECT * FROM sessions ORDER BY updated_at DESC')
}

export async function getSession(id: string): Promise<SessionRow | null> {
  const d = await getDatabase()
  const rows = await d.select<SessionRow[]>('SELECT * FROM sessions WHERE id = ?', [id])
  return rows[0] || null
}

export async function createSession(
  id: string,
  title: string,
  model = '',
  piId?: string,
): Promise<void> {
  const d = await getDatabase()
  const now = Date.now()
  await d.execute(
    'INSERT INTO sessions (id, title, model, pi_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, title, model, piId || null, now, now]
  )
}

export async function updateSession(
  id: string,
  updates: Partial<Pick<SessionRow, 'title' | 'model' | 'pi_id'>>,
): Promise<void> {
  const d = await getDatabase()
  const sets: string[] = []
  const params: any[] = []
  if (updates.title !== undefined) { sets.push('title = ?'); params.push(updates.title) }
  if (updates.model !== undefined) { sets.push('model = ?'); params.push(updates.model) }
  if (updates.pi_id !== undefined) { sets.push('pi_id = ?'); params.push(updates.pi_id) }
  sets.push('updated_at = ?'); params.push(Date.now())
  params.push(id)
  await d.execute(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`, params)
}

export async function deleteSession(id: string): Promise<void> {
  const d = await getDatabase()
  await d.execute('DELETE FROM messages WHERE session_id = ?', [id])
  await d.execute('DELETE FROM sessions WHERE id = ?', [id])
}

// ---- Messages ----

export interface MessageRow {
  id: string
  session_id: string
  role: string
  parts: string
  info: string
  created_at: number
}

export async function getMessages(sessionId: string): Promise<KiloMessage[]> {
  const d = await getDatabase()
  const rows = await d.select<MessageRow[]>(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC',
    [sessionId]
  )
  return rows.map(row => ({
    info: { ...JSON.parse(row.info), id: row.id, sessionID: sessionId, role: row.role as 'user' | 'assistant' },
    parts: JSON.parse(row.parts) as MessagePart[],
  }))
}

export async function saveMessage(
  id: string,
  sessionId: string,
  role: string,
  parts: MessagePart[],
  info: Record<string, any> = {}
): Promise<void> {
  const d = await getDatabase()
  const now = Date.now()
  await d.execute(
    'INSERT INTO messages (id, session_id, role, parts, info, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET parts = excluded.parts, info = excluded.info',
    [id, sessionId, role, JSON.stringify(parts), JSON.stringify(info), now]
  )
}

export async function deleteMessage(id: string): Promise<void> {
  const d = await getDatabase()
  await d.execute('DELETE FROM messages WHERE id = ?', [id])
}

export async function deleteMessagesByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const d = await getDatabase()
  const placeholders = ids.map(() => '?').join(', ')
  await d.execute(`DELETE FROM messages WHERE id IN (${placeholders})`, ids)
}

// ---- Settings ----

export async function setSetting(key: string, value: string): Promise<void> {
  const d = await getDatabase()
  await d.execute(
    'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
    [key, value]
  )
}

