import { describe, it, expect } from 'vitest';
import {
  recommendByProfile,
  recommendByDescription,
  recommendModel,
} from '../../src/core/model-selector.js';
import type { TaskManifest } from '../../src/types/agent.js';

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
});
