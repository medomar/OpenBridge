/**
 * Permission Relay Protocol
 *
 * Routes tool approval requests from the Claude Agent SDK's `canUseTool`
 * callback through messaging channels (WebChat, WhatsApp, Telegram, Discord).
 *
 * When a worker tries to use a tool not in its pre-approved list, this module:
 * 1. Formats a user-friendly permission prompt
 * 2. Sends it through the appropriate connector
 * 3. Awaits the user's YES/NO response (with configurable timeout)
 * 4. Returns the approval decision to the SDK
 *
 * @see OB-F183, OB-1498
 */

import type { Connector } from '../types/connector.js';
import { createLogger } from './logger.js';

const logger = createLogger('permission-relay');

/** Default timeout for permission requests (60 seconds). */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Pattern to match affirmative responses. */
const YES_PATTERN = /^(yes|y|allow|approve|ok|go)$/i;

/** Pattern to match negative responses. */
const NO_PATTERN = /^(no|n|deny|reject|cancel|stop)$/i;

/**
 * Parameters for a permission relay request.
 */
export interface PermissionRelayParams {
  /** The tool name (e.g. "Bash", "Write", "Edit") */
  toolName: string;
  /** The tool input (e.g. { command: "rm -rf ./old-data/" }) */
  input: Record<string, unknown>;
  /** The user ID (sender) to relay the prompt to */
  userId: string;
  /** The channel/connector name (e.g. "webchat", "whatsapp") */
  channel: string;
}

/**
 * A pending permission request awaiting user response.
 */
export interface PendingPermission {
  /** Resolve the promise with the user's decision */
  resolve: (approved: boolean) => void;
  /** Timeout handle for auto-deny */
  timeout: ReturnType<typeof setTimeout>;
  /** Tool name for logging */
  toolName: string;
  /** Timestamp when the request was created */
  createdAt: number;
}

/**
 * Configuration for the PermissionRelay.
 */
export interface PermissionRelayConfig {
  /** Timeout in milliseconds before auto-denying (default: 60000) */
  timeoutMs?: number;
}

/**
 * Formats a user-friendly permission prompt message.
 */
