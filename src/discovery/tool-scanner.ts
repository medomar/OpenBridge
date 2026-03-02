import { execSync } from 'node:child_process';
import { createLogger } from '../core/logger.js';
import type { DiscoveredTool } from '../types/discovery.js';

const logger = createLogger('tool-scanner');

interface ToolDefinition {
  name: string;
  command: string;
  versionFlag: string;
  versionPattern?: RegExp;
  capabilities: string[];
  priority: number;
}

const KNOWN_TOOLS: ToolDefinition[] = [
  {
    name: 'claude',
    command: 'claude',
    versionFlag: '--version',
    versionPattern: /(\d+\.\d+\.\d+)/,
    capabilities: [
      'code-generation',
      'code-editing',
      'file-operations',
      'reasoning',
      'planning',
      'multi-turn-conversation',
      'workspace-exploration',
    ],
    priority: 100,
  },
  {
    name: 'codex',
    command: 'codex',
    versionFlag: '--version',
    versionPattern: /(\d+\.\d+\.\d+)/,
    capabilities: ['code-generation', 'code-editing', 'file-operations', 'reasoning'],
    priority: 80,
  },
  {
    name: 'aider',
    command: 'aider',
    versionFlag: '--version',
    versionPattern: /(\d+\.\d+\.\d+)/,
    capabilities: ['code-generation', 'code-editing', 'git-operations'],
    priority: 70,
  },
  {
    name: 'cursor',
    command: 'cursor',
    versionFlag: '--version',
    versionPattern: /(\d+\.\d+\.\d+)/,
    capabilities: ['code-generation', 'code-editing', 'file-operations'],
    priority: 60,
  },
  {
    name: 'cody',
    command: 'cody',
    versionFlag: '--version',
    versionPattern: /(\d+\.\d+\.\d+)/,
    capabilities: ['code-generation', 'code-completion'],
    priority: 50,
  },
];

const TUNNEL_TOOLS: ToolDefinition[] = [
  {
    name: 'cloudflared',
    command: 'cloudflared',
    versionFlag: '--version',
    versionPattern: /(\d+\.\d+\.\d+)/,
    capabilities: ['tunnel'],
    priority: 30,
  },
  {
    name: 'ngrok',
    command: 'ngrok',
    versionFlag: '--version',
    versionPattern: /(\d+\.\d+\.\d+)/,
    capabilities: ['tunnel'],
    priority: 25,
  },
  {
    name: 'localtunnel',
    command: 'lt',
    versionFlag: '--version',
    versionPattern: /(\d+\.\d+\.\d+)/,
    capabilities: ['tunnel'],
    priority: 20,
  },
];

/**
 * Check if a CLI tool is available on the system PATH
 */
function isCommandAvailable(command: string): boolean {
  try {
    const whichCommand = process.platform === 'win32' ? 'where' : 'which';
    execSync(`${whichCommand} ${command}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the absolute path to a CLI tool
 */
function getCommandPath(command: string): string | null {
  try {
    const whichCommand = process.platform === 'win32' ? 'where' : 'which';
    const result = execSync(`${whichCommand} ${command}`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return result.trim().split('\n')[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Get the version of a CLI tool
 */
function getToolVersion(command: string, versionFlag: string, versionPattern?: RegExp): string {
  try {
    const result = execSync(`${command} ${versionFlag}`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5000,
    });

    if (versionPattern) {
      const match = result.match(versionPattern);
      return match?.[1] ?? 'unknown';
    }

    return result.trim().split('\n')[0] ?? 'unknown';
  } catch (error) {
    logger.debug({ command, error }, 'Failed to get tool version');
    return 'unknown';
  }
}

/**
 * Scan for AI CLI tools installed on the system
 */
export function scanForCLITools(): DiscoveredTool[] {
  logger.info('Scanning for AI CLI tools');

  const discovered: DiscoveredTool[] = [];

  for (const tool of KNOWN_TOOLS) {
    logger.debug({ tool: tool.name }, 'Checking for tool');

    const available = isCommandAvailable(tool.command);

    if (!available) {
      logger.debug({ tool: tool.name }, 'Tool not found on PATH');
      continue;
    }

    const path = getCommandPath(tool.command);

    if (!path) {
      logger.debug({ tool: tool.name }, 'Could not determine tool path');
      continue;
    }

    const version = getToolVersion(tool.command, tool.versionFlag, tool.versionPattern);

    discovered.push({
      name: tool.name,
      path,
      version,
      capabilities: tool.capabilities,
      role: 'none',
      available: true,
    });

    logger.info({ tool: tool.name, path, version }, 'Discovered AI tool');
  }

  return discovered;
}

/**
 * Scan for tunnel tools (cloudflared, ngrok, localtunnel) on the system PATH
 */
export function scanForTunnelTools(): DiscoveredTool[] {
  logger.info('Scanning for tunnel tools');

  const discovered: DiscoveredTool[] = [];

  for (const tool of TUNNEL_TOOLS) {
    logger.debug({ tool: tool.name }, 'Checking for tunnel tool');

    const available = isCommandAvailable(tool.command);

    if (!available) {
      logger.debug({ tool: tool.name }, 'Tunnel tool not found on PATH');
      continue;
    }

    const path = getCommandPath(tool.command);

    if (!path) {
      logger.debug({ tool: tool.name }, 'Could not determine tunnel tool path');
      continue;
    }

    const version = getToolVersion(tool.command, tool.versionFlag, tool.versionPattern);

    discovered.push({
      name: tool.name,
      path,
      version,
      capabilities: tool.capabilities,
      role: 'none',
      available: true,
    });

    logger.info({ tool: tool.name, path, version }, 'Discovered tunnel tool');
  }

  return discovered;
}

/**
 * Select the master AI tool from discovered tools
 *
 * The master is the highest-priority available tool. If no tools are
 * discovered, returns null.
 */
export function selectMaster(tools: DiscoveredTool[]): DiscoveredTool | null {
  if (tools.length === 0) {
    logger.warn('No AI tools discovered — cannot select master');
    return null;
  }

  const priorityMap = new Map(KNOWN_TOOLS.map((t) => [t.name, t.priority] as const));

  const sorted = [...tools].sort((a, b) => {
    const priorityA = priorityMap.get(a.name) ?? 0;
    const priorityB = priorityMap.get(b.name) ?? 0;
    return priorityB - priorityA;
  });

  const master = sorted[0]!;
  master.role = 'master';

  for (let i = 1; i < sorted.length; i++) {
    sorted[i]!.role = 'backup';
  }

  logger.info(
    { master: master.name, backups: sorted.slice(1).map((t) => t.name) },
    'Selected master AI tool',
  );

  return master;
}
