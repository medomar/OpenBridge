import type { PluginRegistry } from '../core/registry.js';
import { ClaudeCodeProvider } from './claude-code/claude-code-provider.js';
import { CodexProvider } from './codex/codex-provider.js';

/** Register all built-in AI providers */
export function registerBuiltInProviders(registry: PluginRegistry): void {
  registry.registerProvider('claude-code', (options) => new ClaudeCodeProvider(options));
  registry.registerProvider('codex', (options) => new CodexProvider(options));
}
