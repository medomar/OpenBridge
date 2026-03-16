/**
 * Unit tests for ClassificationEngine ragQuery field (OB-1571, OB-F207).
 *
 * Verifies that:
 * 1. `ragQuery` is populated from the AI classifier's English reason string.
 * 2. `ragQuery` is `undefined` for keyword-fallback classifications.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ClassificationEngine,
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
 * Access the private classifyTaskByKeywords method for keyword-fallback testing.
 */
function classifyByKeywords(engine: ClassificationEngine, content: string) {
  return (
    engine as unknown as {
      classifyTaskByKeywords(content: string): ReturnType<ClassificationEngine['classifyTask']>;
    }
  ).classifyTaskByKeywords(content);
}

// ── Suite: ragQuery from AI classifier (OB-1571) ─────────────────────────────

describe('ClassificationEngine — ragQuery field (OB-1571, OB-F207)', () => {
  let engine: ClassificationEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new ClassificationEngine(makeDeps());
  });

  it('sets ragQuery when AI classifier returns a reason longer than 10 chars', async () => {
    // Mock the AI classifier to return a JSON object with class + reason in English
    mockSpawn.mockResolvedValueOnce({
      stdout: JSON.stringify({
        class: 'tool-use',
        maxTurns: 10,
        reason: 'Data analysis query requiring supplier aggregation',
        confidence: 0.85,
      }),
      stderr: '',
      exitCode: 0,
    });

    const result = await engine.classifyTask(
      'ta3tini les fournisseurs b9adech khasarna',
      'session-1',
    );

    expect(result.class).toBe('tool-use');
    expect(result.ragQuery).toBe('Data analysis query requiring supplier aggregation');
  });

  it('sets ragQuery on quick-answer AI classification with meaningful reason', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: JSON.stringify({
        class: 'quick-answer',
        maxTurns: 5,
        reason: 'User asks about product pricing and discount calculations',
        confidence: 0.9,
      }),
      stderr: '',
      exitCode: 0,
    });

    const result = await engine.classifyTask('b9adech el prix dyal hadchi', 'session-2');

    expect(result.class).toBe('quick-answer');
    expect(result.ragQuery).toBe('User asks about product pricing and discount calculations');
  });

  it('leaves ragQuery undefined when AI reason is 10 chars or shorter', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: JSON.stringify({
        class: 'tool-use',
        maxTurns: 10,
        reason: 'Short',
        confidence: 0.7,
      }),
      stderr: '',
      exitCode: 0,
    });

    const result = await engine.classifyTask('some query', 'session-3');

    // reason.length <= 10 → ragQuery should be undefined
    expect(result.ragQuery).toBeUndefined();
  });

  it('leaves ragQuery undefined when AI reason is exactly empty string', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: JSON.stringify({
        class: 'quick-answer',
        maxTurns: 5,
        reason: '',
        confidence: 0.5,
      }),
      stderr: '',
      exitCode: 0,
    });

    const result = await engine.classifyTask('hello', 'session-4');

    expect(result.ragQuery).toBeUndefined();
  });
});

// ── Suite: ragQuery absent for keyword fallback (OB-1571) ────────────────────

describe('ClassificationEngine — keyword fallback has no ragQuery (OB-1571)', () => {
  let engine: ClassificationEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new ClassificationEngine(makeDeps());
  });

  it('does NOT set ragQuery for keyword-matched quick-answer', () => {
    const result = classifyByKeywords(engine, 'explain how the auth module works');
    // Keyword fallback should not produce ragQuery
    expect((result as Awaited<typeof result>).ragQuery).toBeUndefined();
  });

  it('does NOT set ragQuery for keyword-matched tool-use', () => {
    const result = classifyByKeywords(engine, 'create a new file called helpers.ts');
    expect((result as Awaited<typeof result>).ragQuery).toBeUndefined();
  });

  it('does NOT set ragQuery for keyword-matched complex-task', () => {
    const result = classifyByKeywords(engine, 'implement a full authentication system');
    expect((result as Awaited<typeof result>).ragQuery).toBeUndefined();
  });
});
