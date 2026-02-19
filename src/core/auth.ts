import type { AuthConfig } from '../types/config.js';
import { createLogger } from './logger.js';

const logger = createLogger('auth');

export class AuthService {
  private readonly whitelist: Set<string>;
  private readonly prefix: string;

  constructor(config: AuthConfig) {
    this.whitelist = new Set(config.whitelist);
    this.prefix = config.prefix;
    logger.info(
      { whitelistedNumbers: this.whitelist.size, prefix: this.prefix },
      'Auth service initialized',
    );
  }

  /** Check if a sender is allowed to use the bridge */
  isAuthorized(sender: string): boolean {
    if (this.whitelist.size === 0) {
      return true; // No whitelist = open access
    }
    return this.whitelist.has(sender);
  }

  /** Check if a message starts with the configured prefix */
  hasPrefix(content: string): boolean {
    return content.trimStart().startsWith(this.prefix);
  }

  /** Strip the prefix from a message and return the cleaned content */
  stripPrefix(content: string): string {
    const trimmed = content.trimStart();
    if (!trimmed.startsWith(this.prefix)) {
      return trimmed;
    }
    return trimmed.slice(this.prefix.length).trimStart();
  }

  get commandPrefix(): string {
    return this.prefix;
  }
}
