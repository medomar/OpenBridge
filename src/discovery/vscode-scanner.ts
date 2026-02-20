import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { DiscoveredTool } from '../types/discovery.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('vscode-scanner');

/**
 * Known VS Code AI extensions and their metadata
 */
const KNOWN_EXTENSIONS = {
  'github.copilot': {
    name: 'GitHub Copilot',
    capabilities: ['code-completion', 'code-generation', 'chat'],
  },
  'github.copilot-chat': {
    name: 'GitHub Copilot Chat',
    capabilities: ['chat', 'code-generation', 'code-explanation'],
  },
  'sourcegraph.cody-ai': {
    name: 'Cody',
    capabilities: ['code-completion', 'code-generation', 'chat', 'code-search'],
  },
  'continue.continue': {
    name: 'Continue',
    capabilities: ['code-completion', 'code-generation', 'chat', 'refactoring'],
  },
  'amazonwebservices.amazon-q-vscode': {
    name: 'Amazon Q',
    capabilities: ['code-completion', 'code-generation', 'chat'],
  },
} as const;

/**
 * Get the VS Code extensions directory path
 */
function getExtensionsPath(): string {
  const home = homedir();
  // VS Code extensions are typically stored in ~/.vscode/extensions
  return join(home, '.vscode', 'extensions');
}

/**
 * Parse package.json from an extension directory
 */
async function parseExtensionMetadata(
  extensionPath: string,
): Promise<{ version: string; publisher: string; name: string } | null> {
  try {
    const packageJsonPath = join(extensionPath, 'package.json');
    const content = await readFile(packageJsonPath, 'utf-8');
    const pkg: unknown = JSON.parse(content);

    if (
      typeof pkg === 'object' &&
      pkg !== null &&
      'version' in pkg &&
      'publisher' in pkg &&
      'name' in pkg
    ) {
      const version = 'version' in pkg && typeof pkg.version === 'string' ? pkg.version : 'unknown';
      const publisher =
        'publisher' in pkg && typeof pkg.publisher === 'string' ? pkg.publisher : 'unknown';
      const name = 'name' in pkg && typeof pkg.name === 'string' ? pkg.name : 'unknown';

      return { version, publisher, name };
    }

    return null;
  } catch (error) {
    logger.debug({ extensionPath, error }, 'Failed to parse extension package.json');
    return null;
  }
}

/**
 * Scan VS Code extensions directory for AI extensions
 *
 * @returns Array of discovered VS Code AI extensions
 */
export async function scanVSCodeExtensions(): Promise<DiscoveredTool[]> {
  const extensionsPath = getExtensionsPath();
  const discovered: DiscoveredTool[] = [];

  try {
    logger.info({ extensionsPath }, 'Scanning VS Code extensions directory');

    const entries = await readdir(extensionsPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Extension directories are typically named: publisher.extension-version
      // e.g., github.copilot-1.123.0
      const dirName = entry.name;

      // Check if this matches any known AI extension
      for (const [extensionId, metadata] of Object.entries(KNOWN_EXTENSIONS)) {
        if (dirName.startsWith(extensionId)) {
          const extensionPath = join(extensionsPath, dirName);
          const extensionMetadata = await parseExtensionMetadata(extensionPath);

          if (extensionMetadata) {
            discovered.push({
              name: metadata.name,
              path: extensionPath,
              version: extensionMetadata.version,
              capabilities: [...metadata.capabilities],
              role: 'none', // VS Code extensions are not CLI tools, so they can't be Master
              available: true,
            });

            logger.info(
              {
                name: metadata.name,
                version: extensionMetadata.version,
                path: extensionPath,
              },
              'Discovered VS Code AI extension',
            );
          }
        }
      }
    }

    logger.info({ count: discovered.length }, 'VS Code extension scan complete');
  } catch (error) {
    logger.warn({ extensionsPath, error }, 'Failed to scan VS Code extensions directory');
  }

  return discovered;
}
