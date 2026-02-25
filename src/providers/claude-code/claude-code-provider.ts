import { access } from 'node:fs/promises';
import type { AIProvider, ProviderResult, ProviderContext } from '../../types/provider.js';
import type { InboundMessage } from '../../types/message.js';
import { ClaudeCodeConfigSchema } from './claude-code-config.js';
import type { ClaudeCodeConfig } from './claude-code-config.js';
import { AgentRunner } from '../../core/agent-runner.js';
import { SessionManager } from './session-manager.js';
import { ProviderError, classifyError } from './provider-error.js';
import { createLogger } from '../../core/logger.js';

const logger = createLogger('claude-code');

export class ClaudeCodeProvider implements AIProvider {
  readonly name = 'claude-code';
  private config: ClaudeCodeConfig;
  private sessionManager: SessionManager;
  private runner: AgentRunner;

  constructor(options: Record<string, unknown>) {
    this.config = ClaudeCodeConfigSchema.parse(options);
    this.sessionManager = new SessionManager(this.config.sessionTtlMs);
    this.runner = new AgentRunner();
  }

  async initialize(): Promise<void> {
    await access(this.config.workspacePath).catch(() => {
      throw new Error(
        `workspacePath does not exist or is not accessible: ${this.config.workspacePath}`,
      );
    });
    logger.info({ workspace: this.config.workspacePath }, 'Claude Code provider initialized');
  }

  async processMessage(
    message: InboundMessage,
    _context?: ProviderContext,
  ): Promise<ProviderResult> {
    const startTime = Date.now();
    const workspacePath = this.resolveWorkspace(message);
    const sessionKey = this.sessionKey(message.sender, workspacePath);
    const { sessionId, isNew } = this.sessionManager.getOrCreate(sessionKey);

    logger.info(
      { messageId: message.id, content: message.content, sessionId, isNew, workspacePath },
      'Processing with Claude Code',
    );

    const result = await this.runner.spawn({
      prompt: message.content,
      workspacePath,
      timeout: this.config.timeout,
      retries: 0,
      ...(isNew ? { sessionId } : { resumeSessionId: sessionId }),
    });

    const durationMs = Date.now() - startTime;

    if (result.exitCode !== 0) {
      const errorKind = classifyError(result.exitCode, result.stderr);
      logger.warn(
        { exitCode: result.exitCode, stderr: result.stderr, errorKind },
        'Claude Code returned non-zero exit code',
      );
      throw new ProviderError(
        result.stderr.trim() || `Claude Code exited with code ${result.exitCode}`,
        errorKind,
        result.exitCode,
      );
    }

    const content = result.stdout.trim() || 'No output from Claude Code.';

    return {
      content,
      metadata: {
        durationMs,
        exitCode: result.exitCode,
        sessionId,
      },
    };
  }

  async *streamMessage(
    message: InboundMessage,
    _context?: ProviderContext,
  ): AsyncGenerator<string, ProviderResult> {
    const startTime = Date.now();
    const workspacePath = this.resolveWorkspace(message);
    const sessionKey = this.sessionKey(message.sender, workspacePath);
    const { sessionId, isNew } = this.sessionManager.getOrCreate(sessionKey);

    logger.info(
      { messageId: message.id, content: message.content, sessionId, isNew, workspacePath },
      'Streaming with Claude Code',
    );

    const stream = this.runner.stream({
      prompt: message.content,
      workspacePath,
      timeout: this.config.timeout,
      retries: 0,
      ...(isNew ? { sessionId } : { resumeSessionId: sessionId }),
    });

    let fullOutput = '';
    let streamResult: IteratorResult<string, unknown>;

    do {
      streamResult = await stream.next();
      if (!streamResult.done && streamResult.value) {
        fullOutput += streamResult.value;
        yield streamResult.value;
      }
    } while (!streamResult.done);

    const durationMs = Date.now() - startTime;
    const agentResult = streamResult.value as {
      exitCode: number;
      stderr: string;
    };

    if (agentResult.exitCode !== 0) {
      const errorKind = classifyError(agentResult.exitCode, agentResult.stderr);
      logger.warn(
        { exitCode: agentResult.exitCode, stderr: agentResult.stderr, errorKind },
        'Claude Code returned non-zero exit code',
      );
      throw new ProviderError(
        agentResult.stderr.trim() || `Claude Code exited with code ${agentResult.exitCode}`,
        errorKind,
        agentResult.exitCode,
      );
    }

    const content = fullOutput.trim() || 'No output from Claude Code.';

    return {
      content,
      metadata: {
        durationMs,
        exitCode: agentResult.exitCode,
        sessionId,
      },
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.runner.spawn({
        prompt: 'echo "ping"',
        workspacePath: this.config.workspacePath,
        timeout: 10_000,
        retries: 0,
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async shutdown(): Promise<void> {
    this.sessionManager.clearAll();
    logger.info('Claude Code provider shut down');
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
