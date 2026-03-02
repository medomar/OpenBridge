import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateMasterSystemPrompt,
  formatPreFetchedKnowledgeSection,
} from '../../src/master/master-system-prompt.js';
import type { MasterSystemPromptContext } from '../../src/master/master-system-prompt.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

describe('generateMasterSystemPrompt', () => {
  const masterTool: DiscoveredTool = {
    name: 'claude',
    path: '/usr/local/bin/claude',
    version: '1.0.0',
    role: 'master',
    capabilities: ['code-analysis', 'task-execution'],
    available: true,
  };

  const specialistTool: DiscoveredTool = {
    name: 'codex',
    path: '/usr/local/bin/codex',
    version: '2.0.0',
    role: 'specialist',
    capabilities: ['code-generation'],
    available: true,
  };

  const baseContext: MasterSystemPromptContext = {
    workspacePath: '/home/user/my-project',
    masterToolName: 'claude',
    discoveredTools: [masterTool, specialistTool],
  };

  it('should include the workspace path', () => {
    const prompt = generateMasterSystemPrompt(baseContext);
    expect(prompt).toContain('/home/user/my-project');
  });

  it('should include Master AI role description', () => {
    const prompt = generateMasterSystemPrompt(baseContext);
    expect(prompt).toContain('Master AI');
    expect(prompt).toContain('Your Role');
    expect(prompt).toContain('self-governing AI agent');
  });

  it('should include built-in profiles', () => {
    const prompt = generateMasterSystemPrompt(baseContext);
    expect(prompt).toContain('read-only');
    expect(prompt).toContain('code-edit');
    expect(prompt).toContain('full-access');
    expect(prompt).toContain('Read');
    expect(prompt).toContain('Glob');
    expect(prompt).toContain('Grep');
  });

  it('should include discovered tools', () => {
    const prompt = generateMasterSystemPrompt(baseContext);
    expect(prompt).toContain('claude');
    expect(prompt).toContain('codex');
    expect(prompt).toContain('master');
    expect(prompt).toContain('specialist');
  });

  it('should include delegation instructions', () => {
    const prompt = generateMasterSystemPrompt(baseContext);
    expect(prompt).toContain('[DELEGATE:tool-name]');
    expect(prompt).toContain('[/DELEGATE]');
  });

  it('should include user response guidelines', () => {
    const prompt = generateMasterSystemPrompt(baseContext);
    expect(prompt).toContain('How to Respond to Users');
    expect(prompt).toContain('Be concise');
  });

  it('should include self-improvement section', () => {
    const prompt = generateMasterSystemPrompt(baseContext);
    expect(prompt).toContain('Self-Improvement');
  });

  it('should include custom profiles when provided', () => {
    const context: MasterSystemPromptContext = {
      ...baseContext,
      customProfiles: {
        'test-runner': {
          name: 'test-runner',
          description: 'Run tests only',
          tools: ['Read', 'Glob', 'Grep', 'Bash(npm:test)'],
        },
      },
    };

    const prompt = generateMasterSystemPrompt(context);
    expect(prompt).toContain('Custom Profiles');
    expect(prompt).toContain('test-runner');
    expect(prompt).toContain('Run tests only');
  });

  it('should not include custom profiles section when none provided', () => {
    const prompt = generateMasterSystemPrompt(baseContext);
    expect(prompt).not.toContain('Custom Profiles');
  });

  it('should handle empty discovered tools', () => {
    const context: MasterSystemPromptContext = {
      ...baseContext,
      discoveredTools: [],
    };

    const prompt = generateMasterSystemPrompt(context);
    expect(prompt).toContain('No AI tools discovered');
  });

  it('should include turn-budget warning instructions', () => {
    const prompt = generateMasterSystemPrompt(baseContext);
    expect(prompt).toContain('Turn-Budget Warnings');
    expect(prompt).toContain('[INCOMPLETE: step X/Y]');
    expect(prompt).toContain('system can retry with a higher budget');
  });

  it('should include RAG guidance for codebase questions', () => {
    const prompt = generateMasterSystemPrompt(baseContext);
    expect(prompt).toContain('Using Pre-fetched Knowledge (RAG)');
    expect(prompt).toContain('Pre-fetched Knowledge (from RAG)');
    expect(prompt).toContain('Use it to answer directly');
    expect(prompt).toContain('Only spawn a `read-only` worker');
  });

  it('should include SHARE marker documentation', () => {
    const prompt = generateMasterSystemPrompt(baseContext);
    expect(prompt).toContain('Sharing Files & Outputs');
    expect(prompt).toContain('[SHARE:channel]');
    expect(prompt).toContain('SHARE:whatsapp');
    expect(prompt).toContain('SHARE:telegram');
    expect(prompt).toContain('SHARE:github-pages');
    expect(prompt).toContain('SHARE:email');
  });

  it('should include active connector names in the Connected Channels section', () => {
    const context: MasterSystemPromptContext = {
      ...baseContext,
      activeConnectorNames: ['whatsapp', 'console'],
    };
    const prompt = generateMasterSystemPrompt(context);
    expect(prompt).toContain('Connected Channels');
    expect(prompt).toContain('**whatsapp**');
    expect(prompt).toContain('**console**');
  });

  it('should not include Connected Channels section when no active connectors are provided', () => {
    const prompt = generateMasterSystemPrompt(baseContext);
    expect(prompt).not.toContain('### Connected Channels');
  });

  it('should include file-server URL when fileServerPort is provided', () => {
    const context: MasterSystemPromptContext = {
      ...baseContext,
      fileServerPort: 3001,
    };
    const prompt = generateMasterSystemPrompt(context);
    expect(prompt).toContain('Local File Server');
    expect(prompt).toContain('http://localhost:3001');
  });

  it('should not include file-server section when fileServerPort is not provided', () => {
    const prompt = generateMasterSystemPrompt(baseContext);
    expect(prompt).not.toContain('Local File Server');
  });

  it('should include output routing guidelines', () => {
    const prompt = generateMasterSystemPrompt(baseContext);
    expect(prompt).toContain('Output Routing Guidelines');
    expect(prompt).toContain('PDF, DOC, DOCX');
    expect(prompt).toContain('HTML report');
    expect(prompt).toContain('Small text results');
  });
});

