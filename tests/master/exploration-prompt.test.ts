import { describe, it, expect } from 'vitest';
import {
  generateExplorationPrompt,
  generateReExplorationPrompt,
  SAMPLE_WORKSPACE_MAP,
} from '../../src/master/exploration-prompt.js';

describe('Exploration Prompt', () => {
  describe('generateExplorationPrompt', () => {
    it('should generate a prompt with workspace path', () => {
      const workspacePath = '/path/to/workspace';
      const prompt = generateExplorationPrompt(workspacePath);

      expect(prompt).toContain(workspacePath);
      expect(prompt).toContain('Workspace Path:');
    });

    it('should include autonomous exploration instructions', () => {
      const prompt = generateExplorationPrompt('/test/path');

      expect(prompt).toContain('Autonomous Workspace Exploration');
      expect(prompt).toContain('silently explore and understand this workspace');
      expect(prompt).toContain('prepare yourself to assist the user');
    });

    it('should include .openbridge folder creation instructions', () => {
      const prompt = generateExplorationPrompt('/test/path');

      expect(prompt).toContain('.openbridge/');
      expect(prompt).toContain('Create .openbridge/ folder');
      expect(prompt).toContain('This folder stores your knowledge');
    });

    it('should include workspace-map.json schema', () => {
      const prompt = generateExplorationPrompt('/test/path');

      expect(prompt).toContain('workspace-map.json');
      expect(prompt).toContain('WorkspaceMap schema');
      expect(prompt).toContain('workspacePath');
      expect(prompt).toContain('projectName');
      expect(prompt).toContain('projectType');
      expect(prompt).toContain('frameworks');
      expect(prompt).toContain('structure');
      expect(prompt).toContain('keyFiles');
      expect(prompt).toContain('entryPoints');
      expect(prompt).toContain('commands');
      expect(prompt).toContain('dependencies');
    });

    it('should include git initialization instructions', () => {
      const prompt = generateExplorationPrompt('/test/path');

      expect(prompt).toContain('Initialize git tracking');
      expect(prompt).toContain('git init');
      expect(prompt).toContain('.openbridge/');
    });

    it('should include agents.json creation instructions', () => {
      const prompt = generateExplorationPrompt('/test/path');

      expect(prompt).toContain('Create agents.json');
      expect(prompt).toContain('Master AI');
      expect(prompt).toContain('specialist AI tools');
    });

    it('should include exploration logging instructions', () => {
      const prompt = generateExplorationPrompt('/test/path');

      expect(prompt).toContain('exploration.log');
      expect(prompt).toContain('timestamp');
      expect(prompt).toContain('level');
      expect(prompt).toContain('message');
    });

    it('should include adaptive response style guidance', () => {
      const prompt = generateExplorationPrompt('/test/path');

      expect(prompt).toContain('Adaptive Response Style');
      expect(prompt).toContain('For Code Projects');
      expect(prompt).toContain('For Business Workspaces');
      expect(prompt).toContain('For Mixed Workspaces');
    });

    it('should include code workspace indicators', () => {
      const prompt = generateExplorationPrompt('/test/path');

      expect(prompt).toContain('Code workspace indicators');
      expect(prompt).toContain('package.json');
      expect(prompt).toContain('requirements.txt');
      expect(prompt).toContain('src/');
      expect(prompt).toContain('.ts');
      expect(prompt).toContain('.py');
    });

    it('should include business workspace indicators', () => {
      const prompt = generateExplorationPrompt('/test/path');

      expect(prompt).toContain('Business workspace indicators');
      expect(prompt).toContain('.xlsx');
      expect(prompt).toContain('.csv');
      expect(prompt).toContain('.pdf');
      expect(prompt).toContain('invoices/');
      expect(prompt).toContain('reports/');
    });

    it('should include response style examples', () => {
      const prompt = generateExplorationPrompt('/test/path');

      expect(prompt).toContain('Example projectType');
      expect(prompt).toContain('cafe-operations');
      expect(prompt).toContain('legal-docs');
      expect(prompt).toContain('node');
      expect(prompt).toContain('python');
    });

    it('should include silent work instructions', () => {
      const prompt = generateExplorationPrompt('/test/path');

      expect(prompt).toContain('Work Silently');
      expect(prompt).toContain('Do NOT output anything to the user');
      expect(prompt).toContain('background');
    });

    it('should include constraints', () => {
      const prompt = generateExplorationPrompt('/test/path');

      expect(prompt).toContain('Constraints');
      expect(prompt).toContain('Only read and analyze');
      expect(prompt).toContain('Do NOT modify workspace files');
      expect(prompt).toContain('Do NOT install dependencies');
      expect(prompt).toContain('Do NOT make network requests');
    });

    it('should include example exploration flow', () => {
      const prompt = generateExplorationPrompt('/test/path');

      expect(prompt).toContain('Example Exploration Flow');
      expect(prompt).toContain('List top-level directories');
      expect(prompt).toContain('Check for package.json');
      expect(prompt).toContain('Scan key directories');
      expect(prompt).toContain('Identify frameworks');
      expect(prompt).toContain('Classify project type');
      expect(prompt).toContain('Write workspace-map.json');
    });

    it('should include post-exploration instructions', () => {
      const prompt = generateExplorationPrompt('/test/path');

      expect(prompt).toContain('After Exploration');
      expect(prompt).toContain('"ready" state');
      expect(prompt).toContain('WhatsApp');
      expect(prompt).toContain('Answer questions');
      expect(prompt).toContain('Execute tasks');
      expect(prompt).toContain('conversation context');
    });

    it('should include important notes', () => {
      const prompt = generateExplorationPrompt('/test/path');

      expect(prompt).toContain('Important');
      expect(prompt).toContain('**once** at startup');
      expect(prompt).toContain('snapshot');
      expect(prompt).toContain('thorough but honest');
      expect(prompt).toContain("don't make it up");
    });

    it('should end with clear directive', () => {
      const prompt = generateExplorationPrompt('/test/path');

      expect(prompt).toContain('Begin exploration now');
      expect(prompt).toContain('Work silently');
      expect(prompt).toContain('Report back when complete');
    });
  });

  describe('generateReExplorationPrompt', () => {
    it('should generate re-exploration prompt with workspace path', () => {
      const workspacePath = '/path/to/workspace';
      const prompt = generateReExplorationPrompt(workspacePath);

      expect(prompt).toContain(workspacePath);
      expect(prompt).toContain('Workspace Re-Exploration');
    });

    it('should include re-scan instructions', () => {
      const prompt = generateReExplorationPrompt('/test/path');

      expect(prompt).toContain('may have changed');
      expect(prompt).toContain('Re-scan the workspace');
      expect(prompt).toContain('Update');
      expect(prompt).toContain('workspace-map.json');
    });

    it('should include commit instructions', () => {
      const prompt = generateReExplorationPrompt('/test/path');

      expect(prompt).toContain('Commit the updated map');
      expect(prompt).toContain('.openbridge/.git');
      expect(prompt).toContain('Re-exploration');
    });

    it('should include logging instructions', () => {
      const prompt = generateReExplorationPrompt('/test/path');

      expect(prompt).toContain('re-exploration log entry');
      expect(prompt).toContain('exploration.log');
    });

    it('should be concise compared to initial exploration prompt', () => {
      const initialPrompt = generateExplorationPrompt('/test/path');
      const rePrompt = generateReExplorationPrompt('/test/path');

      // Re-exploration prompt should be significantly shorter
      expect(rePrompt.length).toBeLessThan(initialPrompt.length / 5);
    });

    it('should end with silent work directive', () => {
      const prompt = generateReExplorationPrompt('/test/path');

      expect(prompt).toContain('Work silently');
      expect(prompt).toContain('Report back when complete');
    });
  });

  describe('SAMPLE_WORKSPACE_MAP', () => {
    it('should be a valid WorkspaceMap example', () => {
      expect(SAMPLE_WORKSPACE_MAP).toBeDefined();
      expect(SAMPLE_WORKSPACE_MAP.workspacePath).toBeDefined();
      expect(SAMPLE_WORKSPACE_MAP.projectName).toBe('my-app');
      expect(SAMPLE_WORKSPACE_MAP.projectType).toBe('node');
    });

    it('should include example frameworks', () => {
      expect(SAMPLE_WORKSPACE_MAP.frameworks).toContain('react');
      expect(SAMPLE_WORKSPACE_MAP.frameworks).toContain('typescript');
      expect(SAMPLE_WORKSPACE_MAP.frameworks).toContain('vite');
    });

    it('should include example structure', () => {
      expect(SAMPLE_WORKSPACE_MAP.structure).toBeDefined();
      expect(SAMPLE_WORKSPACE_MAP.structure.src).toBeDefined();
      expect(SAMPLE_WORKSPACE_MAP.structure.src?.purpose).toContain('source code');
    });

    it('should include example key files', () => {
      expect(SAMPLE_WORKSPACE_MAP.keyFiles).toBeDefined();
      expect(SAMPLE_WORKSPACE_MAP.keyFiles.length).toBeGreaterThan(0);

      const packageJson = SAMPLE_WORKSPACE_MAP.keyFiles.find((f) => f.path === 'package.json');
      expect(packageJson).toBeDefined();
      expect(packageJson?.type).toBe('config');
    });

    it('should include example entry points', () => {
      expect(SAMPLE_WORKSPACE_MAP.entryPoints).toBeDefined();
      expect(SAMPLE_WORKSPACE_MAP.entryPoints.length).toBeGreaterThan(0);
      expect(SAMPLE_WORKSPACE_MAP.entryPoints).toContain('src/index.ts');
    });

    it('should include example commands', () => {
      expect(SAMPLE_WORKSPACE_MAP.commands).toBeDefined();
      expect(SAMPLE_WORKSPACE_MAP.commands.dev).toBe('npm run dev');
      expect(SAMPLE_WORKSPACE_MAP.commands.build).toBe('npm run build');
      expect(SAMPLE_WORKSPACE_MAP.commands.test).toBe('npm test');
    });

    it('should include example dependencies', () => {
      expect(SAMPLE_WORKSPACE_MAP.dependencies).toBeDefined();
      expect(SAMPLE_WORKSPACE_MAP.dependencies.length).toBeGreaterThan(0);

      const react = SAMPLE_WORKSPACE_MAP.dependencies.find((d) => d.name === 'react');
      expect(react).toBeDefined();
      expect(react?.type).toBe('runtime');
    });

    it('should have a summary', () => {
      expect(SAMPLE_WORKSPACE_MAP.summary).toBeDefined();
      expect(SAMPLE_WORKSPACE_MAP.summary.length).toBeGreaterThan(0);
      expect(SAMPLE_WORKSPACE_MAP.summary).toContain('React');
    });

    it('should have timestamps and schema version', () => {
      expect(SAMPLE_WORKSPACE_MAP.generatedAt).toBeDefined();
      expect(SAMPLE_WORKSPACE_MAP.schemaVersion).toBe('1.0.0');
    });
  });

  describe('Prompt Content Validation', () => {
    it('should include all required task sections', () => {
      const prompt = generateExplorationPrompt('/test/path');

      const requiredSections = [
        'Your Task',
        'What You Must Do',
        'Workspace Map Schema',
        'Adaptive Response Style',
        'Detection Heuristics',
        'Work Silently',
        'Constraints',
        'Example Exploration Flow',
        'After Exploration',
        'Important',
      ];

      for (const section of requiredSections) {
        expect(prompt).toContain(section);
      }
    });

    it('should provide clear step-by-step instructions', () => {
      const prompt = generateExplorationPrompt('/test/path');

      expect(prompt).toContain('1. **Explore the workspace thoroughly**');
      expect(prompt).toContain('2. **Create .openbridge/ folder**');
      expect(prompt).toContain('3. **Generate workspace-map.json**');
      expect(prompt).toContain('4. **Initialize git tracking**');
      expect(prompt).toContain('5. **Create agents.json**');
      expect(prompt).toContain('6. **Log your exploration**');
    });

    it('should emphasize silent operation', () => {
      const prompt = generateExplorationPrompt('/test/path');

      const silentPhrases = [
        'silently',
        'Work Silently',
        'Do NOT output anything to the user',
        'background',
      ];

      for (const phrase of silentPhrases) {
        expect(prompt).toContain(phrase);
      }
    });

    it('should provide both code and business examples', () => {
      const prompt = generateExplorationPrompt('/test/path');

      // Code examples
      expect(prompt).toContain('Node.js TypeScript project');
      expect(prompt).toContain('Express');
      expect(prompt).toContain('API');

      // Business examples
      expect(prompt).toContain('Cafe business files');
      expect(prompt).toContain('supplier invoices');
      expect(prompt).toContain('inventory spreadsheets');
    });

    it('should warn against default to technical language', () => {
      const prompt = generateExplorationPrompt('/test/path');

      expect(prompt).toContain('When in doubt');
      expect(prompt).toContain('Default to business/non-technical');
      expect(prompt).toContain('better to be too simple than too complex');
    });
  });
});
