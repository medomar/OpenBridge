/**
 * Tests for exploration-prompts.ts
 */

import { describe, it, expect } from 'vitest';
import {
  generateStructureScanPrompt,
  generateClassificationPrompt,
  generateDirectoryDivePrompt,
  generateSummaryPrompt,
} from '../../src/master/exploration-prompts.js';
import type { StructureScan } from '../../src/types/master.js';

describe('Exploration Prompts', () => {
  const testWorkspace = '/test/workspace';

  describe('generateStructureScanPrompt', () => {
    it('should generate prompt with workspace path', () => {
      const prompt = generateStructureScanPrompt(testWorkspace);

      expect(prompt).toContain(testWorkspace);
      expect(prompt).toContain('Workspace Structure Scan');
    });

    it('should include instructions for listing files and directories', () => {
      const prompt = generateStructureScanPrompt(testWorkspace);

      expect(prompt).toContain('top-level files');
      expect(prompt).toContain('top-level directories');
      expect(prompt).toContain('count how many files');
    });

    it('should specify directories to skip', () => {
      const prompt = generateStructureScanPrompt(testWorkspace);

      expect(prompt).toContain('node_modules');
      expect(prompt).toContain('.git');
      expect(prompt).toContain('dist');
      expect(prompt).toContain('build');
    });

    it('should include configuration file detection', () => {
      const prompt = generateStructureScanPrompt(testWorkspace);

      expect(prompt).toContain('configuration files');
      expect(prompt).toContain('package.json');
      expect(prompt).toContain('tsconfig.json');
    });

    it('should specify JSON output format', () => {
      const prompt = generateStructureScanPrompt(testWorkspace);

      expect(prompt).toContain('Return ONLY valid JSON');
      expect(prompt).toContain('topLevelFiles');
      expect(prompt).toContain('topLevelDirs');
      expect(prompt).toContain('directoryCounts');
      expect(prompt).toContain('configFiles');
    });

    it('should emphasize no file content reading', () => {
      const prompt = generateStructureScanPrompt(testWorkspace);

      expect(prompt).toContain('Do NOT read file contents');
      expect(prompt).toContain('just list and count');
    });
  });

  describe('generateClassificationPrompt', () => {
    const structureScan: StructureScan = {
      workspacePath: testWorkspace,
      topLevelFiles: ['package.json', 'README.md'],
      topLevelDirs: ['src', 'tests'],
      directoryCounts: { src: 20, tests: 10 },
      configFiles: ['package.json', 'tsconfig.json'],
      skippedDirs: ['node_modules'],
      totalFiles: 30,
      scannedAt: '2026-02-21T10:00:00Z',
      durationMs: 1000,
    };

    it('should include workspace path and structure scan results', () => {
      const prompt = generateClassificationPrompt(testWorkspace, structureScan);

      expect(prompt).toContain(testWorkspace);
      expect(prompt).toContain('Structure Scan Results');
      expect(prompt).toContain(JSON.stringify(structureScan, null, 2));
    });

    it('should provide project type classification guidance', () => {
      const prompt = generateClassificationPrompt(testWorkspace, structureScan);

      expect(prompt).toContain('project type');
      expect(prompt).toContain('node');
      expect(prompt).toContain('python');
      expect(prompt).toContain('cafe-operations');
      expect(prompt).toContain('legal-docs');
    });

    it('should include instructions for reading config files', () => {
      const prompt = generateClassificationPrompt(testWorkspace, structureScan);

      expect(prompt).toContain('Read configuration files');
      expect(prompt).toContain('package.json');
      expect(prompt).toContain('requirements.txt');
    });

    it('should specify framework detection', () => {
      const prompt = generateClassificationPrompt(testWorkspace, structureScan);

      expect(prompt).toContain('frameworks and tools');
      expect(prompt).toContain('React');
      expect(prompt).toContain('Django');
      expect(prompt).toContain('TypeScript');
    });

    it('should include command extraction guidance', () => {
      const prompt = generateClassificationPrompt(testWorkspace, structureScan);

      expect(prompt).toContain('commands');
      expect(prompt).toContain('package.json scripts');
      expect(prompt).toContain('Makefile');
    });

    it('should provide classification heuristics for code workspaces', () => {
      const prompt = generateClassificationPrompt(testWorkspace, structureScan);

      expect(prompt).toContain('Code workspace indicators');
      expect(prompt).toContain('.ts');
      expect(prompt).toContain('.js');
      expect(prompt).toContain('.py');
    });

    it('should provide classification heuristics for business workspaces', () => {
      const prompt = generateClassificationPrompt(testWorkspace, structureScan);

      expect(prompt).toContain('Business workspace indicators');
      expect(prompt).toContain('.xlsx');
      expect(prompt).toContain('.csv');
      expect(prompt).toContain('.pdf');
    });

    it('should specify expected JSON output structure', () => {
      const prompt = generateClassificationPrompt(testWorkspace, structureScan);

      expect(prompt).toContain('projectType');
      expect(prompt).toContain('projectName');
      expect(prompt).toContain('frameworks');
      expect(prompt).toContain('commands');
      expect(prompt).toContain('dependencies');
      expect(prompt).toContain('insights');
    });
  });

  describe('generateDirectoryDivePrompt', () => {
    const context = {
      projectType: 'node',
      frameworks: ['typescript', 'vitest'],
    };

    it('should include directory path and workspace path', () => {
      const prompt = generateDirectoryDivePrompt(testWorkspace, 'src', context);

      expect(prompt).toContain('src');
      expect(prompt).toContain(testWorkspace);
      expect(prompt).toContain('Directory Exploration — src');
    });

    it('should include project context', () => {
      const prompt = generateDirectoryDivePrompt(testWorkspace, 'src', context);

      expect(prompt).toContain('**Project Type:** node');
      expect(prompt).toContain('**Frameworks:** typescript, vitest');
    });

    it('should handle empty frameworks array', () => {
      const emptyContext = { projectType: 'business', frameworks: [] };
      const prompt = generateDirectoryDivePrompt(testWorkspace, 'invoices', emptyContext);

      expect(prompt).toContain('**Frameworks:** none detected');
    });

    it('should include exploration instructions', () => {
      const prompt = generateDirectoryDivePrompt(testWorkspace, 'src', context);

      expect(prompt).toContain('Determine the purpose');
      expect(prompt).toContain('Identify key files');
      expect(prompt).toContain('List subdirectories');
      expect(prompt).toContain('Count files');
    });

    it('should provide guidance on what to look for', () => {
      const prompt = generateDirectoryDivePrompt(testWorkspace, 'src', context);

      expect(prompt).toContain('Entry points');
      expect(prompt).toContain('Configuration files');
      expect(prompt).toContain('README or documentation');
      expect(prompt).toContain('Test files');
      expect(prompt).toContain('Patterns in file naming');
    });

    it('should specify JSON output structure', () => {
      const prompt = generateDirectoryDivePrompt(testWorkspace, 'src', context);

      expect(prompt).toContain('Return ONLY valid JSON');
      expect(prompt).toContain('"path": "src"');
      expect(prompt).toContain('keyFiles');
      expect(prompt).toContain('subdirectories');
      expect(prompt).toContain('fileCount');
      expect(prompt).toContain('insights');
    });

    it('should emphasize specific file purposes', () => {
      const prompt = generateDirectoryDivePrompt(testWorkspace, 'src', context);

      expect(prompt).toContain('Be specific about file purposes');
      expect(prompt).toContain('not generic descriptions');
    });
  });

  describe('generateSummaryPrompt', () => {
    const partialMap = {
      projectType: 'node',
      projectName: 'openbridge',
      frameworks: ['typescript', 'node', 'vitest'],
      structure: {
        src: { path: 'src/', purpose: 'Source code', fileCount: 42 },
        tests: { path: 'tests/', purpose: 'Test suite', fileCount: 18 },
      },
      keyFiles: [
        { path: 'package.json', type: 'config', purpose: 'Node.js configuration' },
        { path: 'src/index.ts', type: 'entry', purpose: 'Main entry point' },
      ],
      commands: { dev: 'npm run dev', test: 'npm test', build: 'npm run build' },
    };

    it('should include workspace path and exploration results', () => {
      const prompt = generateSummaryPrompt(testWorkspace, partialMap);

      expect(prompt).toContain(testWorkspace);
      expect(prompt).toContain('Exploration Results');
      expect(prompt).toContain(JSON.stringify(partialMap, null, 2));
    });

    it('should request 2-3 sentence summary', () => {
      const prompt = generateSummaryPrompt(testWorkspace, partialMap);

      expect(prompt).toContain('2-3 sentence summary');
      expect(prompt).toContain('main purpose');
      expect(prompt).toContain('Key technologies');
      expect(prompt).toContain('notable characteristics');
    });

    it('should provide style guidelines for code projects', () => {
      const prompt = generateSummaryPrompt(testWorkspace, partialMap);

      expect(prompt).toContain('Code Projects');
      expect(prompt).toContain('Technical, concise');
      expect(prompt).toContain('Node.js TypeScript project');
    });

    it('should provide style guidelines for business workspaces', () => {
      const prompt = generateSummaryPrompt(testWorkspace, partialMap);

      expect(prompt).toContain('Business Workspaces');
      expect(prompt).toContain('Plain language');
      expect(prompt).toContain('Cafe business files');
    });

    it('should provide style guidelines for mixed workspaces', () => {
      const prompt = generateSummaryPrompt(testWorkspace, partialMap);

      expect(prompt).toContain('Mixed');
      expect(prompt).toContain('Balanced');
      expect(prompt).toContain('E-commerce platform');
    });

    it('should specify JSON output with summary field only', () => {
      const prompt = generateSummaryPrompt(testWorkspace, partialMap);

      expect(prompt).toContain('Return ONLY a JSON object with a single "summary" field');
      expect(prompt).toContain('"summary": "Your 2-3 sentence summary here."');
    });

    it('should emphasize brevity and no repetition', () => {
      const prompt = generateSummaryPrompt(testWorkspace, partialMap);

      expect(prompt).toContain('Keep it concise');
      expect(prompt).toContain('2-3 sentences maximum');
    });

    it('should request adaptive tone based on project type', () => {
      const prompt = generateSummaryPrompt(testWorkspace, partialMap);

      expect(prompt).toContain('Adapt tone based on project type');
    });
  });

  describe('Prompt Content Validation', () => {
    it('all prompts should be non-empty', () => {
      const structureScan = generateStructureScanPrompt(testWorkspace);
      const classification = generateClassificationPrompt(testWorkspace, {
        workspacePath: testWorkspace,
        topLevelFiles: [],
        topLevelDirs: [],
        directoryCounts: {},
        configFiles: [],
        skippedDirs: [],
        totalFiles: 0,
        scannedAt: new Date().toISOString(),
        durationMs: 0,
      });
      const directoryDive = generateDirectoryDivePrompt(testWorkspace, 'src', {
        projectType: 'node',
        frameworks: [],
      });
      const summary = generateSummaryPrompt(testWorkspace, {
        projectType: 'node',
        projectName: 'test',
        frameworks: [],
        structure: {},
        keyFiles: [],
        commands: {},
      });

      expect(structureScan.length).toBeGreaterThan(100);
      expect(classification.length).toBeGreaterThan(100);
      expect(directoryDive.length).toBeGreaterThan(100);
      expect(summary.length).toBeGreaterThan(100);
    });

    it('all prompts should emphasize JSON-only output', () => {
      const prompts = [
        generateStructureScanPrompt(testWorkspace),
        generateClassificationPrompt(testWorkspace, {
          workspacePath: testWorkspace,
          topLevelFiles: [],
          topLevelDirs: [],
          directoryCounts: {},
          configFiles: [],
          skippedDirs: [],
          totalFiles: 0,
          scannedAt: new Date().toISOString(),
          durationMs: 0,
        }),
        generateDirectoryDivePrompt(testWorkspace, 'src', { projectType: 'node', frameworks: [] }),
        generateSummaryPrompt(testWorkspace, {
          projectType: 'node',
          projectName: 'test',
          frameworks: [],
          structure: {},
          keyFiles: [],
          commands: {},
        }),
      ];

      prompts.forEach((prompt) => {
        expect(prompt).toContain('ONLY');
        expect(prompt).toContain('JSON');
      });
    });

    it('all prompts should include relevant task headers', () => {
      const structureScan = generateStructureScanPrompt(testWorkspace);
      const classification = generateClassificationPrompt(testWorkspace, {
        workspacePath: testWorkspace,
        topLevelFiles: [],
        topLevelDirs: [],
        directoryCounts: {},
        configFiles: [],
        skippedDirs: [],
        totalFiles: 0,
        scannedAt: new Date().toISOString(),
        durationMs: 0,
      });
      const directoryDive = generateDirectoryDivePrompt(testWorkspace, 'src', {
        projectType: 'node',
        frameworks: [],
      });
      const summary = generateSummaryPrompt(testWorkspace, {
        projectType: 'node',
        projectName: 'test',
        frameworks: [],
        structure: {},
        keyFiles: [],
        commands: {},
      });

      expect(structureScan).toContain('# Task:');
      expect(classification).toContain('# Task:');
      expect(directoryDive).toContain('# Task:');
      expect(summary).toContain('# Task:');
    });
  });
});
