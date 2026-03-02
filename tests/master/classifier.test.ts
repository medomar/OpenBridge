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
): ClassificationResult {
  return (
    manager as unknown as {
      classifyTaskByKeywords(content: string, recentUserMessages?: string[]): ClassificationResult;
    }
  ).classifyTaskByKeywords(content, recentUserMessages);
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
    expect(result.maxTurns).toBe(5);
  });

  it('classifies "shorter version" as quick-answer', () => {
    // "shorter" is a text-gen keyword → quick-answer
    const result = classify(manager, 'shorter version please');
    expect(result.class).toBe('quick-answer');
    expect(result.maxTurns).toBe(5);
  });

  it('classifies "tweet for non-developers" as quick-answer', () => {
    // "tweet" is a text-gen keyword — avoid substrings of complex keywords
    // ("develop" in "developers", "begin" in "beginners") in the prompt
    const result = classify(manager, 'write a tweet about OpenBridge for casual users');
    expect(result.class).toBe('quick-answer');
    expect(result.maxTurns).toBe(5);
  });

  it('classifies "draft a LinkedIn post" as quick-answer', () => {
    const result = classify(manager, 'draft a LinkedIn post about our new release');
    expect(result.class).toBe('quick-answer');
    expect(result.maxTurns).toBe(5);
  });

  it('classifies "rephrase this" as quick-answer', () => {
    const result = classify(manager, 'rephrase this paragraph to sound more professional');
    expect(result.class).toBe('quick-answer');
    expect(result.maxTurns).toBe(5);
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
