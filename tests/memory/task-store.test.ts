import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import {
  recordTask,
  getTasksByType,
  getSimilarTasks,
  recordLearning,
  getLearnedParams,
  type TaskRecord,
} from '../../src/memory/task-store.js';

describe('task-store.ts', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  const makeTask = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
    id: `task-${Math.random().toString(36).slice(2)}`,
    type: 'worker',
    status: 'completed',
    prompt: 'Add a new feature to the authentication module',
    model: 'claude-sonnet-4-6',
    turns_used: 5,
    max_turns: 10,
    duration_ms: 3000,
    exit_code: 0,
    retries: 0,
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    ...overrides,
  });

  describe('recordTask', () => {
    it('inserts a task record', () => {
      const task = makeTask({ id: 'task-001' });
      recordTask(db, task);
      const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get('task-001') as TaskRecord;
      expect(row).toBeDefined();
      expect(row.type).toBe('worker');
    });

    it('upserts on duplicate id — updates mutable fields', () => {
      const task = makeTask({ id: 'task-dup', status: 'running', response: undefined });
      recordTask(db, task);
      recordTask(db, { ...task, status: 'completed', response: 'done', turns_used: 7 });
      const row = db
        .prepare('SELECT status, response, turns_used FROM tasks WHERE id = ?')
        .get('task-dup') as {
        status: string;
        response: string;
        turns_used: number;
      };
      expect(row.status).toBe('completed');
      expect(row.response).toBe('done');
      expect(row.turns_used).toBe(7);
    });

    it('stores optional fields as null when not provided', () => {
      recordTask(db, {
        id: 'task-min',
        type: 'quick-answer',
        status: 'running',
        created_at: new Date().toISOString(),
      });
      const row = db.prepare('SELECT prompt, model FROM tasks WHERE id = ?').get('task-min') as {
        prompt: string | null;
        model: string | null;
      };
      expect(row.prompt).toBeNull();
      expect(row.model).toBeNull();
    });
  });

  describe('getTasksByType', () => {
    beforeEach(() => {
      recordTask(
        db,
        makeTask({ id: 't1', type: 'worker', created_at: '2026-01-01T00:00:00.000Z' }),
      );
      recordTask(
        db,
        makeTask({ id: 't2', type: 'worker', created_at: '2026-01-02T00:00:00.000Z' }),
      );
      recordTask(
        db,
        makeTask({ id: 't3', type: 'exploration', created_at: '2026-01-03T00:00:00.000Z' }),
      );
    });

    it('returns only tasks of the requested type', () => {
      const tasks = getTasksByType(db, 'worker');
      expect(tasks.every((t) => t.type === 'worker')).toBe(true);
      expect(tasks).toHaveLength(2);
    });

    it('returns tasks in descending created_at order', () => {
      const tasks = getTasksByType(db, 'worker');
      expect(tasks[0].id).toBe('t2');
      expect(tasks[1].id).toBe('t1');
    });

    it('returns empty array when no tasks of that type exist', () => {
      const tasks = getTasksByType(db, 'complex');
      expect(tasks).toHaveLength(0);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        recordTask(db, makeTask({ id: `bulk-${i}`, type: 'tool-use' }));
      }
      const tasks = getTasksByType(db, 'tool-use', 3);
      expect(tasks).toHaveLength(3);
    });
  });

  describe('getSimilarTasks', () => {
    beforeEach(() => {
      recordTask(db, makeTask({ id: 'sim-1', prompt: 'Fix authentication bug in login flow' }));
      recordTask(db, makeTask({ id: 'sim-2', prompt: 'Add unit tests for auth module' }));
      recordTask(db, makeTask({ id: 'sim-3', prompt: 'Refactor database connection pool' }));
    });

    it('returns tasks matching prompt keyword', () => {
      const results = getSimilarTasks(db, 'auth');
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((t) => t.prompt?.includes('auth') || t.prompt?.includes('Auth'))).toBe(
        true,
      );
    });

    it('returns empty array for empty prompt', () => {
      const results = getSimilarTasks(db, '');
      expect(results).toHaveLength(0);
    });

    it('returns empty array for whitespace-only prompt', () => {
      const results = getSimilarTasks(db, '   ');
      expect(results).toHaveLength(0);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        recordTask(db, makeTask({ id: `many-${i}`, prompt: 'common keyword task' }));
      }
      const results = getSimilarTasks(db, 'common keyword', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('recordLearning + getLearnedParams', () => {
    it('inserts a new learning row on first call', () => {
      recordLearning(db, 'worker', 'claude-sonnet-4-6', true, 5, 3000);
      const params = getLearnedParams(db, 'worker');
      expect(params).not.toBeNull();
      expect(params!.model).toBe('claude-sonnet-4-6');
    });

    it('increments success_count on successful call', () => {
      recordLearning(db, 'exploration', 'claude-haiku-4-5', true, 3, 1000);
      recordLearning(db, 'exploration', 'claude-haiku-4-5', true, 2, 800);
      const row = db
        .prepare('SELECT success_count FROM learnings WHERE task_type = ? AND model = ?')
        .get('exploration', 'claude-haiku-4-5') as { success_count: number };
      expect(row.success_count).toBe(2);
    });

    it('increments failure_count on failed call', () => {
      recordLearning(db, 'complex', 'claude-opus-4-6', false, 15, 8000);
      const row = db
        .prepare('SELECT failure_count FROM learnings WHERE task_type = ? AND model = ?')
        .get('complex', 'claude-opus-4-6') as { failure_count: number };
      expect(row.failure_count).toBe(1);
    });

    it('calculates success_rate via generated column', () => {
      recordLearning(db, 'quick-answer', 'claude-haiku-4-5', true, 1, 500);
      recordLearning(db, 'quick-answer', 'claude-haiku-4-5', true, 1, 500);
      recordLearning(db, 'quick-answer', 'claude-haiku-4-5', false, 1, 500);
      const params = getLearnedParams(db, 'quick-answer');
      expect(params!.success_rate).toBeCloseTo(2 / 3);
      expect(params!.total_tasks).toBe(3);
    });

    it('picks the model with the highest success_rate', () => {
      recordLearning(db, 'tool-use', 'model-a', true, 2, 1000);
      recordLearning(db, 'tool-use', 'model-a', false, 2, 1000); // 50% rate
      recordLearning(db, 'tool-use', 'model-b', true, 2, 1000);
      recordLearning(db, 'tool-use', 'model-b', true, 2, 1000); // 100% rate
      const params = getLearnedParams(db, 'tool-use');
      expect(params!.model).toBe('model-b');
    });

    it('returns null when no learning data exists for that task type', () => {
      const params = getLearnedParams(db, 'nonexistent-type');
      expect(params).toBeNull();
    });
  });
});
