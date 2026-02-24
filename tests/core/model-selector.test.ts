import { describe, it, expect } from 'vitest';
import {
  recommendByProfile,
  recommendByDescription,
  recommendModel,
  recommendFromLearnings,
} from '../../src/core/model-selector.js';
import type { TaskManifest } from '../../src/types/agent.js';
import type { LearningEntry } from '../../src/types/master.js';

// ── recommendByProfile ──────────────────────────────────────────────

describe('recommendByProfile', () => {
  it('recommends haiku for read-only profile', () => {
    const rec = recommendByProfile('read-only');
    expect(rec.model).toBe('haiku');
    expect(rec.reason).toContain('read-only');
  });

  it('recommends sonnet for code-edit profile', () => {
    const rec = recommendByProfile('code-edit');
    expect(rec.model).toBe('sonnet');
    expect(rec.reason).toContain('code-edit');
  });

  it('recommends sonnet for full-access profile', () => {
    const rec = recommendByProfile('full-access');
    expect(rec.model).toBe('sonnet');
    expect(rec.reason).toContain('full-access');
  });

  it('defaults to sonnet for unknown profiles', () => {
    const rec = recommendByProfile('custom-profile');
    expect(rec.model).toBe('sonnet');
    expect(rec.reason).toContain('unknown profile');
  });
});

// ── recommendByDescription ──────────────────────────────────────────

describe('recommendByDescription', () => {
  it('recommends opus for complex reasoning keywords', () => {
    const complexDescriptions = [
      'Architect a new module system',
      'Debug the authentication flow',
      'Refactor the entire routing layer',
      'Analyze the security vulnerability',
      'Investigate the performance bottleneck',
    ];

    for (const desc of complexDescriptions) {
      const rec = recommendByDescription(desc);
      expect(rec.model).toBe('opus', `Expected opus for: "${desc}"`);
      expect(rec.reason).toContain('complex reasoning');
    }
  });

  it('recommends sonnet for code editing keywords', () => {
    const editDescriptions = [
      'Implement the user registration form',
      'Create a new API endpoint',
      'Add validation to the login page',
      'Fix the broken test suite',
      'Write unit tests for the router',
    ];

    for (const desc of editDescriptions) {
      const rec = recommendByDescription(desc);
      expect(rec.model).toBe('sonnet', `Expected sonnet for: "${desc}"`);
      expect(rec.reason).toContain('code editing');
    }
  });

  it('recommends haiku for simple tasks with no signals', () => {
    const simpleDescriptions = [
      'List all files in the src directory',
      'Show the project structure',
      'What frameworks does this project use?',
      'Count the number of TypeScript files',
    ];

    for (const desc of simpleDescriptions) {
      const rec = recommendByDescription(desc);
      expect(rec.model).toBe('haiku', `Expected haiku for: "${desc}"`);
      expect(rec.reason).toContain('no complexity signals');
    }
  });

  it('is case-insensitive', () => {
    expect(recommendByDescription('REFACTOR the module').model).toBe('opus');
    expect(recommendByDescription('IMPLEMENT the feature').model).toBe('sonnet');
  });

  it('prioritizes complex keywords over code-edit keywords', () => {
    // "debug" is complex, "fix" is code-edit — complex wins (checked first)
    const rec = recommendByDescription('Debug and fix the login flow');
    expect(rec.model).toBe('opus');
  });
});

// ── recommendModel ──────────────────────────────────────────────────

