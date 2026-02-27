/**
 * Claude CLI Adapter
 *
 * Translates provider-neutral SpawnOptions into Claude Code CLI arguments.
 * Extracted from the hardcoded logic in agent-runner.ts buildArgs() and execOnce().
 *
 * Claude Code CLI flags:
 *   --print              Single-turn stateless mode (no session)
 *   --model <model>      Model to use (haiku, sonnet, opus, or full ID)
 *   --max-turns <n>      Max agentic turns
 *   --allowedTools <t>   Tool names (variadic, repeated per tool)
 *   --append-system-prompt <text>  Append to system prompt
 *   --max-budget-usd <n> Maximum spend in USD
 *   --resume <id>        Resume existing session
 *   --session-id <id>    Start new session with specific ID
 */

import type { CLIAdapter, CLISpawnConfig, CapabilityLevel } from '../cli-adapter.js';
import type { SpawnOptions } from '../agent-runner.js';
import { sanitizePrompt, MODEL_ALIASES, DEFAULT_MAX_TURNS_TASK } from '../agent-runner.js';
import type { ModelAlias } from '../agent-runner.js';
import { createLogger } from '../logger.js';

const logger = createLogger('claude-adapter');

export class ClaudeAdapter implements CLIAdapter {
  readonly name = 'claude';

  buildSpawnConfig(opts: SpawnOptions): CLISpawnConfig {
    const args: string[] = [];

    // Depth limiting: --print (single-turn) vs --session-id/--resume (multi-turn)
    if (opts.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId);
    } else if (opts.sessionId) {
      args.push('--session-id', opts.sessionId);
    } else {
      args.push('--print');
    }

    if (opts.model) {
      if (!this.isValidModel(opts.model)) {
        logger.warn(
          { model: opts.model },
          'Unrecognized model — passing through to CLI, which may reject it',
        );
      }
      args.push('--model', opts.model);
    }

    const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS_TASK;
    args.push('--max-turns', String(maxTurns));

    if (opts.systemPrompt) {
      args.push('--append-system-prompt', opts.systemPrompt);
    }

    if (opts.maxBudgetUsd !== undefined && opts.maxBudgetUsd > 0) {
      args.push('--max-budget-usd', String(opts.maxBudgetUsd));
    }

    // Place the prompt BEFORE --allowedTools. Commander.js parses the first
    // positional argument as the prompt. --allowedTools is variadic (<tools...>)
    // and would consume a trailing prompt as a tool name.
    args.push(sanitizePrompt(opts.prompt));

    if (opts.allowedTools && opts.allowedTools.length > 0) {
      for (const tool of opts.allowedTools) {
        args.push('--allowedTools', tool);
      }
    }

    return {
      binary: 'claude',
      args,
      env: this.cleanEnv({ ...process.env }),
    };
  }

  cleanEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
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
    switch (level) {
      case 'read-only':
        return ['Read', 'Glob', 'Grep'];
      case 'code-edit':
        return [
          'Read',
          'Edit',
          'Write',
          'Glob',
          'Grep',
          'Bash(git:*)',
          'Bash(npm:*)',
          'Bash(npx:*)',
        ];
      case 'full-access':
        return ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'];
    }
  }

  isValidModel(model: string): boolean {
    if (MODEL_ALIASES.includes(model as ModelAlias)) return true;
    // Full model IDs follow the pattern: claude-<variant>-<version>
    return /^claude-[a-z0-9]+-[a-z0-9._-]+$/.test(model);
  }
}
