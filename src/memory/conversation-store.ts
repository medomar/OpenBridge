import type Database from 'better-sqlite3';
import type { ConversationEntry } from './index.js';
import type { AgentRunner } from '../core/agent-runner.js';
import { sanitizeFts5Query } from './retrieval.js';

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
    INSERT INTO conversations (session_id, role, content, channel, user_id, created_at, title)
    VALUES (@session_id, @role, @content, @channel, @user_id, @created_at, @title)
  `);

  const insertFts = db.prepare(`
    INSERT INTO conversations_fts (rowid, content)
    VALUES (?, ?)
  `);

  const countUserMessages = db.prepare(
    `SELECT COUNT(*) AS c FROM conversations WHERE session_id = ? AND role = 'user'`,
  );

  db.transaction(() => {
    // Set title on the first user message of a session (truncated to 50 chars)
    let title: string | null = null;
    if (msg.role === 'user') {
      const { c } = countUserMessages.get(msg.session_id) as { c: number };
      if (c === 0) {
        title = msg.content.slice(0, 50);
      }
    }

    const result = insertConv.run({
      session_id: msg.session_id,
      role: msg.role,
      content: msg.content,
      channel: msg.channel ?? null,
      user_id: msg.user_id ?? null,
      created_at: createdAt,
      title,
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

  const sanitized = sanitizeFts5Query(query);
  if (!sanitized) return [];

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
    .all(sanitized, limit) as ConversationRow[];

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

// ---------------------------------------------------------------------------
// Session listing
// ---------------------------------------------------------------------------

/** Aggregated summary of a single conversation session. */
export interface SessionSummary {
  session_id: string;
  /** Session title — populated once the `title` column is added via migration (OB-1031). Null until then. */
  title: string | null;
  first_message_at: string;
  last_message_at: string;
  message_count: number;
  channel: string | null;
  user_id: string | null;
}

/**
 * Return a paginated list of distinct conversation sessions ordered by most recent activity.
 * Groups all messages by `session_id` and aggregates metadata.
 */
export function listSessions(db: Database.Database, limit = 20, offset = 0): SessionSummary[] {
  interface SessionRow {
    session_id: string;
    title: string | null;
    first_message_at: string;
    last_message_at: string;
    message_count: number;
    channel: string | null;
    user_id: string | null;
  }

  const rows = db
    .prepare(
      `SELECT
         session_id,
         MAX(title)      AS title,
         MIN(created_at) AS first_message_at,
         MAX(created_at) AS last_message_at,
         COUNT(*)        AS message_count,
         MAX(channel)    AS channel,
         MAX(user_id)    AS user_id
       FROM conversations
       GROUP BY session_id
       ORDER BY last_message_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as SessionRow[];

  return rows.map((r) => ({
    session_id: r.session_id,
    title: r.title,
    first_message_at: r.first_message_at,
    last_message_at: r.last_message_at,
    message_count: r.message_count,
    channel: r.channel,
    user_id: r.user_id,
  }));
}

/**
 * FTS5 search over conversations returning session-level results grouped by `session_id`.
 * Sessions are ranked by the number of matching messages (most relevant first),
 * then by most-recent activity. Returns up to `limit` sessions (default 10).
 */