describe('recommendModel', () => {
  const baseManifest: TaskManifest = {
    prompt: 'List all files',
    workspacePath: '/tmp/test',
  };

  it('returns explicit model when set in manifest', () => {
    const manifest: TaskManifest = { ...baseManifest, model: 'opus' };
    const rec = recommendModel(manifest);
    expect(rec.model).toBe('opus');
    expect(rec.reason).toContain('explicitly set');
  });

  it('returns explicit model even if profile is also set', () => {
    const manifest: TaskManifest = {
      ...baseManifest,
      model: 'haiku',
      profile: 'code-edit',
    };
    const rec = recommendModel(manifest);
    expect(rec.model).toBe('haiku');
    expect(rec.reason).toContain('explicitly set');
  });

  it('uses profile-based recommendation when no explicit model', () => {
    const manifest: TaskManifest = {
      ...baseManifest,
      profile: 'read-only',
    };
    const rec = recommendModel(manifest);
    expect(rec.model).toBe('haiku');
    expect(rec.reason).toContain('read-only');
  });

  it('falls back to description-based recommendation', () => {
    const manifest: TaskManifest = {
      prompt: 'Debug the authentication system',
      workspacePath: '/tmp/test',
    };
    const rec = recommendModel(manifest);
    expect(rec.model).toBe('opus');
    expect(rec.reason).toContain('complex reasoning');
  });

  it('defaults to haiku for simple prompts with no profile', () => {
    const rec = recommendModel(baseManifest);
    expect(rec.model).toBe('haiku');
  });

  it('uses learnings-based recommendation when data is available', () => {
    const learnings = makeLearnings('bug-fix', [
      { model: 'sonnet', success: true },
      { model: 'sonnet', success: true },
      { model: 'sonnet', success: true },
      { model: 'haiku', success: false },
      { model: 'haiku', success: false },
    ]);
    const manifest: TaskManifest = {
      prompt: 'Some generic prompt',
      workspacePath: '/tmp/test',
      profile: 'code-edit',
    };
    const rec = recommendModel(manifest, { learnings, taskType: 'bug-fix' });
    expect(rec.model).toBe('sonnet');
    expect(rec.reason).toContain('historical performance');
  });

  it('falls through to heuristics when insufficient learning data', () => {
    const learnings = makeLearnings('bug-fix', [
      { model: 'sonnet', success: true },
      { model: 'sonnet', success: true },
    ]); // Only 2 entries — not enough
    const manifest: TaskManifest = {
      prompt: 'List all files',
      workspacePath: '/tmp/test',
      profile: 'read-only',
    };
    const rec = recommendModel(manifest, { learnings, taskType: 'bug-fix' });
    // Falls through to profile-based: read-only → haiku
    expect(rec.model).toBe('haiku');
  });
});

// ── recommendFromLearnings ─────────────────────────────────────────

/** Helper to generate learning entries */
function makeLearnings(
  taskType: string,
  items: Array<{ model: string; success: boolean }>,
): LearningEntry[] {
  return items.map((item, i) => ({
    id: `learning-${i}`,
    taskType,
    modelUsed: item.model,
    profileUsed: 'code-edit',
    success: item.success,
    durationMs: 1000,
    recordedAt: new Date().toISOString(),
    exitCode: item.success ? 0 : 1,
    retryCount: 0,
    metadata: {},
  }));
}

describe('recommendFromLearnings', () => {
  it('returns the model with the highest success rate', () => {
    const learnings = makeLearnings('testing', [
      { model: 'sonnet', success: true },
      { model: 'sonnet', success: true },
      { model: 'sonnet', success: true },
      { model: 'haiku', success: true },
      { model: 'haiku', success: false },
      { model: 'haiku', success: false },
    ]);
    const rec = recommendFromLearnings('testing', learnings);
    expect(rec).not.toBeNull();
    expect(rec!.model).toBe('sonnet'); // 100% vs 33%
    expect(rec!.reason).toContain('testing');
  });

  it('returns null when insufficient entries (<5)', () => {
    const learnings = makeLearnings('feature', [
      { model: 'sonnet', success: true },
      { model: 'sonnet', success: true },
      { model: 'sonnet', success: true },
    ]);
    const rec = recommendFromLearnings('feature', learnings);
    expect(rec).toBeNull();
  });

  it('returns null when no model has 3+ uses', () => {
    const learnings = makeLearnings('refactoring', [
      { model: 'sonnet', success: true },
      { model: 'sonnet', success: true },
      { model: 'haiku', success: true },
      { model: 'opus', success: true },
      { model: 'opus', success: false },
    ]);
    const rec = recommendFromLearnings('refactoring', learnings);
    // sonnet has 2, haiku has 1, opus has 2 — none reach 3
    expect(rec).toBeNull();
  });

  it('ignores entries for other task types', () => {
    const mixed = [
      ...makeLearnings('bug-fix', [
        { model: 'haiku', success: true },
        { model: 'haiku', success: true },
        { model: 'haiku', success: true },
      ]),
      ...makeLearnings('feature', [
        { model: 'sonnet', success: true },
        { model: 'sonnet', success: true },
        { model: 'sonnet', success: true },
        { model: 'sonnet', success: true },
        { model: 'sonnet', success: true },
      ]),
    ];
    // bug-fix only has 3 entries → insufficient
    expect(recommendFromLearnings('bug-fix', mixed)).toBeNull();
    // feature has 5 entries → sufficient
    expect(recommendFromLearnings('feature', mixed)?.model).toBe('sonnet');
  });

  it('picks the better model even with different sample sizes', () => {
    const learnings = makeLearnings('optimization', [
      { model: 'opus', success: true },
      { model: 'opus', success: true },
      { model: 'opus', success: true },
      { model: 'sonnet', success: true },
      { model: 'sonnet', success: true },
      { model: 'sonnet', success: false },
      { model: 'sonnet', success: false },
    ]);
    const rec = recommendFromLearnings('optimization', learnings);
    expect(rec).not.toBeNull();
    expect(rec!.model).toBe('opus'); // 100% vs 50%
  });
});
