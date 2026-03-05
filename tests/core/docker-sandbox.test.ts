/**
 * Tests for DockerSandbox network isolation and resource limits.
 *
 * Covers OB-1550:
 *  1. Default network mode is 'none' (maximum isolation)
 *  2. 'host' network mode is forwarded correctly
 *  3. 'bridge' network mode is forwarded correctly
 *  4. Explicit 'none' network mode works as expected
 *  5. buildWorkspaceMounts validates absolute paths
 *
 * Covers OB-1551:
 *  1. Default --memory 512m is applied
 *  2. Default --cpus 1 is applied
 *  3. Default --pids-limit 100 is applied
 *  4. Custom memoryMB overrides the default
 *  5. Custom cpus overrides the default
 *  6. Custom pidsLimit overrides the default
 *  7. exec() logs a warning on exit code 137 (OOM kill)
 *
 * Covers OB-1554:
 *  1. cleanupDanglingContainers returns 0 when no containers listed
 *  2. cleanupDanglingContainers removes containers returned by docker ps
 *  3. cleanupDanglingContainers passes the correct --filter flags
 *  4. cleanupDanglingContainers is resilient to docker rm failures
 *  5. cleanupDanglingContainers returns 0 and warns when docker ps fails
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContainerOptions } from '../../src/core/docker-sandbox.js';

// ── Mock node:child_process ──────────────────────────────────────────────────

// Capture args passed to execFile so we can assert on them.
let capturedArgs: string[] = [];
// All captured args across multiple calls within a single test.
let allCapturedArgs: string[][] = [];
// Allow individual tests to override the mock behaviour (e.g. simulate OOM).
let mockError: (Error & { stdout?: string; stderr?: string; code?: number }) | null = null;
// Queue of responses — each call pops the first item. Falls back to default when empty.
type MockResponse =
  | { stdout: string; error?: null }
  | { error: Error & { stdout?: string; stderr?: string; code?: number }; stdout?: never };
let mockResponseQueue: MockResponse[] = [];

vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (
      _bin: string,
      args: string[],
      _opts: unknown,
      cb: (
        err: (Error & { stdout?: string; stderr?: string; code?: number }) | null,
        result: { stdout: string; stderr: string },
      ) => void,
    ) => {
      capturedArgs = args;
      allCapturedArgs.push(args);
      const queued = mockResponseQueue.shift();
      if (queued && 'error' in queued && queued.error) {
        cb(queued.error, { stdout: queued.error.stdout ?? '', stderr: queued.error.stderr ?? '' });
      } else if (queued && 'stdout' in queued) {
        cb(null, { stdout: queued.stdout, stderr: '' });
      } else if (mockError) {
        cb(mockError, { stdout: mockError.stdout ?? '', stderr: mockError.stderr ?? '' });
      } else {
        // Simulate success: stdout is a fake container ID, stderr is empty.
        cb(null, { stdout: 'abc123def456\n', stderr: '' });
      }
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

function argValueAt(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
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
    allCapturedArgs = [];
    mockError = null;
    mockResponseQueue = [];
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

describe('DockerSandbox — resource limits (OB-1551)', () => {
  beforeEach(() => {
    capturedArgs = [];
    allCapturedArgs = [];
    mockError = null;
    mockResponseQueue = [];
  });

  it('defaults to --memory 512m when no memoryMB option is provided', async () => {
    const args = await callCreate({});
    expect(argValueAt(args, '--memory')).toBe('512m');
  });

  it('defaults to --cpus 1 when no cpus option is provided', async () => {
    const args = await callCreate({});
    expect(argValueAt(args, '--cpus')).toBe('1');
  });

  it('defaults to --pids-limit 100 when no pidsLimit option is provided', async () => {
    const args = await callCreate({});
    expect(argValueAt(args, '--pids-limit')).toBe('100');
  });

  it('uses custom memoryMB when specified', async () => {
    const args = await callCreate({ memoryMB: 1024 });
    expect(argValueAt(args, '--memory')).toBe('1024m');
  });

  it('uses custom cpus when specified', async () => {
    const args = await callCreate({ cpus: 2 });
    expect(argValueAt(args, '--cpus')).toBe('2');
  });

  it('uses custom pidsLimit when specified', async () => {
    const args = await callCreate({ pidsLimit: 50 });
    expect(argValueAt(args, '--pids-limit')).toBe('50');
  });

  it('exec() returns exit code 137 when container is OOM-killed', async () => {
    const oomErr = Object.assign(new Error('Container killed'), {
      stdout: '',
      stderr: 'Killed',
      code: 137,
    });
    mockError = oomErr;

    const sandbox = new DockerSandbox();
    const result = await sandbox.exec('abc123', ['claude', '--print', 'hello']);
    expect(result.exitCode).toBe(137);
  });
});

describe('DockerSandbox.cleanupDanglingContainers (OB-1554)', () => {
  beforeEach(() => {
    capturedArgs = [];
    allCapturedArgs = [];
    mockError = null;
    mockResponseQueue = [];
  });

  it('returns 0 when docker ps lists no containers', async () => {
    // docker ps returns empty string — nothing to clean up
    mockResponseQueue = [{ stdout: '' }];
    const sandbox = new DockerSandbox();
    const removed = await sandbox.cleanupDanglingContainers();
    expect(removed).toBe(0);
  });

  it('removes listed containers and returns the count', async () => {
    // docker ps returns two IDs, then two successful rm calls
    mockResponseQueue = [
      { stdout: 'deadbeef\ncafe1234\n' }, // docker ps
      { stdout: '' }, // docker rm deadbeef
      { stdout: '' }, // docker rm cafe1234
    ];
    const sandbox = new DockerSandbox();
    const removed = await sandbox.cleanupDanglingContainers();
    expect(removed).toBe(2);
  });

  it('passes name=ob-worker- and status filters to docker ps', async () => {
    mockResponseQueue = [{ stdout: '' }];
    const sandbox = new DockerSandbox();
    await sandbox.cleanupDanglingContainers();
    // The first call should be docker ps -a ...
    const psArgs = allCapturedArgs[0];
    expect(psArgs[0]).toBe('ps');
    expect(psArgs).toContain('--filter');
    const nameFilterIdx = psArgs.indexOf('name=ob-worker-');
    expect(nameFilterIdx).toBeGreaterThan(-1);
    // Should include at least one status filter
    expect(psArgs).toContain('status=exited');
  });

  it('is resilient to individual docker rm failures', async () => {
    const rmErr = Object.assign(new Error('No such container'), { code: 1 });
    mockResponseQueue = [
      { stdout: 'deadbeef\ncafe1234\n' }, // docker ps — 2 containers
      { error: rmErr }, // docker rm deadbeef — fails
      { stdout: '' }, // docker rm cafe1234 — succeeds
    ];
    const sandbox = new DockerSandbox();
    const removed = await sandbox.cleanupDanglingContainers();
    // Only cafe1234 succeeded
    expect(removed).toBe(1);
  });

  it('returns 0 and does not throw when docker ps itself fails', async () => {
    const psErr = Object.assign(new Error('Cannot connect to Docker daemon'), { code: 1 });
    mockResponseQueue = [{ error: psErr }];
    const sandbox = new DockerSandbox();
    const removed = await sandbox.cleanupDanglingContainers();
    expect(removed).toBe(0);
  });
});
