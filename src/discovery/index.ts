import { scanForCLITools, scanForTunnelTools, selectMaster } from './tool-scanner.js';
import { scanVSCodeExtensions } from './vscode-scanner.js';
import type { ScanResult } from '../types/discovery.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('discovery');

/**
 * Scan for all available AI tools (CLI + VS Code extensions)
 *
 * This function combines CLI tool scanning (via `which`/`where` commands)
 * with VS Code extension scanning. It automatically selects the highest-priority
 * CLI tool as the Master AI.
 *
 * @returns ScanResult containing all discovered tools and the selected Master
 */
export async function scanForAITools(): Promise<ScanResult> {
  logger.info('Starting AI tool discovery');

  // Scan for CLI tools (synchronous)
  const cliTools = scanForCLITools();
  logger.info({ count: cliTools.length }, 'CLI tool scan complete');

  // Scan for VS Code extensions (asynchronous)
  const vscodeExtensions = await scanVSCodeExtensions();
  logger.info({ count: vscodeExtensions.length }, 'VS Code extension scan complete');

  // Scan for tunnel tools (synchronous)
  const tunnelTools = scanForTunnelTools();
  logger.info({ count: tunnelTools.length }, 'Tunnel tool scan complete');

  // Select master from CLI tools (VS Code extensions cannot be Master)
  const master = selectMaster(cliTools);

  if (master) {
    logger.info({ master: master.name }, 'Master AI tool selected');
  } else {
    logger.warn('No master AI tool could be selected — no CLI tools available');
  }

  const timestamp = new Date().toISOString();
  const totalDiscovered = cliTools.length + vscodeExtensions.length + tunnelTools.length;

  const result: ScanResult = {
    cliTools,
    vscodeExtensions,
    tunnelTools,
    master,
    timestamp,
    totalDiscovered,
  };

  logger.info(
    {
      totalDiscovered,
      cliTools: cliTools.length,
      vscodeExtensions: vscodeExtensions.length,
      tunnelTools: tunnelTools.length,
      master: master?.name ?? 'none',
    },
    'AI tool discovery complete',
  );

  return result;
}

// Re-export individual scanners for advanced use cases
export { scanForCLITools, scanForTunnelTools, selectMaster } from './tool-scanner.js';
export { scanVSCodeExtensions } from './vscode-scanner.js';
