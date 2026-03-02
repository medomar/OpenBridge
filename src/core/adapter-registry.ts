/**
 * Adapter Registry — Maps provider names to CLIAdapter instances.
 *
 * Resolves discovered tools to their corresponding CLI adapters.
 * Built-in adapters are lazy-loaded on first access; custom adapters
 * can be registered via register() and take priority over built-ins.
 */

import type { CLIAdapter, CapabilityLevel } from './cli-adapter.js';
import type { DiscoveredTool } from '../types/discovery.js';
import { ClaudeAdapter } from './adapters/claude-adapter.js';
import { CodexAdapter } from './adapters/codex-adapter.js';
import { AiderAdapter } from './adapters/aider-adapter.js';
import { createLogger } from './logger.js';

const logger = createLogger('adapter-registry');

/** Built-in adapter factories keyed by tool name */
const BUILT_IN_ADAPTERS: Record<string, () => CLIAdapter> = {
  claude: () => new ClaudeAdapter(),
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

/** Create an AdapterRegistry pre-loaded with the Claude adapter */
export function createAdapterRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  // Claude is always pre-registered as the default
  registry.register('claude', new ClaudeAdapter());
  return registry;
}
