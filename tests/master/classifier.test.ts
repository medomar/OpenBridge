import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasterManager } from '../../src/master/master-manager.js';
import type { ClassificationResult } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Mock AgentRunner ────────────────────────────────────────────────

const mockSpawn = vi.fn();
const mockStream = vi.fn();
const mockSpawnWithHandle = vi.fn();

vi.mock('../../src/core/agent-runner.js', () => {
  const profiles: Record<string, string[]> = {
    'read-only': ['Read', 'Glob', 'Grep'],
    'code-edit': [
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'Bash(git:*)',
      'Bash(npm:*)',
      'Bash(npx:*)',
    ],
    'full-access': ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'],
  };

  return {
    AgentRunner: vi.fn().mockImplementation(() => ({
      spawn: mockSpawn,
      stream: mockStream,
      spawnWithHandle: mockSpawnWithHandle,
      spawnWithStreamingHandle: mockSpawnWithHandle,
    })),
    TOOLS_READ_ONLY: profiles['read-only'],
    TOOLS_CODE_EDIT: profiles['code-edit'],
    TOOLS_FULL: profiles['full-access'],
    DEFAULT_MAX_TURNS_EXPLORATION: 15,
    DEFAULT_MAX_TURNS_TASK: 25,
    sanitizePrompt: vi.fn((s: string) => s),
    buildArgs: vi.fn(),
    isValidModel: vi.fn(() => true),
    MODEL_ALIASES: ['haiku', 'sonnet', 'opus'],
    AgentExhaustedError: class AgentExhaustedError extends Error {},
    resolveProfile: (profileName: string) => profiles[profileName],
    classifyError: (_stderr: string, _exitCode: number): string => 'unknown',
    manifestToSpawnOptions: (manifest: Record<string, unknown>) => {
      const profile = manifest.profile as string | undefined;
      const allowedTools =
        (manifest.allowedTools as string[] | undefined) ??
        (profile ? profiles[profile] : undefined);
      return Promise.resolve({
        spawnOptions: {
          prompt: manifest.prompt,
          workspacePath: manifest.workspacePath,
          model: manifest.model,
          allowedTools,
          maxTurns: manifest.maxTurns,
          timeout: manifest.timeout,
          retries: manifest.retries,
          retryDelay: manifest.retryDelay,
        },
        cleanup: async () => {},
      });
    },
  };
});

// ── Mock logger ─────────────────────────────────────────────────────

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ── Helper ──────────────────────────────────────────────────────────

const masterTool: DiscoveredTool = {
  name: 'claude',
  path: '/usr/local/bin/claude',
  version: '1.0.0',
  available: true,
  role: 'master',
  capabilities: ['general'],
};

/**
 * Call the private classifyTaskByKeywords method directly.
 * Tests pure keyword-matching logic without going through the full
 * AI-powered classifyTask() pipeline.
 */
function classify(
  manager: MasterManager,
  content: string,
  recentUserMessages?: string[],
  lastBotResponse?: string,
): ClassificationResult {
  return (
    manager as unknown as {
      classifyTaskByKeywords(
        content: string,
        recentUserMessages?: string[],
        lastBotResponse?: string,
      ): ClassificationResult;
    }
  ).classifyTaskByKeywords(content, recentUserMessages, lastBotResponse);
}

// ── Suite ───────────────────────────────────────────────────────────

