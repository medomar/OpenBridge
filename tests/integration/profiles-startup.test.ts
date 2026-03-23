/**
 * Integration test: profile escalation + startup log noise (OB-1559)
 *
 * Verifies:
 *   1. FILE_OP_KEYWORDS detects file-operation prompts ("delete the old build folder").
 *   2. Profile resolution: code-edit → file-management with Bash(rm:*) in resolved tools.
 *   3. Non-destructive prompts ("add a new feature") stay on code-edit.
 *   4. DotFolderManager on a fresh workspace (no .openbridge/) returns null for all
 *      4 read methods and logs zero WARN-level messages.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Heavy dep mocks — must be set up before worker-orchestrator is imported
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Logger mock — captures warn calls for the startup noise assertions
// vi.hoisted() ensures mockWarn is initialized before vi.mock() factory runs
// ---------------------------------------------------------------------------

const mockWarn = vi.hoisted(() => vi.fn());

vi.mock('../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: mockWarn,
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Imports — AFTER all vi.mock() calls (they are hoisted, but keep order clear)
// ---------------------------------------------------------------------------

import { FILE_OP_KEYWORDS } from '../../src/master/worker-orchestrator.js';
import { resolveTools } from '../../src/core/agent-runner.js';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';

// ---------------------------------------------------------------------------
// Helper: simulate the escalation logic from worker-orchestrator.ts:926-931
// ---------------------------------------------------------------------------

function applyEscalation(profile: string, prompt: string): string {
  if (profile === 'code-edit' && FILE_OP_KEYWORDS.test(prompt)) {
    return 'file-management';
  }
  return profile;
}

// ---------------------------------------------------------------------------
// 1. Profile escalation — end-to-end: keyword → profile → resolved tools
// ---------------------------------------------------------------------------

describe('Profile escalation: code-edit → file-management (end-to-end)', () => {
  it('FILE_OP_KEYWORDS matches "delete the old build folder"', () => {
    expect(FILE_OP_KEYWORDS.test('delete the old build folder')).toBe(true);
  });

  it('FILE_OP_KEYWORDS does not match "add a new feature"', () => {
    expect(FILE_OP_KEYWORDS.test('add a new feature')).toBe(false);
  });

  it('escalates profile to file-management when delete keyword present', () => {
    const result = applyEscalation('code-edit', 'delete the old build folder');
    expect(result).toBe('file-management');
  });

  it('keeps code-edit profile when no file-op keywords present', () => {
    const result = applyEscalation('code-edit', 'add a new feature');
    expect(result).toBe('code-edit');
  });

  it('resolved file-management tools include Bash(rm:*)', () => {
    const escalatedProfile = applyEscalation('code-edit', 'delete the old build folder');
    const tools = resolveTools(escalatedProfile);
    expect(tools).toBeDefined();
    expect(tools).toContain('Bash(rm:*)');
  });

  it('resolved file-management tools include Bash(mv:*), Bash(cp:*), Bash(mkdir:*)', () => {
    const escalatedProfile = applyEscalation('code-edit', 'delete the old build folder');
    const tools = resolveTools(escalatedProfile);
    expect(tools).toContain('Bash(mv:*)');
    expect(tools).toContain('Bash(cp:*)');
    expect(tools).toContain('Bash(mkdir:*)');
  });

  it('non-escalated code-edit profile also includes Bash(rm:*) after OB-1547 fix', () => {
    const stayedProfile = applyEscalation('code-edit', 'add a new feature');
    const tools = resolveTools(stayedProfile);
    expect(tools).toContain('Bash(rm:*)');
  });

  it('non-escalated code-edit profile does NOT resolve to file-management tools only', () => {
    const stayedProfile = applyEscalation('code-edit', 'add a new feature');
    // Stays code-edit — resolveTools should return the code-edit tool set
    const tools = resolveTools(stayedProfile);
    expect(tools).toBeDefined();
    // code-edit includes git/npm but NOT chmod (which is file-management only)
    expect(tools).toContain('Bash(git:*)');
    expect(tools).toContain('Bash(npm:*)');
  });
});

// ---------------------------------------------------------------------------
// 2. DotFolderManager startup — zero WARN logs on empty workspace
// ---------------------------------------------------------------------------

describe('DotFolderManager startup: zero WARN logs on empty workspace', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ob-profiles-startup-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('all 4 read methods return null when .openbridge/ folder is missing', async () => {
    const mgr = new DotFolderManager(tempDir);

    const [systemPrompt, batchState, promptManifest, learnings] = await Promise.all([
      mgr.readSystemPrompt(),
      mgr.readBatchState(),
      mgr.readPromptManifest(),
      mgr.readLearnings(),
    ]);

    expect(systemPrompt).toBeNull();
    expect(batchState).toBeNull();
    expect(promptManifest).toBeNull();
    expect(learnings).toBeNull();
  });

  it('no WARN-level messages logged for missing files on first call', async () => {
    const mgr = new DotFolderManager(tempDir);

    await mgr.readSystemPrompt();
    await mgr.readBatchState();
    await mgr.readPromptManifest();
    await mgr.readLearnings();

    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('no WARN-level messages on subsequent calls (no "expected on first run" noise)', async () => {
    const mgr = new DotFolderManager(tempDir);

    // First round
    await mgr.readSystemPrompt();
    await mgr.readBatchState();
    await mgr.readPromptManifest();
    await mgr.readLearnings();

    // Second round
    await mgr.readSystemPrompt();
    await mgr.readBatchState();
    await mgr.readPromptManifest();
    await mgr.readLearnings();

    expect(mockWarn).not.toHaveBeenCalled();
  });
});
