/**
 * Codex CLI Adapter
 *
 * Translates provider-neutral SpawnOptions into OpenAI Codex CLI arguments.
 *
 * Codex uses the `exec` subcommand for non-interactive execution:
 *   codex exec [OPTIONS] <PROMPT>
 *
 * Codex exec flags:
 *   -m, --model <MODEL>           Model to use (codex-mini, o4-mini, gpt-4o, etc.)
 *   -s, --sandbox <MODE>          read-only | workspace-write | danger-full-access
 *   --full-auto                   Auto-approve all actions (convenience flag)
 *   --skip-git-repo-check         Skip git repo trust check (required for non-git workspaces)
 *   -C, --cd <DIR>                Working directory
 *   --ephemeral                   No session persistence
 *   <prompt>                      Positional argument (after exec)
 *
 * Feature mapping (lossy — Codex doesn't support these):
 *   --max-turns        → dropped (codex runs to completion)
 *   --max-budget-usd   → dropped
 *   --session-id       → dropped (use --ephemeral)
 *   --append-system-prompt → prepended to prompt text
 *   --allowedTools     → mapped to --sandbox via heuristic
 */

import type { CLIAdapter, CLISpawnConfig, CapabilityLevel } from '../cli-adapter.js';
import type { SpawnOptions } from '../agent-runner.js';
import { sanitizePrompt } from '../agent-runner.js';
import { createLogger } from '../logger.js';

const logger = createLogger('codex-adapter');

/** Map capability levels to codex sandbox modes */
const CAPABILITY_TO_SANDBOX: Record<CapabilityLevel, string> = {
  'read-only': 'read-only',
  'code-edit': 'workspace-write',
  'full-access': 'danger-full-access',
};

export class CodexAdapter implements CLIAdapter {
  readonly name = 'codex';

  buildSpawnConfig(opts: SpawnOptions): CLISpawnConfig {
    // Start with `exec` subcommand for non-interactive mode
    const args: string[] = ['exec', '--skip-git-repo-check'];

    if (opts.model) {
      args.push('--model', opts.model);
    }

    // Map allowedTools → sandbox mode via heuristic
    const sandboxMode = this.inferSandboxMode(opts.allowedTools);
    if (sandboxMode) {
      if (sandboxMode === 'danger-full-access') {
        // Use --full-auto for full access (enables auto-approve + full sandbox)
        args.push('--full-auto');
      } else {
        args.push('--sandbox', sandboxMode);
      }
    }

    // No session persistence for worker spawning
    args.push('--ephemeral');

    // systemPrompt: prepend to the prompt text (codex has no --append-system-prompt)
    let prompt = sanitizePrompt(opts.prompt);
    if (opts.systemPrompt) {
      prompt = opts.systemPrompt + '\n\n' + prompt;
    }

    // Prompt is positional for codex exec
    args.push(prompt);

    // Log dropped options at debug level
    if (opts.maxTurns) {
      logger.debug({ maxTurns: opts.maxTurns }, 'codex: --max-turns not supported, ignoring');
    }
    if (opts.maxBudgetUsd) {
      logger.debug(
        { maxBudgetUsd: opts.maxBudgetUsd },
        'codex: --max-budget-usd not supported, ignoring',
      );
    }
    if (opts.resumeSessionId || opts.sessionId) {
      logger.debug('codex: sessions not supported, ignoring session options');
    }

    return {
      binary: 'codex',
      args,
      env: this.cleanEnv({ ...process.env }),
      stdin: 'pipe', // codex checks for TTY
    };
  }

  cleanEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
    // Remove Claude env vars in case both Claude and Codex are installed
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
    return cleaned;
  }

  mapCapabilityLevel(_level: CapabilityLevel): string[] | undefined {
    // Codex doesn't use tool lists — it uses sandbox modes.
    // Return undefined; the sandbox mode is set in buildSpawnConfig via inferSandboxMode.
    return undefined;
  }

  isValidModel(model: string): boolean {
    const codexModels = [
      'codex-mini',
      'codex',
      'gpt-4o',
      'gpt-4o-mini',
      'o1',
      'o3-mini',
      'o4-mini',
    ];
    if (codexModels.includes(model)) return true;
    // Accept OpenAI-style model IDs
    return /^(gpt-|o[0-9]|codex)/.test(model);
  }

  /**
   * Infer codex sandbox mode from Claude-style allowedTools list.
   *
   * Heuristic:
   *   - Bash(*) present        → danger-full-access (unrestricted)
   *   - Edit or Write present  → workspace-write (file modifications)
   *   - Otherwise              → read-only
   */
  private inferSandboxMode(allowedTools?: string[]): string | undefined {
    if (!allowedTools || allowedTools.length === 0) return undefined;

    const hasUnrestrictedBash = allowedTools.some((t) => t === 'Bash(*)');
    const hasEditWrite = allowedTools.some((t) => t === 'Edit' || t === 'Write');

    if (hasUnrestrictedBash) return 'danger-full-access';
    if (hasEditWrite) return 'workspace-write';
    return 'read-only';
  }
}

export { CAPABILITY_TO_SANDBOX };
