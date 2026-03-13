/**
 * Claude Agent SDK Adapter
 *
 * Uses `query()` from `@anthropic-ai/claude-agent-sdk` instead of
 * `child_process.spawn('claude', ...)`. The `canUseTool` callback provides
 * per-tool-call control:
 *
 * - Non-interactive mode: auto-approve tools in the allowed list
 *   (mirrors `--allowedTools` behavior from the CLI adapter).
 * - Interactive mode: delegate to a permission relay callback (OB-1498)
 *   that routes approval requests through messaging channels.
 *
 * This adapter implements `CLIAdapter` for compatibility with the adapter
 * registry, but its primary execution path is `executeQuery()` — not
 * `buildSpawnConfig()`. AgentRunner detects SDK adapters via `isSDKAdapter()`
 * and uses `executeQuery()` instead of spawning a child process.
 */

import type { CLIAdapter, CLISpawnConfig, CapabilityLevel } from '../cli-adapter.js';
import type { SpawnOptions } from '../agent-runner.js';
import { sanitizePrompt, MODEL_ALIASES } from '../agent-runner.js';
import type { ModelAlias } from '../agent-runner.js';
import { createLogger } from '../logger.js';
import { sanitizeEnv } from '../env-sanitizer.js';
import { SecurityConfigSchema } from '../../types/config.js';
import type { SecurityConfig } from '../../types/config.js';
import type {
  CanUseTool,
  Options as SDKOptions,
  PermissionResult,
  Query,
  SDKMessage,
  SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';

const logger = createLogger('claude-sdk-adapter');

const DEFAULT_SECURITY_CONFIG: SecurityConfig = SecurityConfigSchema.parse({});

/**
 * Callback signature for interactive permission relay.
 * When set, tool calls not in the allowed list are relayed to the user
 * through the messaging channel for approval.
 */
export type PermissionRelayFn = (params: {
  toolName: string;
  input: Record<string, unknown>;
  userId: string;
  channel: string;
}) => Promise<boolean>;

/**
 * Options for executing a query via the SDK adapter.
 */
export interface SDKExecuteOptions {
  /** SpawnOptions from AgentRunner */
  spawnOptions: SpawnOptions;
  /** User ID for permission relay */
  userId?: string;
  /** Channel name for permission relay */
  channel?: string;
  /** Optional permission relay function for interactive mode */
  permissionRelay?: PermissionRelayFn;
  /** AbortController for cancellation */
  abortController?: AbortController;
  /** Callback for streaming messages */
  onMessage?: (message: SDKMessage) => void;
}

/**
 * Result from an SDK query execution.
 */
export interface SDKExecuteResult {
  /** The text result from the agent */
  stdout: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Number of agentic turns used */
  numTurns: number;
  /** Total cost in USD */
  costUsd: number;
  /** Session ID from the query */
  sessionId: string;
  /** Whether the query ended due to an error */
  isError: boolean;
  /** Error subtype if applicable */
  errorSubtype?: string;
}

export class ClaudeSDKAdapter implements CLIAdapter {
  readonly name = 'claude-sdk';
  private readonly securityConfig: SecurityConfig;

  constructor(securityConfig?: SecurityConfig) {
    this.securityConfig = securityConfig ?? DEFAULT_SECURITY_CONFIG;
  }

  /**
   * Build a CLISpawnConfig for compatibility with the CLIAdapter interface.
   *
   * This adapter does NOT use child_process.spawn() — callers should use
   * `executeQuery()` instead. This method exists only to satisfy the interface.
   * AgentRunner detects SDK adapters via `isSDKAdapter()` and routes accordingly.
   */
  buildSpawnConfig(opts: SpawnOptions): CLISpawnConfig {
    logger.warn('buildSpawnConfig() called on SDK adapter — use executeQuery() instead');
    // Return a no-op config that cannot actually spawn
    return {
      binary: '__claude_sdk__',
      args: [sanitizePrompt(opts.prompt, this.getPromptBudget(opts.model).maxPromptChars)],
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
    return sanitizeEnv(cleaned, this.securityConfig);
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
    return /^claude-[a-z0-9]+-[a-z0-9._-]+$/.test(model);
  }

  supportedProfiles(): readonly CapabilityLevel[] {
    return ['read-only', 'code-edit', 'full-access'];
  }

  getPromptBudget(model?: string): { maxPromptChars: number; maxSystemPromptChars: number } {
    const isHaiku = model != null && /haiku/i.test(model);
    const isSonnet = model != null && /sonnet/i.test(model);
    const isOpus = model != null && /opus/i.test(model);

    if (isHaiku || isSonnet || isOpus) {
      return { maxPromptChars: 32_768, maxSystemPromptChars: 180_000 };
    }
    return { maxPromptChars: 32_768, maxSystemPromptChars: 180_000 };
  }

  /**
   * Type guard: identifies this as an SDK-based adapter.
   * AgentRunner uses this to choose `executeQuery()` over `child_process.spawn()`.
   */
  isSDKAdapter(): boolean {
    return true;
  }

  /**
   * Build a `canUseTool` callback that implements the permission model.
   *
   * - Tools in `allowedTools` are auto-approved (mirrors --allowedTools).
   * - If a `permissionRelay` is provided, non-allowed tools are relayed
   *   to the user through the messaging channel for approval.
   * - Without a `permissionRelay`, non-allowed tools are denied.
   */
  buildCanUseTool(
    allowedTools: string[] | undefined,
    permissionRelay?: PermissionRelayFn,
    userId?: string,
    channel?: string,
  ): CanUseTool {
    const allowed = new Set(allowedTools ?? []);

    return async (
      toolName: string,
      input: Record<string, unknown>,
      _options,
    ): Promise<PermissionResult> => {
      // Auto-approve tools in the allowed list
      if (allowed.has(toolName)) {
        return { behavior: 'allow' };
      }

      // Check for wildcard patterns (e.g. Bash(*) allows any Bash tool)
      for (const pattern of allowed) {
        if (pattern.endsWith('(*)') && toolName.startsWith(pattern.slice(0, -3))) {
          return { behavior: 'allow' };
        }
        // Handle patterns like Bash(git:*) — allow Bash if the command starts with 'git'
        const wildcardMatch = pattern.match(/^(\w+)\(([^)]+):\*\)$/);
        if (wildcardMatch) {
          const [, baseTool, prefix] = wildcardMatch;
          if (toolName === baseTool && prefix) {
            const command = typeof input['command'] === 'string' ? input['command'].trim() : '';
            if (command.startsWith(prefix)) {
              return { behavior: 'allow' };
            }
          }
        }
      }

      // Interactive mode: relay to user for approval
      if (permissionRelay && userId && channel) {
        logger.info({ toolName, userId, channel }, 'Relaying tool permission to user');
        const approved = await permissionRelay({
          toolName,
          input,
          userId,
          channel,
        });
        return approved
          ? { behavior: 'allow', updatedInput: input }
          : { behavior: 'deny', message: 'User denied via messaging channel' };
      }

      // No relay — deny by default
      logger.info({ toolName }, 'Tool not in allowed list and no permission relay — denying');
      return {
        behavior: 'deny',
        message: `Tool "${toolName}" is not in the allowed list`,
      };
    };
  }

  /**
   * Build SDK query options from SpawnOptions.
   */
  buildQueryOptions(opts: SDKExecuteOptions): { prompt: string; options: SDKOptions } {
    const { spawnOptions, permissionRelay, userId, channel, abortController } = opts;
    const budget = this.getPromptBudget(spawnOptions.model);
    const prompt = sanitizePrompt(spawnOptions.prompt, budget.maxPromptChars);

    const sdkOptions: SDKOptions = {
      cwd: spawnOptions.workspacePath,
      env: this.cleanEnv({ ...process.env }),
      persistSession: false,
    };

    if (spawnOptions.model) {
      sdkOptions.model = spawnOptions.model;
    }

    if (spawnOptions.maxTurns) {
      sdkOptions.maxTurns = spawnOptions.maxTurns;
    }

    if (spawnOptions.maxBudgetUsd !== undefined && spawnOptions.maxBudgetUsd > 0) {
      sdkOptions.maxBudgetUsd = spawnOptions.maxBudgetUsd;
    }

    if (spawnOptions.systemPrompt) {
      sdkOptions.systemPrompt = {
        type: 'preset',
        preset: 'claude_code',
        append: spawnOptions.systemPrompt,
      };
    }

    if (spawnOptions.resumeSessionId) {
      sdkOptions.resume = spawnOptions.resumeSessionId;
      sdkOptions.persistSession = true;
    } else if (spawnOptions.sessionId) {
      sdkOptions.sessionId = spawnOptions.sessionId;
      sdkOptions.persistSession = true;
    }

    if (abortController) {
      sdkOptions.abortController = abortController;
    }

    // Set up tool control via canUseTool callback
    if (spawnOptions.allowedTools && spawnOptions.allowedTools.length > 0) {
      sdkOptions.allowedTools = spawnOptions.allowedTools;
      sdkOptions.canUseTool = this.buildCanUseTool(
        spawnOptions.allowedTools,
        permissionRelay,
        userId,
        channel,
      );
      // Use dontAsk so only canUseTool controls approval
      sdkOptions.permissionMode = 'dontAsk';
    }

    return { prompt, options: sdkOptions };
  }

  /**
   * Execute a query using the Claude Agent SDK.
   *
   * This is the primary execution path for the SDK adapter, replacing
   * `child_process.spawn('claude', ...)` with a programmatic `query()` call.
   */
  async executeQuery(opts: SDKExecuteOptions): Promise<SDKExecuteResult> {
    const startTime = Date.now();
    const { prompt, options } = this.buildQueryOptions(opts);

    logger.info(
      {
        model: opts.spawnOptions.model,
        maxTurns: opts.spawnOptions.maxTurns,
        hasPermissionRelay: !!opts.permissionRelay,
        cwd: opts.spawnOptions.workspacePath,
      },
      'Executing SDK query',
    );

    let resultMessage: SDKResultMessage | undefined;

    const queryIterator: Query = query({ prompt, options });

    try {
      for await (const message of queryIterator) {
        // Forward streaming messages to the caller
        if (opts.onMessage) {
          opts.onMessage(message);
        }

        // Capture the final result
        if (message.type === 'result') {
          resultMessage = message;
        }
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error({ error, durationMs }, 'SDK query failed');
      throw error;
    }

    const durationMs = Date.now() - startTime;

    if (!resultMessage) {
      logger.warn({ durationMs }, 'SDK query completed without a result message');
      return {
        stdout: '',
        durationMs,
        numTurns: 0,
        costUsd: 0,
        sessionId: '',
        isError: true,
        errorSubtype: 'no_result',
      };
    }

    const isSuccess = resultMessage.subtype === 'success';
    const stdout = isSuccess && 'result' in resultMessage ? resultMessage.result : '';

    return {
      stdout,
      durationMs,
      numTurns: resultMessage.num_turns,
      costUsd: resultMessage.total_cost_usd,
      sessionId: resultMessage.session_id,
      isError: resultMessage.is_error,
      errorSubtype: isSuccess ? undefined : resultMessage.subtype,
    };
  }
}
