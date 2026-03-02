/**
 * Tests for prompt effectiveness tracking (OB-172)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import { seedPromptLibrary } from '../../src/master/seed-prompts.js';

describe('Prompt Effectiveness Tracking', () => {
  let testWorkspacePath: string;
  let dotFolder: DotFolderManager;

  beforeEach(async () => {
    testWorkspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'test-workspace-effectiveness-'));
    dotFolder = new DotFolderManager(testWorkspacePath);
    await dotFolder.initialize();
    await seedPromptLibrary(dotFolder);
  });

  afterEach(async () => {
    await fs.rm(testWorkspacePath, { recursive: true, force: true });
  });

  describe('Prompt Manifest and Tracking', () => {
    it('should track successful prompt usage and update success rate', async () => {
      await dotFolder.recordPromptUsage('exploration-structure-scan', true);

      const template = await dotFolder.getPromptTemplate('exploration-structure-scan');
      expect(template).not.toBeNull();
      expect(template!.usageCount).toBe(1);
      expect(template!.successCount).toBe(1);
      expect(template!.successRate).toBe(1.0);
      expect(template!.lastUsedAt).toBeDefined();
    });

    it('should track failed prompt usage', async () => {
      await dotFolder.recordPromptUsage('exploration-classification', false);

      const template = await dotFolder.getPromptTemplate('exploration-classification');
      expect(template).not.toBeNull();
      expect(template!.usageCount).toBe(1);
      expect(template!.successCount).toBe(0);
      expect(template!.successRate).toBe(0.0);
    });

    it('should calculate success rate correctly over multiple uses', async () => {
      const promptId = 'task-execute';

      // 3 successes, 2 failures = 60% success rate
      await dotFolder.recordPromptUsage(promptId, true);
      await dotFolder.recordPromptUsage(promptId, true);
      await dotFolder.recordPromptUsage(promptId, false);
      await dotFolder.recordPromptUsage(promptId, true);
      await dotFolder.recordPromptUsage(promptId, false);

      const template = await dotFolder.getPromptTemplate(promptId);
      expect(template).not.toBeNull();
      expect(template!.usageCount).toBe(5);
      expect(template!.successCount).toBe(3);
      expect(template!.successRate).toBe(0.6);
    });

    it('should identify low-performing prompts based on threshold', async () => {
      // Prompt 1: 80% success rate (4/5) - should NOT be flagged
      for (let i = 0; i < 4; i++) {
        await dotFolder.recordPromptUsage('exploration-structure-scan', true);
      }
      await dotFolder.recordPromptUsage('exploration-structure-scan', false);

      // Prompt 2: 40% success rate (2/5) - should be flagged
      for (let i = 0; i < 2; i++) {
        await dotFolder.recordPromptUsage('task-verify', true);
      }
      for (let i = 0; i < 3; i++) {
        await dotFolder.recordPromptUsage('task-verify', false);
      }

      const lowPerforming = await dotFolder.getLowPerformingPrompts(0.5);
      expect(lowPerforming).toHaveLength(1);
      expect(lowPerforming[0].id).toBe('task-verify');
      expect(lowPerforming[0].successRate).toBe(0.4);
    });

    it('should not flag prompts with insufficient usage data', async () => {
      // Only 2 uses (below minimum of 3)
      await dotFolder.recordPromptUsage('task-execute', false);
      await dotFolder.recordPromptUsage('task-execute', false);

      const lowPerforming = await dotFolder.getLowPerformingPrompts(0.5);
      expect(lowPerforming).toHaveLength(0);
    });

    it('should allow custom threshold for low-performing detection', async () => {
      // 60% success rate (3/5)
      for (let i = 0; i < 3; i++) {
        await dotFolder.recordPromptUsage('exploration-classification', true);
      }
      for (let i = 0; i < 2; i++) {
        await dotFolder.recordPromptUsage('exploration-classification', false);
      }

      // Not flagged with 0.5 threshold
      const lowPerforming50 = await dotFolder.getLowPerformingPrompts(0.5);
      expect(lowPerforming50).toHaveLength(0);

      // Flagged with 0.7 threshold
      const lowPerforming70 = await dotFolder.getLowPerformingPrompts(0.7);
      expect(lowPerforming70).toHaveLength(1);
      expect(lowPerforming70[0].id).toBe('exploration-classification');
    });

    it('should track multiple prompts independently', async () => {
      // Prompt 1: 100% success
      await dotFolder.recordPromptUsage('exploration-structure-scan', true);
      await dotFolder.recordPromptUsage('exploration-structure-scan', true);
      await dotFolder.recordPromptUsage('exploration-structure-scan', true);

      // Prompt 2: 0% success
      await dotFolder.recordPromptUsage('task-verify', false);
      await dotFolder.recordPromptUsage('task-verify', false);
      await dotFolder.recordPromptUsage('task-verify', false);

      const template1 = await dotFolder.getPromptTemplate('exploration-structure-scan');
      expect(template1!.usageCount).toBe(3);
      expect(template1!.successRate).toBe(1.0);

      const template2 = await dotFolder.getPromptTemplate('task-verify');
      expect(template2!.usageCount).toBe(3);
      expect(template2!.successRate).toBe(0.0);

      // Only template2 should be flagged
      const lowPerforming = await dotFolder.getLowPerformingPrompts(0.5);
      expect(lowPerforming).toHaveLength(1);
      expect(lowPerforming[0].id).toBe('task-verify');
    });

    it('should handle non-existent prompt gracefully', async () => {
      await expect(dotFolder.recordPromptUsage('non-existent', true)).resolves.not.toThrow();

      const template = await dotFolder.getPromptTemplate('non-existent');
      expect(template).toBeNull();
    });

    it('should preserve all seed prompts in manifest', async () => {
      const manifest = await dotFolder.readPromptManifest();
      expect(manifest).not.toBeNull();

      const expectedPrompts = [
        'exploration-structure-scan',
        'exploration-classification',
        'task-execute',
        'task-verify',
      ];

      for (const promptId of expectedPrompts) {
        expect(manifest!.prompts[promptId]).toBeDefined();
        expect(manifest!.prompts[promptId].id).toBe(promptId);
        expect(manifest!.prompts[promptId].usageCount).toBe(0);
        expect(manifest!.prompts[promptId].successCount).toBe(0);
      }
    });
  });
});
