import type Database from 'better-sqlite3';
import type { ConversationEntry } from './index.js';

// ---------------------------------------------------------------------------
// Raw row shape returned by better-sqlite3
// ---------------------------------------------------------------------------

interface ConversationRow {
  id: number;
  session_id: string;
  role: ConversationEntry['role'];
  content: string;
  channel: string | null;
  user_id: string | null;
  created_at: string;
}

function rowToEntry(row: ConversationRow): ConversationEntry {
  return {
    id: row.id,
    session_id: row.session_id,
    role: row.role,
    content: row.content,
    channel: row.channel ?? undefined,
    user_id: row.user_id ?? undefined,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Insert a message into `conversations` and keep `conversations_fts` in sync.
 * Runs inside a single transaction.
 */
export function recordMessage(db: Database.Database, msg: ConversationEntry): void {
  const now = new Date().toISOString();
  const createdAt = msg.created_at ?? now;

  const insertConv = db.prepare(`
    INSERT INTO conversations (session_id, role, content, channel, user_id, created_at)
    VALUES (@session_id, @role, @content, @channel, @user_id, @created_at)
  `);

  const insertFts = db.prepare(`
    INSERT INTO conversations_fts (rowid, content)
    VALUES (?, ?)
  `);

  db.transaction(() => {
    const result = insertConv.run({
      session_id: msg.session_id,
      role: msg.role,
      content: msg.content,
      channel: msg.channel ?? null,
      user_id: msg.user_id ?? null,
      created_at: createdAt,
    });
    insertFts.run(result.lastInsertRowid, msg.content);
  })();
}

/**
 * Full-text search over conversations using `conversations_fts`.
 * Returns up to `limit` matching entries ordered by relevance (most recent first).
 */
export function findRelevantHistory(
  db: Database.Database,
  query: string,
  limit = 10,
): ConversationEntry[] {
  if (!query.trim()) return [];

  const rows = db
    .prepare(
      `SELECT c.id, c.session_id, c.role, c.content, c.channel, c.user_id, c.created_at
       FROM conversations c
       WHERE c.id IN (
         SELECT rowid FROM conversations_fts WHERE conversations_fts MATCH ?
       )
       ORDER BY c.created_at DESC
       LIMIT ?`,
    )
    .all(query, limit) as ConversationRow[];

  return rows.map(rowToEntry);
}

/**
 * Return the most recent `limit` messages for a given session, ordered oldest first.
 */
export function getSessionHistory(
  db: Database.Database,
  sessionId: string,
  limit = 50,
): ConversationEntry[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, role, content, channel, user_id, created_at
       FROM conversations
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(sessionId, limit) as ConversationRow[];

  // Return in chronological order (oldest → newest)
  return rows.reverse().map(rowToEntry);
}

/**
 * Delete all conversations created before `cutoffDate` and their FTS5 entries.
 * Runs inside a transaction so both tables stay in sync.
 */
export function deleteOldConversations(db: Database.Database, cutoffDate: Date): void {
  const cutoff = cutoffDate.toISOString();

  const oldIds = db.prepare('SELECT id FROM conversations WHERE created_at < ?').all(cutoff) as {
    id: number;
  }[];

  if (oldIds.length === 0) return;

  db.transaction(() => {
    for (const { id } of oldIds) {
      db.prepare('DELETE FROM conversations_fts WHERE rowid = ?').run(id);
    }
    db.prepare('DELETE FROM conversations WHERE created_at < ?').run(cutoff);
  })();
}
