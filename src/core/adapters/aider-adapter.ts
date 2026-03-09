/**
 * Aider CLI Adapter
 *
 * Translates provider-neutral SpawnOptions into Aider CLI arguments.
 *
 * Aider CLI flags:
 *   --model <model>         Model to use (gpt-4o, o1, claude-3-sonnet, etc.)
 *   --message <text>        Non-interactive message (runs and exits)
 *   --yes                   Auto-confirm all changes
 *   --no-auto-commits       Don't auto-commit changes (for read-only tasks)
 *
 * Feature mapping (lossy — Aider doesn't support these):
 *   --max-turns        → dropped (aider manages its own loop)
 *   --max-budget-usd   → dropped
 *   --session-id       → dropped (aider uses git for state)
 *   --append-system-prompt → prepended to message text
 *   --allowedTools     → mapped to --no-auto-commits for read-only
 */

import type { CLIAdapter, CLISpawnConfig, CapabilityLevel } from '../cli-adapter.js';
import type { SpawnOptions } from '../agent-runner.js';
import { sanitizePrompt } from '../agent-runner.js';
import { createLogger } from '../logger.js';
import { sanitizeEnv } from '../env-sanitizer.js';
import { SecurityConfigSchema } from '../../types/config.js';
import type { SecurityConfig } from '../../types/config.js';

const logger = createLogger('aider-adapter');

const DEFAULT_SECURITY_CONFIG: SecurityConfig = SecurityConfigSchema.parse({});

export class AiderAdapter implements CLIAdapter {
  readonly name = 'aider';
  private readonly securityConfig: SecurityConfig;

  constructor(securityConfig?: SecurityConfig) {
    this.securityConfig = securityConfig ?? DEFAULT_SECURITY_CONFIG;
  }

  buildSpawnConfig(opts: SpawnOptions): CLISpawnConfig {
    const args: string[] = [];

    if (opts.model) {
      args.push('--model', opts.model);
    }

    // --yes auto-confirms changes (non-interactive mode)
    args.push('--yes');

    // Map read-only tools to --no-auto-commits (best-effort access control)
    if (opts.allowedTools) {
      const hasEditWrite = opts.allowedTools.some((t) => t === 'Edit' || t === 'Write');
      if (!hasEditWrite) {
        args.push('--no-auto-commits');
      }
    }

    // systemPrompt: prepend to message (aider has no --append-system-prompt)
    let message = sanitizePrompt(opts.prompt, this.getPromptBudget(opts.model).maxPromptChars);
    if (opts.systemPrompt) {
      message = opts.systemPrompt + '\n\n' + message;
    }

    args.push('--message', message);

    // Log dropped options at debug level
    if (opts.maxTurns) {
      logger.debug({ maxTurns: opts.maxTurns }, 'aider: --max-turns not supported, ignoring');
    }
    if (opts.maxBudgetUsd) {
      logger.debug(
        { maxBudgetUsd: opts.maxBudgetUsd },
        'aider: --max-budget-usd not supported, ignoring',
      );
    }
    if (opts.resumeSessionId || opts.sessionId) {
      logger.debug('aider: sessions not supported, ignoring session options');
    }

    return {
      binary: 'aider',
      args,
      env: this.cleanEnv({ ...process.env }),
    };
  }

  cleanEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
    // Remove Claude env vars in case both Claude and Aider are installed
    const cleaned = { ...env };
    for (const key of Object.keys(cleaned)) {
      if (
        key === 'CLAUDECODE' ||
        key.startsWith('CLAUDE_CODE_') ||
        key.startsWith('CLAUDE_AGENT_SDK_')
      ) {
        delete cleaned[key];
      }
    }
    return sanitizeEnv(cleaned, this.securityConfig);
  }

  mapCapabilityLevel(_level: CapabilityLevel): string[] | undefined {
    // Aider doesn't use tool lists — it manages its own file access.
    return undefined;
  }

  isValidModel(model: string): boolean {
    // Aider uses litellm which supports a very wide range of models.
    // Accept anything non-empty — aider will validate at runtime.
    return model.length > 0;
  }

  supportedProfiles(): readonly CapabilityLevel[] {
    // Aider manages its own file access via git integration — no --allowedTools support.
    // Access control is applied via --no-auto-commits for read-only tasks.
    return [];
  }

  getPromptBudget(_model?: string): { maxPromptChars: number; maxSystemPromptChars: number } {
    // Aider prepends systemPrompt to the --message text in buildSpawnConfig(), so both
    // fields share the same underlying `--message` argument. There is no separate
    // system-prompt channel in the Aider CLI.
    //
    // Aider uses litellm and supports a wide range of models (GPT-4o, Claude, Gemini, etc.).
    // Since the model-in-use is unknown at adapter level (user picks at runtime), we use a
    // conservative combined budget of 100K chars (~25K tokens at ~4 chars/token) — safe for
    // the smallest commonly used models (GPT-3.5 has 16K token context, larger models much more).
    //
    // Both fields are set to the same value to signal that they share a single pool
    // (system + user prompt merged into one --message string). PromptAssembler should
    // treat these as a combined budget when targeting AiderAdapter.
    const combined = 100_000;
    return { maxPromptChars: combined, maxSystemPromptChars: combined };
  }
}
