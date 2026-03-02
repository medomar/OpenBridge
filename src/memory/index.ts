import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  PromptManifestSchema,
  type ExplorationLogEntry,
  type PromptManifest,
} from '../types/master.js';
import { openDatabase, closeDatabase } from './database.js';
import type { Chunk } from './chunk-store.js';
import {
  storeChunks as _storeChunks,
  markStale as _markStale,
  deleteStaleChunks as _deleteStaleChunks,
  deleteChunksByScope as _deleteChunksByScope,
} from './chunk-store.js';
import {
  hybridSearch as _hybridSearch,
  searchConversations as _searchConversations,
  type SearchOptions,
} from './retrieval.js';
import type { TaskRecord, LearnedParams, ModelStats } from './task-store.js';
import {
  recordTask as _recordTask,
  getTasksByType as _getTasksByType,
  getSimilarTasks as _getSimilarTasks,
  getLearnedParams as _getLearnedParams,
  recordLearning as _recordLearning,
  getModelStatsForTask as _getModelStatsForTask,
} from './task-store.js';
import {
  recordMessage as _recordMessage,
  findRelevantHistory as _findRelevantHistory,
  getSessionHistory as _getSessionHistory,
  getRecentMessages as _getRecentMessages,
  listSessions as _listSessions,
  searchSessions as _searchSessions,
  type SessionSummary,
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
  closeActiveSessions as _closeActiveSessions,
  type WorkspaceState,
  type SessionRecord,
} from './migration.js';
import { evictOldData as _evictOldData, type EvictionOptions } from './eviction.js';
import { buildBriefing as _buildBriefing } from './worker-briefing.js';
import {
  insertActivity as _insertActivity,
  updateActivity as _updateActivity,
  getActiveAgents as _getActiveAgents,
  getRecentWorkerSpawns as _getRecentWorkerSpawns,
  cleanupOldActivity as _cleanupOldActivity,
  markStaleActivityDone as _markStaleActivityDone,
  getDailyCost as _getDailyCost,
  insertExplorationProgress as _insertExplorationProgress,
  updateExplorationProgressById as _updateExplorationProgressById,
  getExplorationProgressByExplorationId as _getExplorationProgressByExplorationId,
  type ActivityRecord,
  type ActivityUpdate,
  type ExplorationProgressRecord,
  type ExplorationProgressUpdate,
} from './activity-store.js';
import {
  getAccess as _getAccess,
  setAccess as _setAccess,
  listAccess as _listAccess,
  removeAccess as _removeAccess,
  resetDailyCosts as _resetDailyCosts,
  incrementDailyCost as _incrementDailyCost,
  getConsentMode as _getConsentMode,
  type AccessControlEntry,
  type ConsentMode,
} from './access-store.js';
import {
  registerSubMaster as _registerSubMaster,
  getSubMaster as _getSubMaster,
  listSubMasters as _listSubMasters,
  updateSubMasterStatus as _updateSubMasterStatus,
  removeSubMaster as _removeSubMaster,
  type SubMasterEntry,
  type SubMasterStatus,
} from './sub-master-store.js';
import {
  insertAuditEntry as _insertAuditEntry,
  queryAuditEntries as _queryAuditEntries,
  searchAuditLog as _searchAuditLog,
  countAuditByEvent as _countAuditByEvent,
  type AuditRecord,
  type AuditSearchOptions,
} from './audit-store.js';
import { QACacheStore } from './qa-cache-store.js';

// ---------------------------------------------------------------------------
// Domain types (inferred from the database schema)
// ---------------------------------------------------------------------------

export type { Chunk };
export type { TaskRecord, LearnedParams, ModelStats };

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

export type { SessionSummary } from './conversation-store.js';
export type { WorkspaceState, SessionRecord } from './migration.js';
export type { EvictionOptions } from './eviction.js';
export type { SearchOptions } from './retrieval.js';
export type {
  ActivityRecord,
  ActivityUpdate,
  ExplorationProgressRecord,
  ExplorationProgressUpdate,
} from './activity-store.js';
export type { AccessControlEntry, AccessRole, ConsentMode } from './access-store.js';
export type { SubMasterEntry, SubMasterStatus } from './sub-master-store.js';
export type { AuditRecord, AuditSearchOptions, AuditEventType } from './audit-store.js';
export type { QACacheEntry } from './qa-cache-store.js';

export interface ExplorationProgressRow {
  id: number;
  exploration_id: string;
  phase: string;
  target: string | null;
  status: string;
  progress_pct: number;
  files_processed: number;
  files_total: number | null;
  started_at: string | null;
  completed_at: string | null;
}

// ---------------------------------------------------------------------------
// MemoryManager
// ---------------------------------------------------------------------------

export class MemoryManager {
  private dbPath: string;
  private db: Database.Database | null = null;
  private _qaCacheEvictionTimer: ReturnType<typeof setInterval> | null = null;

