import { access } from 'node:fs/promises';
import type { AIProvider, ProviderResult } from '../../types/provider.js';
import type { InboundMessage } from '../../types/message.js';
import { ClaudeCodeConfigSchema } from './claude-code-config.js';
import type { ClaudeCodeConfig } from './claude-code-config.js';
import { executeClaudeCode } from './claude-code-executor.js';
import { createLogger } from '../../core/logger.js';

const logger = createLogger('claude-code');

export class ClaudeCodeProvider implements AIProvider {
  readonly name = 'claude-code';
  private config: ClaudeCodeConfig;

  constructor(options: Record<string, unknown>) {
    this.config = ClaudeCodeConfigSchema.parse(options);
  }

  async initialize(): Promise<void> {
    await access(this.config.workspacePath).catch(() => {
      throw new Error(
        `workspacePath does not exist or is not accessible: ${this.config.workspacePath}`,
      );
    });
    logger.info({ workspace: this.config.workspacePath }, 'Claude Code provider initialized');
  }

  async processMessage(message: InboundMessage): Promise<ProviderResult> {
    const startTime = Date.now();

    logger.info({ messageId: message.id, content: message.content }, 'Processing with Claude Code');

    const result = await executeClaudeCode(
      message.content,
      this.config.workspacePath,
      this.config.timeout,
    );

    const durationMs = Date.now() - startTime;

    if (result.exitCode !== 0) {
      logger.warn(
        { exitCode: result.exitCode, stderr: result.stderr },
        'Claude Code returned non-zero exit code',
      );
    }

    const content = result.stdout.trim() || result.stderr.trim() || 'No output from Claude Code.';

    return {
      content,
      metadata: {
        durationMs,
        exitCode: result.exitCode,
      },
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await executeClaudeCode('echo "ping"', this.config.workspacePath, 10_000);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async shutdown(): Promise<void> {
    logger.info('Claude Code provider shut down');
  }
}
