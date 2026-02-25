import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from './database.js';

// ---------------------------------------------------------------------------
// Domain types (inferred from the database schema)
// ---------------------------------------------------------------------------

export interface Chunk {
  id?: number;
  scope: string;
  category: 'structure' | 'patterns' | 'dependencies' | 'api' | 'config';
  content: string;
  source_hash?: string;
  created_at?: string;
  updated_at?: string;
  stale?: boolean;
}

export interface ConversationEntry {
  id?: number;
  session_id: string;
  role: 'user' | 'master' | 'worker' | 'system';
  content: string;
  channel?: string;
  user_id?: string;
  created_at?: string;
}

export interface TaskRecord {
  id: string;
  type: 'exploration' | 'worker' | 'quick-answer' | 'tool-use' | 'complex';
  status: 'running' | 'completed' | 'failed' | 'timeout';
  prompt?: string;
  response?: string;
  model?: string;
  profile?: string;
  turns_used?: number;
  max_turns?: number;
  duration_ms?: number;
  exit_code?: number;
  retries?: number;
  parent_task_id?: string;
  created_at: string;
  completed_at?: string;
}

export interface LearnedParams {
  model: string;
  success_rate: number;
  avg_turns: number;
  total_tasks: number;
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
  // Context chunks (implemented by chunk-store.ts — OB-704)
  // -------------------------------------------------------------------------

  storeChunks(_chunks: Chunk[]): Promise<void> {
    return Promise.reject(NOT_IMPLEMENTED);
  }

  searchContext(_query: string, _limit?: number): Promise<Chunk[]> {
    return Promise.reject(NOT_IMPLEMENTED);
  }

  markStale(_scopes: string[]): Promise<void> {
    return Promise.reject(NOT_IMPLEMENTED);
  }

  // -------------------------------------------------------------------------
  // Conversations (implemented by conversation-store.ts — OB-706)
  // -------------------------------------------------------------------------

  recordMessage(_msg: ConversationEntry): Promise<void> {
    return Promise.reject(NOT_IMPLEMENTED);
  }

  findRelevantHistory(_query: string, _limit?: number): Promise<ConversationEntry[]> {
    return Promise.reject(NOT_IMPLEMENTED);
  }

  // -------------------------------------------------------------------------
  // Tasks & Learnings (implemented by task-store.ts — OB-705)
  // -------------------------------------------------------------------------

  recordTask(_task: TaskRecord): Promise<void> {
    return Promise.reject(NOT_IMPLEMENTED);
  }

  getLearnedParams(_taskType: string): Promise<LearnedParams> {
    return Promise.reject(NOT_IMPLEMENTED);
  }

  getSimilarTasks(_prompt: string, _limit?: number): Promise<TaskRecord[]> {
    return Promise.reject(NOT_IMPLEMENTED);
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
