import type { ConnectorFactory } from '../../core/registry.js';
import { WhatsAppConnector } from './whatsapp-connector.js';

export { WhatsAppConnector } from './whatsapp-connector.js';
export { WhatsAppConfigSchema } from './whatsapp-config.js';
export type { WhatsAppConfig } from './whatsapp-config.js';
export { formatMarkdownForWhatsApp } from './whatsapp-formatter.js';

/** Plugin name for auto-discovery */
export const pluginName = 'whatsapp';

/** Connector factory for auto-discovery */
export const connectorFactory: ConnectorFactory = (options) => new WhatsAppConnector(options);