describe('classifyTaskByKeywords — text-generation class (OB-1580, OB-1581, OB-1582, OB-1583)', () => {
  let testWorkspace: string;
  let manager: MasterManager;

  beforeEach(async () => {
    vi.clearAllMocks();

    testWorkspace = path.join(os.tmpdir(), 'test-classifier-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });

    manager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // ── Text-generation keyword matching (OB-1580) ─────────────────────

  it('classifies "generate LinkedIn post" as quick-answer', () => {
    // "generate" and "linkedin" are both text-gen keywords → quick-answer
    const result = classify(manager, 'generate a LinkedIn post about our new AI features');
    expect(result.class).toBe('quick-answer');
    expect(result.maxTurns).toBe(10); // OB-1649: text-generation maxTurns increased 5→10
  });

  it('classifies "shorter version" as quick-answer', () => {
    // "shorter" is a text-gen keyword → quick-answer
    const result = classify(manager, 'shorter version please');
    expect(result.class).toBe('quick-answer');
    expect(result.maxTurns).toBe(10); // OB-1649: text-generation maxTurns increased 5→10
  });

  it('classifies "tweet for non-developers" as quick-answer', () => {
    // "tweet" is a text-gen keyword — avoid substrings of complex keywords
    // ("develop" in "developers", "begin" in "beginners") in the prompt
    const result = classify(manager, 'write a tweet about OpenBridge for casual users');
    expect(result.class).toBe('quick-answer');
    expect(result.maxTurns).toBe(10); // OB-1649: text-generation maxTurns increased 5→10
  });

  it('classifies "draft a LinkedIn post" as quick-answer', () => {
    const result = classify(manager, 'draft a LinkedIn post about our new release');
    expect(result.class).toBe('quick-answer');
    expect(result.maxTurns).toBe(10); // OB-1649: text-generation maxTurns increased 5→10
  });

  it('classifies "rephrase this" as quick-answer', () => {
    const result = classify(manager, 'rephrase this paragraph to sound more professional');
    expect(result.class).toBe('quick-answer');
    expect(result.maxTurns).toBe(10); // OB-1649: text-generation maxTurns increased 5→10
  });

  // ── Fallback is quick-answer not tool-use (OB-1581) ───────────────

  it('uses quick-answer as default fallback for unrecognized messages', () => {
    const result = classify(manager, 'something totally unrecognized that matches no keywords');
    expect(result.class).toBe('quick-answer');
    expect(result.reason).toContain('fallback');
  });

  it('fallback does not return tool-use for a simple unrecognized message', () => {
    const result = classify(manager, 'hey what should I do next?');
    expect(result.class).not.toBe('tool-use');
  });

  // ── Conversation context — text-generation follow-ups (OB-1582) ────

  it('classifies a short follow-up as quick-answer when recent messages were text-gen', () => {
    const recentMessages = ['generate a LinkedIn post about our launch'];
    // Short follow-up that has no text-gen keywords on its own
    const result = classify(manager, 'better hook', recentMessages);
    expect(result.class).toBe('quick-answer');
    expect(result.reason).toContain('text-generation follow-up');
  });

  it('classifies "mix of 1 and 3" as quick-answer when recent context is text-gen', () => {
    const recentMessages = ['write three tweet variations about our product'];
    const result = classify(manager, 'mix of 1 and 3', recentMessages);
    expect(result.class).toBe('quick-answer');
    expect(result.reason).toContain('text-generation follow-up');
  });
});

describe('classifyTaskByKeywords — OB-1648/1649/1650/1651 classification improvements', () => {
  let testWorkspace: string;
  let manager: MasterManager;

  beforeEach(async () => {
    vi.clearAllMocks();

    testWorkspace = path.join(os.tmpdir(), 'test-classifier-improvements-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });

    manager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // ── OB-1648: strategic / brainstorming keywords ────────────────────

  it('classifies "brainstorm with me" as complex-task (OB-1648)', () => {
    const result = classify(manager, 'brainstorm with me about the product direction');
    expect(result.class).toBe('complex-task');
    expect(result.maxTurns).toBe(25);
  });

  it('classifies "create a strategy to commercialise" as complex-task (OB-1648)', () => {
    const result = classify(manager, 'create a strategy to commercialise our SaaS product');
    expect(result.class).toBe('complex-task');
    expect(result.maxTurns).toBe(25);
  });

  it('classifies "commercialize the platform" as complex-task (OB-1648)', () => {
    const result = classify(manager, 'how should we commercialize the platform?');
    expect(result.class).toBe('complex-task');
    expect(result.maxTurns).toBe(25);
  });

  // ── OB-1649: text-generation maxTurns increased to 10 ─────────────

  it('classifies "write a tweet" as quick-answer with 10 turns (OB-1649)', () => {
    const result = classify(manager, 'write a tweet about our new release');
    expect(result.class).toBe('quick-answer');
    // OB-1649: text-generation maxTurns increased from 5 → 10
    expect(result.maxTurns).toBe(10);
    expect(result.reason).toContain('text-generation');
  });

  // ── OB-1650: long multi-sentence message → not quick-answer ────────

  it('classifies long multi-sentence message as tool-use, not quick-answer (OB-1650)', () => {
    // > 100 chars, 3 sentences → triggers length-based upgrade to tool-use
    const longMessage =
      'Our codebase has grown significantly over the past year. We are experiencing performance issues in multiple places. I would appreciate your thoughts on this.';
    expect(longMessage.length).toBeGreaterThan(100);
    const result = classify(manager, longMessage);
    expect(result.class).not.toBe('quick-answer');
    expect(result.maxTurns).toBeGreaterThanOrEqual(15);
  });

  // ── OB-1651: length-based complex-task heuristic (> 200 chars + planning) ─

  it('classifies long message with planning/strategy language as complex-task (OB-1651)', () => {
    const longPlanningMessage =
      'I want to discuss the overall strategy and roadmap for our product. We need to define a clear plan with milestones and deliverables. Please help me think through the objectives and framework we should adopt going forward into Q3 and Q4 of this year.';
    expect(longPlanningMessage.length).toBeGreaterThan(200);
    const result = classify(manager, longPlanningMessage);
    expect(result.class).toBe('complex-task');
    expect(result.maxTurns).toBe(25);
    expect(result.reason).toContain('length heuristic');
  });
});

describe('classifyTaskByKeywords — menu-selection class (OB-1658, OB-1659, OB-1660)', () => {
  let testWorkspace: string;
  let manager: MasterManager;

  beforeEach(async () => {
    vi.clearAllMocks();

    testWorkspace = path.join(os.tmpdir(), 'test-classifier-menu-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });

    manager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('classifies single digit "1" as menu-selection (OB-1658)', () => {
    const result = classify(manager, '1');
    expect(result.class).toBe('menu-selection');
    expect(result.menuSelection).toBe(true);
    expect(result.maxTurns).toBe(2);
  });

  it('classifies single digit "9" as menu-selection (OB-1658)', () => {
    const result = classify(manager, '9');
    expect(result.class).toBe('menu-selection');
    expect(result.menuSelection).toBe(true);
  });

  it('does NOT classify "hello" as menu-selection (OB-1658)', () => {
    const result = classify(manager, 'hello');
    expect(result.class).not.toBe('menu-selection');
    expect(result.menuSelection).toBeFalsy();
  });

  it('does NOT classify multi-digit number "12" as menu-selection (OB-1658)', () => {
    const result = classify(manager, '12');
    expect(result.class).not.toBe('menu-selection');
  });

  it('skips RAG for menu-selection (OB-1658)', () => {
    const result = classify(manager, '3');
    expect(result.class).toBe('menu-selection');
    expect(result.skipRag).toBe(true);
  });

  it('extracts option text from previous bot response when numbered list present (OB-1659)', () => {
    const lastBotResponse = [
      'Here are your options:',
      '1. Deploy to production',
      '2. Deploy to staging',
      '3. Run tests only',
    ].join('\n');

    const result = classify(manager, '2', undefined, lastBotResponse);
    expect(result.class).toBe('menu-selection');
    expect(result.selectedOptionText).toBe('Deploy to staging');
    expect(result.reason).toContain('numbered list');
  });

  it('returns undefined selectedOptionText when previous response has no numbered list (OB-1659)', () => {
    const result = classify(manager, '1', undefined, 'No list here, just a sentence.');
    expect(result.class).toBe('menu-selection');
    expect(result.selectedOptionText).toBeUndefined();
  });
});
