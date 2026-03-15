/**
 * OB-1520 — Worker activity tracking unit tests
 *
 * Test 1: Mock a streaming agent (Codex path) that completes with exit code 0.
 *         Assert that the agent_activity record transitions from running → done
 *         with a completed_at timestamp.
 *
 * Test 2: Create 3 stale running records older than 15 minutes.
 *         Call sweepStaleRunning(600_000), assert all 3 are now abandoned.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  insertActivity,
  updateActivity,
  sweepStaleRunning,
  type ActivityRecord,
} from '../../src/memory/activity-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Open an in-memory SQLite database with the minimal schema needed. */
function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=OFF'); // parent_id FK not needed in these tests
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_activity (
      id           TEXT    PRIMARY KEY,
      type         TEXT    NOT NULL,
      model        TEXT,
      profile      TEXT,
      task_summary TEXT,
      status       TEXT    NOT NULL DEFAULT 'starting',
      progress_pct REAL,
      parent_id    TEXT,
      pid          INTEGER,
      cost_usd     REAL,
      started_at   TEXT    NOT NULL,
      updated_at   TEXT    NOT NULL,
      completed_at TEXT,
      summary_json TEXT
    );
  `);
  return db;
}

/** Build a minimal ActivityRecord for insertion. */
function makeRecord(
  id: string,
  status: ActivityRecord['status'],
  startedAt: string,
): ActivityRecord {
  return {
    id,
    type: 'worker',
    model: 'codex-mini',
    profile: 'read-only',
    task_summary: 'test task',
    status,
    started_at: startedAt,
    updated_at: startedAt,
  };
}

/** Return a ISO timestamp N milliseconds in the past. */
function msAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

// ---------------------------------------------------------------------------
// Test 1 — Streaming agent completes: running → done with completed_at
// ---------------------------------------------------------------------------

describe('streaming agent completion (Codex path)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    db.close();
  });

  it('transitions agent_activity from running to done with a completed_at timestamp on exit code 0', () => {
    const workerId = 'worker-codex-streaming-001';
    const startedAt = msAgo(5_000); // started 5 s ago

    // Insert a record in 'running' state (simulates what worker-orchestrator does
    // after spawning the Codex streaming process).
    insertActivity(db, makeRecord(workerId, 'running', startedAt));

    // Verify initial state
    const before = db.prepare('SELECT * FROM agent_activity WHERE id = ?').get(workerId) as
      | ActivityRecord
      | undefined;
    expect(before).toBeDefined();
    expect(before!.status).toBe('running');
    expect(before!.completed_at).toBeNull();

    // Simulate the completion callback triggered when the streaming process exits
    // with code 0 (the fix applied in OB-1517 / OB-F196 finally block).
    const completedAt = new Date().toISOString();
    updateActivity(db, workerId, {
      status: 'done',
      progress_pct: 100,
      completed_at: completedAt,
    });

    // Assert final state
    const after = db.prepare('SELECT * FROM agent_activity WHERE id = ?').get(workerId) as
      | ActivityRecord
      | undefined;
    expect(after).toBeDefined();
    expect(after!.status).toBe('done');
    expect(after!.completed_at).toBe(completedAt);
    expect(after!.progress_pct).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — sweepStaleRunning abandons records older than maxAgeMs
// ---------------------------------------------------------------------------

describe('sweepStaleRunning', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    db.close();
  });

  it('marks all running records older than 15 minutes as abandoned', () => {
    const fifteenMinMs = 15 * 60 * 1_000;
    const tenMinMs = 600_000; // maxAgeMs passed to sweepStaleRunning

    // Insert 3 stale running records (started > 15 min ago)
    const staleIds = ['worker-stale-001', 'worker-stale-002', 'worker-stale-003'];
    for (const id of staleIds) {
      insertActivity(db, makeRecord(id, 'running', msAgo(fifteenMinMs + 1_000)));
    }

    // Insert 1 fresh running record (started 2 min ago) — must NOT be swept
    const freshId = 'worker-fresh-001';
    insertActivity(db, makeRecord(freshId, 'running', msAgo(2 * 60 * 1_000)));

    // Verify precondition: all 4 records are running
    const beforeCount = db
      .prepare("SELECT COUNT(*) AS n FROM agent_activity WHERE status = 'running'")
      .get() as { n: number };
    expect(beforeCount.n).toBe(4);

    // Run the sweep with 10-minute threshold
    const swept = sweepStaleRunning(db, tenMinMs);

    // Three stale records swept
    expect(swept).toBe(3);

    // Each stale record is now 'abandoned' with a completed_at timestamp
    for (const id of staleIds) {
      const row = db.prepare('SELECT * FROM agent_activity WHERE id = ?').get(id) as
        | ActivityRecord
        | undefined;
      expect(row).toBeDefined();
      expect(row!.status).toBe('abandoned');
      expect(row!.completed_at).toBeDefined();
      expect(typeof row!.completed_at).toBe('string');
    }

    // Fresh record is unaffected
    const fresh = db.prepare('SELECT * FROM agent_activity WHERE id = ?').get(freshId) as
      | ActivityRecord
      | undefined;
    expect(fresh).toBeDefined();
    expect(fresh!.status).toBe('running');
    expect(fresh!.completed_at).toBeNull();
  });

  it('returns 0 when no stale running records exist', () => {
    // Insert only fresh running records
    insertActivity(db, makeRecord('worker-fresh-002', 'running', msAgo(30_000)));

    const swept = sweepStaleRunning(db, 600_000);
    expect(swept).toBe(0);
  });

  it('does not sweep done or failed records even if they are old', () => {
    const oldTime = msAgo(60 * 60 * 1_000); // 1 hour ago

    insertActivity(db, makeRecord('worker-done-001', 'done', oldTime));
    insertActivity(db, makeRecord('worker-failed-001', 'failed', oldTime));

    const swept = sweepStaleRunning(db, 600_000);
    expect(swept).toBe(0);

    // Statuses unchanged
    const done = db
      .prepare('SELECT status FROM agent_activity WHERE id = ?')
      .get('worker-done-001') as { status: string };
    expect(done.status).toBe('done');

    const failed = db
      .prepare('SELECT status FROM agent_activity WHERE id = ?')
      .get('worker-failed-001') as { status: string };
    expect(failed.status).toBe('failed');
  });
});
