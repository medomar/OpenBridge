import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { getConfigDir } from '../cli/utils.js';
import { AppConfigSchema, V2ConfigSchema } from '../types/config.js';
import type { AppConfig, V2Config } from '../types/config.js';
import { createLogger } from './logger.js';

const SUPPORTED_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

const logger = createLogger('config');

/** Path to the written MCP config file, set by writeMcpConfig(). */
let _mcpConfigPath: string | null = null;

/**
 * Returns the path to the global MCP config file written on startup, or null
 * if no MCP config was written (no mcp section in config, disabled, or no servers).
 */
export function getMcpConfigPath(): string | null {
  return _mcpConfigPath;
}

/** Claude CLI MCP config format: { mcpServers: { [name]: { command, args?, env? } } } */
type ClaudeMcpServerEntry = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

/**
 * Write global MCP config to {workspacePath}/.openbridge/mcp-config.json on Bridge startup.
 *
 * When V2Config.mcp is set and enabled:
 * - If configPath is set, reads and validates the external MCP config JSON (Claude Desktop format)
 * - If inline servers are defined, converts to Claude CLI format
 * - Merges both; inline servers override same-name imports
 * - Writes merged config to {workspacePath}/.openbridge/mcp-config.json
 *
 * @returns Path to the written config file, or null if no MCP config is needed
 */
