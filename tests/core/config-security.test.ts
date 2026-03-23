/**
 * Unit tests for getEffectiveSandboxMode() (OB-1591).
 *
 * Covers:
 *  1. Trusted mode + Docker available → 'docker'
 *  2. Trusted mode + no Docker + non-Linux → 'none' (with console.warn)
 *  3. Explicit sandbox.mode overrides auto-detection regardless of trust level
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock node:child_process before importing config so getEffectiveSandboxMode
// picks up the mock when it calls execSync('which docker').
const mockExecSync = vi.fn();
vi.mock('node:child_process', () => ({
  execSync: (...args: unknown[]): void => mockExecSync(...args) as void,
}));

import { getEffectiveSandboxMode } from '../../src/types/config.js';
import type { SecurityConfig } from '../../src/types/config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSecurityConfig(
  trustLevel: 'sandbox' | 'standard' | 'trusted',
  sandboxMode: 'none' | 'docker' | 'bubblewrap' = 'none',
): SecurityConfig {
  return {
    enabled: true,
    trustLevel,
    sandbox: { mode: sandboxMode },
    envDenyPatterns: [],
    envAllowPatterns: [],
    confirmHighRisk: true,
    sensitiveFileExceptions: [],
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getEffectiveSandboxMode()', () => {
  it('returns docker when trusted and which docker succeeds', () => {
    // execSync('which docker') doesn't throw → Docker available
    mockExecSync.mockReturnValue(undefined);

    const result = getEffectiveSandboxMode(makeSecurityConfig('trusted'));
    expect(result).toBe('docker');
  });

  it('returns none (with warning) for trusted mode when Docker is unavailable', () => {
    // execSync throws for 'which docker' and 'which bwrap'
    mockExecSync.mockImplementation(() => {
      throw new Error('not found');
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    try {
      const result = getEffectiveSandboxMode(makeSecurityConfig('trusted'));
      expect(result).toBe('none');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Trusted mode without sandbox'));
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
      warnSpy.mockRestore();
    }
  });

  it('preserves explicit sandbox.mode bubblewrap regardless of trust level', () => {
    // Explicit user choice wins — no execSync should be called
    const result = getEffectiveSandboxMode(makeSecurityConfig('trusted', 'bubblewrap'));
    expect(result).toBe('bubblewrap');
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('preserves explicit sandbox.mode docker regardless of trust level', () => {
    const result = getEffectiveSandboxMode(makeSecurityConfig('standard', 'docker'));
    expect(result).toBe('docker');
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('returns none for standard trust level without explicit sandbox', () => {
    const result = getEffectiveSandboxMode(makeSecurityConfig('standard'));
    expect(result).toBe('none');
    // standard mode doesn't trigger auto-detection
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('returns none for sandbox trust level without explicit sandbox', () => {
    const result = getEffectiveSandboxMode(makeSecurityConfig('sandbox'));
    expect(result).toBe('none');
    expect(mockExecSync).not.toHaveBeenCalled();
  });
});
