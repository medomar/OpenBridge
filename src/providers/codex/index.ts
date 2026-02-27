import type { ProviderFactory } from '../../core/registry.js';
import { CodexProvider } from './codex-provider.js';

export { CodexProvider } from './codex-provider.js';
export { CodexConfigSchema } from './codex-config.js';
export type { CodexConfig } from './codex-config.js';
export { CodexSessionManager } from './session-manager.js';
export type { CodexSessionState } from './session-manager.js';

/** Plugin name for auto-discovery */
export const pluginName = 'codex';

/** Provider factory for auto-discovery */
export const providerFactory: ProviderFactory = (options) => new CodexProvider(options);
