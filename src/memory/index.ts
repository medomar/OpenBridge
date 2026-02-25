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

export interface WorkspaceState {
  commit_hash?: string;
  branch?: string;
  has_git?: boolean;
  analyzed_at: string;
  last_verified_at?: string;
  analysis_type: string;
  files_changed?: number;
}

export interface SessionRecord {
  id: string;
  type: 'master' | 'exploration';
  status: 'active' | 'ended' | 'crashed';
  restart_count?: number;
  message_count?: number;
  allowed_tools?: string;
  created_at: string;
  last_used_at: string;
}

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
  // Prompts (implemented by prompt-store.ts — OB-707)
  // -------------------------------------------------------------------------

  getActivePrompt(_name: string): Promise<PromptRecord> {
    return Promise.reject(NOT_IMPLEMENTED);
  }

  recordPromptOutcome(_name: string, _success: boolean): Promise<void> {
    return Promise.reject(NOT_IMPLEMENTED);
  }

  // -------------------------------------------------------------------------
  // Worker Briefing (implemented by worker-briefing.ts — OB-722)
  // -------------------------------------------------------------------------

  buildBriefing(_task: string, _scope?: string): Promise<string> {
    return Promise.reject(NOT_IMPLEMENTED);
  }

  // -------------------------------------------------------------------------
  // Workspace State (implemented by migration.ts / OB-708)
  // -------------------------------------------------------------------------

  getWorkspaceState(): Promise<WorkspaceState> {
    return Promise.reject(NOT_IMPLEMENTED);
  }

  updateWorkspaceState(_state: WorkspaceState): Promise<void> {
    return Promise.reject(NOT_IMPLEMENTED);
  }

  // -------------------------------------------------------------------------
  // Sessions (implemented by migration.ts / OB-708)
  // -------------------------------------------------------------------------

  getSession(_type: string): Promise<SessionRecord | null> {
    return Promise.reject(NOT_IMPLEMENTED);
  }

  upsertSession(_session: SessionRecord): Promise<void> {
    return Promise.reject(NOT_IMPLEMENTED);
  }

  // -------------------------------------------------------------------------
  // Maintenance (implemented by eviction.ts — OB-709, migration.ts — OB-708)
  // -------------------------------------------------------------------------

  evictOldData(): Promise<void> {
    return Promise.reject(NOT_IMPLEMENTED);
  }

  migrate(): Promise<void> {
    return Promise.reject(NOT_IMPLEMENTED);
  }
}

export default MemoryManager;
