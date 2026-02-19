import { randomUUID } from 'node:crypto';
import { createLogger } from '../../core/logger.js';

const logger = createLogger('session-manager');

interface SessionEntry {
  sessionId: string;
  lastUsed: number;
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  /**
   * Get or create a session ID for a given sender.
   * Returns { sessionId, isNew } where isNew indicates a fresh session.
   */
  getOrCreate(sender: string): { sessionId: string; isNew: boolean } {
    const existing = this.sessions.get(sender);
    const now = Date.now();

    if (existing && now - existing.lastUsed < this.ttlMs) {
      existing.lastUsed = now;
      logger.debug({ sender, sessionId: existing.sessionId }, 'Resuming existing session');
      return { sessionId: existing.sessionId, isNew: false };
    }

    if (existing) {
      logger.info({ sender, oldSessionId: existing.sessionId }, 'Session expired, creating new');
    }

    const sessionId = randomUUID();
    this.sessions.set(sender, { sessionId, lastUsed: now });
    logger.info({ sender, sessionId }, 'New session created');
    return { sessionId, isNew: true };
  }

  /** Remove a sender's session (e.g., on explicit reset). */
  clear(sender: string): void {
    this.sessions.delete(sender);
  }

  /** Remove all sessions. */
  clearAll(): void {
    this.sessions.clear();
  }

  /** Evict sessions that have exceeded the TTL. */
  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [sender, entry] of this.sessions) {
      if (now - entry.lastUsed >= this.ttlMs) {
        this.sessions.delete(sender);
        evicted++;
        logger.debug({ sender, sessionId: entry.sessionId }, 'Session evicted');
      }
    }
    return evicted;
  }

  get size(): number {
    return this.sessions.size;
  }
}
