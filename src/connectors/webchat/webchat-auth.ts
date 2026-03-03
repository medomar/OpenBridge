import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../../core/logger.js';

const logger = createLogger('webchat-auth');

/**
 * Reads the existing WebChat auth token from disk, or generates and persists a new one.
 *
 * Token is stored at <baseDir>/.openbridge/webchat-token (64-char hex string).
 * File permissions are set to 0o600 (owner read/write only).
 *
 * @param baseDir - Directory under which `.openbridge/webchat-token` is stored.
 *                  Defaults to `process.cwd()` if not provided.
 */
export function getOrCreateAuthToken(baseDir: string = process.cwd()): string {
  const tokenDir = join(baseDir, '.openbridge');
  const tokenPath = join(tokenDir, 'webchat-token');

  if (existsSync(tokenPath)) {
    const existing = readFileSync(tokenPath, 'utf8').trim();
    if (existing.length > 0) {
      logger.debug({ tokenPath }, 'Loaded existing WebChat auth token');
      return existing;
    }
  }

  const token = randomBytes(32).toString('hex');
  mkdirSync(tokenDir, { recursive: true });
  writeFileSync(tokenPath, token, { mode: 0o600, encoding: 'utf8' });
  logger.info({ tokenPath }, 'Generated new WebChat auth token');
  return token;
}
