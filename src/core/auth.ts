import type { AuthConfig, CommandFilterConfig } from '../types/config.js';
import { createLogger } from './logger.js';

const logger = createLogger('auth');

export interface CommandFilterResult {
  allowed: boolean;
  reason?: string;
}

export class AuthService {
  private readonly whitelist: Set<string>;
  private readonly prefix: string;
  private readonly allowPatterns: RegExp[];
  private readonly denyPatterns: RegExp[];
  private readonly denyMessage: string;

  constructor(config: AuthConfig) {
    this.whitelist = new Set(config.whitelist);
    this.prefix = config.prefix;

    const filter: CommandFilterConfig = config.commandFilter ?? {
      allowPatterns: [],
      denyPatterns: [],
      denyMessage: 'That command is not allowed.',
    };

    this.allowPatterns = filter.allowPatterns.map((p) => new RegExp(p, 'i'));
    this.denyPatterns = filter.denyPatterns.map((p) => new RegExp(p, 'i'));
    this.denyMessage = filter.denyMessage;

    logger.info(
      {
        whitelistedNumbers: this.whitelist.size,
        prefix: this.prefix,
        allowPatterns: filter.allowPatterns.length,
        denyPatterns: filter.denyPatterns.length,
      },
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

  /** Check if a command (after prefix stripping) passes the allow/deny filter */
  filterCommand(command: string): CommandFilterResult {
    // If deny patterns are configured, check them first (deny takes priority)
    for (const pattern of this.denyPatterns) {
      if (pattern.test(command)) {
        logger.warn({ command, pattern: pattern.source }, 'Command blocked by deny pattern');
        return { allowed: false, reason: this.denyMessage };
      }
    }

    // If allow patterns are configured, command must match at least one
    if (this.allowPatterns.length > 0) {
      const matches = this.allowPatterns.some((pattern) => pattern.test(command));
      if (!matches) {
        logger.warn({ command }, 'Command blocked — does not match any allow pattern');
        return { allowed: false, reason: this.denyMessage };
      }
    }

    return { allowed: true };
  }

  get commandPrefix(): string {
    return this.prefix;
  }
}
