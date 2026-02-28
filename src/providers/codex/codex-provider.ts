import { access } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { AIProvider, ProviderResult, ProviderContext } from '../../types/provider.js';

const execAsync = promisify(exec);
import type { InboundMessage } from '../../types/message.js';
import { CodexConfigSchema } from './codex-config.js';
import type { CodexConfig } from './codex-config.js';
import { AgentRunner } from '../../core/agent-runner.js';
import { CodexAdapter } from '../../core/adapters/codex-adapter.js';
import { CodexSessionManager } from './session-manager.js';
import { ProviderError, classifyError } from '../claude-code/provider-error.js';
import { createLogger } from '../../core/logger.js';

const logger = createLogger('codex');

/** Sentinel used as resumeSessionId when we want `codex exec resume --last`. */
const RESUME_LAST = '__last__';

export class CodexProvider implements AIProvider {
  readonly name = 'codex';
  private config: CodexConfig;
  private runner: AgentRunner;
  private sessionManager: CodexSessionManager;

  constructor(options: Record<string, unknown>) {
    this.config = CodexConfigSchema.parse(options);
    this.runner = new AgentRunner(new CodexAdapter());
    this.sessionManager = new CodexSessionManager(this.config.sessionTtlMs);
  }

  async initialize(): Promise<void> {
    await access(this.config.workspacePath).catch(() => {
      throw new Error(
        `workspacePath does not exist or is not accessible: ${this.config.workspacePath}`,
      );
    });
    logger.info({ workspace: this.config.workspacePath }, 'Codex provider initialized');
  }

  async processMessage(
    message: InboundMessage,
    _context?: ProviderContext,
  ): Promise<ProviderResult> {
    const startTime = Date.now();
    const workspacePath = this.resolveWorkspace(message);
    const sessionKey = this.sessionKey(message.sender, workspacePath);
    const { isNew, sessionId } = this.sessionManager.getOrCreate(sessionKey);

    logger.info(
      { messageId: message.id, content: message.content, isNew, workspacePath },
      'Processing with Codex',
    );

    // Build SpawnOptions with session wiring:
    //   isNew: true  → sessionId set (omits --ephemeral, lets Codex save state)
    //   isNew: false → resumeSessionId set (triggers `codex exec resume --last` or explicit ID)
    const spawnOpts = {
      prompt: message.content,
      workspacePath,
      timeout: this.config.timeout,
      model: this.config.model,
      retries: 0,
      ...(isNew
        ? { sessionId: sessionId ?? sessionKey }
        : { resumeSessionId: sessionId ?? RESUME_LAST }),
    };

    const result = await this.runner.spawn(spawnOpts);

    const durationMs = Date.now() - startTime;

    if (result.exitCode !== 0) {
      const errorKind = classifyError(result.exitCode, result.stderr);
      logger.warn(
        { exitCode: result.exitCode, stderr: result.stderr, errorKind },
        'Codex returned non-zero exit code',
      );
      throw new ProviderError(
        result.stderr.trim() || `Codex exited with code ${result.exitCode}`,
        errorKind,
        result.exitCode,
      );
    }

    const content = result.stdout.trim() || 'No output from Codex.';

    return {
      content,
      metadata: {
        durationMs,
        exitCode: result.exitCode,
      },
    };
  }

  async *streamMessage(
    message: InboundMessage,
    context?: ProviderContext,
  ): AsyncGenerator<string, ProviderResult> {
    // Codex uses batch execution (--json JSONL) — no real-time streaming available.
    // Fall back to processMessage and yield the result in a single chunk.
    const result = await this.processMessage(message, context);
    yield result.content;
    return result;
  }

  async isAvailable(): Promise<boolean> {
    // Codex CLI supports multiple auth methods (OAuth via `codex login`, API key, etc.).
    // We only check that the binary is installed — auth is handled by Codex itself.
    try {
      await execAsync('codex --version', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async shutdown(): Promise<void> {
    this.sessionManager.clearAll();
    logger.info('Codex provider shut down');
  }

  /** Resolve the workspace path from message metadata or fall back to config default */
  private resolveWorkspace(message: InboundMessage): string {
    const override = message.metadata?.['workspacePath'];
    if (typeof override === 'string' && override.length > 0) {
      return override;
    }
    return this.config.workspacePath;
  }

  /** Build a session key scoped to sender + workspace to isolate sessions per project */
  private sessionKey(sender: string, workspacePath: string): string {
    return `${sender}:${workspacePath}`;
  }
}
