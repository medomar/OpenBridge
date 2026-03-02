/**
 * TunnelManager — manages a tunnel process that exposes a local port to the internet.
 *
 * Usage:
 *   const manager = new TunnelManager('cloudflared');
 *   const url = await manager.start(3001);
 *   // ... distribute url to users ...
 *   await manager.stop();
 *
 * Tunnel adapters are registered via TunnelManager.registerAdapter(). Each tool
 * (cloudflared, ngrok) provides its own adapter implementing buildArgs() and parseUrl().
 * If no adapter is registered for the given tool name, start() will reject.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createLogger } from './logger.js';

const logger = createLogger('tunnel-manager');

/** Optional configuration for a tunnel session */
export interface TunnelConfig {
  /** Preferred subdomain (if supported by the tool) */
  subdomain?: string;
  /** Auth token (required for ngrok when using reserved domains) */
  authToken?: string;
}

/**
 * Strategy interface for a specific tunnel tool.
 * Implement this interface and call TunnelManager.registerAdapter() to add support
 * for a new tunnel provider (e.g. cloudflared, ngrok, localtunnel).
 */
export interface TunnelAdapter {
  /** Tool name matching DiscoveredTool.name (e.g. 'cloudflared', 'ngrok') */
  readonly toolName: string;
  /** Build CLI arguments for spawning the tunnel process */
  buildArgs(port: number, config?: TunnelConfig): string[];
  /**
   * Attempt to extract a public URL from one line of stdout/stderr output.
   * Returns the URL string if found, or null if this line does not contain a URL.
   */
  parseUrl(line: string): string | null;
}

type TunnelState = 'idle' | 'starting' | 'active' | 'stopped';

/** Timeout waiting for the tunnel URL to appear in output (ms) */
const URL_DETECT_TIMEOUT_MS = 30_000;

export class TunnelManager {
  private readonly toolName: string;
  private readonly config: TunnelConfig | undefined;
  private child: ChildProcess | null = null;
  private state: TunnelState = 'idle';
  private publicUrl: string | null = null;
  private adapter: TunnelAdapter | null;

  private static readonly registry = new Map<string, TunnelAdapter>();

  /**
   * Register a TunnelAdapter for a specific tool name.
   * Called by adapter modules (e.g. cloudflared-adapter.ts) at module load time.
   */
  static registerAdapter(adapter: TunnelAdapter): void {
    TunnelManager.registry.set(adapter.toolName, adapter);
    logger.debug({ toolName: adapter.toolName }, 'Registered tunnel adapter');
  }

  /**
   * @param toolName - The name of the detected tunnel tool (e.g. 'cloudflared', 'ngrok')
   * @param config   - Optional configuration (subdomain, authToken)
   */
  constructor(toolName: string, config?: TunnelConfig) {
    this.toolName = toolName;
    this.config = config;
    this.adapter = TunnelManager.registry.get(toolName) ?? null;
  }

  /**
   * Start the tunnel on the given local port and wait for the public URL.
   * Resolves with the public URL when the tunnel is ready.
   * Rejects if no adapter is registered, the process exits early, or URL detection times out.
   */
  async start(port: number): Promise<string> {
    if (this.state === 'active' && this.publicUrl !== null) {
      return this.publicUrl;
    }

    if (this.state === 'starting') {
      throw new Error('TunnelManager.start() called while already starting');
    }

    if (!this.adapter) {
      throw new Error(
        `No tunnel adapter registered for tool: "${this.toolName}". ` +
          `Register one via TunnelManager.registerAdapter() before calling start().`,
      );
    }

    const args = this.adapter.buildArgs(port, this.config);
    logger.info({ toolName: this.toolName, port, args }, 'Starting tunnel');

    this.state = 'starting';
    this.publicUrl = null;

    return new Promise<string>((resolve, reject) => {
      const child = spawn(this.toolName, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      this.child = child;
      let resolved = false;

      const timeoutHandle = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.state = 'stopped';
          this.child = null;
          child.kill('SIGKILL');
          reject(
            new Error(
              `Tunnel URL not detected within ${URL_DETECT_TIMEOUT_MS / 1000}s ` +
                `for tool: "${this.toolName}"`,
            ),
          );
        }
      }, URL_DETECT_TIMEOUT_MS);

      const onOutput = (data: Buffer): void => {
        if (resolved) return;
        const text = data.toString('utf-8');
        for (const line of text.split('\n')) {
          const url = this.adapter!.parseUrl(line.trim());
          if (url) {
            clearTimeout(timeoutHandle);
            resolved = true;
            this.publicUrl = url;
            this.state = 'active';
            logger.info({ toolName: this.toolName, url }, 'Tunnel active');
            resolve(url);
            return;
          }
        }
      };

      child.stdout?.on('data', onOutput);
      child.stderr?.on('data', onOutput);

      child.on('error', (err) => {
        clearTimeout(timeoutHandle);
        if (!resolved) {
          resolved = true;
          this.state = 'stopped';
          this.child = null;
          logger.error({ toolName: this.toolName, err }, 'Tunnel process error');
          reject(err);
        }
      });

      child.on('exit', (code, signal) => {
        clearTimeout(timeoutHandle);
        const wasActive = this.state === 'active';
        this.state = 'stopped';
        this.child = null;

        if (!resolved) {
          resolved = true;
          reject(
            new Error(
              `Tunnel process exited before URL was detected ` +
                `(code=${String(code)}, signal=${String(signal)})`,
            ),
          );
        } else if (wasActive) {
          logger.warn(
            { toolName: this.toolName, code, signal },
            'Tunnel process exited unexpectedly after URL was established',
          );
          this.publicUrl = null;
        }
      });
    });
  }

  /**
   * Stop the tunnel process.
   * Safe to call even if the tunnel is not running.
   */
  stop(): void {
    if (this.child === null || this.state === 'idle' || this.state === 'stopped') {
      return;
    }

    logger.info({ toolName: this.toolName }, 'Stopping tunnel');
    this.child.kill('SIGTERM');
    this.child = null;
    this.state = 'stopped';
    this.publicUrl = null;
  }

  /**
   * Returns the public URL if the tunnel is active, or null if not running.
   */
  getUrl(): string | null {
    return this.publicUrl;
  }

  /**
   * Returns true if the tunnel is running and a public URL is available.
   */
  isActive(): boolean {
    return this.state === 'active' && this.publicUrl !== null;
  }
}
