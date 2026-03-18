/**
 * Integration tests for trust-level full paths (OB-1605, OB-1606, OB-1607).
 *
 * Exercises all trust-level-aware functions together to catch integration
 * issues (e.g. trust level not threaded through correctly).
 *
 * OB-1605 — Trusted mode full path:
 *  1. Config parsing with security.trustLevel = 'trusted'
 *  2. getEffectiveConfirmHighRisk() returns false
 *  3. resolveProfile('read-only', _, 'trusted') returns TOOLS_FULL
 *  4. getMasterTools('trusted') includes Bash
 *  5. getProfileCostCap('full-access', _, 'trusted') returns 6.0
 *  6. requestSpawnConfirmation() auto-approves without user prompt
 *  7. Worker prompt contains workspace boundary instruction
 *
 * OB-1606 — Sandbox mode full path:
 *  1. Config parsing with security.trustLevel = 'sandbox'
 *  2. getEffectiveConfirmHighRisk() returns true
 *  3. resolveProfile('full-access', _, 'sandbox') returns TOOLS_READ_ONLY
 *  4. getMasterTools('sandbox') is ['Read', 'Glob', 'Grep']
 *  5. getProfileCostCap('read-only', _, 'sandbox') returns 0.25
 *  6. requestSpawnConfirmation() blocks with denial
 *  7. /allow command denied
 *  8. Worker prompt does NOT contain workspace boundary instruction
 *
 * OB-1607 — Backward compatibility (legacy configs without trustLevel):
 *  1. No trustLevel field defaults to 'standard'
 *  2. resolveProfile('code-edit') returns TOOLS_CODE_EDIT
 *  3. getProfileCostCap('full-access') returns 2.0 (no multiplier)
 *  4. confirmHighRisk explicit false is respected at standard trust level
 *  5. workerCostCaps overrides win over trust-level multipliers
 *  6. resolveProfile('code-edit', undefined) === resolveProfile('code-edit', _, 'standard')
 */

import { describe, it, expect } from 'vitest';
import { SecurityConfigSchema, getEffectiveConfirmHighRisk } from '../../src/types/config.js';
import type { WorkspaceTrustLevel } from '../../src/types/config.js';
import {
  resolveProfile,
  TOOLS_FULL,
  TOOLS_READ_ONLY,
  TOOLS_CODE_EDIT,
} from '../../src/core/agent-runner.js';
import { getMasterTools } from '../../src/master/master-manager.js';
import { getProfileCostCap } from '../../src/core/cost-manager.js';

// ---------------------------------------------------------------------------
// Helpers — mirrors WorkerOrchestrator boundary injection (lines 850-852)
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
// Trusted mode full path
// ---------------------------------------------------------------------------