export function formatPermissionPrompt(toolName: string, input: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`🔐 *Permission Request*`);
  lines.push('');

  // Extract the most relevant detail from the input
  const command = typeof input['command'] === 'string' ? input['command'] : undefined;
  const filePath = typeof input['file_path'] === 'string' ? input['file_path'] : undefined;
  const content = typeof input['content'] === 'string' ? input['content'] : undefined;

  if (command) {
    lines.push(`The AI wants to run: \`${truncate(command, 200)}\``);
  } else if (filePath) {
    const verb = toolName === 'Write' ? 'write to' : toolName === 'Edit' ? 'edit' : 'access';
    lines.push(`The AI wants to ${verb}: \`${filePath}\``);
    if (content && toolName === 'Write') {
      lines.push(`(${content.length} characters)`);
    }
  } else {
    lines.push(`The AI wants to use tool: *${toolName}*`);
    // Show a compact summary of the input
    const summary = Object.entries(input)
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${truncate(String(v), 80)}`)
      .join(', ');
    if (summary) {
      lines.push(`Input: ${summary}`);
    }
  }

  lines.push('');
  lines.push('Reply *YES* to allow or *NO* to deny.');

  return lines.join('\n');
}

/**
 * Checks whether a user reply is a permission response (YES/NO).
 */
export function isPermissionResponse(text: string): boolean {
  const trimmed = text.trim();
  return YES_PATTERN.test(trimmed) || NO_PATTERN.test(trimmed);
}

/**
 * Parses a user reply into an approval decision.
 * Returns `true` for approval, `false` for denial, `undefined` if not a valid response.
 */
export function parsePermissionResponse(text: string): boolean | undefined {
  const trimmed = text.trim();
  if (YES_PATTERN.test(trimmed)) return true;
  if (NO_PATTERN.test(trimmed)) return false;
  return undefined;
}

/**
 * Permission Relay — manages pending permission requests and routes them
 * through messaging connectors.
 */
export class PermissionRelay {
  /** Pending permission requests keyed by userId. */
  private readonly pending = new Map<string, PendingPermission>();
  private readonly timeoutMs: number;
  private readonly connectors: () => Map<string, Connector>;

  constructor(getConnectors: () => Map<string, Connector>, config?: PermissionRelayConfig) {
    this.connectors = getConnectors;
    this.timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Relay a permission request to the user and await their response.
   *
   * Returns `true` if the user approves, `false` if denied or timed out.
   */
  async relayPermission(params: PermissionRelayParams): Promise<boolean> {
    const { toolName, input, userId, channel } = params;

    // If there's already a pending permission for this user, auto-deny the new one
    // to prevent confusion from overlapping prompts
    if (this.pending.has(userId)) {
      logger.warn(
        { userId, toolName },
        'Permission request already pending for user — auto-denying new request',
      );
      return false;
    }

    const connector = this.connectors().get(channel);
    if (!connector) {
      logger.error({ channel, userId }, 'No connector found for channel — auto-denying');
      return false;
    }

    // Format and send the permission prompt
    const promptText = formatPermissionPrompt(toolName, input);

    // Extract the most relevant detail for structured UI display
    const command = typeof input['command'] === 'string' ? input['command'] : undefined;
    const filePath = typeof input['file_path'] === 'string' ? input['file_path'] : undefined;
    const detail = command ?? filePath ?? '';

    try {
      await connector.sendMessage({
        target: channel,
        recipient: userId,
        content: promptText,
        metadata: {
          permissionRequest: true,
          toolName,
          detail: truncate(detail, 200),
          timeoutMs: this.timeoutMs,
        },
      });
    } catch (err) {
      logger.error({ err, channel, userId }, 'Failed to send permission prompt — auto-denying');
      return false;
    }

    logger.info({ toolName, userId, channel, timeoutMs: this.timeoutMs }, 'Permission prompt sent');

    // Create a promise that resolves when the user responds or times out
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        // Auto-deny on timeout
        this.pending.delete(userId);
        logger.info({ toolName, userId }, 'Permission request timed out — auto-denying');

        // Notify the user
        connector
          .sendMessage({
            target: channel,
            recipient: userId,
            content: `⏱️ Permission request for *${toolName}* timed out — automatically denied.`,
          })
          .catch((err: unknown) => {
            logger.error({ err }, 'Failed to send timeout notification');
          });

        resolve(false);
      }, this.timeoutMs);

      this.pending.set(userId, {
        resolve,
        timeout,
        toolName,
        createdAt: Date.now(),
      });
    });
  }

  /**
   * Handle a user's response to a pending permission request.
   *
   * Called by the router when it detects a YES/NO reply from a user
   * with a pending permission request.
   *
   * Returns `true` if the response was consumed (was a pending permission reply),
   * `false` if there was no pending request for this user.
   */
  handleResponse(userId: string, text: string): boolean {
    const entry = this.pending.get(userId);
    if (!entry) return false;

    const decision = parsePermissionResponse(text);
    if (decision === undefined) {
      // Not a valid YES/NO response — don't consume it
      return false;
    }

    // Clear the timeout and pending entry
    clearTimeout(entry.timeout);
    this.pending.delete(userId);

    logger.info(
      { userId, toolName: entry.toolName, approved: decision },
      'Permission response received',
    );

    entry.resolve(decision);
    return true;
  }

  /**
   * Check whether a user has a pending permission request.
   */
  hasPending(userId: string): boolean {
    return this.pending.has(userId);
  }

  /**
   * Cancel all pending permission requests (e.g. on shutdown).
   */
  cancelAll(): void {
    this.pending.forEach((entry, userId) => {
      clearTimeout(entry.timeout);
      entry.resolve(false);
      logger.info({ userId, toolName: entry.toolName }, 'Permission request cancelled');
    });
    this.pending.clear();
  }

  /**
   * Get the number of pending permission requests.
   */
  get pendingCount(): number {
    return this.pending.size;
  }
}

/**
 * Truncate a string to a maximum length, adding ellipsis if truncated.
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}
