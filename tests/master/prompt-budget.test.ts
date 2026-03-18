/**
 * OB-1516 — Prompt budget tests
 *
 * Test 1: Build a conversation context with 50 turns of history, assert the
 *         assembled prompt is under 32K chars and all sections are present
 *         (system prompt, workspace, RAG, conversation history).
 *
 * Test 2: Verify that when conversation history is 200K chars, it is trimmed
 *         to the 10K budget while keeping the most recent messages.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  PromptContextBuilder,
  trimKeepingRecentMessages,
  SECTION_BUDGET_SYSTEM_PROMPT,
  SECTION_BUDGET_MEMORY,
  SECTION_BUDGET_WORKSPACE_MAP,
  SECTION_BUDGET_RAG,
  SECTION_BUDGET_CONVERSATION_HISTORY,
} from '../../src/master/prompt-context-builder.js';
import type { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import type { MasterSession, ExplorationSummary } from '../../src/types/master.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a minimal PromptContextBuilder suitable for unit testing. */
function buildMockBuilder(
  systemPrompt: string,
  workspaceMap: string | null = null,
): PromptContextBuilder {
  const session: MasterSession = {
    sessionId: 'test-session-id',
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    messageCount: 0,
    allowedTools: ['Read', 'Write', 'Edit'],
    maxTurns: 50,
  };

  return new PromptContextBuilder({
    workspacePath: '/test/workspace',
    messageTimeout: 30_000,
    dotFolder: {
      readMemoryFile: vi.fn().mockResolvedValue(null),
      listAvailableTemplates: vi.fn().mockResolvedValue([]),
    } as unknown as DotFolderManager,
    getMemory: () => null,
    getSystemPrompt: () => systemPrompt,
    getMasterSession: () => session,
    getMapLastVerifiedAt: () => null,
    getLearningsSummary: () => null,
    getExplorationSummary: (): ExplorationSummary | null => {
      if (!workspaceMap) return null;
      return {
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: 'completed',
        filesScanned: 0,
        directoriesExplored: 0,
        frameworks: [],
        insights: [],
        gitInitialized: false,
      };
    },
    getWorkspaceContextSummary: () => workspaceMap,
    getBatchManager: () => null,
    drainCancellationNotifications: () => [],
    drainDeepModeResumeOffers: () => [],
    readWorkspaceMapFromStore: vi.fn().mockResolvedValue(null),
    readAllTasksFromStore: vi.fn().mockResolvedValue([]),
  });
}

// ── Suite 1: assembled prompt stays under 32K with 50 turns of history ─────────

describe('prompt budget — assembled prompt under 32K', () => {
  it('keeps assembled prompt under total section budget with 50 turns of history', () => {
    // Total budget = sum of all individual section caps
    const TOTAL_BUDGET =
      SECTION_BUDGET_SYSTEM_PROMPT + // 8K
      SECTION_BUDGET_MEMORY + // 4K (conversation section combines memory + history)
      SECTION_BUDGET_WORKSPACE_MAP + // 4K
      SECTION_BUDGET_RAG + // 6K
      SECTION_BUDGET_CONVERSATION_HISTORY; // 10K

    // Each section is twice its budget — assembler must trim each to its cap
    const systemPrompt = '## IDENTITY_SECTION\n' + 'I'.repeat(SECTION_BUDGET_SYSTEM_PROMPT * 2);
    const workspaceMap = 'W'.repeat(SECTION_BUDGET_WORKSPACE_MAP * 2);
    const ragContent = 'R'.repeat(SECTION_BUDGET_RAG * 2);

    // 50 turns of conversation history — padded so the section exceeds 14K
    const turns = Array.from({ length: 50 }, (_, i) => {
      const padding = ' '.repeat(350);
      return `User: Message ${i + 1}${padding}\nYou: Reply ${i + 1}${padding}`;
    }).join('\n');
    const conversationContext = '## Recent conversation (this session):\n' + turns;

    const builder = buildMockBuilder(systemPrompt, workspaceMap);

    const result = builder.buildMasterSpawnOptions('test user message', undefined, undefined, {
      conversationContext,
      knowledgeContext: ragContent,
    });

    expect(result.systemPrompt).toBeDefined();
    const assembled = result.systemPrompt!;

    // Primary assertion: total must not exceed sum of section budgets
    // (+20 chars tolerance for \n\n separators between assembled sections)
    expect(assembled.length).toBeLessThanOrEqual(TOTAL_BUDGET + 20);

    // All sections must be present in the assembled output
    expect(assembled).toContain('## IDENTITY_SECTION'); // system prompt
    expect(assembled).toContain('## Current Workspace Knowledge'); // workspace map
    expect(assembled).toContain('## Recent conversation'); // conversation history
    expect(assembled).toContain('## Pre-fetched Knowledge'); // RAG
  });
});

// ── Suite 2: 200K conversation history trimmed to 10K keeping recent messages ──

describe('prompt budget — conversation history trimming', () => {
  it('trims 200K conversation history to 10K budget keeping most recent messages', () => {
    const budget = SECTION_BUDGET_CONVERSATION_HISTORY; // 10_000
    const header = '## Recent conversation (this session):';

    // Build messages padded to ~500 chars each — total well over 200K
    const messages = Array.from({ length: 500 }, (_, i) => {
      const padding = ' '.repeat(400);
      return `User: Message number ${i + 1}${padding}\nYou: Reply ${i + 1}.`;
    });

    // Add a uniquely identifiable final message
    const finalMarker = `User: FINAL_MARKER_MSG_${Date.now()}`;
    messages.push(finalMarker);

    const section = header + '\n' + messages.join('\n');
    expect(section.length).toBeGreaterThan(200_000);

    const trimmed = trimKeepingRecentMessages(section, budget);

    // Must stay within budget
    expect(trimmed.length).toBeLessThanOrEqual(budget);

    // Header must be preserved
    expect(trimmed).toContain(header);

    // Most recent (last) message must survive the trim
    expect(trimmed).toContain('FINAL_MARKER_MSG_');

    // Very early messages must have been dropped
    expect(trimmed).not.toContain('Message number 1 ');
  });

  it('preserves all messages when section already fits within budget', () => {
    const budget = SECTION_BUDGET_CONVERSATION_HISTORY; // 10_000
    const header = '## Recent conversation (this session):';

    const messages = Array.from(
      { length: 5 },
      (_, i) => `User: Short message ${i + 1}\nYou: Short reply ${i + 1}`,
    ).join('\n');
    const section = header + '\n' + messages;

    expect(section.length).toBeLessThan(budget);

    const trimmed = trimKeepingRecentMessages(section, budget);

    // All messages preserved when section fits
    expect(trimmed).toContain('Short message 1');
    expect(trimmed).toContain('Short message 5');
  });
});
