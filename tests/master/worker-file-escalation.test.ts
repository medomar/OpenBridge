/**
 * Unit tests for worker file-operation profile auto-escalation (OB-1549).
 *
 * Covers:
 *  1. FILE_OP_KEYWORDS regex matches file-operation prompts
 *  2. FILE_OP_KEYWORDS does NOT match non-destructive prompts
 *  3. code-edit profile escalates to file-management when keywords present
 *  4. code-edit profile stays as code-edit when no file-op keywords
 *
 * Note: worker-orchestrator.ts has a deep import chain including
 * @anthropic-ai/claude-agent-sdk.  We mock those heavy transitive deps so the
 * module can be loaded in the test environment.
 */

import { describe, it, expect, vi } from 'vitest';

// @anthropic-ai/claude-agent-sdk is an optional peer dep not installed in CI.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

// router.ts pulls in many things; mock it to avoid further dep chains.
vi.mock('../../src/core/router.js', () => ({
  classifyDocumentIntent: vi.fn().mockReturnValue('general'),
  Router: class {},
}));

// planning-gate.ts may require additional native modules.
vi.mock('../../src/master/planning-gate.js', () => ({
  performReasoningCheckpoint: vi.fn().mockResolvedValue({ approved: true }),
}));

// skill-pack-loader pulls in complex logic; stub it out.
vi.mock('../../src/master/skill-pack-loader.js', () => ({
  getBuiltInSkillPacks: vi.fn().mockReturnValue([]),
  findSkillByFormat: vi.fn().mockReturnValue(null),
  selectSkillPackForTask: vi.fn().mockReturnValue(null),
}));

import { FILE_OP_KEYWORDS } from '../../src/master/worker-orchestrator.js';

// ---------------------------------------------------------------------------
// FILE_OP_KEYWORDS regex
// ---------------------------------------------------------------------------

describe('FILE_OP_KEYWORDS', () => {
  it('matches "delete the build folder"', () => {
    expect(FILE_OP_KEYWORDS.test('delete the build folder')).toBe(true);
  });

  it('matches "remove old log files"', () => {
    expect(FILE_OP_KEYWORDS.test('remove old log files')).toBe(true);
  });

  it('matches "rm -rf dist/"', () => {
    expect(FILE_OP_KEYWORDS.test('rm -rf dist/')).toBe(true);
  });

  it('matches "rmdir the temp directory"', () => {
    expect(FILE_OP_KEYWORDS.test('rmdir the temp directory')).toBe(true);
  });

  it('matches "rename the config file"', () => {
    expect(FILE_OP_KEYWORDS.test('rename the config file to config.prod.json')).toBe(true);
  });

  it('matches "move src/utils to lib/utils"', () => {
    expect(FILE_OP_KEYWORDS.test('move src/utils to lib/utils')).toBe(true);
  });

  it('matches "mv old.ts new.ts"', () => {
    expect(FILE_OP_KEYWORDS.test('mv old.ts new.ts')).toBe(true);
  });

  it('matches "copy the assets folder"', () => {
    expect(FILE_OP_KEYWORDS.test('copy the assets folder')).toBe(true);
  });

  it('matches "cp config.example.json config.json"', () => {
    expect(FILE_OP_KEYWORDS.test('cp config.example.json config.json')).toBe(true);
  });

  it('matches "mkdir output/reports"', () => {
    expect(FILE_OP_KEYWORDS.test('mkdir output/reports')).toBe(true);
  });

  it('is case-insensitive — matches "DELETE" uppercase', () => {
    expect(FILE_OP_KEYWORDS.test('DELETE the old build artifacts')).toBe(true);
  });

  it('does NOT match "add a new feature"', () => {
    expect(FILE_OP_KEYWORDS.test('add a new feature')).toBe(false);
  });

  it('does NOT match "refactor the auth module"', () => {
    expect(FILE_OP_KEYWORDS.test('refactor the auth module')).toBe(false);
  });

  it('does NOT match "write unit tests for the parser"', () => {
    expect(FILE_OP_KEYWORDS.test('write unit tests for the parser')).toBe(false);
  });

  it('does NOT match "fix the bug in router.ts"', () => {
    expect(FILE_OP_KEYWORDS.test('fix the bug in router.ts')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Profile escalation logic (mirrors the condition in spawnWorker)
// ---------------------------------------------------------------------------

/**
 * Inline helper that mirrors the escalation check in WorkerOrchestrator.spawnWorker().
 * Tests the pure logic in isolation without instantiating the full orchestrator.
 */
function applyProfileEscalation(profile: string, prompt: string): string {
  if (profile === 'code-edit' && FILE_OP_KEYWORDS.test(prompt)) {
    return 'file-management';
  }
  return profile;
}

describe('profile auto-escalation', () => {
  it('escalates code-edit to file-management for "delete the build folder"', () => {
    expect(applyProfileEscalation('code-edit', 'delete the build folder')).toBe('file-management');
  });

  it('escalates code-edit to file-management for "remove old log files"', () => {
    expect(applyProfileEscalation('code-edit', 'remove old log files')).toBe('file-management');
  });

  it('escalates code-edit to file-management for "mkdir dist && cp src/* dist/"', () => {
    expect(applyProfileEscalation('code-edit', 'mkdir dist && cp src/* dist/')).toBe(
      'file-management',
    );
  });

  it('keeps code-edit for "add a new feature"', () => {
    expect(applyProfileEscalation('code-edit', 'add a new feature')).toBe('code-edit');
  });

  it('keeps code-edit for "refactor the auth module"', () => {
    expect(applyProfileEscalation('code-edit', 'refactor the auth module')).toBe('code-edit');
  });

  it('does NOT escalate read-only profile even with file-op keywords', () => {
    expect(applyProfileEscalation('read-only', 'delete the build folder')).toBe('read-only');
  });

  it('does NOT escalate full-access profile (already has all tools)', () => {
    expect(applyProfileEscalation('full-access', 'delete the build folder')).toBe('full-access');
  });

  it('does NOT escalate file-management profile (already at target)', () => {
    expect(applyProfileEscalation('file-management', 'delete the build folder')).toBe(
      'file-management',
    );
  });
});
