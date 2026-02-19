import type { PluginRegistry } from '../core/registry.js';
import { WhatsAppConnector } from './whatsapp/whatsapp-connector.js';
import { ConsoleConnector } from './console/console-connector.js';

/** Register all built-in connectors */
export function registerBuiltInConnectors(registry: PluginRegistry): void {
  registry.registerConnector('whatsapp', (options) => new WhatsAppConnector(options));
  registry.registerConnector('console', (options) => new ConsoleConnector(options));
}
