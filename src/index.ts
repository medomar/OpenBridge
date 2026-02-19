import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bridge, loadConfig, resolveConfigPath, createLogger } from './core/index.js';
import { registerBuiltInConnectors } from './connectors/index.js';
import { registerBuiltInProviders } from './providers/index.js';

const logger = createLogger('main');

async function main(): Promise<void> {
  logger.info('OpenBridge starting...');

  try {
    const configPath = resolveConfigPath();
    const config = await loadConfig();
    const bridge = new Bridge(config, { configPath });

    // Register built-in plugins (manual fallback)
    const registry = bridge.getRegistry();
    registerBuiltInConnectors(registry);
    registerBuiltInProviders(registry);

    // Auto-discover additional plugins from connector/provider directories
    const srcDir = path.dirname(fileURLToPath(import.meta.url));
    await registry.discoverPlugins(srcDir);

    await bridge.start();

    logger.info('OpenBridge is running. Press Ctrl+C to stop.');

    // Graceful shutdown
    const shutdown = async (): Promise<void> => {
      logger.info('Shutting down...');
      await bridge.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  } catch (error) {
    logger.fatal({ error }, 'Failed to start OpenBridge');
    process.exit(1);
  }
}

void main();
