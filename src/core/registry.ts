import type { Connector } from '../types/connector.js';
import type { AIProvider } from '../types/provider.js';
import { createLogger } from './logger.js';

const logger = createLogger('registry');

/** Factory function that creates a connector instance from config options */
export type ConnectorFactory = (options: Record<string, unknown>) => Connector;

/** Factory function that creates a provider instance from config options */
export type ProviderFactory = (options: Record<string, unknown>) => AIProvider;

export class PluginRegistry {
  private readonly connectorFactories = new Map<string, ConnectorFactory>();
  private readonly providerFactories = new Map<string, ProviderFactory>();

  /** Register a connector factory by type name */
  registerConnector(type: string, factory: ConnectorFactory): void {
    this.connectorFactories.set(type, factory);
    logger.info({ type }, 'Connector registered');
  }

  /** Register a provider factory by type name */
  registerProvider(type: string, factory: ProviderFactory): void {
    this.providerFactories.set(type, factory);
    logger.info({ type }, 'Provider registered');
  }

  /** Create a connector instance */
  createConnector(type: string, options: Record<string, unknown>): Connector {
    const factory = this.connectorFactories.get(type);
    if (!factory) {
      throw new Error(
        `Unknown connector type: "${type}". Available: ${this.availableConnectors.join(', ')}`,
      );
    }
    return factory(options);
  }

  /** Create a provider instance */
  createProvider(type: string, options: Record<string, unknown>): AIProvider {
    const factory = this.providerFactories.get(type);
    if (!factory) {
      throw new Error(
        `Unknown provider type: "${type}". Available: ${this.availableProviders.join(', ')}`,
      );
    }
    return factory(options);
  }

  get availableConnectors(): string[] {
    return [...this.connectorFactories.keys()];
  }

  get availableProviders(): string[] {
    return [...this.providerFactories.keys()];
  }
}
