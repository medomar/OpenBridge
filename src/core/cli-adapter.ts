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
}

/**
 * Capability level — maps tool profiles to CLI-specific access mechanisms.
 * Claude uses --allowedTools, Codex uses --approval-mode, Aider uses --yes.
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
