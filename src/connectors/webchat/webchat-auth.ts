import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
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

/** bcrypt cost factor for password hashing */
const BCRYPT_ROUNDS = 10;

/**
 * Hash a plain-text password with bcrypt.
 *
 * @param password - The plain-text password to hash.
 * @returns A bcrypt hash string.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a submitted plain-text password against a stored bcrypt hash.
 *
 * @param submitted - The password submitted by the user.
 * @param hash      - The bcrypt hash stored on disk.
 * @returns `true` if the password matches, `false` otherwise.
 */
export async function verifyPassword(submitted: string, hash: string): Promise<boolean> {
  return bcrypt.compare(submitted, hash);
}
