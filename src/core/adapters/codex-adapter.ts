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
 * Feature mapping (lossy — Codex doesn't support these Claude CLI features):
 *   --max-turns        → dropped (codex runs to completion)
 *   --max-budget-usd   → dropped
 *   --session-id       → new named session (omits --ephemeral so Codex saves state)
 *   --resume-session   → `codex exec resume --last` (or explicit session ID)
 *   --append-system-prompt → prepended to prompt text
 *   --allowedTools     → NOT passed to Codex (unsupported); mapped to --sandbox for access
 *                        control + system prompt constraints for behavioral guidance.
 *                        Codex uses shell-level sandbox modes (read-only, workspace-write,
 *                        danger-full-access) rather than named tool lists.
 */

import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { CLIAdapter, CLISpawnConfig, CapabilityLevel } from '../cli-adapter.js';
import type { SpawnOptions } from '../agent-runner.js';
import { sanitizePrompt } from '../agent-runner.js';
import { createLogger } from '../logger.js';
import { sanitizeEnv } from '../env-sanitizer.js';
import { SecurityConfigSchema } from '../../types/config.js';
import type { SecurityConfig } from '../../types/config.js';

const logger = createLogger('codex-adapter');

const DEFAULT_SECURITY_CONFIG: SecurityConfig = SecurityConfigSchema.parse({});

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

/**
 * Extract human-readable text from a single Codex `--json` streaming JSONL chunk.
 *
 * Codex with `--json` emits one JSON event per line during streaming. This function
 * parses a single line and extracts visible text content, returning null for events
 * that are not user-visible (thread.started, item.started without output, etc.).
 *
 * Handled event types:
 *   - `type: "message"` with `content` string → returns content
 *   - `type: "item.completed"` + `item.type: "command_execution"` → formatted output
 *   - `type: "item.completed"` + `item.type: "reasoning"` → reasoning text (if not hidden)
 *   - All other event types → null (not user-visible)
 *
 * @param chunk A single line from Codex `--json` streaming output
 * @returns Human-readable text, or null if the event has no user-visible content
 */
export function parseCodexStreamChunk(chunk: string): string | null {
  const line = chunk.trim();
  if (!line) return null;

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    // Not valid JSON — could be a partial line or mixed terminal output
    return null;
  }

  const type = event['type'];

  // type: "message" — final or intermediate message with string content
  if (type === 'message' && typeof event['content'] === 'string') {
    return event['content'];
  }

  // type: "item.completed" — completed reasoning step or command execution
  if (type === 'item.completed') {
    const item = event['item'];
    if (!item || typeof item !== 'object') return null;
    const itemObj = item as Record<string, unknown>;
    const itemType = itemObj['type'];

    // Reasoning step — extract text (skip if hidden or empty)
    if (itemType === 'reasoning') {
      const text = itemObj['text'];
      if (typeof text === 'string' && text.trim()) {
        return `[thinking] ${text.trim()}`;
      }
      return null;
    }

    // Command execution output
    if (itemType === 'command_execution') {
      const output = itemObj['output'];
      if (typeof output === 'string' && output.trim()) {
        return `[cmd] ${output.trim()}`;
      }
      return null;
    }
  }

  // All other event types (thread.started, item.started, etc.) — not user-visible
  return null;
}

/** Map capability levels to codex sandbox modes */
const CAPABILITY_TO_SANDBOX: Record<CapabilityLevel, string> = {
  'read-only': 'read-only',
  'code-edit': 'workspace-write',
  'full-access': 'danger-full-access',
};

/**
 * System prompt constraints injected when tool restrictions are specified via allowedTools.
 *
 * Codex CLI does NOT support --allowedTools (Claude-style named tool restriction lists).
 * Instead, we rely on two complementary mechanisms:
 *   1. --sandbox <mode>  — shell-level access control (blocks filesystem writes in read-only)
 *   2. System prompt     — behavioral guidance telling Codex how to approach the task
 *
 * Without explicit guidance, Codex workers on read-only tasks tend to resort to complex
 * inline Python scripts via `/bin/zsh -lc "python -c '...'"` with deeply nested shell
 * escaping, exhausting their turn budget without reading any files. The constraint text
 * below steers Codex toward simple, direct commands that work within the sandbox.
 */
const SANDBOX_CONSTRAINTS: Record<string, string> = {
  'read-only':
    'IMPORTANT: For this task, only READ files. Do NOT create, modify, or delete any files.\n' +
    'Do NOT run complex bash scripts, inline Python (-c "..."), or deeply nested shell escaping.\n' +
    'Use simple, direct shell commands: cat, head, tail, grep, find, ls.\n' +
    'Example: to read a file use `cat /path/to/file`. To search use `grep -r "pattern" /dir`.\n' +
    'Keep every command short and direct — avoid multi-line shell gymnastics.',
  'workspace-write':
    'For this task, you can read and write files.\n' +
    'Prefer direct file operations (cat, head, tail, grep, sed, echo, tee) over complex scripts.\n' +
    'Keep shell commands simple and avoid deeply nested shell escaping.',
};

