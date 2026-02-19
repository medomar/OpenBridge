import type { ConnectorFactory } from '../../core/registry.js';
import { ConsoleConnector } from './console-connector.js';

export { ConsoleConnector } from './console-connector.js';
export { ConsoleConfigSchema } from './console-config.js';
export type { ConsoleConfig } from './console-config.js';

/** Plugin name for auto-discovery */
export const pluginName = 'console';

/** Connector factory for auto-discovery */
export const connectorFactory: ConnectorFactory = (options) => new ConsoleConnector(options);
