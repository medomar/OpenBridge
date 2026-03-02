/**
 * Tests for prompt library functionality (OB-170)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import { seedPromptLibrary, SEED_PROMPTS } from '../../src/master/seed-prompts.js';
import type { PromptManifest } from '../../src/types/master.js';

describe('Prompt Library', () => {
  let testWorkspacePath: string;
  let dotFolder: DotFolderManager;

  beforeEach(async () => {
    testWorkspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'test-workspace-prompts-'));
    dotFolder = new DotFolderManager(testWorkspacePath);
    await dotFolder.initialize();
  });

  afterEach(async () => {
    await fs.rm(testWorkspacePath, { recursive: true, force: true });
  });

  describe('Prompt Manifest', () => {
    it('should create empty manifest when none exists', async () => {
      const manifest = await dotFolder.readPromptManifest();
      expect(manifest).toBeNull();
    });

    it('should write and read prompt manifest', async () => {
      const now = new Date().toISOString();
      const manifest: PromptManifest = {
        prompts: {},
        createdAt: now,
        updatedAt: now,
        schemaVersion: '1.0.0',
      };

      await dotFolder.writePromptManifest(manifest);
      const read = await dotFolder.readPromptManifest();

      expect(read).toEqual(manifest);
    });

    it('should validate manifest schema on write', async () => {
      const invalidManifest: any = {
        prompts: {},
        // Missing required fields
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(dotFolder.writePromptManifest(invalidManifest)).rejects.toThrow();
    });
  });

  describe('Prompt Templates', () => {
    it('should write and read a prompt template file', async () => {
      const content = '# Test Prompt\n\nThis is a test prompt.';
      const filename = 'test-prompt.md';

      await dotFolder.writePromptTemplate(filename, content, {
        id: 'test-prompt',
        version: '1.0.0',
        description: 'Test prompt',
        category: 'task',
        usageCount: 0,
        successCount: 0,
      });

      const readContent = await dotFolder.readPromptTemplate(filename);
      expect(readContent).toBe(content);
    });

    it('should update manifest when writing prompt template', async () => {
      const content = '# Test Prompt';
      const filename = 'test-prompt.md';

      await dotFolder.writePromptTemplate(filename, content, {
        id: 'test-prompt',
        version: '1.0.0',
        description: 'Test prompt',
        category: 'exploration',
        usageCount: 0,
        successCount: 0,
      });

      const manifest = await dotFolder.readPromptManifest();
      expect(manifest).not.toBeNull();
      expect(manifest!.prompts['test-prompt']).toBeDefined();
      expect(manifest!.prompts['test-prompt'].filePath).toBe(filename);
      expect(manifest!.prompts['test-prompt'].description).toBe('Test prompt');
      expect(manifest!.prompts['test-prompt'].category).toBe('exploration');
    });

    it('should preserve createdAt when updating existing prompt', async () => {
      const content1 = '# Version 1';
      const content2 = '# Version 2';
      const filename = 'test-prompt.md';

      // Write initial version
      await dotFolder.writePromptTemplate(filename, content1, {
        id: 'test-prompt',
        version: '1.0.0',
        description: 'Test prompt v1',
        category: 'task',
        usageCount: 0,
        successCount: 0,
      });

      const manifest1 = await dotFolder.readPromptManifest();
      const createdAt1 = manifest1!.prompts['test-prompt'].createdAt;

      // Wait a bit to ensure timestamps differ
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Update version
      await dotFolder.writePromptTemplate(filename, content2, {
        id: 'test-prompt',
        version: '2.0.0',
        description: 'Test prompt v2',
        category: 'task',
        usageCount: 0,
        successCount: 0,
      });

      const manifest2 = await dotFolder.readPromptManifest();
      expect(manifest2!.prompts['test-prompt'].createdAt).toBe(createdAt1);
      expect(manifest2!.prompts['test-prompt'].version).toBe('2.0.0');
      expect(manifest2!.prompts['test-prompt'].description).toBe('Test prompt v2');
    });

    it('should get a prompt template by ID', async () => {
      await dotFolder.writePromptTemplate('test-prompt.md', '# Test', {
        id: 'test-prompt',
        version: '1.0.0',
        description: 'Test prompt',
        category: 'verification',
        usageCount: 0,
        successCount: 0,
      });

      const template = await dotFolder.getPromptTemplate('test-prompt');
      expect(template).not.toBeNull();
      expect(template!.id).toBe('test-prompt');
      expect(template!.version).toBe('1.0.0');
    });

    it('should return null for non-existent prompt', async () => {
      const template = await dotFolder.getPromptTemplate('non-existent');
      expect(template).toBeNull();
    });
  });

  describe('Prompt Usage Tracking', () => {
    beforeEach(async () => {
      await dotFolder.writePromptTemplate('test-prompt.md', '# Test', {
        id: 'test-prompt',
        version: '1.0.0',
        description: 'Test prompt',
        category: 'task',
        usageCount: 0,
        successCount: 0,
      });
    });

    it('should increment usage count on successful execution', async () => {
      await dotFolder.recordPromptUsage('test-prompt', true);

      const template = await dotFolder.getPromptTemplate('test-prompt');
      expect(template!.usageCount).toBe(1);
      expect(template!.successCount).toBe(1);
      expect(template!.successRate).toBe(1.0);
      expect(template!.lastUsedAt).toBeDefined();
    });

    it('should increment usage count but not success count on failure', async () => {
      await dotFolder.recordPromptUsage('test-prompt', false);

      const template = await dotFolder.getPromptTemplate('test-prompt');
      expect(template!.usageCount).toBe(1);
      expect(template!.successCount).toBe(0);
      expect(template!.successRate).toBe(0.0);
    });

    it('should calculate success rate correctly', async () => {
      // 3 successes, 2 failures = 60% success rate
      await dotFolder.recordPromptUsage('test-prompt', true);
      await dotFolder.recordPromptUsage('test-prompt', true);
      await dotFolder.recordPromptUsage('test-prompt', false);
      await dotFolder.recordPromptUsage('test-prompt', true);
      await dotFolder.recordPromptUsage('test-prompt', false);

      const template = await dotFolder.getPromptTemplate('test-prompt');
      expect(template!.usageCount).toBe(5);
      expect(template!.successCount).toBe(3);
      expect(template!.successRate).toBe(0.6);
    });

    it('should not error when recording usage for non-existent prompt', async () => {
      await expect(dotFolder.recordPromptUsage('non-existent', true)).resolves.not.toThrow();
    });
  });

  describe('Low-Performing Prompts Detection', () => {
    it('should identify prompts with success rate below threshold', async () => {
      // Prompt 1: 80% success rate (4/5) - should NOT be flagged
      await dotFolder.writePromptTemplate('good-prompt.md', '# Good', {
        id: 'good-prompt',
        version: '1.0.0',
        description: 'Good prompt',
        category: 'task',
        usageCount: 0,
        successCount: 0,
      });
      await dotFolder.recordPromptUsage('good-prompt', true);
      await dotFolder.recordPromptUsage('good-prompt', true);
      await dotFolder.recordPromptUsage('good-prompt', true);
      await dotFolder.recordPromptUsage('good-prompt', true);
      await dotFolder.recordPromptUsage('good-prompt', false);

      // Prompt 2: 40% success rate (2/5) - should be flagged
      await dotFolder.writePromptTemplate('bad-prompt.md', '# Bad', {
        id: 'bad-prompt',
        version: '1.0.0',
        description: 'Bad prompt',
        category: 'task',
        usageCount: 0,
        successCount: 0,
      });
      await dotFolder.recordPromptUsage('bad-prompt', true);
      await dotFolder.recordPromptUsage('bad-prompt', true);
      await dotFolder.recordPromptUsage('bad-prompt', false);
      await dotFolder.recordPromptUsage('bad-prompt', false);
      await dotFolder.recordPromptUsage('bad-prompt', false);

      const lowPerforming = await dotFolder.getLowPerformingPrompts(0.5);
      expect(lowPerforming).toHaveLength(1);
      expect(lowPerforming[0].id).toBe('bad-prompt');
    });

    it('should not flag prompts with < 3 usages (insufficient data)', async () => {
      await dotFolder.writePromptTemplate('new-prompt.md', '# New', {
        id: 'new-prompt',
        version: '1.0.0',
        description: 'New prompt',
        category: 'task',
        usageCount: 0,
        successCount: 0,
      });

      // Only 2 usages, both failures (0% success rate)
      await dotFolder.recordPromptUsage('new-prompt', false);
      await dotFolder.recordPromptUsage('new-prompt', false);

      const lowPerforming = await dotFolder.getLowPerformingPrompts(0.5);
      expect(lowPerforming).toHaveLength(0); // Not flagged due to low usage count
    });

    it('should use custom threshold', async () => {
      await dotFolder.writePromptTemplate('mid-prompt.md', '# Mid', {
        id: 'mid-prompt',
        version: '1.0.0',
        description: 'Mid prompt',
        category: 'task',
        usageCount: 0,
        successCount: 0,
      });

      // 60% success rate (3/5)
      await dotFolder.recordPromptUsage('mid-prompt', true);
      await dotFolder.recordPromptUsage('mid-prompt', true);
      await dotFolder.recordPromptUsage('mid-prompt', true);
      await dotFolder.recordPromptUsage('mid-prompt', false);
      await dotFolder.recordPromptUsage('mid-prompt', false);

      // Not flagged with 0.5 threshold
      const lowPerforming50 = await dotFolder.getLowPerformingPrompts(0.5);
      expect(lowPerforming50).toHaveLength(0);

      // Flagged with 0.7 threshold
      const lowPerforming70 = await dotFolder.getLowPerformingPrompts(0.7);
      expect(lowPerforming70).toHaveLength(1);
      expect(lowPerforming70[0].id).toBe('mid-prompt');
    });

    it('should return empty array when no manifest exists', async () => {
      const tempFolder = new DotFolderManager(path.join(testWorkspacePath, 'temp'));
      await tempFolder.initialize();

      const lowPerforming = await tempFolder.getLowPerformingPrompts();
      expect(lowPerforming).toEqual([]);
    });
  });

  describe('Seed Prompts', () => {
    it('should seed all initial prompt templates', async () => {
      await seedPromptLibrary(dotFolder);

      const manifest = await dotFolder.readPromptManifest();
      expect(manifest).not.toBeNull();
      expect(Object.keys(manifest!.prompts)).toHaveLength(SEED_PROMPTS.length);

      for (const seedPrompt of SEED_PROMPTS) {
        const template = await dotFolder.getPromptTemplate(seedPrompt.id);
        expect(template).not.toBeNull();
        expect(template!.id).toBe(seedPrompt.id);
        expect(template!.version).toBe(seedPrompt.version);
        expect(template!.description).toBe(seedPrompt.description);
        expect(template!.category).toBe(seedPrompt.category);
        expect(template!.usageCount).toBe(0);
        expect(template!.successCount).toBe(0);

        const content = await dotFolder.readPromptTemplate(seedPrompt.filename);
        expect(content).toBe(seedPrompt.content);
      }
    });

    it('should have exploration-structure-scan prompt', async () => {
      await seedPromptLibrary(dotFolder);

      const template = await dotFolder.getPromptTemplate('exploration-structure-scan');
      expect(template).not.toBeNull();
      expect(template!.category).toBe('exploration');

      const content = await dotFolder.readPromptTemplate(template!.filePath);
      expect(content).toContain('Workspace Structure Scan');
      expect(content).toContain('{{workspacePath}}');
      expect(content).toContain('topLevelFiles');
      expect(content).toContain('directoryCounts');
    });

    it('should have exploration-classification prompt', async () => {
      await seedPromptLibrary(dotFolder);

      const template = await dotFolder.getPromptTemplate('exploration-classification');
      expect(template).not.toBeNull();
      expect(template!.category).toBe('exploration');

      const content = await dotFolder.readPromptTemplate(template!.filePath);
      expect(content).toContain('Project Classification');
      expect(content).toContain('{{structureScan}}');
      expect(content).toContain('projectType');
      expect(content).toContain('frameworks');
    });

    it('should have task-execute prompt', async () => {
      await seedPromptLibrary(dotFolder);

      const template = await dotFolder.getPromptTemplate('task-execute');
      expect(template).not.toBeNull();
      expect(template!.category).toBe('task');

      const content = await dotFolder.readPromptTemplate(template!.filePath);
      expect(content).toContain('Execute User Request');
      expect(content).toContain('{{userMessage}}');
      expect(content).toContain('{{projectName}}');
    });

    it('should have task-verify prompt', async () => {
      await seedPromptLibrary(dotFolder);

      const template = await dotFolder.getPromptTemplate('task-verify');
      expect(template).not.toBeNull();
      expect(template!.category).toBe('verification');

      const content = await dotFolder.readPromptTemplate(template!.filePath);
      expect(content).toContain('Verify Implementation');
      expect(content).toContain('{{taskDescription}}');
      expect(content).toContain('"verified"');
    });
  });

  describe('Prompt Template previousVersion (OB-F63)', () => {
    it('should store undefined previousVersion on first write', async () => {
      // First write — no previous file exists, so previousVersion must be undefined
      await dotFolder.writePromptTemplate('evolving-prompt.md', '# First version', {
        id: 'evolving-prompt',
        version: '1.0.0',
        description: 'Evolving prompt',
        category: 'task',
        usageCount: 0,
        successCount: 0,
      });

      const template = await dotFolder.getPromptTemplate('evolving-prompt');
      expect(template).not.toBeNull();
      expect(template!.previousVersion).toBeUndefined();
    });

    it('should store actual previous file content in previousVersion on overwrite', async () => {
      const firstContent = '# First version of the prompt';
      const secondContent = '# Second version of the prompt — updated';

      // First write
      await dotFolder.writePromptTemplate('evolving-prompt.md', firstContent, {
        id: 'evolving-prompt',
        version: '1.0.0',
        description: 'Evolving prompt',
        category: 'task',
        usageCount: 0,
        successCount: 0,
      });

      // Second write — should store firstContent as previousVersion (not secondContent)
      await dotFolder.writePromptTemplate('evolving-prompt.md', secondContent, {
        id: 'evolving-prompt',
        version: '1.1.0',
        description: 'Evolving prompt — updated',
        category: 'task',
        usageCount: 0,
        successCount: 0,
      });

      const template = await dotFolder.getPromptTemplate('evolving-prompt');
      expect(template).not.toBeNull();
      // previousVersion must be the OLD content, not the new content
      expect(template!.previousVersion).toBe(firstContent);
      expect(template!.previousVersion).not.toBe(secondContent);
    });
  });

  describe('Prompt Template Validation', () => {
    it('should validate prompt template schema on write', async () => {
      const invalidTemplate: any = {
        id: 'test',
        // Missing required fields
      };

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        dotFolder.writePromptTemplate('test.md', '# Test', invalidTemplate),
      ).rejects.toThrow();
    });

    it('should validate category enum', async () => {
      const invalidCategory: any = {
        id: 'test',
        version: '1.0.0',
        description: 'Test',
        category: 'invalid-category',
        usageCount: 0,
        successCount: 0,
      };

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        dotFolder.writePromptTemplate('test.md', '# Test', invalidCategory),
      ).rejects.toThrow();
    });

    it('should accept valid categories', async () => {
      const validCategories = ['exploration', 'task', 'verification', 'other'] as const;

      for (const category of validCategories) {
        await dotFolder.writePromptTemplate(`${category}.md`, '# Test', {
          id: `test-${category}`,
          version: '1.0.0',
          description: 'Test',
          category,
          usageCount: 0,
          successCount: 0,
        });

        const template = await dotFolder.getPromptTemplate(`test-${category}`);
        expect(template!.category).toBe(category);
      }
    });
  });
});
