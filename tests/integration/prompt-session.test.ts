/**
 * Integration test: prompt size cap + WebChat isolation (OB-1558)
 *
 * Verifies that:
 *   1. generateMasterSystemPrompt() with a realistic config fits within 55K
 *      (or is trimmed by trimPromptToFit()), and createPromptVersion() saves it.
 *   2. createPromptVersion() throws for content exceeding MAX_PROMPT_VERSION_LENGTH.
 *   3. getSessionHistoryForSender() isolates messages by sender in the same session.
 *   4. buildConversationContext() with a sender only returns that sender's messages.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import { createPromptVersion, MAX_PROMPT_VERSION_LENGTH } from '../../src/memory/prompt-store.js';
import { recordMessage, getSessionHistoryForSender } from '../../src/memory/conversation-store.js';
import {
  generateMasterSystemPrompt,
  trimPromptToFit,
} from '../../src/master/master-system-prompt.js';
import type { MasterSystemPromptContext } from '../../src/master/master-system-prompt.js';
import { PromptContextBuilder } from '../../src/master/prompt-context-builder.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { MCPServer } from '../../src/types/config.js';
import type { SkillPack } from '../../src/types/agent.js';
import type { ConversationEntry } from '../../src/memory/index.js';

// ---------------------------------------------------------------------------
// Suppress logger noise
// ---------------------------------------------------------------------------

vi.mock('../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Fixtures — realistic config (6 tools, 4 MCP servers, 3 skill packs)
// ---------------------------------------------------------------------------

const SIX_TOOLS: DiscoveredTool[] = [
  {
    name: 'claude',
    path: '/usr/local/bin/claude',
    version: '1.0.0',
    role: 'master',
    capabilities: ['code-analysis', 'task-execution'],
    available: true,
  },
  {
    name: 'codex',
    path: '/usr/local/bin/codex',
    version: '2.0.0',
    role: 'specialist',
    capabilities: ['code-generation'],
    available: true,
  },
  {
    name: 'aider',
    path: '/usr/local/bin/aider',
    version: '0.50.0',
    role: 'specialist',
    capabilities: ['code-edit'],
    available: true,
  },
  {
    name: 'gpt4',
    path: '/usr/local/bin/gpt4',
    version: '4.0.0',
    role: 'specialist',
    capabilities: ['analysis'],
    available: true,
  },
  {
    name: 'llama',
    path: '/usr/local/bin/llama',
    version: '3.0.0',
    role: 'backup',
    capabilities: ['summarization'],
    available: true,
  },
  {
    name: 'gemini',
    path: '/usr/local/bin/gemini',
    version: '1.5.0',
    role: 'specialist',
    capabilities: ['multimodal'],
    available: true,
  },
];

const FOUR_MCP_SERVERS: MCPServer[] = [
  { name: 'gmail', command: 'npx', args: ['@modelcontextprotocol/server-gmail'] },
  { name: 'slack', command: 'npx', args: ['@modelcontextprotocol/server-slack'] },
  { name: 'github', command: 'npx', args: ['@modelcontextprotocol/server-github'] },
  { name: 'canva', command: 'npx', args: ['@modelcontextprotocol/server-canva'] },
];

const THREE_SKILL_PACKS: SkillPack[] = [
  {
    name: 'security-audit',
    description: 'Security auditing best practices and vulnerability scanning',
    toolProfile: 'read-only',
    systemPromptExtension: 'Perform thorough security analysis on the codebase.',
    requiredTools: [],
    tags: ['security'],
    isUserDefined: false,
  },
  {
    name: 'code-review',
    description: 'Code quality, maintainability, and review guidelines',
    toolProfile: 'code-edit',
    systemPromptExtension: 'Review code for quality and suggest improvements.',
    requiredTools: [],
    tags: ['quality'],
    isUserDefined: false,
  },
  {
    name: 'data-analysis',
    description: 'Data science analysis and reporting procedures',
    toolProfile: 'full-access',
    systemPromptExtension: 'Analyse data with standard data-science libraries.',
    requiredTools: [],
    tags: ['data'],
    isUserDefined: false,
  },
];

const REALISTIC_CONTEXT: MasterSystemPromptContext = {
  workspacePath: '/home/user/realistic-project',
  masterToolName: 'claude',
  discoveredTools: SIX_TOOLS,
  mcpServers: FOUR_MCP_SERVERS,
  availableSkillPacks: THREE_SKILL_PACKS,
};

// ---------------------------------------------------------------------------
// 1. Prompt size cap — generateMasterSystemPrompt + createPromptVersion
// ---------------------------------------------------------------------------

describe('Prompt size cap: generateMasterSystemPrompt + createPromptVersion', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('generates a prompt under 55K for realistic config (6 tools, 4 MCP, 3 skill packs)', () => {
    const prompt = generateMasterSystemPrompt(REALISTIC_CONTEXT);
    expect(prompt.length).toBeLessThan(55_000);
  });

  it('trimPromptToFit() reduces a 60K prompt to under 50K', () => {
    const preamble = 'x'.repeat(35_000);
    const deepModeSection = '\n## Deep Mode\n\n' + 'y'.repeat(15_000) + '\n\n';
    const tail = '## How to Spawn Workers\n\n' + 'z'.repeat(8_000);
    const oversize = preamble + deepModeSection + tail;

    expect(oversize.length).toBeGreaterThan(50_000);

    const trimmed = trimPromptToFit(oversize, 50_000);
    expect(trimmed.length).toBeLessThan(50_000);
  });

  it('createPromptVersion() saves a realistic prompt without throwing', () => {
    const prompt = generateMasterSystemPrompt(REALISTIC_CONTEXT);
    // Must be under the cap for this test to be valid
    expect(prompt.length).toBeLessThanOrEqual(MAX_PROMPT_VERSION_LENGTH);

    // Should not throw
    expect(() => createPromptVersion(db, 'master-system', prompt)).not.toThrow();
  });

  it('createPromptVersion() throws for content exceeding MAX_PROMPT_VERSION_LENGTH', () => {
    const oversized = 'x'.repeat(60_000);
    expect(oversized.length).toBeGreaterThan(MAX_PROMPT_VERSION_LENGTH);

    expect(() => createPromptVersion(db, 'master-system', oversized)).toThrow(/exceeds size cap/);
  });
});

// ---------------------------------------------------------------------------
// 2. WebChat isolation — getSessionHistoryForSender + buildConversationContext
// ---------------------------------------------------------------------------

describe('WebChat isolation: getSessionHistoryForSender', () => {
  let db: Database.Database;
  const SESSION_ID = 'test-session-isolation';
  const SENDER_A = 'webchat-user-aaa';
  const SENDER_B = 'webchat-user-bbb';

  beforeEach(() => {
    db = openDatabase(':memory:');

    // Insert 5 messages for sender-A
    for (let i = 1; i <= 5; i++) {
      recordMessage(db, {
        session_id: SESSION_ID,
        role: 'user',
        content: `Sender A message ${i}`,
        channel: 'webchat',
        user_id: SENDER_A,
      } satisfies ConversationEntry);
    }

    // Insert 5 messages for sender-B in the SAME session
    for (let i = 1; i <= 5; i++) {
      recordMessage(db, {
        session_id: SESSION_ID,
        role: 'user',
        content: `Sender B message ${i}`,
        channel: 'webchat',
        user_id: SENDER_B,
      } satisfies ConversationEntry);
    }
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('returns only 5 messages for sender-A (not sender-B) from the shared session', () => {
    const history = getSessionHistoryForSender(db, SESSION_ID, SENDER_A);
    expect(history).toHaveLength(5);
    expect(history.every((e) => e.user_id === SENDER_A)).toBe(true);
  });

  it('returns only 5 messages for sender-B (not sender-A) from the shared session', () => {
    const history = getSessionHistoryForSender(db, SESSION_ID, SENDER_B);
    expect(history).toHaveLength(5);
    expect(history.every((e) => e.user_id === SENDER_B)).toBe(true);
  });

  it('does not leak sender-B content into sender-A results', () => {
    const history = getSessionHistoryForSender(db, SESSION_ID, SENDER_A);
    const contents = history.map((e) => e.content);
    expect(contents.every((c) => c.startsWith('Sender A'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. buildConversationContext() with sender → isolates session history
// ---------------------------------------------------------------------------

describe('buildConversationContext() sender isolation', () => {
  let db: Database.Database;
  const SESSION_ID = 'ctx-session-isolation';
  const SENDER_A = 'webchat-ctx-aaa';
  const SENDER_B = 'webchat-ctx-bbb';

  beforeEach(() => {
    db = openDatabase(':memory:');

    // Insert sender-A messages (user + master roles to match filter)
    for (let i = 1; i <= 5; i++) {
      recordMessage(db, {
        session_id: SESSION_ID,
        role: i % 2 === 0 ? 'master' : 'user',
        content: `SenderA turn ${i}`,
        channel: 'webchat',
        user_id: SENDER_A,
      } satisfies ConversationEntry);
    }

    // Insert sender-B messages in the SAME session
    for (let i = 1; i <= 5; i++) {
      recordMessage(db, {
        session_id: SESSION_ID,
        role: i % 2 === 0 ? 'master' : 'user',
        content: `SenderB turn ${i}`,
        channel: 'webchat',
        user_id: SENDER_B,
      } satisfies ConversationEntry);
    }
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('includes only sender-A messages in context when sender=SENDER_A', async () => {
    // Build a mock MemoryManager that delegates to the real DB
    const mockMemory = {
      getSessionHistoryForSender: (sessionId: string, sender: string, limit: number) =>
        Promise.resolve(getSessionHistoryForSender(db, sessionId, sender, limit)),
      getSessionHistory: (sessionId: string, limit: number) => {
        const rows = db
          .prepare(
            `SELECT id, session_id, role, content, channel, user_id, created_at
             FROM conversations
             WHERE session_id = ?
             ORDER BY created_at DESC LIMIT ?`,
          )
          .all(sessionId, limit) as ConversationEntry[];
        return Promise.resolve(rows.reverse());
      },
      searchConversations: (_query: string, _limit: number, _userId?: string) =>
        Promise.resolve([]),
    };

    // Build a minimal PromptContextBuilder deps object
    const builder = new PromptContextBuilder({
      workspacePath: '/tmp/test-workspace',
      dotFolder: {
        readMemoryFile: () => Promise.resolve(null),
      } as never,
      adapter: undefined,
      messageTimeout: 30_000,
      getMemory: () => mockMemory as never,
      getSystemPrompt: () => null,
      getMasterSession: () => null,
      getMapLastVerifiedAt: () => null,
      getLearningsSummary: () => null,
      getExplorationSummary: () => null,
      getWorkspaceContextSummary: () => null,
      getBatchManager: () => null,
      drainCancellationNotifications: () => [],
      drainDeepModeResumeOffers: () => [],
      readWorkspaceMapFromStore: () => Promise.resolve(null),
      readAllTasksFromStore: () => Promise.resolve([]),
    });

    const context = await builder.buildConversationContext(
      'what have we discussed?',
      SESSION_ID,
      SENDER_A,
    );

    // Context should be non-null (there are messages)
    expect(context).not.toBeNull();
    // All content must come from sender-A only
    expect(context).toContain('SenderA');
    expect(context).not.toContain('SenderB');
  });
});
