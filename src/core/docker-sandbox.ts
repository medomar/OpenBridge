/**
 * DockerSandbox — run worker agents inside Docker containers.
 *
 * Uses the docker CLI via child_process (no SDK dependency).
 * Provides container lifecycle management (create/start/stop/remove/exec)
 * and an availability check that verifies both the CLI and daemon.
 *
 * @see OB-1545
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createLogger } from './logger.js';

const execFileAsync = promisify(execFile);

const logger = createLogger('docker-sandbox');

// ─── Types ────────────────────────────────────────────────────────────────────

/** Volume mount specification for a container */
export interface VolumeMount {
  /** Host path (absolute) */
  host: string;
  /** Container path (absolute) */
  container: string;
  /** If true, mount is read-only inside the container */
  readOnly?: boolean;
}

/** Options for creating a new container */
export interface ContainerOptions {
  /** Docker image to use */
  image: string;
  /** Optional container name (auto-generated if not set) */
  name?: string;
  /** Mounts to attach to the container */
  mounts?: VolumeMount[];
  /** Environment variables to pass in */
  env?: Record<string, string>;
  /** Network mode: 'none' (default, most secure), 'host', or 'bridge' */
  network?: 'none' | 'host' | 'bridge';
  /** Memory limit in megabytes (default: 512) */
  memoryMB?: number;
  /** CPU limit (default: 1) */
  cpus?: number;
  /** Maximum number of PIDs (default: 100) */
  pidsLimit?: number;
  /** Working directory inside the container */
  workdir?: string;
  /** Command to run (for run-and-remove flows; exec() ignores this) */
  command?: string[];
}

/** Options for exec() calls */
export interface ExecOptions {
  /** Working directory inside the container */
  cwd?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

/** Result from an exec() call */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Options for buildImage() */
export interface BuildImageOptions {
  /**
   * Rebuild the image even if it already exists locally.
   * Default: false — skips build when `openbridge-worker:latest` is present.
   */
  force?: boolean;
  /**
   * Absolute path to the project root used as the Docker build context.
   * Default: auto-resolved from this module's location (two directories up
   * from dist/core/docker-sandbox.js → project root).
   */
  context?: string;
}

// ─── DockerSandbox ────────────────────────────────────────────────────────────

/**
 * DockerSandbox wraps the docker CLI to manage containers for sandboxed
 * worker execution.  All public methods reject on unexpected errors.
 *
 * Typical flow:
 *   const sandbox = new DockerSandbox();
 *   if (!await sandbox.isAvailable()) { ... fallback ... }
 *   const id = await sandbox.createContainer({ image: 'openbridge-worker:latest', ... });
 *   await sandbox.startContainer(id);
 *   const result = await sandbox.exec(id, ['claude', '--print', ...]);
 *   await sandbox.stopContainer(id);
 *   await sandbox.removeContainer(id);
 */
export class DockerSandbox {
  /**
   * Check whether Docker is available on this machine.
   *
   * Returns true only when:
   *   1. The `docker` binary is in PATH, AND
   *   2. The Docker daemon is running (`docker info` succeeds).
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('docker', ['info'], { timeout: 10_000 });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, 'Docker not available');
      return false;
    }
  }

  /**
   * Create a container (does NOT start it).
   *
   * Returns the full container ID string.
   */
  async createContainer(options: ContainerOptions): Promise<string> {
    const args = this._buildCreateArgs(options);

    logger.debug({ args }, 'Creating Docker container');

    const { stdout, stderr } = await execFileAsync('docker', args, {
      timeout: 60_000,
    });

    const id = stdout.trim();
    if (!id) {
      throw new Error(`docker create produced no container ID. stderr: ${stderr}`);
    }

    logger.info({ containerId: id.slice(0, 12), image: options.image }, 'Container created');
    return id;
  }

  /**
   * Start a previously created (stopped or new) container.
   */
  async startContainer(containerId: string): Promise<void> {
    logger.debug({ containerId: containerId.slice(0, 12) }, 'Starting container');

    await execFileAsync('docker', ['start', containerId], { timeout: 30_000 });

    logger.info({ containerId: containerId.slice(0, 12) }, 'Container started');
  }

  /**
   * Stop a running container.
   *
   * @param containerId - Full or short container ID
   * @param timeoutSeconds - Seconds to wait for graceful stop (default: 10)
   */
  async stopContainer(containerId: string, timeoutSeconds = 10): Promise<void> {
    logger.debug({ containerId: containerId.slice(0, 12), timeoutSeconds }, 'Stopping container');

    await execFileAsync('docker', ['stop', '--time', String(timeoutSeconds), containerId], {
      timeout: (timeoutSeconds + 5) * 1_000,
    });

    logger.info({ containerId: containerId.slice(0, 12) }, 'Container stopped');
  }

