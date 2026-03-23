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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ContainerOptions } from '../../src/core/docker-sandbox.js';

// ── Mock node:child_process ──────────────────────────────────────────────────

// Capture args passed to execFile so we can assert on them.
let capturedArgs: string[] = [];
// All captured args across multiple calls within a single test.
let allCapturedArgs: string[][] = [];
// Allow individual tests to override the mock behaviour (e.g. simulate OOM).
let mockError:
  | (Error & {
      stdout?: string;
      stderr?: string;
      code?: number;
      status?: number;
    })
  | null = null;
// Queue of responses — each call pops the first item. Falls back to default when empty.
type MockResponse =
  | { stdout: string; error?: null }
  | {
      error: Error & { stdout?: string; stderr?: string; code?: number; status?: number };
      stdout?: never;
    };
let mockResponseQueue: MockResponse[] = [];

vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (
      _bin: string,
      args: string[],
      _opts: unknown,
      cb: (
        err: (Error & { stdout?: string; stderr?: string; code?: number; status?: number }) | null,
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
const { DockerSandbox, cleanupSandboxContainers, DockerHealthMonitor } =
  await import('../../src/core/docker-sandbox.js');

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

  it('exec() returns exit code 137 when container is OOM-killed (reads .status)', async () => {
    // OB-1685: implementation reads execErr.status, not execErr.code
    const oomErr = Object.assign(new Error('Container killed'), {
      stdout: '',
      stderr: 'Killed',
      status: 137,
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

// ── OB-1559: comprehensive Docker sandbox tests ──────────────────────────────

describe('DockerSandbox — daemon availability (OB-1559)', () => {
  beforeEach(() => {
    capturedArgs = [];
    allCapturedArgs = [];
    mockError = null;
    mockResponseQueue = [];
  });

  it('isAvailable() calls docker info to check daemon', async () => {
    mockResponseQueue = [{ stdout: 'Docker daemon info' }];
    const sandbox = new DockerSandbox();
    const result = await sandbox.isAvailable();
    expect(result).toBe(true);
    expect(capturedArgs[0]).toBe('info');
  });

  it('isAvailable() returns false when docker info fails', async () => {
    const err = Object.assign(new Error('Cannot connect to the Docker daemon'), { code: 1 });
    mockResponseQueue = [{ error: err }];
    const sandbox = new DockerSandbox();
    const result = await sandbox.isAvailable();
    expect(result).toBe(false);
  });
});

describe('DockerSandbox — createContainer volume mounts (OB-1559)', () => {
  beforeEach(() => {
    capturedArgs = [];
    allCapturedArgs = [];
    mockError = null;
    mockResponseQueue = [];
  });

  it('includes --volume flag with :ro suffix for read-only workspace mount', async () => {
    const args = await callCreate({
      mounts: [{ host: '/my/workspace', container: '/workspace', readOnly: true }],
    });
    const idx = args.indexOf('--volume');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('/my/workspace:/workspace:ro');
  });

  it('includes --volume flag WITHOUT :ro suffix for read-write .openbridge mount', async () => {
    const args = await callCreate({
      mounts: [
        { host: '/my/workspace', container: '/workspace', readOnly: true },
        { host: '/my/workspace/.openbridge', container: '/workspace/.openbridge', readOnly: false },
      ],
    });

    const volumes: string[] = [];
    for (let i = 0; i < args.length - 1; i++) {
      if (args[i] === '--volume') volumes.push(args[i + 1]);
    }

    const obVolume = volumes.find((v) => v.includes('.openbridge'));
    expect(obVolume).toBeDefined();
    expect(obVolume).not.toMatch(/:ro$/);
  });

  it('image name is included as a positional argument after options', async () => {
    const args = await callCreate({});
    expect(args).toContain('openbridge-worker:latest');
  });
});

describe('DockerSandbox — env vars (OB-1559)', () => {
  beforeEach(() => {
    capturedArgs = [];
    allCapturedArgs = [];
    mockError = null;
    mockResponseQueue = [];
  });

  it('passes env vars as --env KEY=VALUE flags', async () => {
    const args = await callCreate({ env: { FOO: 'bar', HELLO: 'world' } });

    const envPairs: string[] = [];
    for (let i = 0; i < args.length - 1; i++) {
      if (args[i] === '--env') envPairs.push(args[i + 1]);
    }

    expect(envPairs).toContain('FOO=bar');
    expect(envPairs).toContain('HELLO=world');
  });

  it('does not include --env when no env vars are provided', async () => {
    const args = await callCreate({ env: {} });
    expect(args).not.toContain('--env');
  });

  it('each env var gets its own --env flag', async () => {
    const args = await callCreate({ env: { A: '1', B: '2', C: '3' } });
    const envFlagCount = args.filter((a) => a === '--env').length;
    expect(envFlagCount).toBe(3);
  });
});

describe('DockerSandbox — cleanup after exit (OB-1559)', () => {
  beforeEach(() => {
    capturedArgs = [];
    allCapturedArgs = [];
    mockError = null;
    mockResponseQueue = [];
  });

  it('stopContainer calls docker stop with the container ID', async () => {
    const sandbox = new DockerSandbox();
    await sandbox.stopContainer('abc123def456');
    expect(allCapturedArgs[0][0]).toBe('stop');
    expect(allCapturedArgs[0]).toContain('abc123def456');
  });

  it('removeContainer calls docker rm with the container ID', async () => {
    const sandbox = new DockerSandbox();
    await sandbox.removeContainer('abc123def456');
    expect(allCapturedArgs[0][0]).toBe('rm');
    expect(allCapturedArgs[0]).toContain('abc123def456');
  });

  it('removeContainer with force=true includes --force flag', async () => {
    const sandbox = new DockerSandbox();
    await sandbox.removeContainer('abc123def456', true);
    expect(allCapturedArgs[0]).toContain('--force');
  });
});

// ── OB-1685: exec() reads .status not .code for exit code ────────────────────

describe('DockerSandbox.exec() exit code from .status property (OB-1685)', () => {
  beforeEach(() => {
    capturedArgs = [];
    allCapturedArgs = [];
    mockError = null;
    mockResponseQueue = [];
  });

  it('returns exit code from execErr.status when status is set', async () => {
    // The fix: implementation reads execErr.status ?? 1
    const err = Object.assign(new Error('Command failed'), {
      stdout: 'partial output',
      stderr: 'error text',
      status: 42,
    });
    mockError = err;

    const sandbox = new DockerSandbox();
    const result = await sandbox.exec('ctr123', ['echo', 'hi']);
    expect(result.exitCode).toBe(42);
  });

  it('falls back to 1 when neither .status nor .code is set', async () => {
    // Only .code is set (old behavior) — implementation ignores .code and uses .status ?? 1
    const err = Object.assign(new Error('Command failed'), {
      stdout: '',
      stderr: 'error',
      code: 99, // old property — should be ignored
    });
    mockError = err;

    const sandbox = new DockerSandbox();
    const result = await sandbox.exec('ctr123', ['echo', 'hi']);
    // .status is undefined → fallback to 1
    expect(result.exitCode).toBe(1);
  });

  it('returns 0 when exec succeeds without error', async () => {
    mockResponseQueue = [{ stdout: 'command output' }];

    const sandbox = new DockerSandbox();
    const result = await sandbox.exec('ctr123', ['echo', 'hello']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('command output');
  });
});

// ── OB-1686: trackContainer / cleanupSandboxContainers ───────────────────────

describe('DockerSandbox container crash-cleanup tracking (OB-1686)', () => {
  beforeEach(() => {
    capturedArgs = [];
    allCapturedArgs = [];
    mockError = null;
    mockResponseQueue = [];
  });

  afterEach(async () => {
    // Drain any remaining tracked containers so tests don't bleed into each other
    await cleanupSandboxContainers();
    allCapturedArgs = [];
  });

  it('trackContainer registers container ID for cleanup', async () => {
    const sandbox = new DockerSandbox();
    sandbox.trackContainer('tracked-abc12345');

    // cleanupSandboxContainers should issue docker rm --force for the tracked ID
    await cleanupSandboxContainers();

    const rmCall = allCapturedArgs.find(
      (args) => args[0] === 'rm' && args.includes('--force') && args.includes('tracked-abc12345'),
    );
    expect(rmCall).toBeDefined();
  });

  it('untrackContainer removes container from the tracked set', async () => {
    const sandbox = new DockerSandbox();
    sandbox.trackContainer('untrack-test-xyz');
    sandbox.untrackContainer('untrack-test-xyz');

    // After untracking, cleanup should NOT remove this container
    await cleanupSandboxContainers();

    const rmCall = allCapturedArgs.find((args) => args.includes('untrack-test-xyz'));
    expect(rmCall).toBeUndefined();
  });

  it('cleanupSandboxContainers removes all tracked containers', async () => {
    const sandbox = new DockerSandbox();
    sandbox.trackContainer('multi-cleanup-1');
    sandbox.trackContainer('multi-cleanup-2');

    await cleanupSandboxContainers();

    const rm1 = allCapturedArgs.find(
      (args) => args[0] === 'rm' && args.includes('--force') && args.includes('multi-cleanup-1'),
    );
    const rm2 = allCapturedArgs.find(
      (args) => args[0] === 'rm' && args.includes('--force') && args.includes('multi-cleanup-2'),
    );
    expect(rm1).toBeDefined();
    expect(rm2).toBeDefined();
  });

  it('cleanupSandboxContainers is a no-op when no containers are tracked', async () => {
    // Fresh state — no containers tracked
    await cleanupSandboxContainers();
    // No docker rm calls should have been made
    const rmCalls = allCapturedArgs.filter((args) => args[0] === 'rm');
    expect(rmCalls).toHaveLength(0);
  });
});

// ── OB-1611: DockerHealthMonitor state transition logging ──────────────────────

describe('DockerHealthMonitor — state transition logging (OB-F215 / OB-1611)', () => {
  beforeEach(() => {
    capturedArgs = [];
    allCapturedArgs = [];
    mockError = null;
    mockResponseQueue = [];
  });

  it('first check with Docker unavailable transitions from unavailable state', async () => {
    const sandbox = new DockerSandbox();
    const monitor = new DockerHealthMonitor(sandbox, 5 * 60 * 1000);

    // Initial state: unavailable (default, line 178 in docker-sandbox.ts)
    expect(monitor.isDockerAvailable()).toBe(false);

    // First check: Docker is unavailable
    mockResponseQueue = [{ error: Object.assign(new Error('Cannot connect'), { code: 1 }) }];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await (monitor as any)._check();

    // Monitor should still show unavailable after first check
    // (wasAvailable was false, available is false, so condition at line 230 matches)
    expect(monitor.isDockerAvailable()).toBe(false);
  });

  it('second consecutive check with Docker still unavailable does not transition', async () => {
    const sandbox = new DockerSandbox();
    const monitor = new DockerHealthMonitor(sandbox, 5 * 60 * 1000);

    // Manually set to unavailable (simulating first check already happened)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (monitor as any).available = false;

    // Second check: Docker is still unavailable
    mockResponseQueue = [{ error: Object.assign(new Error('Cannot connect'), { code: 1 }) }];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await (monitor as any)._check();

    // Monitor should still show unavailable
    // (wasAvailable was false, available becomes false, so condition at line 230 matches: !available && !wasAvailable)
    expect(monitor.isDockerAvailable()).toBe(false);
  });

  it('check with Docker becomes available after being unavailable transitions to available', async () => {
    const sandbox = new DockerSandbox();
    const monitor = new DockerHealthMonitor(sandbox, 5 * 60 * 1000);

    // Set state: Docker was unavailable
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (monitor as any).available = false;

    // Check: Docker is now available
    mockResponseQueue = [{ stdout: 'Docker info output' }];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await (monitor as any)._check();

    // Monitor should now show available
    // (wasAvailable was false, available becomes true, so condition at line 233 matches: !wasAvailable && available)
    expect(monitor.isDockerAvailable()).toBe(true);
  });

  it('check with Docker available after previously available does not transition', async () => {
    const sandbox = new DockerSandbox();
    const monitor = new DockerHealthMonitor(sandbox, 5 * 60 * 1000);

    // Set state: Docker was available
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (monitor as any).available = true;

    // Check: Docker is still available
    mockResponseQueue = [{ stdout: 'Docker info output' }];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await (monitor as any)._check();

    // Monitor should still show available
    // (wasAvailable was true, available becomes true, so condition at line 236 else block matches)
    expect(monitor.isDockerAvailable()).toBe(true);
  });

  it('transitions from available to unavailable', async () => {
    const sandbox = new DockerSandbox();
    const monitor = new DockerHealthMonitor(sandbox, 5 * 60 * 1000);

    // Set state: Docker was available
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (monitor as any).available = true;

    // Check: Docker is now unavailable
    mockResponseQueue = [{ error: Object.assign(new Error('Cannot connect'), { code: 1 }) }];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await (monitor as any)._check();

    // Monitor should now show unavailable
    // (wasAvailable was true, available becomes false, so condition at line 225 matches: !available && wasAvailable)
    expect(monitor.isDockerAvailable()).toBe(false);
  });
});
