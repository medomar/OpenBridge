import * as path from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from './database.js';
import type { Chunk } from './chunk-store.js';
import {
  storeChunks as _storeChunks,
  markStale as _markStale,
  deleteStaleChunks as _deleteStaleChunks,
} from './chunk-store.js';
import { hybridSearch as _hybridSearch, type SearchOptions } from './retrieval.js';
import type { TaskRecord, LearnedParams } from './task-store.js';
import {
  recordTask as _recordTask,
  getTasksByType as _getTasksByType,
  getSimilarTasks as _getSimilarTasks,
  getLearnedParams as _getLearnedParams,
  recordLearning as _recordLearning,
} from './task-store.js';
import {
  recordMessage as _recordMessage,
  findRelevantHistory as _findRelevantHistory,
} from './conversation-store.js';
import {
  getActivePrompt as _getActivePrompt,
  recordPromptOutcome as _recordPromptOutcome,
  getPromptStats as _getPromptStats,
  getUnderperformingPrompts as _getUnderperformingPrompts,
  createPromptVersion as _createPromptVersion,
  getHighEffectivenessPrompts as _getHighEffectivenessPrompts,
} from './prompt-store.js';
import {
  migrateJsonToSqlite,
  getWorkspaceState as _getWorkspaceState,
  updateWorkspaceState as _updateWorkspaceState,
  getSession as _getSession,
  upsertSession as _upsertSession,
  type WorkspaceState,
  type SessionRecord,
} from './migration.js';
import { evictOldData as _evictOldData, type EvictionOptions } from './eviction.js';
import { buildBriefing as _buildBriefing } from './worker-briefing.js';

// ---------------------------------------------------------------------------
// Domain types (inferred from the database schema)
// ---------------------------------------------------------------------------

export type { Chunk };
export type { TaskRecord, LearnedParams };

export interface ConversationEntry {
  id?: number;
  session_id: string;
  role: 'user' | 'master' | 'worker' | 'system';
  content: string;
  channel?: string;
  user_id?: string;
  created_at?: string;
}

export interface PromptRecord {
  id?: number;
  name: string;
  version: number;
  content: string;
  effectiveness: number;
  usage_count: number;
  success_count: number;
  active: boolean;
  created_at: string;
}

export type { WorkspaceState, SessionRecord } from './migration.js';
export type { EvictionOptions } from './eviction.js';
export type { SearchOptions } from './retrieval.js';

// ---------------------------------------------------------------------------
// MemoryManager
// ---------------------------------------------------------------------------

export class MemoryManager {
  private dbPath: string;
  private db: Database.Database | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  init(): Promise<void> {
    this.db = openDatabase(this.dbPath);
    return Promise.resolve();
  }

  close(): Promise<void> {
    if (this.db) {
      closeDatabase(this.db);
      this.db = null;
    }
    return Promise.resolve();
  }

  // -------------------------------------------------------------------------
  // Context chunks (chunk-store.ts — OB-704)
  // -------------------------------------------------------------------------