export function searchSessions(db: Database.Database, query: string, limit = 10): SessionSummary[] {
  if (!query.trim()) return [];

  const sanitized = sanitizeFts5Query(query);
  if (!sanitized) return [];

  interface SessionSearchRow {
    session_id: string;
    title: string | null;
    first_message_at: string;
    last_message_at: string;
    message_count: number;
    channel: string | null;
    user_id: string | null;
  }

  const rows = db
    .prepare(
      `SELECT
         matched.session_id,
         all_msgs.title,
         all_msgs.first_message_at,
         all_msgs.last_message_at,
         all_msgs.message_count,
         all_msgs.channel,
         all_msgs.user_id
       FROM (
         SELECT c.session_id, COUNT(*) AS match_count
         FROM conversations c
         INNER JOIN (
           SELECT rowid FROM conversations_fts WHERE conversations_fts MATCH ?
         ) fts ON c.id = fts.rowid
         GROUP BY c.session_id
       ) matched
       INNER JOIN (
         SELECT
           session_id,
           MAX(title)      AS title,
           MIN(created_at) AS first_message_at,
           MAX(created_at) AS last_message_at,
           COUNT(*)        AS message_count,
           MAX(channel)    AS channel,
           MAX(user_id)    AS user_id
         FROM conversations
         GROUP BY session_id
       ) all_msgs ON matched.session_id = all_msgs.session_id
       ORDER BY matched.match_count DESC, all_msgs.last_message_at DESC
       LIMIT ?`,
    )
    .all(sanitized, limit) as SessionSearchRow[];

  return rows.map((r) => ({
    session_id: r.session_id,
    title: r.title,
    first_message_at: r.first_message_at,
    last_message_at: r.last_message_at,
    message_count: r.message_count,
    channel: r.channel,
    user_id: r.user_id,
  }));
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

// ---------------------------------------------------------------------------
// Tiered eviction with AI summarization (OB-736)
// ---------------------------------------------------------------------------

/** Options for the tiered conversation eviction policy. */
export interface ConversationEvictionOptions {
  /** Conversations newer than this many days are kept untouched (default: 30). */
  recentDays?: number;
  /** Conversations between recentDays and summarizeDays are AI-summarized then deleted (default: 90). */
  summarizeDays?: number;
  /**
   * Conversations older than this are deleted except those in sessions linked to a completed
   * task; beyond this boundary everything is deleted unconditionally (default: 365).
   */
  extendedRetentionDays?: number;
  /** Optional AgentRunner for AI-powered one-paragraph summarization. */
  agentRunner?: AgentRunner;
  /** Working directory for the AI summarizer (defaults to process.cwd()). */
  workspacePath?: string;
}

/** Build a simple text-only summary when no AI is available. */
function buildTextSummary(
  rows: { role: string; content: string; created_at: string }[],
  sessionId: string,
): string {
  const first = rows[0]?.created_at ?? '';
  const last = rows[rows.length - 1]?.created_at ?? '';
  const userCount = rows.filter((r) => r.role === 'user').length;
  const assistantCount = rows.filter((r) => r.role === 'master' || r.role === 'worker').length;
  return (
    `[Auto-summary of session ${sessionId}: ` +
    `${rows.length} messages (${userCount} user, ${assistantCount} assistant) ` +
    `from ${first} to ${last}. Content archived during eviction.]`
  );
}

/** Spawn a haiku agent to generate a one-paragraph summary; falls back to text summary on error. */
async function generateAISummary(
  rows: { role: string; content: string; created_at: string }[],
  sessionId: string,
  agentRunner: AgentRunner,
  workspacePath: string,
): Promise<string> {
  const formatted = rows
    .map((r) => `[${r.created_at}] ${r.role}: ${r.content.slice(0, 400)}`)
    .join('\n');

  const prompt =
    `Summarize the following conversation in one paragraph. ` +
    `Focus on what was discussed, decisions made, and key outcomes.\n\n` +
    `${formatted}\n\n` +
    `Provide ONLY the one-paragraph summary with no extra commentary:`;

  try {
    const result = await agentRunner.spawn({
      prompt,
      workspacePath,
      model: 'haiku',
      maxTurns: 1,
      timeout: 15_000,
      retries: 0,
    });

    if (result.exitCode === 0 && result.stdout.trim()) {
      const dateRange = `${rows[0]?.created_at ?? ''} to ${rows[rows.length - 1]?.created_at ?? ''}`;
      return `[Session summary (${rows.length} messages, ${dateRange})]\n${result.stdout.trim()}`;
    }
  } catch {
    // Fall through to text summary
  }

  return buildTextSummary(rows, sessionId);
}

/** Summarize all messages for one session in [from, to) then delete the originals. */
async function summarizeAndDeleteSession(
  db: Database.Database,
  sessionId: string,
  from: string,
  to: string,
  agentRunner: AgentRunner | undefined,
  workspacePath: string,
): Promise<void> {
  interface MsgRow {
    id: number;
    role: string;
    content: string;
    created_at: string;
  }

  const rows = db
    .prepare(
      `SELECT id, role, content, created_at
       FROM conversations
       WHERE session_id = ? AND created_at >= ? AND created_at < ?
         AND role != 'system'
       ORDER BY created_at ASC`,
    )
    .all(sessionId, from, to) as MsgRow[];

  if (rows.length === 0) return;

  const summary = agentRunner
    ? await generateAISummary(rows, sessionId, agentRunner, workspacePath)
    : buildTextSummary(rows, sessionId);

  // Atomically save the summary row and remove the originals
  db.transaction(() => {
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `INSERT INTO conversations (session_id, role, content, channel, user_id, created_at)
         VALUES (?, 'system', ?, NULL, NULL, ?)`,
      )
      .run(sessionId, summary, now);

    db.prepare('INSERT INTO conversations_fts (rowid, content) VALUES (?, ?)').run(
      result.lastInsertRowid,
      summary,
    );

    for (const { id } of rows) {
      db.prepare('DELETE FROM conversations_fts WHERE rowid = ?').run(id);
    }

    db.prepare(
      `DELETE FROM conversations
       WHERE session_id = ? AND created_at >= ? AND created_at < ? AND role != 'system'`,
    ).run(sessionId, from, to);
  })();
}