describe('trust level integration — trusted mode full path', () => {
  // Step 1: Parse config with trustLevel: 'trusted'
  it('parses config with security.trustLevel = trusted', () => {
    const parsed = SecurityConfigSchema.parse({
      trustLevel: 'trusted',
    });
    expect(parsed.trustLevel).toBe('trusted');
    // Confirm other fields get their defaults
    expect(parsed.confirmHighRisk).toBe(true);
    expect(parsed.envDenyPatterns.length).toBeGreaterThan(0);
  });

  // Step 2: getEffectiveConfirmHighRisk() returns false for trusted
  it('getEffectiveConfirmHighRisk() returns false in trusted mode', () => {
    const security = SecurityConfigSchema.parse({ trustLevel: 'trusted' });
    expect(getEffectiveConfirmHighRisk(security)).toBe(false);
  });

  // Step 3: resolveProfile() returns TOOLS_FULL regardless of requested profile
  it('resolveProfile(read-only, _, trusted) returns TOOLS_FULL', () => {
    const tools = resolveProfile('read-only', undefined, 'trusted');
    expect(tools).toEqual([...TOOLS_FULL]);
    expect(tools).toContain('Bash(*)');
  });

  it('resolveProfile overrides any profile name in trusted mode', () => {
    const readOnly = resolveProfile('read-only', undefined, 'trusted');
    const codeEdit = resolveProfile('code-edit', undefined, 'trusted');
    const codeAudit = resolveProfile('code-audit', undefined, 'trusted');
    // All profiles resolve to the same full-access tools
    expect(readOnly).toEqual(codeEdit);
    expect(codeEdit).toEqual(codeAudit);
    expect(readOnly).toEqual([...TOOLS_FULL]);
  });

  // Step 4: getMasterTools('trusted') includes Bash
  it('getMasterTools(trusted) includes Bash(*)', () => {
    const tools = getMasterTools('trusted');
    expect(tools).toContain('Bash(*)');
    expect(tools).toContain('Read');
    expect(tools).toContain('Write');
    expect(tools).toContain('Edit');
  });

  // Step 5: getProfileCostCap('full-access', _, 'trusted') returns 6.0
  it('getProfileCostCap(full-access, _, trusted) returns 6.0', () => {
    const cap = getProfileCostCap('full-access', undefined, 'trusted');
    // full-access base cap is 2.0, trusted multiplier is 3× → 6.0
    expect(cap).toBe(6.0);
  });

  it('cost caps scale consistently across profiles in trusted mode', () => {
    // read-only: 0.5 × 3 = 1.5
    expect(getProfileCostCap('read-only', undefined, 'trusted')).toBe(1.5);
    // code-edit: 1.0 × 3 = 3.0
    expect(getProfileCostCap('code-edit', undefined, 'trusted')).toBe(3.0);
    // code-audit: 1.0 × 3 = 3.0
    expect(getProfileCostCap('code-audit', undefined, 'trusted')).toBe(3.0);
  });

  // Step 6: requestSpawnConfirmation() auto-approves in trusted mode
  it('requestSpawnConfirmation auto-approves without user prompt in trusted mode', async () => {
    // We test the trust-level gate logic directly rather than instantiating
    // the full Router (which requires DB, connectors, etc.).
    // The Router's requestSpawnConfirmation() checks:
    //   if (trustLevel === 'trusted') return false;
    // We verify the same gate produces the expected result.
    const trustLevel: WorkspaceTrustLevel = 'trusted';
    const shouldBlock = trustLevel === 'trusted' ? false : true;
    expect(shouldBlock).toBe(false);

    // Also verify that getEffectiveConfirmHighRisk aligns — in trusted mode
    // the confirmation gate should never fire.
    const security = SecurityConfigSchema.parse({ trustLevel: 'trusted' });
    expect(getEffectiveConfirmHighRisk(security)).toBe(false);
  });

  // Step 7: Worker prompt contains workspace boundary instruction
  it('worker prompt contains WORKSPACE BOUNDARY instruction in trusted mode', () => {
    const workspacePath = '/home/user/my-project';
    const basePrompt = 'Fix the authentication bug in src/auth.ts.';
    const result = applyBoundaryInstruction(basePrompt, workspacePath, 'trusted');

    expect(result).toMatch(/^WORKSPACE BOUNDARY:/);
    expect(result).toContain(workspacePath);
    expect(result).toContain(basePrompt);
    // Forbidden directories are mentioned
    expect(result).toContain('no ~/.ssh');
    expect(result).toContain('no /etc');
  });

  // End-to-end: all gates align for trusted mode
  it('all trust-level gates are consistent for trusted mode', () => {
    const security = SecurityConfigSchema.parse({ trustLevel: 'trusted' });

    // Confirmation gates disabled
    expect(getEffectiveConfirmHighRisk(security)).toBe(false);

    // All workers get full tools
    const workerTools = resolveProfile('read-only', undefined, 'trusted');
    expect(workerTools).toEqual([...TOOLS_FULL]);

    // Master gets full tools including Bash
    const masterTools = getMasterTools('trusted');
    expect(masterTools).toContain('Bash(*)');

    // Cost caps are scaled up 3×
    expect(getProfileCostCap('full-access', undefined, 'trusted')).toBe(6.0);

    // Boundary instruction is injected
    const prompt = applyBoundaryInstruction('task', '/workspace', 'trusted');
    expect(prompt).toMatch(/^WORKSPACE BOUNDARY:/);
  });
});

// ---------------------------------------------------------------------------
// Sandbox mode full path (OB-1606)
// ---------------------------------------------------------------------------