describe('formatPreFetchedKnowledgeSection', () => {
  it('should wrap knowledge context in a Pre-fetched Knowledge section', () => {
    const raw = '## Relevant Knowledge\n\nSome content here.';
    const result = formatPreFetchedKnowledgeSection(raw);
    expect(result).toContain('## Pre-fetched Knowledge (from RAG)');
    expect(result).toContain('Some content here.');
  });

  it('should trim leading/trailing whitespace from the knowledge context', () => {
    const raw = '  \n  Content with surrounding whitespace  \n  ';
    const result = formatPreFetchedKnowledgeSection(raw);
    expect(result).toBe(
      '## Pre-fetched Knowledge (from RAG)\n\nContent with surrounding whitespace',
    );
  });

  it('should separate the header from the content with a blank line', () => {
    const raw = 'Chunk content.';
    const result = formatPreFetchedKnowledgeSection(raw);
    expect(result).toBe('## Pre-fetched Knowledge (from RAG)\n\nChunk content.');
  });

  it('should preserve multi-line knowledge context', () => {
    const raw = 'Line 1\nLine 2\nLine 3';
    const result = formatPreFetchedKnowledgeSection(raw);
    expect(result).toContain('Line 1\nLine 2\nLine 3');
  });
});

describe('DotFolderManager system prompt methods', () => {
  let testWorkspace: string;
  let dotFolder: DotFolderManager;

  beforeEach(async () => {
    testWorkspace = path.join(process.cwd(), 'test-workspace-sysprompt-' + Date.now());
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

  it('should return null when no system prompt exists', async () => {
    const prompt = await dotFolder.readSystemPrompt();
    expect(prompt).toBeNull();
  });

  it('should write and read system prompt', async () => {
    const content = '# Test System Prompt\nYou are a test AI.';
    await dotFolder.writeSystemPrompt(content);

    const result = await dotFolder.readSystemPrompt();
    expect(result).toBe(content);
  });

  it('should create prompts directory if it does not exist', async () => {
    const content = '# Test Prompt';
    await dotFolder.writeSystemPrompt(content);

    const promptsDir = dotFolder.getPromptsPath();
    const stat = await fs.stat(promptsDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('should overwrite existing system prompt', async () => {
    await dotFolder.writeSystemPrompt('Version 1');
    await dotFolder.writeSystemPrompt('Version 2');

    const result = await dotFolder.readSystemPrompt();
    expect(result).toBe('Version 2');
  });

  it('should return correct paths', () => {
    expect(dotFolder.getPromptsPath()).toBe(path.join(testWorkspace, '.openbridge', 'prompts'));
    expect(dotFolder.getSystemPromptPath()).toBe(
      path.join(testWorkspace, '.openbridge', 'prompts', 'master-system.md'),
    );
  });
});
