import type Database from 'better-sqlite3';
import type { AuthConfig, CommandFilterConfig } from '../types/config.js';
import {
  getAccess,
  resetDailyCosts,
  incrementDailyCost as storeIncrementDailyCost,
} from '../memory/access-store.js';
import { createLogger } from './logger.js';

const logger = createLogger('auth');

export interface CommandFilterResult {
  allowed: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Role-based default allowed actions
// null = no restriction (all actions allowed)
// ---------------------------------------------------------------------------

const ROLE_ALLOWED_ACTIONS: Record<string, string[] | null> = {
  owner: null,
  admin: null,
  developer: ['read', 'edit', 'test'],
  viewer: ['read'],
  custom: null, // governed by entry.allowed_actions
};

// Keywords used to classify a message into an action category.
// Order matters — stop > deploy > edit > test > read (most → least restrictive).
const STOP_RE = /\bstop\b/i;
const DEPLOY_RE = /\b(deploy|release|publish|push to|ship|launch|stage)\b/i;
const EDIT_RE =
  /\b(edit|modify|change|update|fix|refactor|add|create|write|implement|delete|remove|replace|rename|install|uninstall)\b/i;
const TEST_RE = /\b(test|run|execute|build|compile|lint)\b/i;

function classifyMessageAction(content: string): string {
  if (STOP_RE.test(content)) return 'stop';
  if (DEPLOY_RE.test(content)) return 'deploy';
  if (EDIT_RE.test(content)) return 'edit';
  if (TEST_RE.test(content)) return 'test';
  return 'read';
}

export class AuthService {
  private whitelist: Set<string>;
  private prefix: string;
  private allowPatterns: RegExp[];
  private denyPatterns: RegExp[];
  private denyMessage: string;
  private db: Database.Database | null = null;
  private defaultRole: string;
  private channelRoles: Record<string, string>;

  /**
   * Normalize a phone number to digits-only for comparison.
   * Handles: "+33629539495", "33629539495@c.us", "33629539495"
   */
  /**
   * Normalize any sender identifier — phone numbers get digit-only treatment,
   * non-numeric identifiers (webchat-user, console-user, usernames) are lowercased as-is.
   */
  private static normalizeId(input: string): string {
    const withoutSuffix = input.replace(/@c\.us$/, '');
    const withoutPrefix = withoutSuffix.replace(/^\+/, '');
    // If it's all digits, treat as phone number
    if (/^\d+$/.test(withoutPrefix)) {
      return withoutPrefix;
    }
    // Non-numeric identifier — keep as-is (lowercased)
    return input.toLowerCase();
  }

  /**
   * Build whitelist with per-entry diagnostics.
   * Returns the normalized Set and a list of dropped entries with reasons.
   */
  private static buildWhitelistDetailed(numbers: string[]): {
    whitelist: Set<string>;
    dropped: Array<{ entry: string; reason: string }>;
  } {
    const whitelist = new Set<string>();
    const dropped: Array<{ entry: string; reason: string }> = [];

    for (const n of numbers) {
      const trimmed = n.trim();
      if (!trimmed) {
        dropped.push({ entry: n, reason: 'empty entry' });
        continue;
      }

      const normalized = AuthService.normalizeId(trimmed);
      if (whitelist.has(normalized)) {
        dropped.push({ entry: n, reason: 'duplicate' });
        continue;
      }

      whitelist.add(normalized);
    }

    return { whitelist, dropped };
  }

  private static buildWhitelist(numbers: string[]): Set<string> {
    return AuthService.buildWhitelistDetailed(numbers).whitelist;
  }

  constructor(config: AuthConfig) {
    const detailed = AuthService.buildWhitelistDetailed(config.whitelist);
    this.whitelist = detailed.whitelist;
    this.prefix = config.prefix;
    this.defaultRole = config.defaultRole ?? 'owner';
    this.channelRoles = config.channelRoles ?? {};

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
        rawEntries: config.whitelist.length,
        droppedEntries: detailed.dropped.length,
        prefix: this.prefix,
        allowPatterns: filter.allowPatterns.length,
        denyPatterns: filter.denyPatterns.length,
      },
      'Auth service initialized',
    );

    for (const { entry, reason } of detailed.dropped) {
      if (reason === 'duplicate') {
        logger.warn({ entry }, `Duplicate whitelist entry ignored: ${entry}`);
      } else {
        logger.warn({ entry, reason }, `Dropped whitelist entry '${entry}': ${reason}`);
      }
    }

