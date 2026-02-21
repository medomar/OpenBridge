import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { Bridge, loadConfig, resolveConfigPath, createLogger, isV2Config } from './core/index.js';
import { V2ConfigSchema } from './types/config.js';

// whatsapp-web.js / puppeteer registers multiple exit handlers — raise the limit to avoid the warning
process.setMaxListeners(20);
import { registerBuiltInConnectors } from './connectors/index.js';
import { registerBuiltInProviders } from './providers/index.js';
import { scanForAITools } from './discovery/index.js';
import { MasterManager } from './master/index.js';
import type { V2Config } from './types/config.js';

const logger = createLogger('main');

/**
 * V0 startup flow (legacy)
 * - Load config
 * - Create bridge
 * - Register plugins
 * - Start bridge
 */
async function startV0Flow(configPath: string): Promise<Bridge> {
  logger.info('Starting V0 flow (legacy mode)');

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

  logger.info('OpenBridge (V0) is running. Press Ctrl+C to stop.');

  return bridge;
}

/**
 * V2 startup flow (autonomous AI bridge)
 * - Load config
 * - Discover AI tools
 * - Create bridge
 * - Register plugins
 * - Start bridge
 * - Launch Master AI
 * - Explore workspace autonomously
 */
async function startV2Flow(configPath: string, v2Config: V2Config): Promise<Bridge> {
  logger.info('Starting V2 flow (autonomous AI bridge)');

  // Step 1: Discover AI tools on the machine
  logger.info('Discovering AI tools...');
  const scanResult = await scanForAITools();

  if (!scanResult.master) {
    logger.error('No Master AI tool found. V2 flow requires at least one CLI AI tool.');
    logger.error(
      'Install Claude Code CLI (https://claude.ai/download) or another supported AI tool.',
    );
    throw new Error('No Master AI tool available for V2 flow');
  }

  logger.info(
    {
      master: scanResult.master.name,
      totalTools: scanResult.totalDiscovered,
      cliTools: scanResult.cliTools.length,
      vscodeExtensions: scanResult.vscodeExtensions.length,
    },
    'AI tool discovery complete',
  );

  // Step 2: Load config and create bridge
  const config = await loadConfig();
  const bridge = new Bridge(config, { configPath });

  // Register built-in plugins
  const registry = bridge.getRegistry();
  registerBuiltInConnectors(registry);
  registerBuiltInProviders(registry);

  // Auto-discover additional plugins
  const srcDir = path.dirname(fileURLToPath(import.meta.url));
  await registry.discoverPlugins(srcDir);

  // Step 3: Create Master AI and wire into bridge BEFORE starting
  logger.info({ workspacePath: v2Config.workspacePath }, 'Launching Master AI...');

  const masterManager = new MasterManager({
    workspacePath: v2Config.workspacePath,
    masterTool: scanResult.master,
    discoveredTools: scanResult.cliTools,
  });

  // Wire Master into the bridge router (must happen before start)
  bridge.setMaster(masterManager);

  // Step 4: Start bridge (connectors only — Master handles AI routing)
  await bridge.start();

  // Step 5: Start exploration (runs in background — does NOT block the bridge)
  masterManager.start().catch((error) => {
    logger.error(
      { err: error },
      'Master AI exploration failed — bridge continues running without workspace context',
    );
  });

  logger.info('OpenBridge (V2) is running. Master AI is exploring workspace...');
  logger.info('Press Ctrl+C to stop.');

  return bridge;
}

/**
 * Detect config version and route to appropriate startup flow
 */
async function detectConfigVersion(configPath: string): Promise<'v0' | 'v2'> {
  try {
    const raw = await readFile(configPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    if (isV2Config(parsed)) {
      return 'v2';
    }

    return 'v0';
  } catch (error) {
    logger.error({ err: error }, 'Failed to detect config version');
    throw error;
  }
}

async function main(): Promise<void> {
  logger.info('OpenBridge starting...');

  let bridge: Bridge | null = null;

  try {
    const configPath = resolveConfigPath();

    // Detect config version
    const version = await detectConfigVersion(configPath);

    if (version === 'v2') {
      // V2 flow: autonomous AI bridge with Master
      const raw = await readFile(configPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      const v2Config = V2ConfigSchema.parse(parsed);
      bridge = await startV2Flow(configPath, v2Config);
    } else {
      // V0 flow: legacy mode (backward compatibility)
      bridge = await startV0Flow(configPath);
    }

    // Graceful shutdown
    const shutdown = async (): Promise<void> => {
      logger.info('Shutting down...');
      if (bridge) {
        await bridge.stop();
      }
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start OpenBridge');
    process.exit(1);
  }
}

void main();
