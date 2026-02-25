import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { MemoryManager } from '../../src/memory/index.js';

describe('MemoryManager (index.ts)', () => {
  let manager: MemoryManager;
  let tmpDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-mm-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    manager = new MemoryManager(dbPath);
    await manager.init();
  });

  afterEach(async () => {
    await manager.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('init() creates the database file on disk', async () => {
      expect(fs.existsSync(dbPath)).toBe(true);
    });

    it('close() closes the database (no error on double close)', async () => {
      await manager.close();
      await expect(manager.close()).resolves.toBeUndefined();
    });

    it('methods reject when called before init()', async () => {
      const uninit = new MemoryManager(':memory:');
      await expect(uninit.storeChunks([])).rejects.toThrow('not initialised');
    });
  });

  // ---------------------------------------------------------------------------
  // Context chunks
  // ---------------------------------------------------------------------------

  describe('storeChunks + searchContext', () => {
    it('stores and retrieves chunks via full-text search', async () => {
      await manager.storeChunks([
        { scope: 'src', category: 'structure', content: 'Bridge routes messages to providers' },
      ]);
      const results = await manager.searchContext('Bridge');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('Bridge');
    });

    it('storeChunks is a no-op for empty array', async () => {
      await expect(manager.storeChunks([])).resolves.toBeUndefined();
    });
  });

  describe('markStale', () => {
    it('marks chunks as stale and excludes them from search', async () => {
      await manager.storeChunks([
        { scope: 'src/stale', category: 'patterns', content: 'stale pattern content' },
      ]);
      await manager.markStale(['src/stale']);
      const results = await manager.searchContext('stale');
      expect(results).toHaveLength(0);
    });
  });

  describe('getChunksByScope', () => {
    it('returns chunks for the given scope', async () => {
      await manager.storeChunks([
        { scope: 'src/core', category: 'structure', content: 'core content' },
        { scope: 'src/master', category: 'structure', content: 'master content' },
      ]);
      const results = await manager.getChunksByScope('src/core');
      expect(results).toHaveLength(1);
      expect(results[0].scope).toBe('src/core');
    });

    it('optionally filters by category', async () => {
      await manager.storeChunks([
        { scope: 'src/core', category: 'structure', content: 'core structure' },
        { scope: 'src/core', category: 'patterns', content: 'core patterns' },
      ]);
      const results = await manager.getChunksByScope('src/core', 'structure');
      expect(results).toHaveLength(1);
      expect(results[0].category).toBe('structure');
    });
  });

  // ---------------------------------------------------------------------------
  // Tasks & Learnings
  // ---------------------------------------------------------------------------

  describe('recordTask + getSimilarTasks', () => {
    it('records a task and finds it by similar prompt', async () => {
      await manager.recordTask({
        id: 'mm-task-001',
        type: 'worker',
        status: 'completed',
        prompt: 'refactor authentication module',
        created_at: new Date().toISOString(),
      });
      const results = await manager.getSimilarTasks('authentication');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('mm-task-001');
    });
  });

  describe('recordLearning + getLearnedParams', () => {
    it('records a learning and retrieves best params', async () => {
      await manager.recordLearning('worker', 'claude-sonnet-4-6', true, 5, 2000);
      const params = await manager.getLearnedParams('worker');
      expect(params).not.toBeNull();
      expect(params!.model).toBe('claude-sonnet-4-6');
      expect(params!.success_rate).toBe(1);
    });

    it('getLearnedParams returns null when no data exists', async () => {
      const result = await manager.getLearnedParams('unknown-type');
      expect(result).toBeNull();
    });
  });

  describe('getTasksByType', () => {
    it('returns tasks of a given type', async () => {
      await manager.recordTask({
        id: 'tt-1',
        type: 'quick-answer',
        status: 'completed',
        created_at: new Date().toISOString(),
      });
      await manager.recordTask({
        id: 'tt-2',
        type: 'complex',
        status: 'completed',
        created_at: new Date().toISOString(),
      });
      const tasks = await manager.getTasksByType('quick-answer');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('tt-1');
    });
  });

  // ---------------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------------

  describe('recordMessage + findRelevantHistory', () => {
    it('records a message and finds it via FTS5 search', async () => {
      await manager.recordMessage({
        session_id: 'sess-mm',
        role: 'user',
        content: 'deploy the authentication service',
      });
      const results = await manager.findRelevantHistory('authentication');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('authentication');
    });
  });

  // ---------------------------------------------------------------------------
  // Prompts
  // ---------------------------------------------------------------------------

  describe('getActivePrompt + recordPromptOutcome', () => {
    it('rejects when no active prompt exists', async () => {
      await expect(manager.getActivePrompt('no-such-prompt')).rejects.toThrow();
    });

    it('records outcome without error when prompt exists', async () => {
      // Insert a prompt directly for testing
      const db = (
        manager as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }
      ).db;
      db.prepare(
        `INSERT INTO prompts (name, version, content, effectiveness, usage_count, success_count, active, created_at)
         VALUES ('test-prompt', 1, 'content', 0.5, 0, 0, 1, ?)`,
      ).run(new Date().toISOString());

      await expect(manager.recordPromptOutcome('test-prompt', true)).resolves.toBeUndefined();
      const prompt = await manager.getActivePrompt('test-prompt');
      expect(prompt.usage_count).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // System config
  // ---------------------------------------------------------------------------

  describe('getSystemConfig + setSystemConfig', () => {
    it('returns null for non-existent key', async () => {
      const val = await manager.getSystemConfig('no-key');
      expect(val).toBeNull();
    });

    it('stores and retrieves a config value', async () => {
      await manager.setSystemConfig('my-key', 'my-value');
      const val = await manager.getSystemConfig('my-key');
      expect(val).toBe('my-value');
    });

    it('replaces existing config value', async () => {
      await manager.setSystemConfig('replace-key', 'first');
      await manager.setSystemConfig('replace-key', 'second');
      const val = await manager.getSystemConfig('replace-key');
      expect(val).toBe('second');
    });
  });

  // ---------------------------------------------------------------------------
  // Workspace State & Sessions
  // ---------------------------------------------------------------------------

  describe('updateWorkspaceState + getWorkspaceState', () => {
    it('rejects when no workspace state exists', async () => {
      await expect(manager.getWorkspaceState()).rejects.toThrow('No workspace state found');
    });

    it('stores and retrieves workspace state', async () => {
      await manager.updateWorkspaceState({
        commit_hash: 'def456',
        branch: 'develop',
        has_git: true,
        analyzed_at: new Date().toISOString(),
        analysis_type: 'incremental',
      });
      const state = await manager.getWorkspaceState();
      expect(state.commit_hash).toBe('def456');
      expect(state.branch).toBe('develop');
    });
  });

  describe('upsertSession + getSession', () => {
    it('returns null when session of that type does not exist', async () => {
      const session = await manager.getSession('master');
      expect(session).toBeNull();
    });

    it('stores and retrieves a session', async () => {
      await manager.upsertSession({
        id: 'sess-123',
        type: 'master',
        status: 'active',
        created_at: new Date().toISOString(),
        last_used_at: new Date().toISOString(),
      });
      const session = await manager.getSession('master');
      expect(session).not.toBeNull();
      expect(session!.id).toBe('sess-123');
    });
  });

  // ---------------------------------------------------------------------------
  // Eviction
  // ---------------------------------------------------------------------------

  describe('evictOldData', () => {
    it('runs without error on an empty database', async () => {
      await expect(manager.evictOldData()).resolves.toBeUndefined();
    });

    it('runs without error with custom options', async () => {
      await expect(
        manager.evictOldData({ conversationRetentionDays: 30, taskRetentionDays: 90 }),
      ).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Migration
  // ---------------------------------------------------------------------------

  describe('migrate', () => {
    it('completes without error when no JSON files exist', async () => {
      await expect(manager.migrate()).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getLearnedTaskTypes
  // ---------------------------------------------------------------------------

  describe('getLearnedTaskTypes', () => {
    it('returns an empty array when no learning data exists', async () => {
      const types = await manager.getLearnedTaskTypes();
      expect(types).toHaveLength(0);
    });

    it('returns aggregate stats per task type', async () => {
      await manager.recordLearning('worker', 'model-x', true, 3, 1500);
      await manager.recordLearning('worker', 'model-x', false, 5, 2000);
      const types = await manager.getLearnedTaskTypes();
      expect(types.length).toBeGreaterThan(0);
      const worker = types.find((t) => t.taskType === 'worker');
      expect(worker).toBeDefined();
      expect(worker!.successCount).toBe(1);
      expect(worker!.failureCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // buildBriefing (OB-722)
  // ---------------------------------------------------------------------------

  describe('buildBriefing', () => {
    it('returns a string starting with TASK:', async () => {
      const briefing = await manager.buildBriefing('some task');
      expect(typeof briefing).toBe('string');
      expect(briefing.startsWith('TASK:')).toBe(true);
    });

    it('includes the task description in the output', async () => {
      const briefing = await manager.buildBriefing('fix auth validation bug');
      expect(briefing).toContain('fix auth validation bug');
    });

    it('returns a briefing under the 2000-token budget (~8000 chars)', async () => {
      const briefing = await manager.buildBriefing('some task');
      expect(briefing.length).toBeLessThanOrEqual(8000);
    });
  });
});
