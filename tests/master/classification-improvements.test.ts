/**
 * Unit tests for classification engine improvements (OB-1526, OB-1527, OB-1528, OB-1529).
 * Tests keyword-matching changes and AI-classifier priority over keyword fallback.
 * File: tests/master/classification-improvements.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ClassificationEngine,
  type ClassificationResult,
  type ClassificationEngineDeps,
} from '../../src/master/classification-engine.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../src/intelligence/skill-creator.js', () => ({
  getTopSkills: vi.fn().mockResolvedValue([]),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockSpawn = vi.fn();

function makeDeps(overrides?: Partial<ClassificationEngineDeps>): ClassificationEngineDeps {
  return {
    memory: null,
    dotFolder: {
      readClassificationCache: vi.fn().mockResolvedValue(null),
      writeClassificationCache: vi.fn().mockResolvedValue(undefined),
    } as unknown as ClassificationEngineDeps['dotFolder'],
    agentRunner: {
      spawn: mockSpawn,
    } as unknown as ClassificationEngineDeps['agentRunner'],
    modelRegistry: {
      resolveModelOrTier: vi.fn().mockReturnValue('claude-haiku-4-5'),
    } as unknown as ClassificationEngineDeps['modelRegistry'],
    workspacePath: '/tmp/test-workspace',
    adapter: { name: 'claude' } as unknown as ClassificationEngineDeps['adapter'],
    getWorkspaceContext: () => null,
    ...overrides,
  };
}

/**
 * Call the public classifyTaskByKeywords method.
 * This exercises pure keyword heuristics without the AI classifier pipeline.
 */
function classifyByKeywords(
  engine: ClassificationEngine,
  content: string,
  recentUserMessages?: string[],
  lastBotResponse?: string,
): ClassificationResult {
  return (
    engine as unknown as {
      classifyTaskByKeywords(
        content: string,
        recentUserMessages?: string[],
        lastBotResponse?: string,
      ): ClassificationResult;
    }
  ).classifyTaskByKeywords(content, recentUserMessages, lastBotResponse);
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('ClassificationEngine — OB-1526 conversational intent → quick-answer', () => {
  let engine: ClassificationEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new ClassificationEngine(makeDeps());
  });

  it('"I want to know if I can add a worker" classifies as quick-answer', () => {
    const result = classifyByKeywords(engine, 'I want to know if I can add a worker');
    expect(result.class).toBe('quick-answer');
  });

  it('"how can I learn about the worker system" classifies as quick-answer', () => {
    // "how can I" is a conversational pattern; no tool-use keywords present
    const result = classifyByKeywords(engine, 'how can I learn about the worker system');
    expect(result.class).toBe('quick-answer');
  });

  it('"is it possible to use multiple connectors" classifies as quick-answer', () => {
    const result = classifyByKeywords(engine, 'is it possible to use multiple connectors');
    expect(result.class).toBe('quick-answer');
  });

  it('"can you explain how the memory system works" classifies as quick-answer', () => {
    const result = classifyByKeywords(engine, 'can you explain how the memory system works');
    expect(result.class).toBe('quick-answer');
  });
});

describe('ClassificationEngine — OB-1527 batch-mode false-positive prevention', () => {
  let engine: ClassificationEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new ClassificationEngine(makeDeps());
  });

  it('"normally know about the sub-companies and about the stock" is NOT batch-mode', () => {
    const result = classifyByKeywords(
      engine,
      'normally know about the sub-companies and about the stock',
    );
    expect(result.batchMode).toBeFalsy();
    expect(result.class).not.toBe('complex-task');
  });

  it('"bon de commande" alone does NOT trigger batch-mode', () => {
    const result = classifyByKeywords(engine, 'bon de commande pour le mois de mars');
    expect(result.batchMode).toBeFalsy();
  });

  it('"command" alone does NOT trigger batch-mode', () => {
    const result = classifyByKeywords(engine, 'command for the system');
    expect(result.batchMode).toBeFalsy();
  });

  it('"batch" alone does NOT trigger batch-mode', () => {
    const result = classifyByKeywords(engine, 'batch results from the analysis');
    expect(result.batchMode).toBeFalsy();
  });
});

