import { createLogger } from '../../core/logger.js';

const logger = createLogger('codex-session-manager');

interface CodexSessionEntry {
  lastUsed: number;
  /** Explicit session ID extracted from Codex output, if available. */
  sessionId?: string;
}

export interface CodexSessionState {
  /** True if this is the first message in the session window. */
  isNew: boolean;
  /**
   * Explicit session ID returned by Codex in a prior invocation.
   * Undefined for new sessions or when Codex did not expose a session ID.
   * When set, the adapter prefers this over `codex exec resume --last`.
   */
  sessionId?: string;
}

/**
 * Manages Codex session state for multi-turn conversations.
 *
 * Codex v0.104.0 supports session resumption via `codex exec resume --last`.
 * Unlike Claude (which uses named `--session-id` UUIDs), Codex tracks sessions
 * internally and exposes resumption via `--last` (resume latest) or an explicit
 * session ID emitted in its output.
 *
 * Lifecycle per key (sender:workspacePath):
 *   - First message (`isNew: true`):  adapter uses `--ephemeral` — clean slate.
 *   - Follow-up (`isNew: false`):     adapter uses `codex exec resume --last`
 *                                     (or explicit session ID if stored).
 *   - Session expires (TTL elapsed):  next call returns `isNew: true` again.
 */
export class CodexSessionManager {
  private readonly sessions = new Map<string, CodexSessionEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  /**
   * Get or create a Codex session for a given key (e.g., `sender:workspacePath`).
   *
   * Returns `{ isNew, sessionId? }`:
   *   - `isNew: true`  → start a new session window; provider passes `--ephemeral`.
   *   - `isNew: false` → active session exists; provider uses resume mechanism.
   *   - `sessionId`    → if Codex previously returned an explicit session ID, it is
   *                       included so the adapter can use it for precise resumption.
   */
  getOrCreate(key: string): CodexSessionState {
    const existing = this.sessions.get(key);
    const now = Date.now();

    if (existing && now - existing.lastUsed < this.ttlMs) {
      existing.lastUsed = now;
      logger.debug({ key, sessionId: existing.sessionId }, 'Resuming Codex session');
      return { isNew: false, sessionId: existing.sessionId };
    }

    if (existing) {
      logger.info({ key }, 'Codex session expired, starting new session');
    }

    this.sessions.set(key, { lastUsed: now });
    logger.info({ key }, 'New Codex session started');
    return { isNew: true };
  }

  /**
   * Store an explicit session ID returned by Codex output for the given key.
   * Enables precise resumption (`--session-id <id>`) over the `--last` fallback.
   */
  updateSessionId(key: string, sessionId: string): void {
    const entry = this.sessions.get(key);
    if (entry) {
      entry.sessionId = sessionId;
      logger.debug({ key, sessionId }, 'Updated Codex session ID');
    }
  }

  /** Remove a session (e.g., on explicit user reset or error). */
  clear(key: string): void {
    this.sessions.delete(key);
    logger.debug({ key }, 'Codex session cleared');
  }

  /** Remove all active sessions. */
  clearAll(): void {
    this.sessions.clear();
  }

  /** Evict sessions that have exceeded the TTL. Returns the number evicted. */
  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.sessions) {
      if (now - entry.lastUsed >= this.ttlMs) {
        this.sessions.delete(key);
        evicted++;
        logger.debug({ key }, 'Codex session evicted');
      }
    }
    return evicted;
  }

  get size(): number {
    return this.sessions.size;
  }
}
