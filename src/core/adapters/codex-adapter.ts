/**
 * Codex CLI Adapter
 *
 * Translates provider-neutral SpawnOptions into OpenAI Codex CLI arguments.
 *
 * Codex uses the `exec` subcommand for non-interactive execution:
 *   codex exec [OPTIONS] <PROMPT>
 *
 * Codex exec flags:
 *   -m, --model <MODEL>           Model to use (gpt-5.2-codex is default; o3/o4-mini require API key auth)
 *   -s, --sandbox <MODE>          read-only | workspace-write | danger-full-access
 *   --full-auto                   Auto-approve all actions (convenience flag)
 *   --skip-git-repo-check         Skip git repo trust check (required for non-git workspaces)
 *   --json                        Output JSONL events to stdout (structured output)
 *   -o, --output-last-message <FILE>  Write final answer to file (reliable capture)
 *   -C, --cd <DIR>                Working directory
 *   --ephemeral                   No session persistence
 *   -c, --config <FILE>           Config file for MCP server definitions (MCP passthrough)
 *   <prompt>                      Positional argument (after exec)
 *
 * Feature mapping (lossy — Codex doesn't support these):
 *   --max-turns        → dropped (codex runs to completion)
 *   --max-budget-usd   → dropped
 *   --session-id       → new named session (omits --ephemeral so Codex saves state)
 *   --resume-session   → `codex exec resume --last` (or explicit session ID)
 *   --append-system-prompt → prepended to prompt text
 *   --allowedTools     → mapped to --sandbox via heuristic
 */

import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { CLIAdapter, CLISpawnConfig, CapabilityLevel } from '../cli-adapter.js';
import type { SpawnOptions } from '../agent-runner.js';
import { sanitizePrompt } from '../agent-runner.js';
import { createLogger } from '../logger.js';

const logger = createLogger('codex-adapter');

/**
 * Extract the final message content from Codex `--json` JSONL output.
 *
 * Codex with `--json` emits one JSON object per line to stdout:
 *   {"type":"message","content":"Hello, world!"}
 *   {"type":"tool_call","name":"bash","input":"..."}
 *   {"type":"tool_result","output":"..."}
 *   {"type":"message","content":"Final answer"}
 *
 * We find the last `type === "message"` event and return its `content` field.
 * Falls back to raw stdout if no parseable message event is found.
 */
export function parseCodexJsonlOutput(stdout: string): string {
  const lines = stdout.split('\n').filter(Boolean);
  let lastContent: string | undefined;

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event['type'] === 'message' && typeof event['content'] === 'string') {
        lastContent = event['content'];
      }
    } catch {
      // Not valid JSON — skip (could be mixed terminal output or partial lines)
    }
  }

  return lastContent ?? stdout;
}

/** Map capability levels to codex sandbox modes */
const CAPABILITY_TO_SANDBOX: Record<CapabilityLevel, string> = {
  'read-only': 'read-only',
  'code-edit': 'workspace-write',
  'full-access': 'danger-full-access',
};

export class CodexAdapter implements CLIAdapter {
  readonly name = 'codex';

  buildSpawnConfig(opts: SpawnOptions): CLISpawnConfig {
    // Codex CLI supports multiple auth methods:
    //   1. `codex login` — OAuth via ChatGPT (zero API key, like Claude Code CLI)
    //   2. OPENAI_API_KEY env var — direct API key auth
    // We don't check for either here — Codex handles auth internally and gives
    // a clear error if the user isn't authenticated.

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

    // Session management:
    //   - resumeSessionId set → resume last session via `exec resume --last` (or explicit ID)
    //   - sessionId set       → new named session start (no --ephemeral so Codex saves state)
    //   - neither set         → ephemeral (no session persistence, current worker behavior)
    if (opts.resumeSessionId) {
      // Insert `resume --last` (or explicit session ID) after `exec`.
      // codex exec resume --last [OPTIONS] <PROMPT>
      args.splice(
        1,
        0,
        'resume',
        opts.resumeSessionId === '__last__' ? '--last' : opts.resumeSessionId,
      );
    } else if (!opts.sessionId) {
      // Worker spawn path — stateless, no session saved.
      args.push('--ephemeral');
    }
    // When sessionId is set (new provider session), omit --ephemeral so Codex saves state.

    // MCP passthrough: Codex supports MCP natively via `codex mcp add`.
    // When a config path is provided, pass it via the -c flag so Codex can
    // load MCP server definitions without requiring global pre-configuration.
    if (opts.mcpConfigPath) {
      logger.debug({ mcpConfigPath: opts.mcpConfigPath }, 'codex: passing MCP config via -c flag');
      args.push('-c', opts.mcpConfigPath);
    }

    // Enable JSONL structured output — each event is a JSON object on its own line.
    // AgentRunner applies parseOutput() to extract the final message content.
    args.push('--json');

    // -o / --output-last-message: Codex's recommended way to capture the final answer reliably.
    // Generates a unique temp file; parseOutput reads it after process exit and cleans up.
    const tempFile = join(tmpdir(), `ob-codex-${Date.now()}-${randomBytes(4).toString('hex')}.txt`);
    args.push('-o', tempFile);

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
    return {
      binary: 'codex',
      args,
      env: this.cleanEnv({ ...process.env }),
      parseOutput: (stdout: string): string => {
        // Prefer the -o temp file — Codex writes the final answer there reliably.
        // Falls back to --json JSONL parsing if the file is missing or unreadable
        // (older Codex versions, unsupported flag, or process crash before write).
        try {
          const content = readFileSync(tempFile, 'utf-8').trim();
          if (content) {
            try {
              unlinkSync(tempFile);
            } catch {
              // Best-effort cleanup — not critical if it fails
            }
            return content;
          }
        } catch {
          // Temp file not found or unreadable — fall through to JSONL parsing
        }
        return parseCodexJsonlOutput(stdout);
      },
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
    // ChatGPT-account auth only supports gpt-5.2-codex (the default in v0.104.0).
    // o3, o4-mini, codex-mini are rejected with "not supported when using Codex with a ChatGPT account".
    // API-key auth may support more models — accept OpenAI-style IDs for forward compat.
    const codexModels = [
      'gpt-5.2-codex', // default — works with both ChatGPT auth and API key
    ];
    if (codexModels.includes(model)) return true;
    // Accept OpenAI-style model IDs for forward compatibility (API-key users)
    return /^(gpt-|o[0-9]|codex)/.test(model);
  }

  /**
   * Infer codex sandbox mode from Claude-style allowedTools list.
   *
   * Heuristic:
   *   - Bash(*) present        → danger-full-access (unrestricted)
   *   - Edit or Write present  → workspace-write (file modifications)
   *   - Otherwise (incl. empty/undefined) → read-only (safe default)
   */
  private inferSandboxMode(allowedTools?: string[]): string {
    if (!allowedTools || allowedTools.length === 0) return 'read-only';

    const hasUnrestrictedBash = allowedTools.some((t) => t === 'Bash(*)');
    const hasEditWrite = allowedTools.some((t) => t === 'Edit' || t === 'Write');

    if (hasUnrestrictedBash) return 'danger-full-access';
    if (hasEditWrite) return 'workspace-write';
    return 'read-only';
  }
}

export { CAPABILITY_TO_SANDBOX };
