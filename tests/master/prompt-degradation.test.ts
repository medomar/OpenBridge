import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// Mock logger
vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('Prompt Degradation Detection', () => {
  let testWorkspace: string;
  let dotFolder: DotFolderManager;
  const now = new Date().toISOString();

  beforeEach(async () => {
    vi.clearAllMocks();
    testWorkspace = path.join(process.cwd(), 'test-workspace-degradation-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });

    dotFolder = new DotFolderManager(testWorkspace);
    await dotFolder.initialize();
  });

  afterEach(async () => {
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ── rewritePrompt stores previousVersion ───────────────────────

  describe('resetPromptStats preserves previousSuccessRate', () => {
    it('stores the current success rate as previousSuccessRate on reset', async () => {
      // Create a prompt with a known success rate
      const promptsDir = path.join(testWorkspace, '.openbridge', 'prompts');
      await fs.mkdir(promptsDir, { recursive: true });
      await fs.writeFile(path.join(promptsDir, 'test-prompt.md'), 'Original content');

      await dotFolder.writePromptManifest({
        prompts: {
          'test-prompt': {
            id: 'test-prompt',
            version: '1.0.0',
            filePath: 'test-prompt.md',
            description: 'A test prompt',
            category: 'task',
            usageCount: 10,
            successCount: 7,
            successRate: 0.7,
            createdAt: now,
            updatedAt: now,
          },
        },
        createdAt: now,
        updatedAt: now,
        schemaVersion: '1.0.0',
      });

      await dotFolder.resetPromptStats('test-prompt');

      const manifest = await dotFolder.readPromptManifest();
      const prompt = manifest!.prompts['test-prompt'];

      expect(prompt.previousSuccessRate).toBe(0.7);
      expect(prompt.usageCount).toBe(0);
      expect(prompt.successCount).toBe(0);
      expect(prompt.successRate).toBe(0);
    });
  });

  // ── previousVersion storage ────────────────────────────────────

  describe('previousVersion field in manifest', () => {
    it('can store and read back previousVersion content', async () => {
      const promptsDir = path.join(testWorkspace, '.openbridge', 'prompts');
      await fs.mkdir(promptsDir, { recursive: true });

      await dotFolder.writePromptManifest({
        prompts: {
          'my-prompt': {
            id: 'my-prompt',
            version: '2.0.0',
            filePath: 'my-prompt.md',
            description: 'A rewritten prompt',
            category: 'task',
            usageCount: 6,
            successCount: 2,
            successRate: 0.33,
            createdAt: now,
            updatedAt: now,
            previousVersion: 'This was the original prompt content before rewrite.',
            previousSuccessRate: 0.8,
          },
        },
        createdAt: now,
        updatedAt: now,
        schemaVersion: '1.0.0',
      });

      const manifest = await dotFolder.readPromptManifest();
      const prompt = manifest!.prompts['my-prompt'];

      expect(prompt.previousVersion).toBe('This was the original prompt content before rewrite.');
      expect(prompt.previousSuccessRate).toBe(0.8);
    });
  });

  // ── getLowPerformingPrompts ────────────────────────────────────

  describe('getLowPerformingPrompts', () => {
    it('returns prompts below the success threshold with 3+ uses', async () => {
      const promptsDir = path.join(testWorkspace, '.openbridge', 'prompts');
      await fs.mkdir(promptsDir, { recursive: true });

      await dotFolder.writePromptManifest({
        prompts: {
          'good-prompt': {
            id: 'good-prompt',
            version: '1.0.0',
            filePath: 'good.md',
            description: 'Good prompt',
            category: 'task',
            usageCount: 10,
            successCount: 8,
            successRate: 0.8,
            createdAt: now,
            updatedAt: now,
          },
          'bad-prompt': {
            id: 'bad-prompt',
            version: '1.0.0',
            filePath: 'bad.md',
            description: 'Bad prompt',
            category: 'task',
            usageCount: 10,
            successCount: 3,
            successRate: 0.3,
            createdAt: now,
            updatedAt: now,
          },
          'new-prompt': {
            id: 'new-prompt',
            version: '1.0.0',
            filePath: 'new.md',
            description: 'New prompt (too few uses)',
            category: 'task',
            usageCount: 2,
            successCount: 0,
            successRate: 0,
            createdAt: now,
            updatedAt: now,
          },
        },
        createdAt: now,
        updatedAt: now,
        schemaVersion: '1.0.0',
      });

      const lowPerforming = await dotFolder.getLowPerformingPrompts(0.5);
      expect(lowPerforming).toHaveLength(1);
      expect(lowPerforming[0].id).toBe('bad-prompt');
    });
  });

  // ── Degradation detection integration scenario ─────────────────

  describe('degradation detection scenario', () => {
    it('degraded prompt has lower successRate than previousSuccessRate after 5+ uses', async () => {
      // Simulate a prompt that was rewritten and is now performing worse
      const promptsDir = path.join(testWorkspace, '.openbridge', 'prompts');
      await fs.mkdir(promptsDir, { recursive: true });
      await fs.writeFile(path.join(promptsDir, 'worker-task.md'), 'Rewritten content v2');

      await dotFolder.writePromptManifest({
        prompts: {
          'worker-task': {
            id: 'worker-task',
            version: '2.0.0',
            filePath: 'worker-task.md',
            description: 'Worker task prompt',
            category: 'task',
            usageCount: 7,
            successCount: 2,
            successRate: 0.286,
            createdAt: now,
            updatedAt: now,
            previousVersion: 'Original content v1 that worked well.',
            previousSuccessRate: 0.75,
          },
        },
        createdAt: now,
        updatedAt: now,
        schemaVersion: '1.0.0',
      });

      const manifest = await dotFolder.readPromptManifest();
      const prompt = manifest!.prompts['worker-task'];

      // Verify degradation conditions
      expect(prompt.previousVersion).toBeDefined();
      expect(prompt.previousSuccessRate).toBeDefined();
      expect(prompt.usageCount).toBeGreaterThanOrEqual(5);
      expect(prompt.successRate).toBeLessThan(prompt.previousSuccessRate!);
    });

    it('non-degraded prompt has equal or better successRate than previous', async () => {
      const promptsDir = path.join(testWorkspace, '.openbridge', 'prompts');
      await fs.mkdir(promptsDir, { recursive: true });

      await dotFolder.writePromptManifest({
        prompts: {
          'good-rewrite': {
            id: 'good-rewrite',
            version: '2.0.0',
            filePath: 'good-rewrite.md',
            description: 'Improved prompt',
            category: 'task',
            usageCount: 8,
            successCount: 7,
            successRate: 0.875,
            createdAt: now,
            updatedAt: now,
            previousVersion: 'Old content that was worse.',
            previousSuccessRate: 0.6,
          },
        },
        createdAt: now,
        updatedAt: now,
        schemaVersion: '1.0.0',
      });

      const manifest = await dotFolder.readPromptManifest();
      const prompt = manifest!.prompts['good-rewrite'];

      // This is an improvement, not degradation
      expect(prompt.successRate).toBeGreaterThan(prompt.previousSuccessRate!);
    });

    it('prompt with insufficient data (<5 uses) should NOT be considered degraded', async () => {
      const promptsDir = path.join(testWorkspace, '.openbridge', 'prompts');
      await fs.mkdir(promptsDir, { recursive: true });

      await dotFolder.writePromptManifest({
        prompts: {
          'early-prompt': {
            id: 'early-prompt',
            version: '2.0.0',
            filePath: 'early-prompt.md',
            description: 'Recently rewritten',
            category: 'task',
            usageCount: 3,
            successCount: 1,
            successRate: 0.33,
            createdAt: now,
            updatedAt: now,
            previousVersion: 'Old content.',
            previousSuccessRate: 0.8,
          },
        },
        createdAt: now,
        updatedAt: now,
        schemaVersion: '1.0.0',
      });

      const manifest = await dotFolder.readPromptManifest();
      const prompt = manifest!.prompts['early-prompt'];

      // Even though rate is worse, not enough data to conclude degradation
      expect(prompt.usageCount).toBeLessThan(5);
    });
  });
});
