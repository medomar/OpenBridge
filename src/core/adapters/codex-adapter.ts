/**
 * Codex CLI Adapter
 *
 * Translates provider-neutral SpawnOptions into OpenAI Codex CLI arguments.
 *
 * Codex CLI flags:
 *   --model <model>             Model to use (codex-mini, codex, gpt-4o, etc.)
 *   --approval-mode <mode>      suggest | auto-edit | full-auto
 *   <prompt>                    Positional argument
 *
 * Feature mapping (lossy — Codex doesn't support these):
 *   --max-turns        → dropped (codex runs to completion)
 *   --max-budget-usd   → dropped
 *   --session-id       → dropped (no session concept)
 *   --append-system-prompt → prepended to prompt text
 *   --allowedTools     → mapped to --approval-mode via heuristic
 */

import type { CLIAdapter, CLISpawnConfig, CapabilityLevel } from '../cli-adapter.js';
import type { SpawnOptions } from '../agent-runner.js';
import { sanitizePrompt } from '../agent-runner.js';
import { createLogger } from '../logger.js';

const logger = createLogger('codex-adapter');

/** Map capability levels to codex approval modes */
const CAPABILITY_TO_APPROVAL: Record<CapabilityLevel, string> = {
  'read-only': 'suggest',
  'code-edit': 'auto-edit',
  'full-access': 'full-auto',
};

export class CodexAdapter implements CLIAdapter {
  readonly name = 'codex';

  buildSpawnConfig(opts: SpawnOptions): CLISpawnConfig {
    const args: string[] = [];

    if (opts.model) {
      args.push('--model', opts.model);
    }

    // Map allowedTools → approval mode via heuristic
    const approvalMode = this.inferApprovalMode(opts.allowedTools);
    if (approvalMode) {
      args.push('--approval-mode', approvalMode);
    }

    // systemPrompt: prepend to the prompt text (codex has no --append-system-prompt)
    let prompt = sanitizePrompt(opts.prompt);
    if (opts.systemPrompt) {
      prompt = opts.systemPrompt + '\n\n' + prompt;
    }

    // Prompt is positional for codex
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

  mapCapabilityLevel(level: CapabilityLevel): string[] | undefined {
    // Codex doesn't use tool lists — it uses approval modes.
    // Return undefined; the approval mode is set in buildSpawnConfig via inferApprovalMode.
    return undefined;
  }

  isValidModel(model: string): boolean {
    const codexModels = ['codex-mini', 'codex', 'gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini'];
    if (codexModels.includes(model)) return true;
    // Accept OpenAI-style model IDs
    return /^(gpt-|o[0-9]|codex)/.test(model);
  }

  /**
   * Infer codex approval mode from Claude-style allowedTools list.
   *
   * Heuristic:
   *   - Bash(*) present        → full-auto (unrestricted)
   *   - Edit or Write present  → auto-edit (file modifications)
   *   - Otherwise              → suggest (read-only)
   */
  private inferApprovalMode(allowedTools?: string[]): string | undefined {
    if (!allowedTools || allowedTools.length === 0) return undefined;

    const hasUnrestrictedBash = allowedTools.some((t) => t === 'Bash(*)');
    const hasEditWrite = allowedTools.some((t) => t === 'Edit' || t === 'Write');

    if (hasUnrestrictedBash) return 'full-auto';
    if (hasEditWrite) return 'auto-edit';
    return 'suggest';
  }
}

export { CAPABILITY_TO_APPROVAL };