export class CodexAdapter implements CLIAdapter {
  readonly name = 'codex';
  private readonly securityConfig: SecurityConfig;

  constructor(securityConfig?: SecurityConfig) {
    this.securityConfig = securityConfig ?? DEFAULT_SECURITY_CONFIG;
  }

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

    // Map allowedTools → sandbox mode via heuristic.
    // Codex does not support --allowedTools (Claude-style named tool lists). Instead, we:
    //   1. Infer a --sandbox mode from the tool list for shell-level access control
    //   2. Inject a system prompt constraint to guide behavioral compliance (see below)
    const sandboxMode = this.inferSandboxMode(opts.allowedTools);
    if (opts.allowedTools && opts.allowedTools.length > 0) {
      logger.debug(
        { allowedTools: opts.allowedTools, sandboxMode },
        'codex: --allowedTools not supported — mapped to --sandbox mode + system prompt constraints',
      );
    }
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

    // Build the combined prompt with system-level guidance prepended.
    // Codex has no --append-system-prompt flag, so all guidance is prepended to the prompt.
    //
    // Order (first → last in the text):
    //   1. Sandbox constraint — behavioral guidance when tool restrictions were specified
    //   2. User system prompt — caller-supplied context or instructions
    //   3. Task prompt        — the actual task description
    let prompt = sanitizePrompt(
      opts.prompt,
      this.getPromptBudget(opts.model).maxPromptChars,
      'worker',
    );
    const systemParts: string[] = [];

    // Inject behavioral constraint based on sandbox mode — always applied so Codex
    // receives guidance appropriate for its access level.  In particular, read-only
    // workers always get the file-read-only instruction, preventing shell gymnastics
    // even when no explicit allowedTools list was passed.
    const constraint = SANDBOX_CONSTRAINTS[sandboxMode];
    if (constraint) {
      systemParts.push(constraint);
    }

    if (opts.systemPrompt) {
      systemParts.push(opts.systemPrompt);
    }

    if (systemParts.length > 0) {
      prompt = systemParts.join('\n\n') + '\n\n' + prompt;
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
      parseStreamChunk: parseCodexStreamChunk,
      parseOutput: (stdout: string): string => {
        // Prefer the -o temp file — Codex writes the final answer there reliably.
        // Falls back to --json JSONL parsing if the file is missing or unreadable
        // (older Codex versions, unsupported flag, or process crash before write).
        try {
          const content = readFileSync(tempFile, 'utf-8').trim();
          if (content) {
            logger.debug(
              { tempFile, contentLength: content.length },
              'codex: tempfile output read successfully — using as primary source',
            );
            try {
              unlinkSync(tempFile);
              logger.debug({ tempFile }, 'codex: tempfile cleaned up');
            } catch {
              // Best-effort cleanup — not critical if it fails
            }
            return content;
          }
          // File exists but is empty — Codex may not have written the final answer
          logger.warn(
            { tempFile },
            'codex: tempfile exists but is empty — falling back to JSONL stdout parsing',
          );
        } catch {
          // Temp file not found or unreadable — normal if -o flag is unsupported
          logger.debug(
            { tempFile },
            'codex: tempfile not found — falling back to JSONL stdout parsing',
          );
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
    return sanitizeEnv(cleaned, this.securityConfig);
  }

  mapCapabilityLevel(_level: CapabilityLevel): string[] | undefined {
    // Codex doesn't use tool lists — it uses sandbox modes.
    // Return undefined; the sandbox mode is set in buildSpawnConfig via inferSandboxMode.
    return undefined;
  }

  supportedProfiles(): readonly CapabilityLevel[] {
    // Codex uses --sandbox modes + system-prompt constraints, not --allowedTools named
    // tool lists. No profiles are natively enforced via named tool restrictions.
    // The adapter emulates profile restrictions via sandbox mode and injected constraints.
    return [];
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

  getPromptBudget(_model?: string): { maxPromptChars: number; maxSystemPromptChars: number } {
    // Codex merges systemPrompt INTO the prompt positional argument — there is no
    // separate system-prompt channel (no --append-system-prompt flag). Both system
    // context and task description are concatenated into a single string before
    // being passed to `codex exec` as one positional arg.
    //
    // Because of this merger the two fields share the same underlying budget.
    // We return a conservative combined limit based on OpenAI model context windows:
    //   - gpt-5.3-codex / gpt-5.2-codex: ~400K token context window (~1.6M chars)
    //   - We use 400K chars total as a conservative combined budget to leave
    //     ample room for tool call outputs and model response tokens.
    //
    // Both fields are set to the same value to signal that they share a single pool
    // rather than having independent channels. The PromptAssembler should treat these
    // as a combined budget when targeting CodexAdapter.
    const combined = 400_000;
    return { maxPromptChars: combined, maxSystemPromptChars: combined };
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
