/**
 * Unit tests for workspace boundary instruction injection (OB-1591, OB-1588).
 *
 * The WorkerOrchestrator prepends a WORKSPACE BOUNDARY instruction to the worker
 * prompt when trustLevel is 'trusted'. These tests verify the injection logic by
 * mirroring the exact condition from worker-orchestrator.ts:850-852 as a pure
 * function — avoiding the need to instantiate the full orchestrator with its many
 * async dependencies.
 *
 * Covers:
 *  1. trustLevel 'trusted' → prompt starts with WORKSPACE BOUNDARY instruction
 *  2. trustLevel 'standard' → prompt is unchanged (no boundary instruction)
 *  3. trustLevel 'sandbox' → prompt is unchanged (no boundary instruction)
 *  4. Boundary instruction includes the correct workspacePath
 *  5. Original prompt content is preserved after injection
 */

import { describe, it, expect } from 'vitest';
import type { WorkspaceTrustLevel } from '../../src/types/config.js';

// ---------------------------------------------------------------------------
// Inline helper — mirrors WorkerOrchestrator.spawnWorker() lines 850-852
// ---------------------------------------------------------------------------

function applyBoundaryInstruction(
  prompt: string,
  workspacePath: string,
  trustLevel: WorkspaceTrustLevel | undefined,
): string {
  if (trustLevel === 'trusted') {
    const boundaryInstruction =
      `WORKSPACE BOUNDARY: You are operating inside ${workspacePath}. ` +
      `All file reads, writes, and Bash commands must target files within this directory. ` +
      `Do not access files outside this workspace (no ~/.ssh, no ~/.env, no /etc). ` +
      `If you need system information, use safe commands like 'node --version' or 'which <tool>'.\n\n`;
    return boundaryInstruction + prompt;
  }
  return prompt;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('workspace boundary instruction injection', () => {
  const workspacePath = '/home/user/my-project';
  const basePrompt = 'Analyze the codebase and fix the bug in src/auth.ts.';

  it('prepends WORKSPACE BOUNDARY when trustLevel is trusted', () => {
    const result = applyBoundaryInstruction(basePrompt, workspacePath, 'trusted');
    expect(result).toMatch(/^WORKSPACE BOUNDARY:/);
  });

  it('includes the workspacePath in the boundary instruction', () => {
    const result = applyBoundaryInstruction(basePrompt, workspacePath, 'trusted');
    expect(result).toContain(workspacePath);
  });

  it('preserves the original prompt content after the boundary instruction', () => {
    const result = applyBoundaryInstruction(basePrompt, workspacePath, 'trusted');
    expect(result).toContain(basePrompt);
    // Original prompt comes after the instruction (not before)
    const boundaryEnd = result.indexOf('\n\n');
    expect(result.slice(boundaryEnd + 2)).toBe(basePrompt);
  });

  it('does NOT inject boundary instruction for standard trust level', () => {
    const result = applyBoundaryInstruction(basePrompt, workspacePath, 'standard');
    expect(result).toBe(basePrompt);
    expect(result).not.toMatch(/^WORKSPACE BOUNDARY:/);
  });

  it('does NOT inject boundary instruction for sandbox trust level', () => {
    const result = applyBoundaryInstruction(basePrompt, workspacePath, 'sandbox');
    expect(result).toBe(basePrompt);
    expect(result).not.toMatch(/^WORKSPACE BOUNDARY:/);
  });

  it('does NOT inject boundary instruction when trustLevel is undefined', () => {
    const result = applyBoundaryInstruction(basePrompt, workspacePath, undefined);
    expect(result).toBe(basePrompt);
  });

  it('boundary instruction mentions /etc as a forbidden directory', () => {
    const result = applyBoundaryInstruction(basePrompt, workspacePath, 'trusted');
    expect(result).toContain('no /etc');
  });

  it('boundary instruction mentions ~/.ssh as a forbidden directory', () => {
    const result = applyBoundaryInstruction(basePrompt, workspacePath, 'trusted');
    expect(result).toContain('no ~/.ssh');
  });
});