    if (this.whitelist.size === 0) {
      logger.warn(
        'Auth whitelist is empty — ALL senders are authorized. To restrict access, add phone numbers to auth.whitelist in config.json.',
      );
    }
  }

  /** Attach a SQLite database for access_control enforcement. */
  setDatabase(db: Database.Database): void {
    this.db = db;
    logger.info('AuthService: access_control database attached');
  }

  /** Check if a sender is allowed to use the bridge */
  isAuthorized(sender: string): boolean {
    if (this.whitelist.size === 0) {
      return true; // No whitelist = open access
    }
    return this.whitelist.has(AuthService.normalizeId(sender));
  }

  /**
   * Check access control for a whitelisted user.
   *
   * Enforces three rules (in order):
   *  1. Entry must be active.
   *  2. Daily cost budget must not be exceeded.
   *  3. The classified action must be allowed for the user's role (or custom list).
   *  4. If scopes are set and the message contains explicit file paths, those paths
   *     must fall within at least one allowed scope.
   *
   * When no DB is attached or no entry exists, defaults to 'owner' (backward-compatible).
   * Before checking the budget, stale daily-cost resets are applied automatically.
   */
  checkAccessControl(
    userId: string,
    channel: string,
    messageContent?: string,
  ): CommandFilterResult {
    if (!this.db) return { allowed: true };

    // Run any pending midnight resets before checking the budget.
    try {
      resetDailyCosts(this.db);
    } catch (err) {
      logger.warn({ err }, 'AuthService: resetDailyCosts failed — skipping');
    }

    let entry;
    try {
      entry = getAccess(this.db, userId, channel);
    } catch (err) {
      logger.warn({ err, userId, channel }, 'AuthService: getAccess failed — defaulting to allow');
      return { allowed: true };
    }

    // No entry → default to owner (backward-compatible with pre-ACL whitelist behaviour).
    if (!entry) return { allowed: true };

    // 1. Active check
    if (!entry.active) {
      logger.warn({ userId, channel }, 'Access denied — account inactive');
      return { allowed: false, reason: 'Your access has been revoked.' };
    }

    // 2. Daily budget check
    if (entry.max_cost_per_day_usd != null && entry.daily_cost_used != null) {
      if (entry.daily_cost_used >= entry.max_cost_per_day_usd) {
        logger.warn(
          {
            userId,
            channel,
            used: entry.daily_cost_used,
            limit: entry.max_cost_per_day_usd,
          },
          'Access denied — daily cost limit exceeded',
        );
        return {
          allowed: false,
          reason: `Daily usage limit ($${entry.max_cost_per_day_usd.toFixed(2)}) reached. Try again tomorrow.`,
        };
      }
    }

    // 3. Action check (only when message content is available)
    if (messageContent) {
      const action = classifyMessageAction(messageContent);

      // blocked_actions always take precedence (explicit deny list)
      if (entry.blocked_actions && entry.blocked_actions.includes(action)) {
        logger.warn({ userId, channel, action }, 'Access denied — action in blocked list');
        return { allowed: false, reason: 'That action is not permitted for your role.' };
      }

      // Determine the effective allowed-action set:
      //  • If the entry has an explicit allowed_actions list, use that.
      //  • Otherwise fall back to the role default.
      //  • null means "no restriction" (owner / admin).
      const effectiveAllowed =
        entry.allowed_actions && entry.allowed_actions.length > 0
          ? entry.allowed_actions
          : (ROLE_ALLOWED_ACTIONS[entry.role] ?? null);

      if (effectiveAllowed !== null && !effectiveAllowed.includes(action)) {
        logger.warn(
          { userId, channel, role: entry.role, action, effectiveAllowed },
          'Access denied — action not in allowed list for role',
        );
        return { allowed: false, reason: 'That action is not permitted for your role.' };
      }

      // 4. Scope check — only enforced when explicit file paths appear in the message.
      if (entry.scopes && entry.scopes.length > 0) {
        // A simple heuristic: paths contain a '/' and end with a known extension.
        const FILE_PATH_RE = /(?:^|\s)((?:\.{0,2}\/)?[\w./\\-]+\.[\w]{1,6})(?:\s|$)/g;
        let match: RegExpExecArray | null;
        const detectedPaths: string[] = [];
        while ((match = FILE_PATH_RE.exec(messageContent)) !== null) {
          if (match[1]) detectedPaths.push(match[1]);
        }

        if (detectedPaths.length > 0) {
          const outOfScope = detectedPaths.filter(
            (fp) => !entry.scopes!.some((scope) => fp.startsWith(scope)),
          );
          if (outOfScope.length > 0) {
            logger.warn(
              { userId, channel, outOfScope, scopes: entry.scopes },
              'Access denied — file path outside allowed scopes',
            );
            return {
              allowed: false,
              reason: 'One or more referenced file paths are outside your allowed scope.',
            };
          }
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Increment daily_cost_used for the given user+channel.
   * No-op when no DB is attached or no entry exists for the pair.
   */
  incrementDailyCost(userId: string, channel: string, costUsd: number): void {
    if (!this.db || costUsd <= 0) return;
    try {
      storeIncrementDailyCost(this.db, userId, channel, costUsd);
    } catch (err) {
      logger.warn({ err, userId, channel, costUsd }, 'AuthService: incrementDailyCost failed');
    }
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

  /** Hot-reload auth config without restarting */
  updateConfig(config: AuthConfig): void {
    const detailed = AuthService.buildWhitelistDetailed(config.whitelist);
    this.whitelist = detailed.whitelist;
    this.prefix = config.prefix;
    this.defaultRole = config.defaultRole ?? 'owner';
    this.channelRoles = config.channelRoles ?? {};

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
        droppedEntries: detailed.dropped.length,
        prefix: this.prefix,
        allowPatterns: filter.allowPatterns.length,
        denyPatterns: filter.denyPatterns.length,
      },
      'Auth service config reloaded',
    );

    for (const { entry, reason } of detailed.dropped) {
      if (reason === 'duplicate') {
        logger.warn({ entry }, `Duplicate whitelist entry ignored: ${entry}`);
      } else {
        logger.warn({ entry, reason }, `Dropped whitelist entry '${entry}': ${reason}`);
      }
    }
  }

  /**
   * Returns the role to assign for a given channel when auto-creating an access_control entry.
   * Checks channelRoles[channel] first, then falls back to defaultRole.
   */
  getRoleForChannel(channel: string): string {
    return this.channelRoles[channel] ?? this.defaultRole;
  }

  get commandPrefix(): string {
    return this.prefix;
  }
}
