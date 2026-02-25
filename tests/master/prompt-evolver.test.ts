/**
 * Tests for prompt evolution (OB-734 / OB-737)
 *
 * Verifies that evolvePrompts() correctly:
 * - Spawns workers for underperforming prompts
 * - Creates a new prompt version when the worker succeeds
 * - Skips prompts with insufficient usage
 * - Handles worker failures gracefully
 * - Reverts a new version when it underperforms the previous one
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import { MemoryManager } from '../../src/memory/index.js';
import { getActivePrompt, getPromptStats } from '../../src/memory/prompt-store.js';
import { evolvePrompts } from '../../src/master/prompt-evolver.js';
import type { AgentRunner } from '../../src/core/agent-runner.js';
import type { AgentResult } from '../../src/core/agent-runner.js';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    stdout: 'You are an improved assistant that handles tasks efficiently.',
    stderr: '',
    exitCode: 0,
    durationMs: 100,
    retryCount: 0,
    ...overrides,
  };
}

function makeMockAgentRunner(result: AgentResult | Error): AgentRunner {
  return {
    spawn: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as AgentRunner;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('prompt-evolver.ts', () => {
  let db: Database.Database;
  let memory: MemoryManager;
  let tmpDir: string;
  let workspacePath: string;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-evolver-test-'));
    workspacePath = tmpDir;

    memory = new MemoryManager(':memory:');
    await memory.init();
  });

  afterEach(async () => {
    await memory.close();
    closeDatabase(db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // evolvePrompts — no candidates
  // -------------------------------------------------------------------------

  describe('evolvePrompts — no eligible candidates', () => {
    it('completes without error when no prompts exist', async () => {
      const runner = makeMockAgentRunner(makeAgentResult());
      await expect(evolvePrompts(memory, runner, workspacePath)).resolves.toBeUndefined();
    });

    it('does not create any new version when all prompts perform well', async () => {
      await memory.createPromptVersion('good-prompt', 'You are a helpful assistant.');
      // Force high effectiveness
      const innerDb = (memory as unknown as { db: Database.Database }).db;
      innerDb
        .prepare('UPDATE prompts SET effectiveness = 0.9, usage_count = 20 WHERE name = ?')
        .run('good-prompt');

      const runner = makeMockAgentRunner(makeAgentResult());
      await evolvePrompts(memory, runner, workspacePath);

      const stats = await memory.getPromptStats('good-prompt');
      expect(stats).toHaveLength(1); // no new version
    });

    it('skips underperforming prompts that have too few uses (< 10)', async () => {
      await memory.createPromptVersion('new-prompt', 'Initial content.');
      const innerDb = (memory as unknown as { db: Database.Database }).db;
      innerDb
        .prepare('UPDATE prompts SET effectiveness = 0.3, usage_count = 5 WHERE name = ?')
        .run('new-prompt');

      const runner = makeMockAgentRunner(makeAgentResult());
      await evolvePrompts(memory, runner, workspacePath);

      const stats = await memory.getPromptStats('new-prompt');
      expect(stats).toHaveLength(1); // still just version 1
    });
  });

  // -------------------------------------------------------------------------
  // evolvePrompts — new version created
  // -------------------------------------------------------------------------

  describe('evolvePrompts — creates new version on success', () => {
    it('creates a new prompt version when the worker returns improved content', async () => {
      await memory.createPromptVersion('slow-prompt', 'Original prompt content here.');
      const innerDb = (memory as unknown as { db: Database.Database }).db;
      innerDb
        .prepare('UPDATE prompts SET effectiveness = 0.4, usage_count = 15 WHERE name = ?')
        .run('slow-prompt');

      const runner = makeMockAgentRunner(
        makeAgentResult({ stdout: 'Improved prompt content that is different and better.' }),
      );
      await evolvePrompts(memory, runner, workspacePath);

      const stats = await memory.getPromptStats('slow-prompt');
      expect(stats).toHaveLength(2);
    });

    it('new version has neutral effectiveness (0.5)', async () => {
      await memory.createPromptVersion('evolving-prompt', 'Old content version one.');
      const innerDb = (memory as unknown as { db: Database.Database }).db;
      innerDb
        .prepare('UPDATE prompts SET effectiveness = 0.5, usage_count = 12 WHERE name = ?')
        .run('evolving-prompt');

      const runner = makeMockAgentRunner(
        makeAgentResult({ stdout: 'Completely new and improved content for the prompt.' }),
      );
      await evolvePrompts(memory, runner, workspacePath);

      const active = getActivePrompt(innerDb, 'evolving-prompt');
      expect(active).not.toBeNull();
      expect(active!.effectiveness).toBe(0.5);
    });

    it('new version is set as active and previous version is deactivated', async () => {
      await memory.createPromptVersion('active-test', 'Version one of the prompt content.');
      const innerDb = (memory as unknown as { db: Database.Database }).db;
      innerDb
        .prepare('UPDATE prompts SET effectiveness = 0.3, usage_count = 20 WHERE name = ?')
        .run('active-test');

      const runner = makeMockAgentRunner(
        makeAgentResult({ stdout: 'Version two improved content significantly better.' }),
      );
      await evolvePrompts(memory, runner, workspacePath);

      const allVersions = getPromptStats(innerDb, 'active-test');
      expect(allVersions).toHaveLength(2);

      const activeVersions = allVersions.filter((v) => v.active);
      expect(activeVersions).toHaveLength(1);
      expect(activeVersions[0].version).toBe(2);
    });

    it('strips markdown code fences from worker output', async () => {
      await memory.createPromptVersion('fenced-prompt', 'Old prompt content to replace.');
      const innerDb = (memory as unknown as { db: Database.Database }).db;
      innerDb
        .prepare('UPDATE prompts SET effectiveness = 0.3, usage_count = 15 WHERE name = ?')
        .run('fenced-prompt');

      const runner = makeMockAgentRunner(
        makeAgentResult({
          stdout: '```\nClean improved prompt without fences after stripping.\n```',
        }),
      );
      await evolvePrompts(memory, runner, workspacePath);

      const active = getActivePrompt(innerDb, 'fenced-prompt');
      expect(active!.content).not.toContain('```');
      expect(active!.content).toBe('Clean improved prompt without fences after stripping.');
    });
  });

  // -------------------------------------------------------------------------
  // evolvePrompts — worker failures
  // -------------------------------------------------------------------------

  describe('evolvePrompts — handles worker failures gracefully', () => {
    it('does not create a new version when the worker throws an error', async () => {
      await memory.createPromptVersion('throw-prompt', 'Original content that stays.');
      const innerDb = (memory as unknown as { db: Database.Database }).db;
      innerDb
        .prepare('UPDATE prompts SET effectiveness = 0.3, usage_count = 15 WHERE name = ?')
        .run('throw-prompt');

      const runner = makeMockAgentRunner(new Error('Agent spawn failed'));
      await expect(evolvePrompts(memory, runner, workspacePath)).resolves.toBeUndefined();

      const stats = getPromptStats(innerDb, 'throw-prompt');
      expect(stats).toHaveLength(1);
    });

    it('does not create a new version when the worker exits with non-zero code', async () => {
      await memory.createPromptVersion('fail-prompt', 'Prompt that should not be replaced.');
      const innerDb = (memory as unknown as { db: Database.Database }).db;
      innerDb
        .prepare('UPDATE prompts SET effectiveness = 0.3, usage_count = 15 WHERE name = ?')
        .run('fail-prompt');

      const runner = makeMockAgentRunner(makeAgentResult({ exitCode: 1, stdout: '' }));
      await evolvePrompts(memory, runner, workspacePath);

      const stats = getPromptStats(innerDb, 'fail-prompt');
      expect(stats).toHaveLength(1);
    });

    it('does not create a new version when the worker returns empty output', async () => {
      await memory.createPromptVersion('empty-output-prompt', 'Content that stays unchanged.');
      const innerDb = (memory as unknown as { db: Database.Database }).db;
      innerDb
        .prepare('UPDATE prompts SET effectiveness = 0.3, usage_count = 15 WHERE name = ?')
        .run('empty-output-prompt');

      const runner = makeMockAgentRunner(makeAgentResult({ stdout: '   ' }));
      await evolvePrompts(memory, runner, workspacePath);

      const stats = getPromptStats(innerDb, 'empty-output-prompt');
      expect(stats).toHaveLength(1);
    });

    it('does not create a new version when the worker returns the same content', async () => {
      const content = 'Exact same content, no changes made here.';
      await memory.createPromptVersion('unchanged-prompt', content);
      const innerDb = (memory as unknown as { db: Database.Database }).db;
      innerDb
        .prepare('UPDATE prompts SET effectiveness = 0.3, usage_count = 15 WHERE name = ?')
        .run('unchanged-prompt');

      const runner = makeMockAgentRunner(makeAgentResult({ stdout: content }));
      await evolvePrompts(memory, runner, workspacePath);

      const stats = getPromptStats(innerDb, 'unchanged-prompt');
      expect(stats).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Revert logic
  // -------------------------------------------------------------------------

  describe('checkAndRevertIfWorse — revert when new version underperforms', () => {
    it('reverts a new version that performs worse than its predecessor', async () => {
      // Set up v1 with high effectiveness
      await memory.createPromptVersion('revert-test', 'Version one content that worked well.');
      const innerDb = (memory as unknown as { db: Database.Database }).db;
      innerDb
        .prepare('UPDATE prompts SET effectiveness = 0.85, usage_count = 30 WHERE name = ?')
        .run('revert-test');

      // Create v2 and make it perform poorly with enough uses
      await memory.createPromptVersion('revert-test', 'Version two content that is much worse.');
      innerDb
        .prepare(
          'UPDATE prompts SET effectiveness = 0.2, usage_count = 25 WHERE name = ? AND active = 1',
        )
        .run('revert-test');

      // Run evolution cycle (no new candidates but revert check should trigger)
      const runner = makeMockAgentRunner(makeAgentResult());
      await evolvePrompts(memory, runner, workspacePath);

      // A v3 should have been created restoring v1's content
      const stats = getPromptStats(innerDb, 'revert-test');
      expect(stats.length).toBeGreaterThanOrEqual(3);

      const latest = stats[0];
      expect(latest.content).toBe('Version one content that worked well.');
    });

    it('does not revert when the new version has insufficient usage data', async () => {
      await memory.createPromptVersion('no-revert', 'Version one content original.');
      const innerDb = (memory as unknown as { db: Database.Database }).db;
      innerDb
        .prepare('UPDATE prompts SET effectiveness = 0.9, usage_count = 30 WHERE name = ?')
        .run('no-revert');

      await memory.createPromptVersion('no-revert', 'Version two has not been used enough yet.');
      // Only 5 uses — below MIN_USES_FOR_COMPARISON (20)
      innerDb
        .prepare(
          'UPDATE prompts SET effectiveness = 0.1, usage_count = 5 WHERE name = ? AND active = 1',
        )
        .run('no-revert');

      const runner = makeMockAgentRunner(makeAgentResult());
      await evolvePrompts(memory, runner, workspacePath);

      const stats = getPromptStats(innerDb, 'no-revert');
      expect(stats).toHaveLength(2); // no v3 created
    });
  });

  // -------------------------------------------------------------------------
  // getPromptStats
  // -------------------------------------------------------------------------

  describe('getPromptStats', () => {
    it('returns all versions ordered by version descending', async () => {
      await memory.createPromptVersion('stats-prompt', 'v1 content');
      await memory.createPromptVersion('stats-prompt', 'v2 content');
      await memory.createPromptVersion('stats-prompt', 'v3 content');

      const stats = await memory.getPromptStats('stats-prompt');
      expect(stats).toHaveLength(3);
      expect(stats[0].version).toBe(3);
      expect(stats[1].version).toBe(2);
      expect(stats[2].version).toBe(1);
    });

    it('includes effectiveness, usage_count, and success_count per version', async () => {
      await memory.createPromptVersion('track-prompt', 'initial content');
      await memory.recordPromptOutcome('track-prompt', true);
      await memory.recordPromptOutcome('track-prompt', false);

      const stats = await memory.getPromptStats('track-prompt');
      expect(stats[0].usage_count).toBe(2);
      expect(stats[0].success_count).toBe(1);
      expect(stats[0].effectiveness).toBeCloseTo(0.5, 1);
    });

    it('returns empty array when the prompt does not exist', async () => {
      const stats = await memory.getPromptStats('nonexistent-prompt-xyz');
      expect(stats).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getHighEffectivenessPrompts
  // -------------------------------------------------------------------------

  describe('getHighEffectivenessPrompts', () => {
    it('returns prompts at or above the threshold with enough uses', async () => {
      await memory.createPromptVersion('high-eff', 'high performing prompt content');
      const innerDb = (memory as unknown as { db: Database.Database }).db;
      innerDb
        .prepare('UPDATE prompts SET effectiveness = 0.9, usage_count = 10 WHERE name = ?')
        .run('high-eff');

      const results = await memory.getHighEffectivenessPrompts(0.7, 5);
      expect(results.some((r) => r.name === 'high-eff')).toBe(true);
    });

    it('excludes prompts below minimum usage count', async () => {
      await memory.createPromptVersion('low-use-high-eff', 'high quality but few uses');
      const innerDb = (memory as unknown as { db: Database.Database }).db;
      innerDb
        .prepare('UPDATE prompts SET effectiveness = 0.95, usage_count = 2 WHERE name = ?')
        .run('low-use-high-eff');

      const results = await memory.getHighEffectivenessPrompts(0.7, 5);
      expect(results.every((r) => r.name !== 'low-use-high-eff')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // recordPromptOutcome — stats accuracy
  // -------------------------------------------------------------------------

  describe('recordPromptOutcome — stats accuracy', () => {
    it('effectiveness converges to 1.0 after all successful uses', async () => {
      await memory.createPromptVersion('perfect-prompt', 'content');
      for (let i = 0; i < 10; i++) {
        await memory.recordPromptOutcome('perfect-prompt', true);
      }
      const active = await memory.getActivePrompt('perfect-prompt');
      expect(active.effectiveness).toBeCloseTo(1.0, 2);
    });

    it('effectiveness converges to 0.0 after all failed uses', async () => {
      await memory.createPromptVersion('failing-prompt', 'content');
      for (let i = 0; i < 10; i++) {
        await memory.recordPromptOutcome('failing-prompt', false);
      }
      const active = await memory.getActivePrompt('failing-prompt');
      expect(active.effectiveness).toBeCloseTo(0.0, 2);
    });
  });
});
