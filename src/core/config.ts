import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { AppConfigSchema, V2ConfigSchema } from '../types/config.js';
import type { AppConfig, V2Config } from '../types/config.js';
import { createLogger } from './logger.js';

const logger = createLogger('config');

export function expandTilde(filePath: string): string {
  if (filePath === '~' || filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return homedir() + filePath.slice(1);
  }
  return filePath;
}

export function resolveConfigPath(configPath?: string): string {
  const path = configPath ?? process.env['CONFIG_PATH'] ?? './config.json';
  return resolve(path);
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

export async function loadConfig(configPath?: string): Promise<AppConfig> {
  const absolutePath = resolveConfigPath(configPath);

  logger.info({ path: absolutePath }, 'Loading configuration');

  const raw = await readFile(absolutePath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);

  if (isV2Config(parsed)) {
    logger.info('Detected V2 config format');
    const v2Config = V2ConfigSchema.parse(parsed);
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