  /** Q&A cache store — available after init(). */
  qaCache!: QACacheStore;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  init(): Promise<void> {
    this.db = openDatabase(this.dbPath);
    this.qaCache = new QACacheStore(this.db);

    // Evict Q&A cache entries older than 7 days on init and then daily.
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    this.qaCache.evictStale(SEVEN_DAYS_MS);
    this._qaCacheEvictionTimer = setInterval(() => {
      if (this.db) this.qaCache.evictStale(SEVEN_DAYS_MS);
    }, ONE_DAY_MS);
    this._qaCacheEvictionTimer.unref();

    return Promise.resolve();
  }

  close(): Promise<void> {
    if (this._qaCacheEvictionTimer) {
      clearInterval(this._qaCacheEvictionTimer);
      this._qaCacheEvictionTimer = null;
    }
    if (this.db) {
      try {
        this.db.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // WAL checkpoint is best-effort — in-memory DBs and read-only mounts may skip
      }
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

  /** Delete all chunks for the given scope (fresh and stale) and their FTS5 entries. */
  deleteChunksByScope(scope: string): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _deleteChunksByScope(this.db, scope);
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

  /** Return the most recent messages for a given session, ordered chronologically (OB-1035). */
  getSessionHistory(sessionId: string, limit?: number): Promise<ConversationEntry[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_getSessionHistory(this.db, sessionId, limit));
  }

  /** Return the most recent messages across all sessions (user + master roles), chronologically (OB-1116). */
  getRecentMessages(limit?: number): Promise<ConversationEntry[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_getRecentMessages(this.db, limit));
  }

