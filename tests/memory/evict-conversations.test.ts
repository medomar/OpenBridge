/**
 * Tests for tiered conversation eviction (OB-736 / OB-737)
 *
 * evictConversations() has four zones:
 * - Zone 1 (< recentDays, default 30):          keep untouched
 * - Zone 2 (recentDays–summarizeDays, 30–90):   AI-summarize then delete originals
 * - Zone 3 (summarizeDays–extendedDays, 90–365): delete except task-linked sessions
 * - Zone 4 (> extendedDays, 365+):              delete everything
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import { recordMessage, evictConversations } from '../../src/memory/conversation-store.js';
import type { AgentRunner } from '../../src/core/agent-runner.js';
import type { ConversationEntry } from '../../src/memory/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function makeMsg(overrides: Partial<ConversationEntry> = {}): ConversationEntry {
  return {
    session_id: 'sess-default',
    role: 'user',
    content: 'some message content',
    ...overrides,
  };
}

function countConversations(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM conversations').get() as { c: number }).c;
}

function makeMockAgentRunner(summaryText = 'Summary of conversation.'): AgentRunner {
  return {
    spawn: async () => ({
      stdout: summaryText,
      stderr: '',
      exitCode: 0,
      durationMs: 10,
      retryCount: 0,
    }),
  } as unknown as AgentRunner;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('evictConversations (tiered policy)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  // -------------------------------------------------------------------------
  // Zone 1 — keep recent messages untouched
  // -------------------------------------------------------------------------

  describe('Zone 1 — recent messages are untouched', () => {
    it('keeps messages newer than recentDays', async () => {
      recordMessage(db, makeMsg({ content: 'fresh message', created_at: daysAgo(5) }));
      await evictConversations(db, { recentDays: 30 });
      expect(countConversations(db)).toBe(1);
    });

    it('keeps messages exactly at the recent boundary', async () => {
      recordMessage(db, makeMsg({ content: 'boundary message', created_at: daysAgo(29) }));
      await evictConversations(db, { recentDays: 30 });
      expect(countConversations(db)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Zone 4 — very old messages deleted unconditionally
  // -------------------------------------------------------------------------

  describe('Zone 4 — messages older than extendedRetentionDays are deleted', () => {
    it('deletes messages beyond the extended retention period', async () => {
      recordMessage(db, makeMsg({ content: 'ancient message', created_at: daysAgo(400) }));
      await evictConversations(db, { extendedRetentionDays: 365 });
      expect(countConversations(db)).toBe(0);
    });

    it('removes FTS5 entries when deleting beyond extended retention', async () => {
      recordMessage(db, makeMsg({ content: 'fts old message', created_at: daysAgo(400) }));
      await evictConversations(db, { extendedRetentionDays: 365 });
      const fts = db.prepare("SELECT * FROM conversations_fts WHERE content MATCH 'fts'").all();
      expect(fts).toHaveLength(0);
    });

    it('keeps task-linked messages just inside the extended retention boundary', async () => {
      // Insert a completed task whose id matches the session_id so Zone 3 preserves it
      db.prepare(
        `INSERT INTO tasks (id, type, status, created_at, completed_at)
         VALUES ('boundary-task', 'worker', 'completed', ?, ?)`,
      ).run(daysAgo(300), daysAgo(300));
      recordMessage(
        db,
        makeMsg({
          session_id: 'boundary-task',
          content: 'just inside',
          created_at: daysAgo(300),
        }),
      );
      await evictConversations(db, { extendedRetentionDays: 365 });
      expect(countConversations(db)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Zone 3 — delete except task-linked sessions
  // -------------------------------------------------------------------------

  describe('Zone 3 — delete non-task-linked sessions between summarizeDays and extendedDays', () => {
    it('deletes sessions not linked to completed tasks', async () => {
      recordMessage(
        db,
        makeMsg({
          session_id: 'orphan-session',
          content: 'orphan message',
          created_at: daysAgo(120),
        }),
      );
      await evictConversations(db, { summarizeDays: 90, extendedRetentionDays: 365 });
      const remaining = db.prepare('SELECT session_id FROM conversations').all() as {
        session_id: string;
      }[];
      expect(remaining.every((r) => r.session_id !== 'orphan-session')).toBe(true);
    });

    it('preserves sessions linked to completed tasks', async () => {
      // Insert a completed task whose id matches the session_id
      db.prepare(
        `INSERT INTO tasks (id, type, status, created_at, completed_at)
         VALUES ('linked-session', 'worker', 'completed', ?, ?)`,
      ).run(daysAgo(120), daysAgo(120));

      recordMessage(
        db,
        makeMsg({
          session_id: 'linked-session',
          content: 'linked message',
          created_at: daysAgo(120),
        }),
      );
      await evictConversations(db, { summarizeDays: 90, extendedRetentionDays: 365 });

      const remaining = db.prepare('SELECT session_id FROM conversations').all() as {
        session_id: string;
      }[];
      expect(remaining.some((r) => r.session_id === 'linked-session')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Zone 2 — summarize-and-delete
  // -------------------------------------------------------------------------

  describe('Zone 2 — messages in summarization window', () => {
    it('removes original messages after summarization (text fallback)', async () => {
      recordMessage(
        db,
        makeMsg({
          session_id: 'zone2-sess',
          content: 'message to summarize',
          created_at: daysAgo(60),
        }),
      );
      await evictConversations(db, { recentDays: 30, summarizeDays: 90 });

      // Original message deleted, replaced by summary
      const rows = db
        .prepare("SELECT role, content FROM conversations WHERE session_id = 'zone2-sess'")
        .all() as { role: string; content: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].role).toBe('system');
    });

    it('summary row is a system message containing session info', async () => {
      recordMessage(
        db,
        makeMsg({
          session_id: 'sum-sess',
          content: 'user question about the project',
          created_at: daysAgo(60),
        }),
      );
      recordMessage(
        db,
        makeMsg({
          session_id: 'sum-sess',
          role: 'master',
          content: 'master reply here',
          created_at: daysAgo(60),
        }),
      );
      await evictConversations(db, { recentDays: 30, summarizeDays: 90 });

      const rows = db
        .prepare("SELECT content FROM conversations WHERE session_id = 'sum-sess'")
        .all() as { content: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].content).toContain('sum-sess');
    });

    it('summary FTS5 entry is created for the new system row', async () => {
      recordMessage(
        db,
        makeMsg({
          session_id: 'fts-sum-sess',
          content: 'uniquefts message',
          created_at: daysAgo(60),
        }),
      );
      await evictConversations(db, { recentDays: 30, summarizeDays: 90 });

      const summaryId = (
        db.prepare("SELECT id FROM conversations WHERE session_id = 'fts-sum-sess'").get() as {
          id: number;
        }
      ).id;
      const fts = db.prepare('SELECT rowid FROM conversations_fts WHERE rowid = ?').get(summaryId);
      expect(fts).toBeDefined();
    });

    it('uses AI summary text when agentRunner is provided and succeeds', async () => {
      recordMessage(
        db,
        makeMsg({
          session_id: 'ai-sum-sess',
          content: 'ai summary target',
          created_at: daysAgo(60),
        }),
      );
      const runner = makeMockAgentRunner('The user asked about project setup.');
      await evictConversations(db, {
        recentDays: 30,
        summarizeDays: 90,
        agentRunner: runner,
        workspacePath: process.cwd(),
      });

      const row = db
        .prepare("SELECT content FROM conversations WHERE session_id = 'ai-sum-sess'")
        .get() as { content: string };
      expect(row.content).toContain('The user asked about project setup.');
    });

    it('falls back to text summary when agentRunner returns non-zero exit code', async () => {
      recordMessage(
        db,
        makeMsg({
          session_id: 'fail-ai-sess',
          content: 'fallback test message',
          created_at: daysAgo(60),
        }),
      );
      const failRunner = {
        spawn: async () => ({
          stdout: '',
          stderr: 'error',
          exitCode: 1,
          durationMs: 0,
          retryCount: 0,
        }),
      } as unknown as AgentRunner;

      await evictConversations(db, {
        recentDays: 30,
        summarizeDays: 90,
        agentRunner: failRunner,
      });

      const row = db
        .prepare("SELECT content FROM conversations WHERE session_id = 'fail-ai-sess'")
        .get() as { content: string };
      expect(row.content).toContain('fail-ai-sess'); // text summary includes session id
    });
  });

  // -------------------------------------------------------------------------
  // Default options
  // -------------------------------------------------------------------------

  describe('default options', () => {
    it('uses default retention periods when no options are passed', async () => {
      // Recent message should be kept
      recordMessage(db, makeMsg({ content: 'fresh', created_at: daysAgo(5) }));
      // Very old message should be deleted
      recordMessage(
        db,
        makeMsg({ session_id: 'old-sess', content: 'very old', created_at: daysAgo(370) }),
      );

      await evictConversations(db); // no options — defaults

      const rows = db.prepare('SELECT content FROM conversations').all() as { content: string }[];
      expect(rows.some((r) => r.content === 'fresh')).toBe(true);
      expect(rows.every((r) => r.content !== 'very old')).toBe(true);
    });

    it('completes without error on an empty database', async () => {
      await expect(evictConversations(db)).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // System rows are preserved
  // -------------------------------------------------------------------------

  describe('system (summary) rows are not re-summarized', () => {
    it('existing system rows in zone 2 are not deleted or re-processed', async () => {
      // Insert a system summary row in the summarization window
      db.prepare(
        `INSERT INTO conversations (session_id, role, content, channel, user_id, created_at)
         VALUES ('sys-sess', 'system', '[Summary of session sys-sess]', NULL, NULL, ?)`,
      ).run(daysAgo(60));

      await evictConversations(db, { recentDays: 30, summarizeDays: 90 });

      const rows = db.prepare("SELECT * FROM conversations WHERE session_id = 'sys-sess'").all();
      // The summary row should still be there (zone 2 query excludes role='system')
      expect(rows).toHaveLength(1);
    });
  });
});
