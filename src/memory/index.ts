import * as path from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from './database.js';
import type { Chunk } from './chunk-store.js';
import {
  storeChunks as _storeChunks,
  searchChunks as _searchChunks,
  markStale as _markStale,
} from './chunk-store.js';
import type { TaskRecord, LearnedParams } from './task-store.js';
import {
  recordTask as _recordTask,
  getTasksByType as _getTasksByType,
  getSimilarTasks as _getSimilarTasks,
  getLearnedParams as _getLearnedParams,
} from './task-store.js';
import {
  recordMessage as _recordMessage,
  findRelevantHistory as _findRelevantHistory,
} from './conversation-store.js';
import {
  getActivePrompt as _getActivePrompt,
  recordPromptOutcome as _recordPromptOutcome,
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

// ---------------------------------------------------------------------------
// MemoryManager
// ---------------------------------------------------------------------------

const NOT_IMPLEMENTED = new Error('not implemented');

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

  searchContext(query: string, limit?: number): Promise<Chunk[]> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    return Promise.resolve(_searchChunks(this.db, query, limit));
  }

  markStale(scopes: string[]): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    _markStale(this.db, scopes);
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

  // -------------------------------------------------------------------------
  // Worker Briefing (implemented by worker-briefing.ts — OB-722)
  // -------------------------------------------------------------------------

  buildBriefing(_task: string, _scope?: string): Promise<string> {
    return Promise.reject(NOT_IMPLEMENTED);
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

  evictOldData(): Promise<void> {
    return Promise.reject(NOT_IMPLEMENTED);
  }

  migrate(): Promise<void> {
    if (!this.db) return Promise.reject(new Error('MemoryManager not initialised'));
    const dotfolderPath = path.dirname(this.dbPath);
    return migrateJsonToSqlite(this.db, dotfolderPath);
  }
}

export default MemoryManager;
