/**
 * CLIAdapter — Provider-agnostic interface for spawning AI CLI tools.
 *
 * Each CLI tool (claude, codex, aider) implements this interface to translate
 * the provider-neutral SpawnOptions into tool-specific binary, args, and env.
 *
 * The adapter sits between AgentRunner and child_process.spawn():
 *   SpawnOptions → adapter.buildSpawnConfig() → spawn(config.binary, config.args, { env: config.env })
 *
 * Lossy translation is intentional: if a CLI doesn't support a feature
 * (e.g. codex has no --max-turns), the adapter silently drops it.
 */

import type { SpawnOptions } from './agent-runner.js';

/** The output of a CLIAdapter: everything needed to call child_process.spawn() */
export interface CLISpawnConfig {
  /** Command name or absolute path to the binary */
  binary: string;
  /** CLI arguments array */
  args: string[];
  /** Environment variables (already cleaned of conflicting vars) */
  env: Record<string, string | undefined>;
  /**
   * stdin behavior: 'ignore' closes stdin (Claude), 'pipe' provides a writable stream
   * (needed by CLIs that check for TTY). Defaults to 'ignore'.
   */
  stdin?: 'ignore' | 'pipe';
  /**
   * Optional post-processor for raw stdout. When set, AgentRunner applies this
   * function to the accumulated stdout after the process exits. Used by adapters
   * that emit structured output (e.g. Codex `--json` JSONL) to extract the final
   * human-readable message content before returning the AgentResult.
   * Falls back to raw stdout if the function returns undefined or throws.
   */
  parseOutput?: (stdout: string) => string;
}

/**
 * Capability level — maps tool profiles to CLI-specific access mechanisms.
 * Claude uses --allowedTools, Codex uses --sandbox modes, Aider uses --yes.
 */
export type CapabilityLevel = 'read-only' | 'code-edit' | 'full-access';

export interface CLIAdapter {
  /** Provider name matching DiscoveredTool.name (e.g. 'claude', 'codex', 'aider') */
  readonly name: string;

  /**
   * Build the spawn configuration from provider-neutral options.
   * Translates SpawnOptions into the binary, args, and env for this CLI.
   */
  buildSpawnConfig(opts: SpawnOptions): CLISpawnConfig;

  /**
   * Clean the process environment for this CLI tool.
   * Removes env vars that would cause nested-session or other conflicts.
   */
  cleanEnv(env: Record<string, string | undefined>): Record<string, string | undefined>;

  /**
   * Map a capability level to whatever mechanism this CLI uses for access control.
   * For Claude: tool name lists. For Codex: approval modes. For Aider: flags.
   * Returns undefined if the CLI doesn't have a capability restriction mechanism.
   */
  mapCapabilityLevel(level: CapabilityLevel): string[] | undefined;

  /**
   * Validate a model string for this provider.
   * Returns true if the model is recognized or can be passed through.
   */
  isValidModel(model: string): boolean;
}