/**
 * Tiered conversation eviction:
 *
 * - Zone 1 — 0 to recentDays (default 30): keep full history, no action.
 * - Zone 2 — recentDays to summarizeDays (default 30–90): AI-summarize each session_id group
 *   into a single 'system' row, then delete the originals.
 * - Zone 3 — summarizeDays to extendedRetentionDays (default 90–365): delete all except rows
 *   whose session_id matches a completed task id in the tasks table.
 * - Zone 4 — Beyond extendedRetentionDays (default 365+): delete everything.
 */
export async function evictConversations(
  db: Database.Database,
  options: ConversationEvictionOptions = {},
): Promise<void> {
  const {
    recentDays = 30,
    summarizeDays = 90,
    extendedRetentionDays = 365,
    agentRunner,
    workspacePath = process.cwd(),
  } = options;

  const now = new Date();
  function offset(days: number): string {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d.toISOString();
  }

  const recentCutoff = offset(recentDays);
  const summarizeCutoff = offset(summarizeDays);
  const extendedCutoff = offset(extendedRetentionDays);

  // Zone 4: beyond extendedRetentionDays — delete everything
  deleteOldConversations(db, new Date(extendedCutoff));

  // Zone 3: summarizeDays–extendedRetentionDays — delete except sessions linked to
  // completed tasks (matched by session_id = task.id)
  {
    const ids = db
      .prepare(
        `SELECT id FROM conversations
         WHERE created_at >= ? AND created_at < ?
           AND session_id NOT IN (
             SELECT id FROM tasks WHERE status = 'completed'
           )`,
      )
      .all(extendedCutoff, summarizeCutoff) as { id: number }[];

    if (ids.length > 0) {
      db.transaction(() => {
        for (const { id } of ids) {
          db.prepare('DELETE FROM conversations_fts WHERE rowid = ?').run(id);
        }
        db.prepare(
          `DELETE FROM conversations
           WHERE created_at >= ? AND created_at < ?
             AND session_id NOT IN (
               SELECT id FROM tasks WHERE status = 'completed'
             )`,
        ).run(extendedCutoff, summarizeCutoff);
      })();
    }
  }

  // Zone 2: recentDays–summarizeDays — summarize each session then delete originals
  {
    const sessions = db
      .prepare(
        `SELECT DISTINCT session_id FROM conversations
         WHERE created_at >= ? AND created_at < ?
           AND role != 'system'`,
      )
      .all(summarizeCutoff, recentCutoff) as { session_id: string }[];

    for (const { session_id } of sessions) {
      await summarizeAndDeleteSession(
        db,
        session_id,
        summarizeCutoff,
        recentCutoff,
        agentRunner,
        workspacePath,
      );
    }
  }

  // Zone 1: 0–recentDays — keep untouched (no action)
}
