/**
 * Tests for DockerSandbox network isolation.
 *
 * Covers OB-1550:
 *  1. Default network mode is 'none' (maximum isolation)
 *  2. 'host' network mode is forwarded correctly
 *  3. 'bridge' network mode is forwarded correctly
 *  4. Explicit 'none' network mode works as expected
 *  5. buildWorkspaceMounts validates absolute paths
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContainerOptions } from '../../src/core/docker-sandbox.js';

// ── Mock node:child_process ──────────────────────────────────────────────────

// Capture args passed to execFile so we can assert on them.
let capturedArgs: string[] = [];

vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (
      _bin: string,
      args: string[],
      _opts: unknown,
      cb: (err: null, result: { stdout: string; stderr: string }) => void,
    ) => {
      capturedArgs = args;
      // Simulate success: stdout is a fake container ID, stderr is empty.
      cb(null, { stdout: 'abc123def456\n', stderr: '' });
    },
  ),
}));

// ── Import AFTER mocking ─────────────────────────────────────────────────────

// Dynamic import is used so the vi.mock() above is hoisted first.
const { DockerSandbox } = await import('../../src/core/docker-sandbox.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function argsIncludeNetwork(args: string[], mode: string): boolean {
  const idx = args.indexOf('--network');
  return idx !== -1 && args[idx + 1] === mode;
}

async function callCreate(options: Partial<ContainerOptions>): Promise<string[]> {
  const sandbox = new DockerSandbox();
  const base: ContainerOptions = { image: 'openbridge-worker:latest', ...options };
  await sandbox.createContainer(base);
  return capturedArgs;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DockerSandbox — network isolation (OB-1550)', () => {
  beforeEach(() => {
    capturedArgs = [];
  });

  it('defaults to --network none when no network option is provided', async () => {
    const args = await callCreate({});
    expect(argsIncludeNetwork(args, 'none')).toBe(true);
  });

  it('passes --network none when network is explicitly set to none', async () => {
    const args = await callCreate({ network: 'none' });
    expect(argsIncludeNetwork(args, 'none')).toBe(true);
  });

  it('passes --network host when network is set to host', async () => {
    const args = await callCreate({ network: 'host' });
    expect(argsIncludeNetwork(args, 'host')).toBe(true);
  });

  it('passes --network bridge when network is set to bridge', async () => {
    const args = await callCreate({ network: 'bridge' });
    expect(argsIncludeNetwork(args, 'bridge')).toBe(true);
  });

  it('always includes exactly one --network flag', async () => {
    const args = await callCreate({ network: 'none' });
    const networkFlagCount = args.filter((a) => a === '--network').length;
    expect(networkFlagCount).toBe(1);
  });
});

describe('DockerSandbox.buildWorkspaceMounts — path validation (OB-1550)', () => {
  it('throws when workspacePath is not absolute', () => {
    expect(() => DockerSandbox.buildWorkspaceMounts({ workspacePath: 'relative/path' })).toThrow(
      /absolute path/,
    );
  });

  it('throws when workspacePath is empty', () => {
    expect(() => DockerSandbox.buildWorkspaceMounts({ workspacePath: '' })).toThrow(
      /non-empty string/,
    );
  });

  it('returns two mounts for a valid workspace path', async () => {
    // Use /tmp as a guaranteed-absolute path that exists
    const mounts = DockerSandbox.buildWorkspaceMounts({ workspacePath: '/tmp/test-workspace' });
    expect(mounts).toHaveLength(2);
    expect(mounts[0].container).toBe('/workspace');
    expect(mounts[0].readOnly).toBe(true);
    expect(mounts[1].container).toBe('/workspace/.openbridge');
    expect(mounts[1].readOnly).toBe(false);
  });
});
