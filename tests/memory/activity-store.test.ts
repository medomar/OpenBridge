import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import {
  insertActivity,
  updateActivity,
  getActiveAgents,
  cleanupOldActivity,
  getDailyCost,
  insertExplorationProgress,
  updateExplorationProgressById,
  getExplorationProgressByExplorationId,
  type ActivityRecord,
} from '../../src/memory/activity-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  const now = new Date().toISOString();
  return {
    id: `agent-${Math.random().toString(36).slice(2, 8)}`,
    type: 'worker',
    model: 'claude-sonnet-4-6',
    profile: 'code-edit',
    task_summary: 'fix bug in auth module',
    status: 'running',
    progress_pct: 0,
    started_at: now,
    updated_at: now,
    ...overrides,
  };
}

/** Returns an ISO timestamp N hours in the past. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/** Returns an ISO timestamp for the start of a specific date (YYYY-MM-DD) in UTC. */
function dateIso(dateStr: string): string {
  return `${dateStr}T12:00:00.000Z`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('activity-store.ts', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  // -------------------------------------------------------------------------
  // insertActivity
  // -------------------------------------------------------------------------

  describe('insertActivity', () => {
    it('inserts a new activity row', () => {
      const activity = makeActivity({ id: 'agent-001', type: 'master' });
      insertActivity(db, activity);

      const row = db.prepare('SELECT * FROM agent_activity WHERE id = ?').get('agent-001') as
        | ActivityRecord
        | undefined;
      expect(row).toBeDefined();
      expect(row?.id).toBe('agent-001');
      expect(row?.type).toBe('master');
      expect(row?.status).toBe('running');
    });

    it('inserts activity with all optional fields null', () => {
      const now = new Date().toISOString();
      insertActivity(db, {
        id: 'agent-minimal',
        type: 'worker',
        status: 'starting',
        started_at: now,
        updated_at: now,
      });

      const row = db.prepare('SELECT * FROM agent_activity WHERE id = ?').get('agent-minimal') as
        | ActivityRecord
        | undefined;
      expect(row).toBeDefined();
      expect(row?.model).toBeNull();
      expect(row?.profile).toBeNull();
      expect(row?.task_summary).toBeNull();
      expect(row?.cost_usd).toBeNull();
      expect(row?.completed_at).toBeNull();
    });

    it('is idempotent on duplicate id (INSERT OR IGNORE)', () => {
      const activity = makeActivity({ id: 'agent-dup', status: 'starting' });
      insertActivity(db, activity);
      insertActivity(db, { ...activity, status: 'running' }); // duplicate — should be ignored

      const rows = db
        .prepare('SELECT * FROM agent_activity WHERE id = ?')
        .all('agent-dup') as ActivityRecord[];
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('starting'); // original preserved
    });

    it('stores all worker type variants', () => {
      for (const type of ['master', 'worker', 'sub-master', 'explorer'] as const) {
        const a = makeActivity({ id: `agent-${type}`, type });
        insertActivity(db, a);
      }
      const count = (db.prepare('SELECT COUNT(*) AS c FROM agent_activity').get() as { c: number })
        .c;
      expect(count).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // updateActivity
  // -------------------------------------------------------------------------

  describe('updateActivity', () => {
    it('updates status to done and sets completed_at', () => {
      const activity = makeActivity({ id: 'upd-001' });
      insertActivity(db, activity);

      const completedAt = new Date().toISOString();
      updateActivity(db, 'upd-001', { status: 'done', completed_at: completedAt });

      const row = db
        .prepare('SELECT * FROM agent_activity WHERE id = ?')
        .get('upd-001') as ActivityRecord;
      expect(row.status).toBe('done');
      expect(row.completed_at).toBe(completedAt);
    });

    it('updates progress_pct', () => {
      const activity = makeActivity({ id: 'upd-002', progress_pct: 0 });
      insertActivity(db, activity);
      updateActivity(db, 'upd-002', { progress_pct: 75 });

      const row = db
        .prepare('SELECT progress_pct FROM agent_activity WHERE id = ?')
        .get('upd-002') as {
        progress_pct: number;
      };
      expect(row.progress_pct).toBe(75);
    });

    it('updates cost_usd', () => {
      const activity = makeActivity({ id: 'upd-003' });
      insertActivity(db, activity);
      updateActivity(db, 'upd-003', { cost_usd: 0.025 });

      const row = db.prepare('SELECT cost_usd FROM agent_activity WHERE id = ?').get('upd-003') as {
        cost_usd: number;
      };
      expect(row.cost_usd).toBeCloseTo(0.025);
    });

    it('updates task_summary', () => {
      const activity = makeActivity({ id: 'upd-004', task_summary: 'original' });
      insertActivity(db, activity);
      updateActivity(db, 'upd-004', { task_summary: 'updated summary' });

      const row = db
        .prepare('SELECT task_summary FROM agent_activity WHERE id = ?')
        .get('upd-004') as {
        task_summary: string;
      };
      expect(row.task_summary).toBe('updated summary');
    });

    it('updates updated_at timestamp', () => {
      const activity = makeActivity({ id: 'upd-005', updated_at: '2024-01-01T00:00:00.000Z' });
      insertActivity(db, activity);

      const newTs = new Date().toISOString();
      updateActivity(db, 'upd-005', { updated_at: newTs });

      const row = db
        .prepare('SELECT updated_at FROM agent_activity WHERE id = ?')
        .get('upd-005') as {
        updated_at: string;
      };
      expect(row.updated_at).toBe(newTs);
    });

    it('does nothing when updates is empty', () => {
      const activity = makeActivity({ id: 'upd-006', status: 'running' });
      insertActivity(db, activity);
      // Should not throw even with no update fields
      expect(() => updateActivity(db, 'upd-006', {})).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // getActiveAgents
  // -------------------------------------------------------------------------

  describe('getActiveAgents', () => {
    it('returns only starting/running/completing agents', () => {
      const now = new Date().toISOString();
      insertActivity(db, makeActivity({ id: 'active-1', status: 'starting' }));
      insertActivity(db, makeActivity({ id: 'active-2', status: 'running' }));
      insertActivity(db, makeActivity({ id: 'active-3', status: 'completing' }));
      insertActivity(db, makeActivity({ id: 'done-1', status: 'done', completed_at: now }));
      insertActivity(db, makeActivity({ id: 'fail-1', status: 'failed', completed_at: now }));

      const active = getActiveAgents(db);
      expect(active).toHaveLength(3);
      const ids = active.map((a) => a.id);
      expect(ids).toContain('active-1');
      expect(ids).toContain('active-2');
      expect(ids).toContain('active-3');
      expect(ids).not.toContain('done-1');
      expect(ids).not.toContain('fail-1');
    });

    it('returns empty array when no active agents', () => {
      const now = new Date().toISOString();
      insertActivity(db, makeActivity({ id: 'done-x', status: 'done', completed_at: now }));
      expect(getActiveAgents(db)).toHaveLength(0);
    });

    it('orders by started_at ascending', () => {
      const older = new Date(Date.now() - 5000).toISOString();
      const newer = new Date().toISOString();
      insertActivity(
        db,
        makeActivity({ id: 'b-agent', status: 'running', started_at: newer, updated_at: newer }),
      );
      insertActivity(
        db,
        makeActivity({ id: 'a-agent', status: 'running', started_at: older, updated_at: older }),
      );

      const active = getActiveAgents(db);
      expect(active[0]?.id).toBe('a-agent');
      expect(active[1]?.id).toBe('b-agent');
    });

    it('returns master type in results', () => {
      insertActivity(db, makeActivity({ id: 'master-1', type: 'master', status: 'running' }));
      const active = getActiveAgents(db);
      expect(active.some((a) => a.type === 'master')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // cleanupOldActivity
  // -------------------------------------------------------------------------

  describe('cleanupOldActivity', () => {
    it('deletes completed activities older than cutoff', () => {
      insertActivity(
        db,
        makeActivity({ id: 'old-done', status: 'done', completed_at: hoursAgo(48) }),
      );
      insertActivity(
        db,
        makeActivity({ id: 'recent-done', status: 'done', completed_at: hoursAgo(2) }),
      );

      cleanupOldActivity(db, 24);

      const ids = (db.prepare('SELECT id FROM agent_activity').all() as { id: string }[]).map(
        (r) => r.id,
      );
      expect(ids).not.toContain('old-done');
      expect(ids).toContain('recent-done');
    });

    it('never deletes still-running activities (no completed_at)', () => {
      insertActivity(db, makeActivity({ id: 'still-running', status: 'running' }));
      cleanupOldActivity(db, 0); // cutoff = now, delete everything with completed_at

      const row = db.prepare('SELECT id FROM agent_activity WHERE id = ?').get('still-running');
      expect(row).toBeDefined();
    });

    it('uses 24 hours as default cutoff', () => {
      insertActivity(
        db,
        makeActivity({ id: 'old-default', status: 'done', completed_at: hoursAgo(25) }),
      );
      insertActivity(
        db,
        makeActivity({ id: 'new-default', status: 'done', completed_at: hoursAgo(23) }),
      );

      cleanupOldActivity(db); // default = 24

      const ids = (db.prepare('SELECT id FROM agent_activity').all() as { id: string }[]).map(
        (r) => r.id,
      );
      expect(ids).not.toContain('old-default');
      expect(ids).toContain('new-default');
    });

    it('deletes failed activities older than cutoff', () => {
      insertActivity(
        db,
        makeActivity({ id: 'old-fail', status: 'failed', completed_at: hoursAgo(30) }),
      );
      cleanupOldActivity(db, 24);

      const row = db.prepare('SELECT id FROM agent_activity WHERE id = ?').get('old-fail');
      expect(row).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getDailyCost
  // -------------------------------------------------------------------------

  describe('getDailyCost', () => {
    it('returns 0 when no activities have costs', () => {
      const cost = getDailyCost(db);
      expect(cost).toBe(0);
    });

    it('sums cost_usd for activities on the given date', () => {
      const today = new Date().toISOString().slice(0, 10);
      insertActivity(
        db,
        makeActivity({
          id: 'cost-1',
          cost_usd: 0.01,
          started_at: dateIso(today),
          updated_at: dateIso(today),
        }),
      );
      insertActivity(
        db,
        makeActivity({
          id: 'cost-2',
          cost_usd: 0.02,
          started_at: dateIso(today),
          updated_at: dateIso(today),
        }),
      );

      const cost = getDailyCost(db, today);
      expect(cost).toBeCloseTo(0.03);
    });

    it('excludes activities from other dates', () => {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      insertActivity(
        db,
        makeActivity({
          id: 'today-cost',
          cost_usd: 0.05,
          started_at: dateIso(today),
          updated_at: dateIso(today),
        }),
      );
      insertActivity(
        db,
        makeActivity({
          id: 'yest-cost',
          cost_usd: 0.99,
          started_at: dateIso(yesterday),
          updated_at: dateIso(yesterday),
        }),
      );

      const cost = getDailyCost(db, today);
      expect(cost).toBeCloseTo(0.05);
    });

    it('handles null cost_usd entries gracefully (treats as 0)', () => {
      const today = new Date().toISOString().slice(0, 10);
      insertActivity(
        db,
        makeActivity({ id: 'no-cost', started_at: dateIso(today), updated_at: dateIso(today) }),
      ); // cost_usd not set
      insertActivity(
        db,
        makeActivity({
          id: 'with-cost',
          cost_usd: 0.03,
          started_at: dateIso(today),
          updated_at: dateIso(today),
        }),
      );

      const cost = getDailyCost(db, today);
      expect(cost).toBeCloseTo(0.03);
    });

    it('uses today (UTC) as default date', () => {
      const today = new Date().toISOString().slice(0, 10);
      insertActivity(
        db,
        makeActivity({
          id: 'default-date',
          cost_usd: 0.007,
          started_at: dateIso(today),
          updated_at: dateIso(today),
        }),
      );

      const cost = getDailyCost(db); // no date arg
      expect(cost).toBeCloseTo(0.007);
    });
  });

  // -------------------------------------------------------------------------
  // insertExplorationProgress
  // -------------------------------------------------------------------------

  describe('insertExplorationProgress', () => {
    it('inserts a progress row and returns its numeric id', () => {
      // Need a parent agent_activity row due to FK
      const parentId = 'exp-parent-1';
      insertActivity(db, makeActivity({ id: parentId, type: 'explorer' }));

      const rowId = insertExplorationProgress(db, {
        exploration_id: parentId,
        phase: 'structure',
        target: 'src/',
        status: 'in_progress',
        progress_pct: 0,
        files_processed: 0,
        files_total: 10,
      });

      expect(typeof rowId).toBe('number');
      expect(rowId).toBeGreaterThan(0);
    });

    it('inserts row with all optional fields null', () => {
      const parentId = 'exp-parent-2';
      insertActivity(db, makeActivity({ id: parentId, type: 'explorer' }));

      const rowId = insertExplorationProgress(db, {
        exploration_id: parentId,
        phase: 'classification',
        status: 'pending',
        progress_pct: 0,
        files_processed: 0,
      });

      const row = db.prepare('SELECT * FROM exploration_progress WHERE id = ?').get(rowId) as {
        target: null;
        files_total: null;
        started_at: null;
        completed_at: null;
      };
      expect(row.target).toBeNull();
      expect(row.files_total).toBeNull();
      expect(row.started_at).toBeNull();
      expect(row.completed_at).toBeNull();
    });

    it('auto-increments id for multiple rows', () => {
      const parentId = 'exp-parent-3';
      insertActivity(db, makeActivity({ id: parentId, type: 'explorer' }));

      const base: Omit<Parameters<typeof insertExplorationProgress>[1], 'phase'> = {
        exploration_id: parentId,
        status: 'pending',
        progress_pct: 0,
        files_processed: 0,
      };
      const id1 = insertExplorationProgress(db, { ...base, phase: 'structure' });
      const id2 = insertExplorationProgress(db, { ...base, phase: 'classification' });
      const id3 = insertExplorationProgress(db, { ...base, phase: 'dir-dive' });

      expect(id2).toBeGreaterThan(id1);
      expect(id3).toBeGreaterThan(id2);
    });
  });

  // -------------------------------------------------------------------------
  // updateExplorationProgressById
  // -------------------------------------------------------------------------

  describe('updateExplorationProgressById', () => {
    it('updates status and progress_pct', () => {
      const parentId = 'exp-upd-1';
      insertActivity(db, makeActivity({ id: parentId, type: 'explorer' }));
      const rowId = insertExplorationProgress(db, {
        exploration_id: parentId,
        phase: 'dir-dive',
        status: 'in_progress',
        progress_pct: 20,
        files_processed: 2,
        files_total: 10,
      });

      updateExplorationProgressById(db, rowId, { progress_pct: 60, files_processed: 6 });

      const row = db
        .prepare('SELECT progress_pct, files_processed FROM exploration_progress WHERE id = ?')
        .get(rowId) as {
        progress_pct: number;
        files_processed: number;
      };
      expect(row.progress_pct).toBe(60);
      expect(row.files_processed).toBe(6);
    });

    it('marks row as completed', () => {
      const parentId = 'exp-upd-2';
      insertActivity(db, makeActivity({ id: parentId, type: 'explorer' }));
      const rowId = insertExplorationProgress(db, {
        exploration_id: parentId,
        phase: 'assembly',
        status: 'in_progress',
        progress_pct: 90,
        files_processed: 9,
      });

      const completedAt = new Date().toISOString();
      updateExplorationProgressById(db, rowId, {
        status: 'completed',
        completed_at: completedAt,
        progress_pct: 100,
      });

      const row = db
        .prepare('SELECT status, completed_at, progress_pct FROM exploration_progress WHERE id = ?')
        .get(rowId) as {
        status: string;
        completed_at: string;
        progress_pct: number;
      };
      expect(row.status).toBe('completed');
      expect(row.completed_at).toBe(completedAt);
      expect(row.progress_pct).toBe(100);
    });

    it('does nothing on empty updates object', () => {
      const parentId = 'exp-upd-3';
      insertActivity(db, makeActivity({ id: parentId, type: 'explorer' }));
      const rowId = insertExplorationProgress(db, {
        exploration_id: parentId,
        phase: 'structure',
        status: 'pending',
        progress_pct: 0,
        files_processed: 0,
      });

      expect(() => updateExplorationProgressById(db, rowId, {})).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // getExplorationProgressByExplorationId
  // -------------------------------------------------------------------------

  describe('getExplorationProgressByExplorationId', () => {
    it('returns all rows for a given exploration_id ordered by id asc', () => {
      const parentId = 'exp-q-1';
      insertActivity(db, makeActivity({ id: parentId, type: 'explorer' }));

      const phases = ['structure', 'classification', 'dir-dive', 'assembly'];
      for (const phase of phases) {
        insertExplorationProgress(db, {
          exploration_id: parentId,
          phase,
          status: 'pending',
          progress_pct: 0,
          files_processed: 0,
        });
      }

      const rows = getExplorationProgressByExplorationId(db, parentId);
      expect(rows).toHaveLength(4);
      expect(rows.map((r) => r.phase)).toEqual(phases);
    });

    it('returns empty array when exploration_id has no rows', () => {
      const rows = getExplorationProgressByExplorationId(db, 'nonexistent');
      expect(rows).toHaveLength(0);
    });

    it('does not return rows from other exploration_ids', () => {
      const parentA = 'exp-qa-1';
      const parentB = 'exp-qb-1';
      insertActivity(db, makeActivity({ id: parentA, type: 'explorer' }));
      insertActivity(db, makeActivity({ id: parentB, type: 'explorer' }));

      insertExplorationProgress(db, {
        exploration_id: parentA,
        phase: 'structure',
        status: 'completed',
        progress_pct: 100,
        files_processed: 5,
      });
      insertExplorationProgress(db, {
        exploration_id: parentB,
        phase: 'structure',
        status: 'in_progress',
        progress_pct: 50,
        files_processed: 2,
      });

      const rowsA = getExplorationProgressByExplorationId(db, parentA);
      expect(rowsA).toHaveLength(1);
      expect(rowsA[0]?.exploration_id).toBe(parentA);

      const rowsB = getExplorationProgressByExplorationId(db, parentB);
      expect(rowsB).toHaveLength(1);
      expect(rowsB[0]?.exploration_id).toBe(parentB);
    });
  });

  // -------------------------------------------------------------------------
  // Cost aggregation integration test
  // -------------------------------------------------------------------------

  describe('cost aggregation', () => {
    it('accumulates cost across multiple completed workers', () => {
      const today = new Date().toISOString().slice(0, 10);
      const costs = [0.001, 0.005, 0.01, 0.025, 0.05];
      let expected = 0;
      for (let i = 0; i < costs.length; i++) {
        const c = costs[i]!;
        expected += c;
        insertActivity(
          db,
          makeActivity({
            id: `worker-cost-${i}`,
            type: 'worker',
            status: 'done',
            cost_usd: c,
            started_at: dateIso(today),
            updated_at: dateIso(today),
            completed_at: dateIso(today),
          }),
        );
      }

      const daily = getDailyCost(db, today);
      expect(daily).toBeCloseTo(expected, 5);
    });

    it('active (non-completed) workers still count toward daily cost', () => {
      const today = new Date().toISOString().slice(0, 10);
      insertActivity(
        db,
        makeActivity({
          id: 'running-cost',
          status: 'running',
          cost_usd: 0.007,
          started_at: dateIso(today),
          updated_at: dateIso(today),
        }),
      );

      const daily = getDailyCost(db, today);
      expect(daily).toBeCloseTo(0.007);
    });
  });

  // -------------------------------------------------------------------------
  // Lifecycle integration: insert → update → cleanup
  // -------------------------------------------------------------------------

  describe('full lifecycle', () => {
    it('inserts as starting, transitions through running → done → cleanup', () => {
      const agentId = 'lifecycle-001';
      const now = new Date().toISOString();

      // Spawn
      insertActivity(
        db,
        makeActivity({ id: agentId, status: 'starting', started_at: now, updated_at: now }),
      );
      expect(getActiveAgents(db).map((a) => a.id)).toContain(agentId);

      // Running
      updateActivity(db, agentId, { status: 'running', progress_pct: 50 });
      const running = getActiveAgents(db).find((a) => a.id === agentId);
      expect(running?.status).toBe('running');
      expect(running?.progress_pct).toBe(50);

      // Done
      const completedAt = hoursAgo(25);
      updateActivity(db, agentId, { status: 'done', cost_usd: 0.01, completed_at: completedAt });
      expect(getActiveAgents(db).map((a) => a.id)).not.toContain(agentId);

      // Cleanup
      cleanupOldActivity(db, 24);
      const row = db.prepare('SELECT id FROM agent_activity WHERE id = ?').get(agentId);
      expect(row).toBeUndefined();
    });
  });
});