  /**
   * Remove a container.
   *
   * @param containerId - Full or short container ID
   * @param force - Force removal even if running (default: false)
   */
  async removeContainer(containerId: string, force = false): Promise<void> {
    logger.debug({ containerId: containerId.slice(0, 12), force }, 'Removing container');

    const args = ['rm'];
    if (force) args.push('--force');
    args.push(containerId);

    await execFileAsync('docker', args, { timeout: 30_000 });

    logger.info({ containerId: containerId.slice(0, 12) }, 'Container removed');
  }

  /**
   * Execute a command inside a running container.
   *
   * Returns stdout, stderr, and the exit code.  Does NOT throw on non-zero
   * exit codes — callers are responsible for interpreting the exit code.
   */
  async exec(
    containerId: string,
    command: string[],
    options: ExecOptions = {},
  ): Promise<ExecResult> {
    const args: string[] = ['exec'];

    if (options.cwd) {
      args.push('--workdir', options.cwd);
    }

    args.push(containerId, ...command);

    logger.debug({ containerId: containerId.slice(0, 12), command }, 'Executing in container');

    try {
      const { stdout, stderr } = await execFileAsync('docker', args, {
        timeout: options.timeout ?? 300_000,
      });

      return { stdout, stderr, exitCode: 0 };
    } catch (err) {
      // execFile rejects on non-zero exit codes — extract the details.
      const execErr = err as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number;
      };
      const exitCode = typeof execErr.code === 'number' ? execErr.code : 1;

      logger.debug(
        { containerId: containerId.slice(0, 12), exitCode },
        'Container exec returned non-zero exit code',
      );

      return {
        stdout: execErr.stdout ?? '',
        stderr: execErr.stderr ?? execErr.message,
        exitCode,
      };
    }
  }

  /**
   * Build the worker image from `docker/Dockerfile.worker`.
   *
   * Tags the image as `openbridge-worker:latest`.  Docker layer caching keeps
   * incremental rebuilds fast when the Dockerfile has not changed.
   *
   * Skips the build when the image already exists locally unless `force` is
   * set to `true`.
   *
   * @param options.force   - Rebuild even when the image exists (default: false)
   * @param options.context - Project root build context (default: auto-resolved)
   */
  async buildImage(options: BuildImageOptions = {}): Promise<void> {
    const tag = 'openbridge-worker:latest';
    const force = options.force ?? false;

    if (!force && (await this._imageExists(tag))) {
      logger.info({ tag }, 'Worker image already exists — skipping build');
      return;
    }

    const projectRoot = options.context ?? this._resolveProjectRoot();
    const dockerfile = path.join(projectRoot, 'docker', 'Dockerfile.worker');

    logger.info({ tag, dockerfile }, 'Building worker image');

    await execFileAsync('docker', ['build', '--file', dockerfile, '--tag', tag, projectRoot], {
      timeout: 600_000, // 10 minutes for a full image build
    });

    logger.info({ tag }, 'Worker image built successfully');
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /** Returns true if a Docker image with the given tag exists locally. */
  private async _imageExists(tag: string): Promise<boolean> {
    try {
      await execFileAsync('docker', ['image', 'inspect', tag], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve the project root from this module's compiled location.
   *
   * At runtime the compiled file lives at `dist/core/docker-sandbox.js`.
   * Two directory levels up yields the project root.
   */
  private _resolveProjectRoot(): string {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  }

  private _buildCreateArgs(options: ContainerOptions): string[] {
    const args: string[] = ['create'];

    // Container name
    if (options.name) {
      args.push('--name', options.name);
    }

    // Volume mounts
    for (const mount of options.mounts ?? []) {
      const spec = `${mount.host}:${mount.container}${mount.readOnly ? ':ro' : ''}`;
      args.push('--volume', spec);
    }

    // Environment variables
    for (const [key, value] of Object.entries(options.env ?? {})) {
      args.push('--env', `${key}=${value}`);
    }

    // Network mode (default: none for maximum isolation)
    const network = options.network ?? 'none';
    args.push('--network', network);

    // Resource limits
    const memoryMB = options.memoryMB ?? 512;
    args.push('--memory', `${memoryMB}m`);

    const cpus = options.cpus ?? 1;
    args.push('--cpus', String(cpus));

    const pidsLimit = options.pidsLimit ?? 100;
    args.push('--pids-limit', String(pidsLimit));

    // Working directory
    if (options.workdir) {
      args.push('--workdir', options.workdir);
    }

    // Image
    args.push(options.image);

    // Optional command
    if (options.command && options.command.length > 0) {
      args.push(...options.command);
    }

    return args;
  }
}
