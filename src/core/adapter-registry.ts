/**
 * Adapter Registry — Maps provider names to CLIAdapter instances.
 *
 * Resolves discovered tools to their corresponding CLI adapters.
 * Built-in adapters are lazy-loaded on first access; custom adapters
 * can be registered via register() and take priority over built-ins.
 */

import type { CLIAdapter, CapabilityLevel } from './cli-adapter.js';
import type { DiscoveredTool } from '../types/discovery.js';
import type { ConsentMode } from '../memory/access-store.js';
import { ClaudeAdapter } from './adapters/claude-adapter.js';
import { CodexAdapter } from './adapters/codex-adapter.js';
import { AiderAdapter } from './adapters/aider-adapter.js';
import { ClaudeSDKAdapter } from './adapters/claude-sdk.js';
import { createLogger } from './logger.js';

const logger = createLogger('adapter-registry');

/**
 * Trust level controlling which adapter is selected for Claude tools.
 *
 * - `auto`  — pre-approved `--allowedTools` list; uses the CLI adapter (no prompts).
 * - `edit`  — auto-approve reads/edits, relay Bash/Write to user; uses the SDK adapter.
 * - `ask`   — relay every tool call to the user for approval; uses the SDK adapter.
 */
export type TrustLevel = 'auto' | 'edit' | 'ask';

/**
 * Map a stored ConsentMode value to the corresponding TrustLevel for adapter selection.
 *
 * - `auto-approve-all`        → `auto`  (CLI adapter, no per-tool prompts)
 * - `auto-approve-up-to-edit` → `edit`  (SDK adapter, prompt only for Bash/Write)
 * - `always-ask`              → `ask`   (SDK adapter, prompt for every tool call)
 * - `auto-approve-read`       → `ask`   (SDK adapter, conservative fallback)
 */
export function consentModeToTrustLevel(mode: ConsentMode): TrustLevel {
  if (mode === 'auto-approve-all') return 'auto';
  if (mode === 'auto-approve-up-to-edit') return 'edit';
  return 'ask';
}

/** Built-in adapter factories keyed by tool name */
const BUILT_IN_ADAPTERS: Record<string, () => CLIAdapter> = {
  claude: () => new ClaudeAdapter(),
  'claude-sdk': () => new ClaudeSDKAdapter(),
  codex: () => new CodexAdapter(),
  aider: () => new AiderAdapter(),
};

export class AdapterRegistry {
  private adapters = new Map<string, CLIAdapter>();

  /** Register a CLIAdapter for a tool name */
  register(name: string, adapter: CLIAdapter): void {
    this.adapters.set(name, adapter);
    logger.debug({ name }, 'Registered CLI adapter');
  }

  /** Get the adapter for a tool name, creating from built-ins if needed */
  get(name: string): CLIAdapter | undefined {
    let adapter = this.adapters.get(name);
    if (!adapter) {
      const factory = BUILT_IN_ADAPTERS[name];
      if (factory) {
        adapter = factory();
        this.adapters.set(name, adapter);
      }
    }
    return adapter;
  }

  /** Get the adapter for a discovered tool */
  getForTool(tool: DiscoveredTool): CLIAdapter | undefined {
    return this.get(tool.name);
  }

  /**
   * Get the adapter for a tool name, choosing between CLI and SDK adapters
   * based on the user's trust level.
   *
   * - `auto`  → CLI adapter (pre-approved --allowedTools, no prompts).
   * - `edit`  → SDK adapter (auto-approve reads/edits, relay Bash/Write to user).
   * - `ask`   → SDK adapter (relay every tool call to the user for approval).
   *
   * Non-Claude tools are unaffected — `trustLevel` is ignored and the
   * standard adapter for that tool name is returned.
   */
  getForTrustLevel(toolName: string, trustLevel: TrustLevel): CLIAdapter | undefined {
    if (toolName === 'claude') {
      const adapterName = trustLevel === 'auto' ? 'claude' : 'claude-sdk';
      return this.get(adapterName);
    }
    return this.get(toolName);
  }

  /** Check if an adapter exists (registered or built-in) for a tool name */
  has(name: string): boolean {
    return this.adapters.has(name) || name in BUILT_IN_ADAPTERS;
  }

  /**
   * Validate whether an adapter natively enforces a capability profile.
   *
   * Returns `{ supported: true }` if the adapter enforces the profile via
   * native CLI mechanisms (e.g. Claude's --allowedTools named tool lists).
   * Returns `{ supported: false }` if the adapter emulates the profile via
   * sandbox modes or system-prompt constraints instead (e.g. Codex, Aider).
   *
   * Callers can use this to decide whether additional system-prompt constraints
   * are needed or whether to accept the adapter's emulated enforcement.
   * This does NOT change spawn behavior — adapters always handle tool profiles
   * in buildSpawnConfig(), using whatever mechanism they support.
   */
  resolveProfileForAdapter(adapterName: string, profile: CapabilityLevel): { supported: boolean } {
    const adapter = this.get(adapterName);
    if (!adapter) {
      logger.debug(
        { adapterName, profile },
        'resolveProfileForAdapter: no adapter found — profile support unknown',
      );
      return { supported: false };
    }

    const profiles = adapter.supportedProfiles?.();
    if (!profiles || !profiles.includes(profile)) {
      logger.debug(
        { adapterName, profile },
        'Adapter does not natively enforce profile via tool lists — ' +
          'profile emulated via sandbox mode or system-prompt constraints',
      );
      return { supported: false };
    }

    return { supported: true };
  }
}

/** Create an AdapterRegistry pre-loaded with the Claude CLI and SDK adapters */
export function createAdapterRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  // Claude CLI adapter — default for trust=auto
  registry.register('claude', new ClaudeAdapter());
  // Claude SDK adapter — used for trust=edit or trust=ask (interactive approval)
  registry.register('claude-sdk', new ClaudeSDKAdapter());
  return registry;
}
