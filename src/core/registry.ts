import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Connector } from '../types/connector.js';
import type { AIProvider } from '../types/provider.js';
import { createLogger } from './logger.js';

const logger = createLogger('registry');

/** Factory function that creates a connector instance from config options */
export type ConnectorFactory = (options: Record<string, unknown>) => Connector;

/** Factory function that creates a provider instance from config options */
export type ProviderFactory = (options: Record<string, unknown>) => AIProvider;

/** Shape of a connector plugin module's auto-discovery exports */
export interface ConnectorPluginModule {
  pluginName: string;
  connectorFactory: ConnectorFactory;
}

/** Shape of a provider plugin module's auto-discovery exports */
export interface ProviderPluginModule {
  pluginName: string;
  providerFactory: ProviderFactory;
}

function isConnectorPlugin(mod: unknown): mod is ConnectorPluginModule {
  return (
    typeof mod === 'object' &&
    mod !== null &&
    'pluginName' in mod &&
    typeof (mod as ConnectorPluginModule).pluginName === 'string' &&
    'connectorFactory' in mod &&
    typeof (mod as ConnectorPluginModule).connectorFactory === 'function'
  );
}

function isProviderPlugin(mod: unknown): mod is ProviderPluginModule {
  return (
    typeof mod === 'object' &&
    mod !== null &&
    'pluginName' in mod &&
    typeof (mod as ProviderPluginModule).pluginName === 'string' &&
    'providerFactory' in mod &&
    typeof (mod as ProviderPluginModule).providerFactory === 'function'
  );
}

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

  /** Scan connector and provider directories for plugin modules and register them automatically */
  async discoverPlugins(srcDir: string): Promise<void> {
    const connectorsDir = path.join(srcDir, 'connectors');
    const providersDir = path.join(srcDir, 'providers');

    await this.scanDirectory(connectorsDir, 'connector');
    await this.scanDirectory(providersDir, 'provider');
  }

  private async scanDirectory(dir: string, kind: 'connector' | 'provider'): Promise<void> {
    if (!fs.existsSync(dir)) {
      logger.debug({ dir }, 'Plugin directory does not exist, skipping');
      return;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const indexPath = path.join(dir, entry.name, 'index.js');
      if (!fs.existsSync(indexPath)) continue;

      try {
        const moduleUrl = pathToFileURL(indexPath).href;
        const mod: unknown = await import(moduleUrl);

        if (kind === 'connector' && isConnectorPlugin(mod)) {
          if (!this.connectorFactories.has(mod.pluginName)) {
            this.registerConnector(mod.pluginName, mod.connectorFactory);
            logger.info({ plugin: mod.pluginName }, 'Auto-discovered connector');
          }
        } else if (kind === 'provider' && isProviderPlugin(mod)) {
          if (!this.providerFactories.has(mod.pluginName)) {
            this.registerProvider(mod.pluginName, mod.providerFactory);
            logger.info({ plugin: mod.pluginName }, 'Auto-discovered provider');
          }
        }
      } catch (error) {
        logger.warn({ dir: entry.name, error }, 'Failed to load plugin module');
      }
    }
  }

  get availableConnectors(): string[] {
    return [...this.connectorFactories.keys()];
  }

  get availableProviders(): string[] {
    return [...this.providerFactories.keys()];
  }
}
