import type { AgentRunner } from './agent-runner.js';
import { TOOLS_READ_ONLY } from './agent-runner.js';
import type { MemoryManager } from '../memory/index.js';
import { createLogger } from './logger.js';

const logger = createLogger('fast-path-responder');

/** Configuration for the FastPathResponder pool. */
export interface FastPathOptions {
  /** Maximum number of fast-path agents that may run concurrently. Default: 2. */
  maxConcurrent?: number;
  /** Maximum turns per fast-path agent call. Default: 3. */
  maxTurns?: number;
  /** Per-call timeout in milliseconds. Default: 30 000. */
  timeoutMs?: number;
}

/** Parameters for a single fast-path answer request. */
export interface FastPathRequest {
  /** The user's question to answer. */
  question: string;
  /** Absolute path to the workspace the agent will read. */
  workspacePath: string;
  /**
   * Pre-built workspace map summary string (project name, frameworks, commands,
   * key files). Populated by the caller from MasterManager.getWorkspaceMap().
   * When provided the FastPathResponder injects it as context.
   */
  workspaceContext?: string;
}

/**
 * Manages a pool of short-lived read-only agent sessions for quick-answer
 * responses while the Master AI is busy processing a complex task.
 *
 * Key features
 * ─────────────
 * • Concurrency pool — at most `maxConcurrent` (default 2) fast-path agents
 *   run at the same time. Extra requests are rejected immediately with a
 *   "busy" message rather than queuing indefinitely.
 * • DB context augmentation — when a MemoryManager is provided the responder
 *   performs a hybrid search on `context_chunks` and prepends the top results
 *   to the agent prompt (read-only DB access; no writes).
 * • Workspace-map context — the caller may supply a compact summary string
 *   derived from the cached workspace map so the agent already knows the
 *   project structure without extra file reads.
 */
export class FastPathResponder {
  private readonly maxConcurrent: number;
  private readonly maxTurns: number;
  private readonly timeoutMs: number;
  private readonly runner: AgentRunner;
  private memory?: MemoryManager;
  private activeCount = 0;

  constructor(runner: AgentRunner, memory?: MemoryManager, options?: FastPathOptions) {
    this.runner = runner;
    this.memory = memory;
    this.maxConcurrent = options?.maxConcurrent ?? 2;
    this.maxTurns = options?.maxTurns ?? 3;
    this.timeoutMs = options?.timeoutMs ?? 30_000;
  }

  /** Attach or replace the MemoryManager used for context chunk retrieval. */
  setMemory(memory: MemoryManager): void {
    this.memory = memory;
  }

  /** Returns true when the pool is at full capacity (activeCount >= maxConcurrent). */
  get isBusy(): boolean {
    return this.activeCount >= this.maxConcurrent;
  }

  /** Number of fast-path agent calls currently in flight. */
  get activeSessions(): number {
    return this.activeCount;
  }

  /** Configured maximum concurrent fast-path agents. */
  get maxSessions(): number {
    return this.maxConcurrent;
  }

  /**
   * Answer a quick question using a read-only agent session.
   *
   * Returns the agent's response as a plain string. Falls back to a graceful
   * "busy" or "failed" message instead of throwing, so callers can forward the
   * text to the user without error handling.
   */
  async answer(request: FastPathRequest): Promise<string> {
    if (this.isBusy) {
      logger.warn(
        { activeCount: this.activeCount, maxConcurrent: this.maxConcurrent },
        'FastPathResponder: pool at capacity, rejecting request',
      );
      return 'The AI is busy processing multiple requests. Please wait a moment and try again.';
    }

    this.activeCount++;
    logger.info(
      { activeCount: this.activeCount, maxConcurrent: this.maxConcurrent },
      'FastPathResponder: starting fast-path agent',
    );

    try {
      const context = await this.buildContext(request);
      const promptParts = [
        'You are a helpful assistant with read-only access to a codebase. Answer the question concisely (1–3 paragraphs). Do not modify any files.',
      ];
      if (context) {
        promptParts.push(`\nWorkspace context:\n${context}`);
      }
      promptParts.push(`\nUser question: ${request.question}`);
      const prompt = promptParts.join('');

      const result = await this.runner.spawn({
        prompt,
        workspacePath: request.workspacePath,
        allowedTools: [...TOOLS_READ_ONLY],
        maxTurns: this.maxTurns,
        retries: 0,
        timeout: this.timeoutMs,
      });

      const reply = result.stdout.trim() || 'No response — please try again.';
      logger.info(
        { activeCount: this.activeCount },
        'FastPathResponder: fast-path agent completed',
      );
      return reply;
    } catch (err) {
      logger.warn({ err }, 'FastPathResponder: fast-path agent failed');
      return 'The AI is busy and could not answer right now. Your question will be processed shortly.';
    } finally {
      this.activeCount--;
    }
  }

  /**
   * Build the context string to inject into the fast-path agent prompt.
   *
   * Combines (in order):
   * 1. The pre-built workspace map summary from the caller (if provided).
   * 2. The top-3 context chunks from the MemoryManager (if available),
   *    retrieved via a hybrid search on the user's question.
   *
   * Returns an empty string when no context is available.
   */
  private async buildContext(request: FastPathRequest): Promise<string> {
    const parts: string[] = [];

    if (request.workspaceContext) {
      parts.push(request.workspaceContext);
    }

    if (this.memory) {
      try {
        const chunks = await this.memory.searchContext(request.question, 3);
        if (chunks.length > 0) {
          const chunkText = chunks.map((c) => c.content).join('\n---\n');
          parts.push(`Relevant context:\n${chunkText}`);
        }
      } catch (err) {
        // DB search is best-effort — a missing or locked DB must not block the fast-path
        logger.debug({ err }, 'FastPathResponder: context chunk search failed (non-fatal)');
      }
    }

    return parts.join('\n\n');
  }
}