export async function writeMcpConfig(
  v2Config: V2Config,
  workspacePath: string,
): Promise<string | null> {
  const mcpConfig = v2Config.mcp;
  if (!mcpConfig || mcpConfig.enabled === false) return null;

  const hasServers = mcpConfig.servers.length > 0;
  const hasConfigPath = Boolean(mcpConfig.configPath);

  if (!hasServers && !hasConfigPath) return null;

  const merged: Record<string, ClaudeMcpServerEntry> = {};

  // Step 1: Load from external configPath (base layer — may be overridden by inline servers)
  if (hasConfigPath) {
    const expandedPath = expandTilde(mcpConfig.configPath!);
    let raw: string;
    try {
      raw = await readFile(expandedPath, 'utf-8');
    } catch (err) {
      throw new Error(
        `MCP configPath "${mcpConfig.configPath}" not found or unreadable: ${(err as Error).message}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `MCP configPath "${mcpConfig.configPath}" is not valid JSON: ${(err as Error).message}`,
      );
    }

    // Support Claude Desktop format { mcpServers: {...} } or direct { [name]: {...} } object
    const externalConfig = parsed as Record<string, unknown>;
    const externalServers =
      typeof externalConfig['mcpServers'] === 'object' && externalConfig['mcpServers'] !== null
        ? (externalConfig['mcpServers'] as Record<string, unknown>)
        : externalConfig;

    for (const [name, serverConfig] of Object.entries(externalServers)) {
      if (
        typeof serverConfig === 'object' &&
        serverConfig !== null &&
        'command' in serverConfig &&
        typeof (serverConfig as Record<string, unknown>)['command'] === 'string'
      ) {
        merged[name] = serverConfig as ClaudeMcpServerEntry;
      }
    }

    logger.info(
      { configPath: mcpConfig.configPath, count: Object.keys(merged).length },
      'MCP: loaded servers from configPath',
    );
  }

  // Step 2: Apply inline servers (override same-name imports)
  if (hasServers) {
    for (const server of mcpConfig.servers) {
      const entry: ClaudeMcpServerEntry = { command: server.command };
      if (server.args && server.args.length > 0) entry.args = server.args;
      if (server.env && Object.keys(server.env).length > 0) entry.env = server.env;
      merged[server.name] = entry;
    }
    logger.info({ count: mcpConfig.servers.length }, 'MCP: applied inline servers');
  }

  if (Object.keys(merged).length === 0) return null;

  // Step 3: Write to .openbridge/mcp-config.json
  const dotFolderPath = join(workspacePath, '.openbridge');
  await mkdir(dotFolderPath, { recursive: true });
  const outputPath = join(dotFolderPath, 'mcp-config.json');
  await writeFile(outputPath, JSON.stringify({ mcpServers: merged }, null, 2), 'utf-8');

  _mcpConfigPath = outputPath;
  logger.info({ path: outputPath, servers: Object.keys(merged) }, 'MCP config written');

  return outputPath;
}

export function expandTilde(filePath: string): string {
  if (filePath === '~' || filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return homedir() + filePath.slice(1);
  }
  return filePath;
}

export function resolveConfigPath(configPath?: string): string {
  if (configPath) {
    return resolve(configPath);
  }
  if (process.env['CONFIG_PATH']) {
    return resolve(process.env['CONFIG_PATH']);
  }
  // In packaged mode (pkg binary), getConfigDir() returns ~/.openbridge/
  // In dev mode, getConfigDir() returns process.cwd()
  return join(getConfigDir(), 'config.json');
}

export function isV2Config(parsed: unknown): parsed is V2Config {
  const result = V2ConfigSchema.safeParse(parsed);
  return result.success;
}

export function convertV2ToInternal(v2Config: V2Config): AppConfig {
  return {
    connectors: v2Config.channels.map((channel) => ({
      type: channel.type,
      enabled: channel.enabled,
      options: channel.options ?? {},
    })),
    providers: [
      {
        type: 'auto-discovered',
        enabled: true,
        options: {},
      },
    ],
    defaultProvider: 'auto-discovered',
    workspaces: [
      {
        name: 'default',
        path: expandTilde(v2Config.workspacePath),
      },
    ],
    defaultWorkspace: 'default',
    auth: {
      whitelist: v2Config.auth.whitelist,
      prefix: v2Config.auth.prefix,
      rateLimit: v2Config.auth.rateLimit ?? {
        enabled: true,
        maxMessages: 10,
        windowMs: 60_000,
      },
      commandFilter: v2Config.auth.commandFilter ?? {
        allowPatterns: [],
        denyPatterns: [],
        denyMessage: 'That command is not allowed.',
      },
    },
    queue: v2Config.queue ?? {
      maxRetries: 3,
      retryDelayMs: 1_000,
    },
    router: v2Config.router ?? {
      progressIntervalMs: 15_000,
    },
    audit: v2Config.audit ?? {
      enabled: false,
      logPath: 'audit.log',
    },
    health: v2Config.health ?? {
      enabled: false,
      port: 8080,
    },
    metrics: v2Config.metrics ?? {
      enabled: false,
      port: 9090,
    },
    logLevel: v2Config.logLevel ?? 'info',
  };
}

/**
 * In non-production environments, automatically add the WebChat connector if
 * not already configured. Also adds 'webchat-user' to the auth whitelist so
 * local connector senders (webchat-user, console-user) can authenticate.
 *
 * Call this after loadConfig() in startup flows.
 */
export function injectDevConnectors(config: AppConfig): void {
  if (process.env['NODE_ENV'] === 'production') return;

  const hasWebChat = config.connectors.some((c) => c.type === 'webchat');
  if (hasWebChat) return;

  config.connectors.push({ type: 'webchat', enabled: true, options: {} });

  // Allow non-numeric senders (webchat-user, console-user) through auth.
  // normalizeNumber() strips non-digits → 'webchat-user' → ''. Adding any
  // non-numeric entry to the whitelist puts '' in the normalized set, which
  // authorises all local-connector senders in dev mode.
  if (!config.auth.whitelist.includes('webchat-user')) {
    config.auth.whitelist.push('webchat-user');
  }

  logger.info('Dev mode: WebChat connector auto-injected (localhost:3000)');
}

/**
 * Apply environment variable overrides to a parsed V2Config.
 * ENV vars take precedence over values in config.json.
 *
 * Supported variables:
 *   OPENBRIDGE_WORKSPACE_PATH  — overrides workspacePath
 *   OPENBRIDGE_CHANNELS        — JSON array string, overrides channels
 *   OPENBRIDGE_AUTH_WHITELIST  — comma-separated phone numbers, overrides auth.whitelist
 *   OPENBRIDGE_AUTH_PREFIX     — overrides auth.prefix
 *   OPENBRIDGE_LOG_LEVEL       — overrides logLevel
 */
export function applyEnvOverrides(v2Config: V2Config): V2Config {
  const overridden: V2Config = { ...v2Config, auth: { ...v2Config.auth } };

  if (process.env['OPENBRIDGE_WORKSPACE_PATH']) {
    overridden.workspacePath = process.env['OPENBRIDGE_WORKSPACE_PATH'];
  }

  if (process.env['OPENBRIDGE_CHANNELS']) {
    try {
      overridden.channels = JSON.parse(process.env['OPENBRIDGE_CHANNELS']) as V2Config['channels'];
    } catch {
      throw new Error(
        'OPENBRIDGE_CHANNELS must be a valid JSON array, e.g.: \'[{"type":"console","enabled":true}]\'',
      );
    }
  }

  if (process.env['OPENBRIDGE_AUTH_WHITELIST']) {
    overridden.auth.whitelist = process.env['OPENBRIDGE_AUTH_WHITELIST']
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (process.env['OPENBRIDGE_AUTH_PREFIX']) {
    overridden.auth.prefix = process.env['OPENBRIDGE_AUTH_PREFIX'];
  }

  if (process.env['OPENBRIDGE_LOG_LEVEL']) {
    const level = process.env['OPENBRIDGE_LOG_LEVEL'];
    if (!SUPPORTED_LOG_LEVELS.includes(level as (typeof SUPPORTED_LOG_LEVELS)[number])) {
      throw new Error(
        `OPENBRIDGE_LOG_LEVEL must be one of: ${SUPPORTED_LOG_LEVELS.join(', ')}. Got: "${level}"`,
      );
    }
    overridden.logLevel = level as V2Config['logLevel'];
  }

  return overridden;
}

/**
 * Build a complete V2Config from environment variables alone (no config.json required).
 * Throws a descriptive error if required variables are missing.
 */
export function buildV2ConfigFromEnv(): V2Config {
  const workspacePath = process.env['OPENBRIDGE_WORKSPACE_PATH'];
  const whitelistRaw = process.env['OPENBRIDGE_AUTH_WHITELIST'];

  const missing: string[] = [];
  if (!workspacePath) missing.push('OPENBRIDGE_WORKSPACE_PATH');
  if (!whitelistRaw) missing.push('OPENBRIDGE_AUTH_WHITELIST');

  if (missing.length > 0) {
    throw new Error(
      `No config.json found and required environment variables are not set: ${missing.join(', ')}.\n` +
        'Either create a config.json (run "npx openbridge init") or set:\n' +
        '  OPENBRIDGE_WORKSPACE_PATH=/absolute/path/to/your/project\n' +
        '  OPENBRIDGE_AUTH_WHITELIST=+1234567890,+0987654321\n' +
        '  OPENBRIDGE_CHANNELS=\'[{"type":"console","enabled":true}]\'  # optional, defaults to console\n' +
        '  OPENBRIDGE_AUTH_PREFIX=/ai   # optional\n' +
        '  OPENBRIDGE_LOG_LEVEL=info    # optional',
    );
  }

  let channels: V2Config['channels'];
  const channelsRaw = process.env['OPENBRIDGE_CHANNELS'];
  if (channelsRaw) {
    try {
      channels = JSON.parse(channelsRaw) as V2Config['channels'];
    } catch {
      throw new Error(
        'OPENBRIDGE_CHANNELS must be a valid JSON array, e.g.: \'[{"type":"console","enabled":true}]\'',
      );
    }
  } else {
    channels = [{ type: 'console', enabled: true }];
  }

  const whitelist = (whitelistRaw as string)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const result: Record<string, unknown> = {
    workspacePath,
    channels,
    auth: {
      whitelist,
      prefix: process.env['OPENBRIDGE_AUTH_PREFIX'] ?? '/ai',
    },
  };

  if (process.env['OPENBRIDGE_LOG_LEVEL']) {
    const level = process.env['OPENBRIDGE_LOG_LEVEL'];
    if (!SUPPORTED_LOG_LEVELS.includes(level as (typeof SUPPORTED_LOG_LEVELS)[number])) {
      throw new Error(
        `OPENBRIDGE_LOG_LEVEL must be one of: ${SUPPORTED_LOG_LEVELS.join(', ')}. Got: "${level}"`,
      );
    }
    result['logLevel'] = level;
  }

  return V2ConfigSchema.parse(result);
}

export async function loadConfig(configPath?: string): Promise<AppConfig> {
  const absolutePath = resolveConfigPath(configPath);

  logger.info({ path: absolutePath }, 'Loading configuration');

  let raw: string;
  try {
    raw = await readFile(absolutePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.info('No config.json found — loading configuration from environment variables');
      const v2Config = buildV2ConfigFromEnv();
      const internalConfig = convertV2ToInternal(v2Config);
      logger.info(
        {
          workspacePath: v2Config.workspacePath,
          channels: v2Config.channels.length,
          whitelist: v2Config.auth.whitelist.length,
          source: 'env',
        },
        'Configuration loaded from environment variables',
      );
      return internalConfig;
    }
    throw err;
  }

  const parsed: unknown = JSON.parse(raw);

  if (isV2Config(parsed)) {
    logger.info('Detected V2 config format');
    let v2Config = V2ConfigSchema.parse(parsed);
    v2Config = applyEnvOverrides(v2Config);
    const internalConfig = convertV2ToInternal(v2Config);

    logger.info(
      {
        workspacePath: v2Config.workspacePath,
        channels: v2Config.channels.length,
        whitelist: v2Config.auth.whitelist.length,
      },
      'V2 configuration loaded successfully',
    );

    return internalConfig;
  }

  logger.info('Detected V0 config format');
  const config = AppConfigSchema.parse(parsed);

  logger.info(
    {
      connectors: config.connectors.length,
      providers: config.providers.length,
      defaultProvider: config.defaultProvider,
    },
    'V0 configuration loaded successfully',
  );

  return config;
}