  /** Return a paginated list of distinct conversation sessions ordered by most recent activity. */
  listSessions(limit?: number, offset?: number): Promise<SessionSummary[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_listSessions(this.db, limit, offset));
  }

  /** FTS5 session-level search — returns sessions ranked by number of matching messages (OB-1032). */
  searchSessions(query: string, limit?: number): Promise<SessionSummary[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_searchSessions(this.db, query, limit));
  }

  /** BM25-ranked cross-session FTS5 search over conversations (OB-1025). */
  searchConversations(query: string, limit?: number): Promise<ConversationEntry[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_searchConversations(this.db, query, limit));
  }

  // -------------------------------------------------------------------------
  // Tasks & Learnings (task-store.ts — OB-705)
  // -------------------------------------------------------------------------

  recordTask(task: TaskRecord): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _recordTask(this.db, task);
    return Promise.resolve();
  }

  getLearnedParams(taskType: string): Promise<LearnedParams | null> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_getLearnedParams(this.db, taskType));
  }

  getModelStatsForTask(taskType: string, model: string): Promise<ModelStats | null> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_getModelStatsForTask(this.db, taskType, model));
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

  /** Read the prompt manifest stored in system_config under key 'prompt_manifest'. Returns null if not stored. */
  getPromptManifest(): Promise<PromptManifest | null> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    interface ConfigRow {
      value: string;
    }
    const row = this.db
      .prepare('SELECT value FROM system_config WHERE key = ?')
      .get('prompt_manifest') as ConfigRow | undefined;
    if (!row?.value) return Promise.resolve(null);
    try {
      return Promise.resolve(PromptManifestSchema.parse(JSON.parse(row.value)));
    } catch {
      return Promise.resolve(null);
    }
  }

  /** Persist the prompt manifest to system_config under key 'prompt_manifest'. */
  setPromptManifest(manifest: PromptManifest): Promise<void> {
    return this.setSystemConfig('prompt_manifest', JSON.stringify(manifest));
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

  closeActiveSessions(): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _closeActiveSessions(this.db);
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

  // -------------------------------------------------------------------------
  // Agent Activity (activity-store.ts — OB-742)
  // -------------------------------------------------------------------------

  insertActivity(activity: ActivityRecord): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _insertActivity(this.db, activity);
    return Promise.resolve();
  }

  updateActivity(id: string, updates: ActivityUpdate): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _updateActivity(this.db, id, updates);
    return Promise.resolve();
  }

  getActiveAgents(): Promise<ActivityRecord[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_getActiveAgents(this.db));
  }

  /** Return the last N worker spawns (type='worker'), most recent first. */
  getRecentWorkerSpawns(limit?: number): Promise<ActivityRecord[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_getRecentWorkerSpawns(this.db, limit));
  }

  cleanupOldActivity(cutoffHours?: number): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _cleanupOldActivity(this.db, cutoffHours);
    return Promise.resolve();
  }

  /** Mark all in-flight activity rows as 'done' — call once on startup. */
  markStaleActivityDone(): number {
    if (!this.db) return 0;
    return _markStaleActivityDone(this.db);
  }

  /**
   * Return the total cost_usd for all agent_activity rows on a given date (YYYY-MM-DD).
   * Defaults to today's date (UTC) when no date is provided.
   */
  getDailyCost(date?: string): Promise<number> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_getDailyCost(this.db, date));
  }

  // -------------------------------------------------------------------------
  // Exploration progress (activity-store.ts — OB-745)
  // -------------------------------------------------------------------------

  /** Insert an exploration_progress row; returns the auto-increment row id. */
  insertExplorationProgress(record: Omit<ExplorationProgressRecord, 'id'>): Promise<number> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_insertExplorationProgress(this.db, record));
  }

  /** Update an exploration_progress row by its numeric id. */
  updateExplorationProgressById(id: number, updates: ExplorationProgressUpdate): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _updateExplorationProgressById(this.db, id, updates);
    return Promise.resolve();
  }

  /** Return all exploration_progress rows for a given exploration_id. */
  getExplorationProgressByExplorationId(
    explorationId: string,
  ): Promise<ExplorationProgressRecord[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_getExplorationProgressByExplorationId(this.db, explorationId));
  }

  /** Return pending or in-progress rows from the exploration_progress table. */
  getExplorationProgress(): Promise<ExplorationProgressRow[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    const rows = this.db
      .prepare(
        `SELECT * FROM exploration_progress
         WHERE status IN ('pending', 'in_progress')
         ORDER BY id ASC`,
      )
      .all() as ExplorationProgressRow[];
    return Promise.resolve(rows);
  }

  // -------------------------------------------------------------------------
  // Access control (access-store.ts — OB-750)
  // -------------------------------------------------------------------------

  getAccess(userId: string, channel: string): Promise<AccessControlEntry | null> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_getAccess(this.db, userId, channel));
  }

  getConsentMode(userId: string, channel: string): Promise<ConsentMode> {
    if (!this.db) return Promise.resolve('always-ask');
    return Promise.resolve(_getConsentMode(this.db, userId, channel));
  }

  setAccess(entry: AccessControlEntry): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _setAccess(this.db, entry);
    return Promise.resolve();
  }

  listAccess(): Promise<AccessControlEntry[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_listAccess(this.db));
  }

  removeAccess(userId: string, channel: string): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _removeAccess(this.db, userId, channel);
    return Promise.resolve();
  }

  resetDailyCosts(): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _resetDailyCosts(this.db);
    return Promise.resolve();
  }

  incrementDailyCost(userId: string, channel: string, costUsd: number): void {
    if (!this.db) return;
    _incrementDailyCost(this.db, userId, channel, costUsd);
  }

  // -------------------------------------------------------------------------
  // Sub-master registry (sub-master-store.ts — OB-756)
  // -------------------------------------------------------------------------

  registerSubMaster(entry: SubMasterEntry): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _registerSubMaster(this.db, entry);
    return Promise.resolve();
  }

  getSubMaster(id: string): Promise<SubMasterEntry | null> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_getSubMaster(this.db, id));
  }

  listSubMasters(): Promise<SubMasterEntry[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_listSubMasters(this.db));
  }

  updateSubMasterStatus(id: string, status: SubMasterStatus): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _updateSubMasterStatus(this.db, id, status);
    return Promise.resolve();
  }

  removeSubMaster(id: string): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _removeSubMaster(this.db, id);
    return Promise.resolve();
  }

  // -------------------------------------------------------------------------
  // Audit log (audit-store.ts — OB-820)
  // -------------------------------------------------------------------------

  /** Insert a structured audit log entry into the audit_log table. */
  insertAuditEntry(entry: AuditRecord): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _insertAuditEntry(this.db, entry);
    return Promise.resolve();
  }

  /** Query audit log entries with optional filters (event type, sender, time range). */
  queryAuditEntries(options?: AuditSearchOptions): Promise<AuditRecord[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_queryAuditEntries(this.db, options));
  }

  /** Full-text search across audit log entries. */
  searchAuditLog(query: string, limit?: number): Promise<AuditRecord[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_searchAuditLog(this.db, query, limit));
  }

  /** Count audit entries grouped by event type, optionally filtered by time. */
  countAuditByEvent(since?: string): Promise<{ event: string; count: number }[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_countAuditByEvent(this.db, since));
  }

  // -------------------------------------------------------------------------
  // Exploration State (system_config — OB-800)
  // -------------------------------------------------------------------------

  /**
   * Persist the full ExplorationState as JSON in system_config.
   * Replaces dotFolder.writeExplorationState() calls.
   */
  upsertExplorationState(state: unknown): Promise<void> {
    return this.setSystemConfig('exploration_state', JSON.stringify(state));
  }

  /**
   * Read the persisted ExplorationState JSON from system_config.
   * Returns null if not yet stored.
   * Replaces dotFolder.readExplorationState() calls.
   */
  getExplorationState(): Promise<string | null> {
    return this.getSystemConfig('exploration_state');
  }

  /**
   * Persist the StructureScan result as JSON in system_config.
   * Replaces dotFolder.writeStructureScan() calls.
   */
  upsertStructureScan(scan: unknown): Promise<void> {
    return this.setSystemConfig('structure_scan', JSON.stringify(scan));
  }

  /**
   * Read the persisted StructureScan JSON from system_config.
   * Returns null if not yet stored.
   * Replaces dotFolder.readStructureScan() calls.
   */
  getStructureScan(): Promise<string | null> {
    return this.getSystemConfig('structure_scan');
  }

  /**
   * Persist the Classification result as JSON in system_config.
   * Replaces dotFolder.writeClassification() calls.
   */
  upsertClassification(classification: unknown): Promise<void> {
    return this.setSystemConfig('classification', JSON.stringify(classification));
  }

  /**
   * Read the persisted Classification JSON from system_config.
   * Returns null if not yet stored.
   * Replaces dotFolder.readClassification() calls.
   */
  getClassification(): Promise<string | null> {
    return this.getSystemConfig('classification');
  }

  /**
   * Persist a DirectoryDive result as JSON in system_config under key `dir_dive:<dirName>`.
   * Replaces dotFolder.writeDirectoryDive() calls.
   */
  upsertDirectoryDive(dirName: string, dive: unknown): Promise<void> {
    return this.setSystemConfig(`dir_dive:${dirName}`, JSON.stringify(dive));
  }

  /**
   * Read a persisted DirectoryDive result JSON from system_config.
   * Returns null if not yet stored.
   * Replaces dotFolder.readDirectoryDive() calls.
   */
  getDirectoryDive(dirName: string): Promise<string | null> {
    return this.getSystemConfig(`dir_dive:${dirName}`);
  }

  // -------------------------------------------------------------------------
  // Exploration log (exploration_progress table — OB-835)
  // -------------------------------------------------------------------------

  /**
   * Append an exploration log entry to the DB.
   *
   * When `explorationId` is provided (a valid agent_activity.id), inserts a
   * structured row into `exploration_progress` — keeping all exploration-related
   * records in the same table that `insertExplorationProgress` uses.
   *
   * When `explorationId` is absent, falls back to writing a `type='log'` row in
   * `agent_activity` for backward compatibility with callers that have no
   * exploration context (e.g. lifecycle events in MasterManager).
   *
   * Replaces dotFolder.appendLog() calls.
   */
  logExploration(entry: ExplorationLogEntry, explorationId?: string): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    const now = entry.timestamp ?? new Date().toISOString();

    if (explorationId) {
      _insertExplorationProgress(this.db, {
        exploration_id: explorationId,
        phase: entry.message,
        target: entry.data !== undefined ? JSON.stringify(entry.data) : null,
        status: entry.level === 'error' ? 'failed' : 'completed',
        progress_pct: 100,
        files_processed: 0,
        started_at: now,
        completed_at: now,
      });
      return Promise.resolve();
    }

    // Fallback: no exploration context — write to agent_activity with type='log'
    this.db
      .prepare(
        `INSERT INTO agent_activity
           (id, type, model, task_summary, status, started_at, updated_at, completed_at)
         VALUES (?, 'log', ?, ?, 'done', ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        entry.level,
        entry.data ? `${entry.message} | ${JSON.stringify(entry.data)}` : entry.message,
        now,
        now,
        now,
      );
    return Promise.resolve();
  }

  /**
   * Read all exploration log entries from the DB (agent_activity rows with type='log').
   * Replaces dotFolder.readLog() calls.
   */
  readExplorationLog(): Promise<ExplorationLogEntry[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    interface LogRow {
      model: string;
      task_summary: string;
      started_at: string;
    }
    const rows = this.db
      .prepare(
        `SELECT model, task_summary, started_at FROM agent_activity
         WHERE type = 'log'
         ORDER BY started_at ASC`,
      )
      .all() as LogRow[];
    return Promise.resolve(
      rows.map((row) => {
        const pipeIdx = row.task_summary.indexOf(' | ');
        let message = row.task_summary;
        let data: Record<string, unknown> | undefined;
        if (pipeIdx !== -1) {
          message = row.task_summary.slice(0, pipeIdx);
          try {
            data = JSON.parse(row.task_summary.slice(pipeIdx + 3)) as Record<string, unknown>;
          } catch {
            // leave data undefined
          }
        }
        return {
          timestamp: row.started_at,
          level: row.model as 'info' | 'warn' | 'error',
          message,
          ...(data !== undefined ? { data } : {}),
        };
      }),
    );
  }

  /** Expose the raw Database instance — used by AuthService for synchronous access control checks. */
  getDb(): Database.Database | null {
    return this.db;
  }
}

export default MemoryManager;