  storeChunks(chunks: Chunk[]): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _storeChunks(this.db, chunks);
    return Promise.resolve();
  }

  searchContext(query: string, limit?: number, options?: SearchOptions): Promise<Chunk[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return _hybridSearch(this.db, query, { limit, ...options });
  }

  markStale(scopes: string[]): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _markStale(this.db, scopes);
    return Promise.resolve();
  }

  /** Return the unique scopes that have at least one stale chunk in the DB. */
  getStaleScopes(): Promise<string[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    const rows = this.db
      .prepare('SELECT DISTINCT scope FROM context_chunks WHERE stale = 1')
      .all() as { scope: string }[];
    return Promise.resolve(rows.map((r) => r.scope));
  }

  /** Immediately delete all stale chunks (stale=1) and their FTS5 entries. */
  deleteStaleChunks(): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _deleteStaleChunks(this.db);
    return Promise.resolve();
  }

  // -------------------------------------------------------------------------
  // Conversations (implemented by conversation-store.ts — OB-706)
  // -------------------------------------------------------------------------

  recordMessage(msg: ConversationEntry): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _recordMessage(this.db, msg);
    return Promise.resolve();
  }

  findRelevantHistory(query: string, limit?: number): Promise<ConversationEntry[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_findRelevantHistory(this.db, query, limit));
  }

  // -------------------------------------------------------------------------
  // Tasks & Learnings (task-store.ts — OB-705)
  // -------------------------------------------------------------------------

  recordTask(task: TaskRecord): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _recordTask(this.db, task);
    return Promise.resolve();
  }

  getLearnedParams(taskType: string): Promise<LearnedParams> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    const result = _getLearnedParams(this.db, taskType);
    if (!result) return Promise.reject(new Error(`No learning data for task type: ${taskType}`));
    return Promise.resolve(result);
  }

  getSimilarTasks(prompt: string, limit?: number): Promise<TaskRecord[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_getSimilarTasks(this.db, prompt, limit));
  }

  getTasksByType(type: TaskRecord['type'], limit?: number): Promise<TaskRecord[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_getTasksByType(this.db, type, limit));
  }

  recordLearning(
    taskType: string,
    model: string,
    success: boolean,
    turns: number,
    durationMs: number,
  ): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _recordLearning(this.db, taskType, model, success, turns, durationMs);
    return Promise.resolve();
  }

  /** Return aggregate stats for every task_type in the learnings table (OB-711). */
  getLearnedTaskTypes(): Promise<
    {
      taskType: string;
      successCount: number;
      failureCount: number;
      successRate: number;
      bestModel: string;
    }[]
  > {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    interface Row {
      task_type: string;
      success_count: number;
      failure_count: number;
      success_rate: number;
      best_model: string;
    }
    const rows = this.db
      .prepare(
        `SELECT task_type,
                SUM(success_count) AS success_count,
                SUM(failure_count) AS failure_count,
                CAST(SUM(success_count) AS REAL) /
                  NULLIF(SUM(success_count) + SUM(failure_count), 0) AS success_rate,
                model AS best_model
         FROM learnings
         GROUP BY task_type
         ORDER BY success_rate DESC`,
      )
      .all() as Row[];
    return Promise.resolve(
      rows.map((r) => ({
        taskType: r.task_type,
        successCount: r.success_count ?? 0,
        failureCount: r.failure_count ?? 0,
        successRate: r.success_rate ?? 0,
        bestModel: r.best_model ?? 'unknown',
      })),
    );
  }

  // -------------------------------------------------------------------------
  // Context chunk direct lookup (chunk-store.ts — OB-711)
  // -------------------------------------------------------------------------

  getChunksByScope(scope: string, category?: string): Promise<Chunk[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    let query = 'SELECT * FROM context_chunks WHERE scope = ? AND stale = 0';
    const params: (string | number)[] = [scope];
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    interface ChunkRow {
      id: number;
      scope: string;
      category: 'structure' | 'patterns' | 'dependencies' | 'api' | 'config';
      content: string;
      source_hash: string | null;
      created_at: string;
      updated_at: string;
      stale: number;
    }
    const rows = this.db.prepare(query).all(...params) as ChunkRow[];
    return Promise.resolve(
      rows.map((row) => ({
        id: row.id,
        scope: row.scope,
        category: row.category,
        content: row.content,
        source_hash: row.source_hash ?? undefined,
        created_at: row.created_at,
        updated_at: row.updated_at,
        stale: row.stale === 1,
      })),
    );
  }

  // -------------------------------------------------------------------------
  // System config (key-value store — OB-711)
  // -------------------------------------------------------------------------

  getSystemConfig(key: string): Promise<string | null> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    interface ConfigRow {
      value: string;
    }
    const row = this.db.prepare('SELECT value FROM system_config WHERE key = ?').get(key) as
      | ConfigRow
      | undefined;
    return Promise.resolve(row?.value ?? null);
  }

  setSystemConfig(key: string, value: string): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    const now = new Date().toISOString();
    this.db
      .prepare('INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)')
      .run(key, value, now);
    return Promise.resolve();
  }

  // -------------------------------------------------------------------------
  // Prompts (prompt-store.ts — OB-707)
  // -------------------------------------------------------------------------

  getActivePrompt(name: string): Promise<PromptRecord> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    const record = _getActivePrompt(this.db, name);
    if (!record) return Promise.reject(new Error(`No active prompt found: ${name}`));
    return Promise.resolve(record);
  }

  recordPromptOutcome(name: string, success: boolean): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _recordPromptOutcome(this.db, name, success);
    return Promise.resolve();
  }

  /** Return per-version stats (effectiveness, usage_count, success_count) for all versions of a prompt. */
  getPromptStats(name: string): Promise<PromptRecord[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_getPromptStats(this.db, name));
  }

  /** Return all active prompts whose effectiveness is below threshold (default 0.7). */
  getUnderperformingPrompts(threshold?: number): Promise<PromptRecord[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_getUnderperformingPrompts(this.db, threshold));
  }

  /** Return active prompts at or above effectiveness threshold with minimum usage count. */
  getHighEffectivenessPrompts(threshold?: number, minUsage?: number): Promise<PromptRecord[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_getHighEffectivenessPrompts(this.db, threshold, minUsage));
  }

  /** Insert a new version of a named prompt and deactivate all previous versions. */
  createPromptVersion(name: string, content: string): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _createPromptVersion(this.db, name, content);
    return Promise.resolve();
  }

  // -------------------------------------------------------------------------
  // Worker Briefing (worker-briefing.ts — OB-722)
  // -------------------------------------------------------------------------

  buildBriefing(task: string, scope?: string): Promise<string> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return _buildBriefing(this.db, task, scope);
  }

  // -------------------------------------------------------------------------
  // Workspace State (migration.ts — OB-708)
  // -------------------------------------------------------------------------

  getWorkspaceState(): Promise<WorkspaceState> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    const state = _getWorkspaceState(this.db);
    if (!state) return Promise.reject(new Error('No workspace state found'));
    return Promise.resolve(state);
  }

  updateWorkspaceState(state: WorkspaceState): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _updateWorkspaceState(this.db, state);
    return Promise.resolve();
  }

  // -------------------------------------------------------------------------
  // Sessions (migration.ts — OB-708)
  // -------------------------------------------------------------------------

  getSession(type: string): Promise<SessionRecord | null> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_getSession(this.db, type));
  }

  upsertSession(session: SessionRecord): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _upsertSession(this.db, session);
    return Promise.resolve();
  }

  // -------------------------------------------------------------------------
  // Maintenance (eviction.ts — OB-709, migration.ts — OB-708)
  // -------------------------------------------------------------------------

  evictOldData(options?: EvictionOptions): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return _evictOldData(this.db, options);
  }

  migrate(): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    const dotfolderPath = path.dirname(this.dbPath);
    return migrateJsonToSqlite(this.db, dotfolderPath);
  }
}

export default MemoryManager;
