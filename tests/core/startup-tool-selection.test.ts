/**
 * Tests for Phase 103 startup polish (OB-1679, OB-1680, OB-1681).
 *
 * Covers:
 * 1. Tool selection summary log format (OB-1679) — mirrors logic in src/index.ts
 * 2. Whitelist dropped entry logged with reason (OB-1681)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the logger BEFORE importing AuthService ───────────────────────────
// vi.hoisted runs before vi.mock, allowing the factory to reference the spy.
const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: mockWarn,
    debug: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  })),
}));

// Import AFTER mocking so AuthService uses the mock logger
const { AuthService } = await import('../../src/core/auth.js');

// ── Tool selection summary log tests (OB-1679) ─────────────────────────────

/**
 * Mirrors the summary-suffix logic from src/index.ts lines 230-244.
 * Tests the exact string format that `logger.info('Master AI: ...')` produces.
 */
function buildMasterSummary(opts: {
  selectedMasterName: string;
  excludeTools?: string[];
  masterToolOverride?: string;
  autoSelectedMasterName?: string | null;
}): string {
  const summaryParts: string[] = [];

  if (opts.excludeTools?.length) {
    summaryParts.push(`${opts.excludeTools.join(', ')} excluded per config.excludeTools`);
  }

  if (
    opts.masterToolOverride &&
    opts.selectedMasterName === opts.masterToolOverride &&
    opts.autoSelectedMasterName !== opts.masterToolOverride
  ) {
    summaryParts.push('override: config.master.tool');
  }

  const suffix = summaryParts.length ? ` (${summaryParts.join('; ')})` : '';
  return `Master AI: ${opts.selectedMasterName}${suffix}`;
}

describe('Tool selection summary log format (OB-1679)', () => {
  it('produces plain "Master AI: claude" when no exclusions or overrides', () => {
    const summary = buildMasterSummary({ selectedMasterName: 'claude' });
    expect(summary).toBe('Master AI: claude');
  });

  it('includes exclusion reason when one tool is excluded', () => {
    const summary = buildMasterSummary({
      selectedMasterName: 'codex',
      excludeTools: ['claude'],
    });
    expect(summary).toBe('Master AI: codex (claude excluded per config.excludeTools)');
  });

  it('lists multiple excluded tools comma-separated', () => {
    const summary = buildMasterSummary({
      selectedMasterName: 'codex',
      excludeTools: ['claude', 'aider'],
    });
    expect(summary).toBe('Master AI: codex (claude, aider excluded per config.excludeTools)');
  });

  it('includes override marker when master was changed from auto-selected', () => {
    const summary = buildMasterSummary({
      selectedMasterName: 'claude',
      masterToolOverride: 'claude',
      autoSelectedMasterName: 'codex',
    });
    expect(summary).toBe('Master AI: claude (override: config.master.tool)');
  });

  it('does not include override marker when override matches auto-selected', () => {
    // Override was specified but it matches auto-selection — skip redundant note
    const summary = buildMasterSummary({
      selectedMasterName: 'claude',
      masterToolOverride: 'claude',
      autoSelectedMasterName: 'claude',
    });
    expect(summary).toBe('Master AI: claude');
  });

  it('combines exclusions and override in single summary line', () => {
    const summary = buildMasterSummary({
      selectedMasterName: 'claude',
      excludeTools: ['aider'],
      masterToolOverride: 'claude',
      autoSelectedMasterName: 'codex',
    });
    expect(summary).toBe(
      'Master AI: claude (aider excluded per config.excludeTools; override: config.master.tool)',
    );
  });
});

// ── Whitelist dropped entry log tests (OB-1681) ────────────────────────────

describe('AuthService whitelist dropped entry logging (OB-1681)', () => {
  beforeEach(() => {
    mockWarn.mockClear();
  });

  it('logs a warning for non-numeric whitelist entries', () => {
    new AuthService({ whitelist: ['+1-abc-invalid'], prefix: '/ai' });

    // Should have warned about the bad entry
    const calls = mockWarn.mock.calls as unknown[][];
    const warnedAboutEntry = calls.some(
      (args) =>
        typeof args[1] === 'string' &&
        args[1].includes('+1-abc-invalid') &&
        args[1].includes('non-numeric characters'),
    );
    expect(warnedAboutEntry).toBe(true);
  });

  it('logs a warning for duplicate whitelist entries', () => {
    new AuthService({ whitelist: ['+12345678901', '+12345678901'], prefix: '/ai' });

    const calls = mockWarn.mock.calls as unknown[][];
    const warnedAboutDuplicate = calls.some(
      (args) => typeof args[1] === 'string' && args[1].toLowerCase().includes('duplicate'),
    );
    expect(warnedAboutDuplicate).toBe(true);
  });

  it('still builds valid whitelist entries despite dropped ones', () => {
    const auth = new AuthService({
      whitelist: ['+12345678901', 'bad-entry', '+12345678901'],
      prefix: '/ai',
    });

    // Only the valid unique entry should be whitelisted
    expect(auth.isAuthorized('+12345678901')).toBe(true);
    expect(auth.isAuthorized('bad-entry')).toBe(false);
  });

  it('does not log dropped-entry warnings for valid unique entries', () => {
    mockWarn.mockClear();
    new AuthService({ whitelist: ['+12345678901', '+09876543210'], prefix: '/ai' });

    const calls = mockWarn.mock.calls as unknown[][];
    const droppedWarns = calls.filter(
      (args) =>
        typeof args[1] === 'string' &&
        (args[1].includes('Dropped') || args[1].includes('Duplicate')),
    );
    expect(droppedWarns).toHaveLength(0);
  });
});
