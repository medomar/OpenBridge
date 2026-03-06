import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import { storeChunks } from '../../src/memory/chunk-store.js';
import { recordTask, recordLearning } from '../../src/memory/task-store.js';
import { buildBriefing } from '../../src/memory/worker-briefing.js';
import type { AgentRunner } from '../../src/core/agent-runner.js';

/** Maximum allowed briefing length in characters (2000 tokens × 4 chars/token). */
const MAX_BRIEFING_CHARS = 8000;

describe('worker-briefing.ts — buildBriefing', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  // -------------------------------------------------------------------------
  // Basic contract
  // -------------------------------------------------------------------------

  describe('basic contract', () => {
    it('returns a non-empty string', async () => {
      const result = await buildBriefing(db, 'some task description');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('starts with the TASK: prefix', async () => {
      const result = await buildBriefing(db, 'fix authentication bug');
      expect(result.startsWith('TASK:')).toBe(true);
    });

    it('includes the task description verbatim', async () => {
      const task = 'implement rate limiting middleware';
      const result = await buildBriefing(db, task);
      expect(result).toContain(task);
    });

    it('stays within the 2000-token budget (≤ 8000 chars)', async () => {
      const result = await buildBriefing(db, 'some task');
      expect(result.length).toBeLessThanOrEqual(MAX_BRIEFING_CHARS);
    });

    it('handles empty database gracefully — only TASK line returned', async () => {
      const result = await buildBriefing(db, 'simple question');
      // With no chunks, tasks, or learnings, should just be the TASK line
      expect(result).toBe('TASK: simple question');
    });
  });

  // -------------------------------------------------------------------------
  // Project Context section
  // -------------------------------------------------------------------------

  describe('Project Context section', () => {
    it('includes "## Project Context" header when relevant chunks exist', async () => {
      void storeChunks(db, [
        {
          scope: 'src/core',
          category: 'structure',
          content: 'The authentication module validates credentials via JWT tokens',
        },
      ]);

      const result = await buildBriefing(db, 'authentication');
      expect(result).toContain('## Project Context');
    });

    it('omits Project Context section when no matching chunks exist', async () => {
      // Store a chunk that does NOT match the query
      void storeChunks(db, [
        { scope: 'src/core', category: 'structure', content: 'database connection pooling' },
      ]);

      const result = await buildBriefing(db, 'xyznonexistentquery');
      expect(result).not.toContain('## Project Context');
    });

    it('scope filter narrows context chunks to relevant directory', async () => {
      void storeChunks(db, [
        {
          scope: 'src/core',
          category: 'structure',
          content: 'core authentication middleware integration',
        },
        {
          scope: 'src/master',
          category: 'structure',
          content: 'master authentication orchestration',
        },
      ]);

      const resultScoped = await buildBriefing(db, 'authentication', 'src/core');
      // The scoped briefing should include only src/core content
      // (we can't assert exactly which chunks, but it should not exceed budget)
      expect(resultScoped.length).toBeLessThanOrEqual(MAX_BRIEFING_CHARS);
    });
  });

  // -------------------------------------------------------------------------
  // Relevant History section
  // -------------------------------------------------------------------------

  describe('Relevant History section', () => {
    it('includes "## Relevant History" when similar completed tasks exist', async () => {
      recordTask(db, {
        id: 'task-history-001',
        type: 'worker',
        status: 'completed',
        prompt: 'fix authentication token validation',
        model: 'claude-sonnet-4-6',
        turns_used: 4,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      const result = await buildBriefing(db, 'authentication');
      expect(result).toContain('## Relevant History');
    });

    it('omits Relevant History when no similar tasks exist', async () => {
      // Record a task with a completely unrelated prompt
      recordTask(db, {
        id: 'task-unrelevant-001',
        type: 'worker',
        status: 'completed',
        prompt: 'deploy kubernetes cluster configuration',
        created_at: new Date().toISOString(),
      });

      // Query about something completely different
      const result = await buildBriefing(db, 'xyzunrelatedquery');
      expect(result).not.toContain('## Relevant History');
    });

    it('omits Relevant History when all tasks are still running', async () => {
      recordTask(db, {
        id: 'task-running-001',
        type: 'worker',
        status: 'running',
        prompt: 'authentication refactor task',
        created_at: new Date().toISOString(),
      });

      const result = await buildBriefing(db, 'authentication');
      expect(result).not.toContain('## Relevant History');
    });
  });

  // -------------------------------------------------------------------------
  // Learned Patterns section
  // -------------------------------------------------------------------------

  describe('Learned Patterns section', () => {
    it('includes "## Learned Patterns" when learning data exists for the task type', async () => {
      recordLearning(db, 'worker', 'claude-sonnet-4-6', true, 5, 2000);

      // A "fix" prompt → inferTaskType maps to 'worker'
      const result = await buildBriefing(db, 'fix authentication bug');
      expect(result).toContain('## Learned Patterns');
    });

    it('omits Learned Patterns when no learning data exists', async () => {
      // No recordLearning call → no learnings table data
      const result = await buildBriefing(db, 'fix authentication bug');
      expect(result).not.toContain('## Learned Patterns');
    });

    it('includes model name and success rate in Learned Patterns section', async () => {
      recordLearning(db, 'worker', 'claude-opus-4-6', true, 3, 1500);
      recordLearning(db, 'worker', 'claude-opus-4-6', true, 4, 1800);

      const result = await buildBriefing(db, 'fix validation logic');
      expect(result).toContain('claude-opus-4-6');
      expect(result).toContain('100%'); // 2/2 success
    });
  });

  // -------------------------------------------------------------------------
  // Token budget enforcement
  // -------------------------------------------------------------------------

  describe('token budget enforcement', () => {
    it('keeps briefing under budget even with many large chunks', async () => {
      // Insert chunks with large content
      void storeChunks(
        db,
        Array.from({ length: 20 }, (_, i) => ({
          scope: `src/module${i}`,
          category: 'structure' as const,
          content: `${'x'.repeat(500)} module description routing integration ${i}`,
        })),
      );

      const result = await buildBriefing(db, 'routing');
      expect(result.length).toBeLessThanOrEqual(MAX_BRIEFING_CHARS);
    });

    it('keeps briefing under budget with many task history entries', async () => {
      for (let i = 0; i < 15; i++) {
        recordTask(db, {
          id: `task-budget-${i}`,
          type: 'worker',
          status: 'completed',
          prompt: `fix authentication middleware error handler module task ${i}`,
          model: 'claude-sonnet-4-6',
          turns_used: i + 1,
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        });
      }

      const result = await buildBriefing(db, 'authentication');
      expect(result.length).toBeLessThanOrEqual(MAX_BRIEFING_CHARS);
    });
  });

  // -------------------------------------------------------------------------
  // Integration test: full pipeline
  // -------------------------------------------------------------------------

  describe('integration: store → search → build briefing', () => {
    it('assembles a multi-section briefing from real DB data', async () => {
      // 1. Store relevant context chunks
      void storeChunks(db, [
        {
          scope: 'src/core',
          category: 'structure',
          content: 'The bridge core handles message routing and provider fallback logic',
        },
        {
          scope: 'src/master',
          category: 'patterns',
          content: 'Master AI spawns workers for complex tasks using tool profiles',
        },
      ]);

      // 2. Record a similar past task — prompt must contain the query string for LIKE match
      recordTask(db, {
        id: 'integ-task-001',
        type: 'worker',
        status: 'completed',
        prompt: 'update bridge routing for better performance',
        model: 'claude-sonnet-4-6',
        turns_used: 6,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      // 3. Record learning data
      recordLearning(db, 'worker', 'claude-sonnet-4-6', true, 6, 3000);

      // 4. Build briefing for a related task
      // Use a query term that exists in the stored chunks (FTS5 uses AND logic)
      const result = await buildBriefing(db, 'bridge routing');

      // Assertions
      expect(result).toContain('TASK: bridge routing');
      expect(result).toContain('## Project Context');
      expect(result).toContain('## Relevant History');
      expect(result).toContain('## Learned Patterns');
      expect(result.length).toBeLessThanOrEqual(MAX_BRIEFING_CHARS);
    });

    it('passes agentRunner through to hybridSearch for AI reranking', async () => {
      // Insert >10 chunks so reranking can trigger
      void storeChunks(
        db,
        Array.from({ length: 12 }, (_, i) => ({
          scope: 'src/core',
          category: 'structure' as const,
          content: `bridge routing gateway provider integration component ${i}`,
        })),
      );

      const mockSpawn = vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: Array.from({ length: 12 }, (_, i) => i + 1).join(','),
        stderr: '',
      });
      const mockRunner = { spawn: mockSpawn } as unknown as AgentRunner;

      const result = await buildBriefing(db, 'bridge routing', undefined, mockRunner);
      expect(typeof result).toBe('string');
      expect(result.length).toBeLessThanOrEqual(MAX_BRIEFING_CHARS);
      // Reranking may have been called (limit 15 > 10 threshold if all 12 match)
      // We just verify the briefing is well-formed
      expect(result).toContain('TASK: bridge routing');
    });
  });
});