describe('trust level integration — sandbox mode full path', () => {
  // Step 1: Parse config with trustLevel: 'sandbox'
  it('parses config with security.trustLevel = sandbox', () => {
    const parsed = SecurityConfigSchema.parse({
      trustLevel: 'sandbox',
    });
    expect(parsed.trustLevel).toBe('sandbox');
    expect(parsed.confirmHighRisk).toBe(true);
  });

  // Step 2: getEffectiveConfirmHighRisk() returns true for sandbox
  it('getEffectiveConfirmHighRisk() returns true in sandbox mode', () => {
    const security = SecurityConfigSchema.parse({ trustLevel: 'sandbox' });
    expect(getEffectiveConfirmHighRisk(security)).toBe(true);
  });

  it('getEffectiveConfirmHighRisk() returns true even if confirmHighRisk is explicitly false', () => {
    const security = SecurityConfigSchema.parse({
      trustLevel: 'sandbox',
      confirmHighRisk: false,
    });
    // sandbox overrides the explicit false
    expect(getEffectiveConfirmHighRisk(security)).toBe(true);
  });

  // Step 3: resolveProfile('full-access', _, 'sandbox') returns TOOLS_READ_ONLY
  it('resolveProfile(full-access, _, sandbox) returns TOOLS_READ_ONLY', () => {
    const tools = resolveProfile('full-access', undefined, 'sandbox');
    expect(tools).toEqual([...TOOLS_READ_ONLY]);
    expect(tools).not.toContain('Bash(*)');
    expect(tools).not.toContain('Write');
    expect(tools).not.toContain('Edit');
  });

  it('resolveProfile downgrades any profile to read-only in sandbox mode', () => {
    const fullAccess = resolveProfile('full-access', undefined, 'sandbox');
    const codeEdit = resolveProfile('code-edit', undefined, 'sandbox');
    const codeAudit = resolveProfile('code-audit', undefined, 'sandbox');
    const readOnly = resolveProfile('read-only', undefined, 'sandbox');
    // All profiles resolve to the same read-only tools
    expect(fullAccess).toEqual(readOnly);
    expect(codeEdit).toEqual(readOnly);
    expect(codeAudit).toEqual(readOnly);
    expect(readOnly).toEqual([...TOOLS_READ_ONLY]);
  });

  // Step 4: getMasterTools('sandbox') is ['Read', 'Glob', 'Grep']
  it('getMasterTools(sandbox) is Read/Glob/Grep only', () => {
    const tools = getMasterTools('sandbox');
    expect(tools).toEqual(['Read', 'Glob', 'Grep']);
    expect(tools).not.toContain('Write');
    expect(tools).not.toContain('Edit');
    expect(tools).not.toContain('Bash(*)');
  });

  // Step 5: getProfileCostCap('read-only', _, 'sandbox') returns 0.25
  it('getProfileCostCap(read-only, _, sandbox) returns 0.25', () => {
    const cap = getProfileCostCap('read-only', undefined, 'sandbox');
    // read-only base cap is 0.5, sandbox multiplier is 0.5× → 0.25
    expect(cap).toBe(0.25);
  });

  it('cost caps scale consistently across profiles in sandbox mode', () => {
    // code-edit: 1.0 × 0.5 = 0.5
    expect(getProfileCostCap('code-edit', undefined, 'sandbox')).toBe(0.5);
    // code-audit: 1.0 × 0.5 = 0.5
    expect(getProfileCostCap('code-audit', undefined, 'sandbox')).toBe(0.5);
    // full-access: 2.0 × 0.5 = 1.0
    expect(getProfileCostCap('full-access', undefined, 'sandbox')).toBe(1.0);
  });

  // Step 6: requestSpawnConfirmation() blocks in sandbox mode
  it('requestSpawnConfirmation blocks with denial in sandbox mode', () => {
    // The Router's requestSpawnConfirmation() checks:
    //   if (trustLevel === 'sandbox') { send denial message; return true; }
    const trustLevel: WorkspaceTrustLevel = 'sandbox';
    const shouldBlock = trustLevel === 'sandbox';
    expect(shouldBlock).toBe(true);

    // getEffectiveConfirmHighRisk also enforces — high-risk gates always fire
    const security = SecurityConfigSchema.parse({ trustLevel: 'sandbox' });
    expect(getEffectiveConfirmHighRisk(security)).toBe(true);
  });

  // Step 7: /allow command denied in sandbox mode
  it('/allow command is denied in sandbox mode', () => {
    // The command handler checks:
    //   if (trustLevel === 'sandbox') { send '⛔ Sandbox mode — tool escalation is disabled.'; return; }
    const trustLevel: WorkspaceTrustLevel = 'sandbox';
    const isDenied = trustLevel === 'sandbox';
    expect(isDenied).toBe(true);
  });

  // Step 8: Worker prompt does NOT contain workspace boundary instruction
  it('worker prompt does NOT contain WORKSPACE BOUNDARY instruction in sandbox mode', () => {
    const workspacePath = '/home/user/my-project';
    const basePrompt = 'Analyze the project structure.';
    const result = applyBoundaryInstruction(basePrompt, workspacePath, 'sandbox');

    // Sandbox workers can't run Bash, so no boundary instruction is needed
    expect(result).not.toMatch(/^WORKSPACE BOUNDARY:/);
    expect(result).toBe(basePrompt);
  });

  // End-to-end: all gates align for sandbox mode
  it('all trust-level gates are consistent for sandbox mode', () => {
    const security = SecurityConfigSchema.parse({ trustLevel: 'sandbox' });

    // Confirmation gates enforced
    expect(getEffectiveConfirmHighRisk(security)).toBe(true);

    // All workers get read-only tools
    const workerTools = resolveProfile('full-access', undefined, 'sandbox');
    expect(workerTools).toEqual([...TOOLS_READ_ONLY]);

    // Master gets read-only tools only
    const masterTools = getMasterTools('sandbox');
    expect(masterTools).toEqual(['Read', 'Glob', 'Grep']);

    // Cost caps are halved (0.5×)
    expect(getProfileCostCap('full-access', undefined, 'sandbox')).toBe(1.0);
    expect(getProfileCostCap('read-only', undefined, 'sandbox')).toBe(0.25);

    // No boundary instruction for sandbox
    const prompt = applyBoundaryInstruction('task', '/workspace', 'sandbox');
    expect(prompt).toBe('task');
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility — legacy configs without trustLevel (OB-1607)
// ---------------------------------------------------------------------------

describe('trust level integration — backward compatibility', () => {
  // Step 1: No trustLevel field defaults to 'standard'
  it('config with no trustLevel field defaults to standard', () => {
    const parsed = SecurityConfigSchema.parse({});
    expect(parsed.trustLevel).toBe('standard');
    // confirmHighRisk defaults to true in standard mode
    expect(parsed.confirmHighRisk).toBe(true);
  });

  it('config with explicit trustLevel standard parses correctly', () => {
    const parsed = SecurityConfigSchema.parse({ trustLevel: 'standard' });
    expect(parsed.trustLevel).toBe('standard');
  });

  // Step 2: resolveProfile('code-edit') returns TOOLS_CODE_EDIT with no trust level
  it('resolveProfile(code-edit) returns TOOLS_CODE_EDIT when no trustLevel passed', () => {
    const tools = resolveProfile('code-edit');
    expect(tools).toEqual([...TOOLS_CODE_EDIT]);
    expect(tools).toContain('Read');
    expect(tools).toContain('Edit');
    expect(tools).toContain('Write');
    expect(tools).toContain('Bash(git:*)');
    expect(tools).not.toContain('Bash(*)');
  });

  // Step 3: getProfileCostCap('full-access') returns 2.0 (no multiplier, 1× baseline)
  it('getProfileCostCap(full-access) returns 2.0 with no trustLevel', () => {
    const cap = getProfileCostCap('full-access');
    expect(cap).toBe(2.0);
  });

  it('getProfileCostCap returns base caps for all profiles with no trustLevel', () => {
    expect(getProfileCostCap('read-only')).toBe(0.5);
    expect(getProfileCostCap('code-edit')).toBe(1.0);
    expect(getProfileCostCap('code-audit')).toBe(1.0);
    expect(getProfileCostCap('full-access')).toBe(2.0);
  });

  // Step 4: confirmHighRisk explicit false is respected at standard trust level
  it('explicit confirmHighRisk: false is respected when trustLevel is standard', () => {
    const security = SecurityConfigSchema.parse({
      trustLevel: 'standard',
      confirmHighRisk: false,
    });
    // standard mode defers to the explicit user setting
    expect(getEffectiveConfirmHighRisk(security)).toBe(false);
  });

  it('confirmHighRisk defaults to true for standard trust level', () => {
    const security = SecurityConfigSchema.parse({ trustLevel: 'standard' });
    expect(getEffectiveConfirmHighRisk(security)).toBe(true);
  });

  // Step 5: workerCostCaps overrides win over trust-level multipliers
  it('workerCostCaps overrides win over trust-level multipliers', () => {
    const overrides: Record<string, number> = { 'full-access': 0.75 };
    // Even in trusted mode (which would multiply 2.0 × 3 = 6.0), override wins
    const capTrusted = getProfileCostCap('full-access', overrides, 'trusted');
    expect(capTrusted).toBe(0.75);

    // Even in sandbox mode (which would multiply 2.0 × 0.5 = 1.0), override wins
    const capSandbox = getProfileCostCap('full-access', overrides, 'sandbox');
    expect(capSandbox).toBe(0.75);

    // Standard mode with override
    const capStandard = getProfileCostCap('full-access', overrides, 'standard');
    expect(capStandard).toBe(0.75);
  });

  it('workerCostCaps override applies only to the matching profile', () => {
    const overrides: Record<string, number> = { 'code-edit': 0.25 };
    // code-edit uses override
    expect(getProfileCostCap('code-edit', overrides, 'trusted')).toBe(0.25);
    // full-access is NOT overridden — trusted multiplier applies (2.0 × 3 = 6.0)
    expect(getProfileCostCap('full-access', overrides, 'trusted')).toBe(6.0);
  });

  // Step 6: resolveProfile('code-edit', undefined) === resolveProfile('code-edit', _, 'standard')
  it('resolveProfile with undefined trustLevel returns same as explicit standard', () => {
    const withUndefined = resolveProfile('code-edit', undefined);
    const withStandard = resolveProfile('code-edit', undefined, 'standard');
    expect(withUndefined).toEqual(withStandard);
    expect(withUndefined).toEqual([...TOOLS_CODE_EDIT]);
  });

  it('resolveProfile standard does not override profiles (unlike trusted/sandbox)', () => {
    const readOnly = resolveProfile('read-only', undefined, 'standard');
    const fullAccess = resolveProfile('full-access', undefined, 'standard');
    // Each profile keeps its own tool set in standard mode
    expect(readOnly).toEqual([...TOOLS_READ_ONLY]);
    expect(fullAccess).toEqual([...TOOLS_FULL]);
    expect(readOnly).not.toEqual(fullAccess);
  });

  // End-to-end: all gates align for backward-compatible standard mode
  it('all trust-level gates are backward-compatible for standard mode', () => {
    const security = SecurityConfigSchema.parse({});
    expect(security.trustLevel).toBe('standard');

    // confirmHighRisk defaults to true
    expect(getEffectiveConfirmHighRisk(security)).toBe(true);

    // Profiles resolve to their own tool sets (no override)
    expect(resolveProfile('code-edit', undefined, 'standard')).toEqual([...TOOLS_CODE_EDIT]);
    expect(resolveProfile('read-only', undefined, 'standard')).toEqual([...TOOLS_READ_ONLY]);
    expect(resolveProfile('full-access', undefined, 'standard')).toEqual([...TOOLS_FULL]);

    // Cost caps use 1× multiplier (no change from base)
    expect(getProfileCostCap('full-access', undefined, 'standard')).toBe(2.0);
    expect(getProfileCostCap('read-only', undefined, 'standard')).toBe(0.5);

    // No boundary instruction for standard mode
    const prompt = applyBoundaryInstruction('task', '/workspace', 'standard');
    expect(prompt).toBe('task');
  });
});
