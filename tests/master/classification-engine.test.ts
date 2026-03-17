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
  CLI_STARTUP_BUDGET_MS,
  MESSAGE_MAX_TURNS_QUICK,
  turnsToTimeout,
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

// ── Suite: escalation suppression via efficiency data (OB-1574, OB-F208) ─────

/**
 * Helper: build deps with a mock memory that drives the escalation path.
 * - getLearnedParams('classification') → { model: 'complex-task', success_rate: 0.9, ... }
 *   (satisfies learnedRank > currentRank, success_rate > 0.5, currentRank > 0)
 * - getTaskEfficiency('complex-task') → caller-supplied value
 */
function makeDepsWithMemory(
  efficiencyData: { avg_turns: number; avg_workers: number; sample_count: number } | null,
): ClassificationEngineDeps {
  const mockMemory = {
    getLearnedParams: vi.fn().mockResolvedValue({
      model: 'complex-task',
      success_rate: 0.9,
      avg_turns: 10,
      total_tasks: 20,
    }),
    getTaskEfficiency: vi.fn().mockResolvedValue(
      efficiencyData
        ? {
            task_class: 'complex-task',
            avg_turns: efficiencyData.avg_turns,
            avg_workers: efficiencyData.avg_workers,
            sample_count: efficiencyData.sample_count,
            updated_at: new Date().toISOString(),
          }
        : null,
    ),
    getDb: vi.fn().mockReturnValue(null),
    getSessionHistory: vi.fn().mockResolvedValue([]),
    getSystemConfig: vi.fn().mockResolvedValue(null),
    setSystemConfig: vi.fn().mockResolvedValue(undefined),
    recordLearning: vi.fn().mockResolvedValue(undefined),
  };

  return makeDeps({
    memory: mockMemory as unknown as ClassificationEngineDeps['memory'],
  });
}

describe('ClassificationEngine — efficiency-based escalation suppression (OB-1574, OB-F208)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('suppresses escalation when avg_turns < 5, avg_workers <= 1, sample_count >= 5', async () => {
    const engine = new ClassificationEngine(
      makeDepsWithMemory({ avg_turns: 3, avg_workers: 1, sample_count: 5 }),
    );

    // AI classifies as tool-use (rank 1) with high confidence
    mockSpawn.mockResolvedValueOnce({
      stdout: JSON.stringify({
        class: 'tool-use',
        maxTurns: 10,
        reason: 'Generate a report from the data',
        confidence: 0.85,
      }),
      stderr: '',
      exitCode: 0,
    });

    const result = await engine.classifyTask('generate a report', 'sess-suppress');

    // Escalation should be suppressed — result stays tool-use
    expect(result.class).toBe('tool-use');
  });

  it('proceeds with escalation when avg_turns >= 5 (high usage indicates escalated class is necessary)', async () => {
    const engine = new ClassificationEngine(
      makeDepsWithMemory({ avg_turns: 12, avg_workers: 3, sample_count: 5 }),
    );

    mockSpawn.mockResolvedValueOnce({
      stdout: JSON.stringify({
        class: 'tool-use',
        maxTurns: 10,
        reason: 'Generate a report from the data',
        confidence: 0.85,
      }),
      stderr: '',
      exitCode: 0,
    });

    const result = await engine.classifyTask('generate a report', 'sess-proceed-turns');

    // avg_turns >= 5 → suppression condition NOT met → escalation proceeds
    expect(result.class).toBe('complex-task');
  });

  it('proceeds with escalation when sample_count < 5 (not enough data to suppress)', async () => {
    const engine = new ClassificationEngine(
      makeDepsWithMemory({ avg_turns: 3, avg_workers: 1, sample_count: 2 }),
    );

    mockSpawn.mockResolvedValueOnce({
      stdout: JSON.stringify({
        class: 'tool-use',
        maxTurns: 10,
        reason: 'Generate a report from the data',
        confidence: 0.85,
      }),
      stderr: '',
      exitCode: 0,
    });

    const result = await engine.classifyTask('generate a report', 'sess-proceed-samples');

    // sample_count < 5 → not enough data → escalation proceeds
    expect(result.class).toBe('complex-task');
  });

  it('proceeds with escalation when efficiency data is null (no efficiency records yet)', async () => {
    const engine = new ClassificationEngine(makeDepsWithMemory(null));

    mockSpawn.mockResolvedValueOnce({
      stdout: JSON.stringify({
        class: 'tool-use',
        maxTurns: 10,
        reason: 'Generate a report from the data',
        confidence: 0.85,
      }),
      stderr: '',
      exitCode: 0,
    });

    const result = await engine.classifyTask('generate a report', 'sess-null-efficiency');

    // No efficiency data → cannot suppress → escalation proceeds
    expect(result.class).toBe('complex-task');
  });
});

// ── Suite: OB-1618 timeout constant updates ────────────────────────────────

describe('ClassificationEngine — timeout computation with updated constants (OB-1618)', () => {
  it('verifies CLI_STARTUP_BUDGET_MS is 30_000', () => {
    // OB-1616 reduced CLI startup budget from 60s to 30s
    expect(CLI_STARTUP_BUDGET_MS).toBe(30_000);
  });

  it('verifies MESSAGE_MAX_TURNS_QUICK is 3', () => {
    // OB-1616 reduced quick-answer turn budget from 5 to 3
    expect(MESSAGE_MAX_TURNS_QUICK).toBe(3);
  });

  it('verifies turnsToTimeout(3) returns 120_000 with updated constants', () => {
    // OB-1616 changed CLI_STARTUP_BUDGET_MS to 30_000
    // Quick-answer timeout: 30_000 + 3 × 30_000 = 120_000ms
    expect(turnsToTimeout(3)).toBe(120_000);
  });

  it('verifies turnsToTimeout formula is correct for other task types', () => {
    // Tool-use: 30_000 + 15 × 30_000 = 480_000ms
    expect(turnsToTimeout(15)).toBe(480_000);
    // Complex-task: 30_000 + 25 × 30_000 = 780_000ms
    expect(turnsToTimeout(25)).toBe(780_000);
  });
});