describe('ClassificationEngine — OB-1527 batch-mode true positives', () => {
  let engine: ClassificationEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new ClassificationEngine(makeDeps());
  });

  it('"run a batch process on all files" classifies as batch-mode', () => {
    const result = classifyByKeywords(engine, 'run a batch process on all files');
    expect(result.batchMode).toBe(true);
    expect(result.class).toBe('complex-task');
  });

  it('"batch run the tests" classifies as batch-mode', () => {
    const result = classifyByKeywords(engine, 'batch run the tests');
    expect(result.batchMode).toBe(true);
  });

  it('"for each file in the directory, update the imports" classifies as batch-mode', () => {
    const result = classifyByKeywords(engine, 'for each file in the directory, update the imports');
    expect(result.batchMode).toBe(true);
  });

  it('"implement all the pending tasks" classifies as batch-mode', () => {
    const result = classifyByKeywords(engine, 'implement all the pending tasks');
    expect(result.batchMode).toBe(true);
  });
});

describe('ClassificationEngine — OB-1528 AI classifier priority ≥ 0.4 over keyword', () => {
  let engine: ClassificationEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new ClassificationEngine(makeDeps());
  });

  it('AI quick-answer at confidence 0.5 beats keyword tool-use result', async () => {
    // "configure" is in toolUseKeywords → keyword returns tool-use
    // AI returns quick-answer with confidence 0.5 → AI should win (confidence ≥ 0.4)
    mockSpawn.mockResolvedValueOnce({
      stdout: JSON.stringify({
        class: 'quick-answer',
        maxTurns: 5,
        reason: 'conversational question',
        confidence: 0.5,
      }),
      stderr: '',
      exitCode: 0,
    });

    const result = await engine.classifyTask('configure something please');
    expect(result.class).toBe('quick-answer');
    expect(result.reason).toContain('AI classifier');
  });

  it('AI tool-use at confidence 0.6 beats keyword quick-answer result', async () => {
    // "what about this" → keyword matches conversational → quick-answer
    // AI returns tool-use with confidence 0.6 → AI should win
    mockSpawn.mockResolvedValueOnce({
      stdout: JSON.stringify({
        class: 'tool-use',
        maxTurns: 15,
        reason: 'needs file access',
        confidence: 0.6,
      }),
      stderr: '',
      exitCode: 0,
    });

    const result = await engine.classifyTask('what about this configuration file');
    expect(result.class).toBe('tool-use');
    expect(result.reason).toContain('AI classifier');
  });

  it('AI classifier at confidence < 0.4 loses to keyword match', async () => {
    // "run a batch process" → keyword returns complex-task/batch-mode
    // AI returns quick-answer with confidence 0.3 (< 0.4) → keyword should win
    mockSpawn.mockResolvedValueOnce({
      stdout: JSON.stringify({
        class: 'quick-answer',
        maxTurns: 5,
        reason: 'short message',
        confidence: 0.3,
      }),
      stderr: '',
      exitCode: 0,
    });

    const result = await engine.classifyTask('run a batch process on all files');
    // keyword wins → complex-task with batchMode
    expect(result.class).toBe('complex-task');
    expect(result.batchMode).toBe(true);
  });

  it('when AI classifier fails, keyword result is used', async () => {
    // AI call throws → fall back to keyword
    mockSpawn.mockRejectedValueOnce(new Error('classifier timeout'));

    // "for each file" → keyword matches batch-mode
    const result = await engine.classifyTask('for each file in the directory update imports');
    expect(result.class).toBe('complex-task');
    expect(result.batchMode).toBe(true);
  });
});

describe('ClassificationEngine — OB-1529 default fallback is quick-answer', () => {
  let engine: ClassificationEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new ClassificationEngine(makeDeps());
  });

  it('unrecognized message defaults to quick-answer not tool-use', () => {
    const result = classifyByKeywords(engine, 'zxyqw something totally unrecognized here');
    expect(result.class).toBe('quick-answer');
    expect(result.reason).toContain('fallback');
  });

  it('default fallback has 5 max turns (quick-answer budget)', () => {
    const result = classifyByKeywords(engine, 'completely unknown message with no keywords');
    expect(result.class).toBe('quick-answer');
    expect(result.maxTurns).toBe(5);
  });
});
