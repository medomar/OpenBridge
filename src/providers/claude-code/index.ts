import type { ProviderFactory } from '../../core/registry.js';
import { ClaudeCodeProvider } from './claude-code-provider.js';

export { ClaudeCodeProvider } from './claude-code-provider.js';
export { ClaudeCodeConfigSchema } from './claude-code-config.js';
export type { ClaudeCodeConfig } from './claude-code-config.js';
export { SessionManager } from './session-manager.js';
export { ProviderError, classifyError } from './provider-error.js';
export type { ErrorKind } from './provider-error.js';

/** Plugin name for auto-discovery */
export const pluginName = 'claude-code';

/** Provider factory for auto-discovery */
export const providerFactory: ProviderFactory = (options) => new ClaudeCodeProvider(options);
