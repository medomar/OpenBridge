import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppConfigSchema } from '../types/config.js';
import type { AppConfig } from '../types/config.js';
import { createLogger } from './logger.js';

const logger = createLogger('config');

export function resolveConfigPath(configPath?: string): string {
  const path = configPath ?? process.env['CONFIG_PATH'] ?? './config.json';
  return resolve(path);
}

export async function loadConfig(configPath?: string): Promise<AppConfig> {
  const absolutePath = resolveConfigPath(configPath);

  logger.info({ path: absolutePath }, 'Loading configuration');

  const raw = await readFile(absolutePath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  const config = AppConfigSchema.parse(parsed);

  logger.info(
    {
      connectors: config.connectors.length,
      providers: config.providers.length,
      defaultProvider: config.defaultProvider,
    },
    'Configuration loaded successfully',
  );

  return config;
}
