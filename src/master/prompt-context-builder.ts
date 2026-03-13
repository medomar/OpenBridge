/** PromptContextBuilder — extracted from MasterManager (OB-1282, OB-F158). */

import {
  PromptAssembler,
  PRIORITY_IDENTITY,
  PRIORITY_WORKSPACE,
  PRIORITY_MEMORY,
  PRIORITY_RAG,
  PRIORITY_LEARNINGS,
  PRIORITY_WORKER_NEXT,
  PRIORITY_ANALYSIS,
} from '../core/prompt-assembler.js';
import { listDocTypes, getDocType } from '../intelligence/doctype-store.js';
import { getTopSkills } from '../intelligence/skill-creator.js';
import { buildUserPreferencesSection } from '../intelligence/user-preferences.js';
import type { CLIAdapter } from '../core/cli-adapter.js';
import type { SpawnOptions } from '../core/agent-runner.js';
import {
  formatLearnedPatternsSection,
  formatWorkerNextStepsSection,
  formatPreFetchedKnowledgeSection,
  formatTargetedReaderSection,
  formatTemplateSelectionSection,
} from './master-system-prompt.js';
import type { WorkerNextStepsEntry } from './master-system-prompt.js';
import type { DotFolderManager } from './dotfolder-manager.js';
import type { MemoryManager } from '../memory/index.js';
import type {
  MasterSession,
  ExplorationSummary,
  TaskRecord,
  LearningEntry,
  WorkspaceMap,
} from '../types/master.js';
import type { BatchManager } from './batch-manager.js';
import { MESSAGE_MAX_TURNS_QUICK } from './classification-engine.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('prompt-context-builder');

// ---------------------------------------------------------------------------
// Constants (moved from master-manager.ts)
// ---------------------------------------------------------------------------

/** Maximum number of recent tasks to include in a context summary on restart */
const RESTART_CONTEXT_TASK_LIMIT = 10;

/**
 * Format an ISO timestamp as a human-readable "X ago" string.
 * Used to show the Master how fresh its workspace knowledge is.
 */
export function formatTimeAgo(isoTimestamp: string): string {
  const ms = Date.now() - new Date(isoTimestamp).getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} day${days !== 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  return 'just now';
}

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

/**
 * Optional pre-formatted context sections to inject into the Master system prompt.
 * Passed to buildMasterSpawnOptions() so PromptAssembler can budget-rank them.
 */
export interface MasterContextSections {
  conversationContext?: string | null;
  learnedPatternsContext?: string | null;
  workerNextStepsContext?: string | null;
  knowledgeContext?: string | null;
  targetedReaderContext?: string | null;
  analysisContext?: string | null;
  /** Industry template suggestion — only injected when no DocTypes exist (OB-1466). */
  templateSelectionContext?: string | null;
  /** Learned skills section — top-10 skills with usage stats (OB-1471). */
  learnedSkillsContext?: string | null;
  /** User preferences section — per-sender format/language/hours (OB-1474). */
  userPreferencesContext?: string | null;
}

// ---------------------------------------------------------------------------
// Dependencies interface — callbacks + shared references from MasterManager
// ---------------------------------------------------------------------------

export interface PromptContextBuilderDeps {
  workspacePath: string;
  dotFolder: DotFolderManager;
  adapter?: CLIAdapter;
  messageTimeout: number;

  // Mutable references via getters
  getMemory: () => MemoryManager | null;
  getSystemPrompt: () => string | null;
  getMasterSession: () => MasterSession | null;
  getMapLastVerifiedAt: () => string | null;
  getLearningsSummary: () => string | null;
  getExplorationSummary: () => ExplorationSummary | null;
  getWorkspaceContextSummary: () => string | null;
  getBatchManager: () => BatchManager | null;

  // Drain operations — return and clear pending items
  drainCancellationNotifications: () => string[];
  drainDeepModeResumeOffers: () => string[];

  // Store helpers delegated back to MasterManager
  readWorkspaceMapFromStore: () => Promise<WorkspaceMap | null>;
  readAllTasksFromStore: () => Promise<TaskRecord[]>;
}

// ---------------------------------------------------------------------------
// PromptContextBuilder class
// ---------------------------------------------------------------------------

export class PromptContextBuilder {
  private deps: PromptContextBuilderDeps;

  constructor(deps: PromptContextBuilderDeps) {
    this.deps = deps;
  }

  /** Update mutable dependency references (e.g. after memory init). */
  updateDeps(partial: Partial<PromptContextBuilderDeps>): void {
    this.deps = { ...this.deps, ...partial };
  }

  // -------------------------------------------------------------------------
  // buildMasterSpawnOptions (OB-1246)
  // -------------------------------------------------------------------------

  /**
   * Assemble SpawnOptions for a Master AI call — attaches a budget-ranked system prompt.
   * Uses PromptAssembler for budget-aware system prompt construction.
   * Each context section is prioritized so lower-priority content is truncated
   * or dropped when the total budget is exceeded.
   */
  buildMasterSpawnOptions(
    prompt: string,
    timeout?: number,
    maxTurns?: number,
    contextSections?: MasterContextSections,
    skipWorkspaceContext?: boolean,
  ): SpawnOptions {
    const session = this.deps.getMasterSession();
    if (!session) {
      throw new Error('Master session not initialized — call initMasterSession() first');
    }
    const opts: SpawnOptions = {
      prompt,
      workspacePath: this.deps.workspacePath,
      allowedTools: [...session.allowedTools],
      maxTurns: maxTurns ?? MESSAGE_MAX_TURNS_QUICK,
      timeout: timeout ?? this.deps.messageTimeout,
      retries: 0, // Master session calls don't auto-retry (caller handles)
    };

    // Retrieve adapter-aware system prompt budget (OB-F147/OB-F148)
    const budget = this.deps.adapter?.getPromptBudget?.() ?? { maxSystemPromptChars: 100_000 };
    const assembler = new PromptAssembler();

    // Base system prompt — identity and rules (highest priority)
    const systemPrompt = this.deps.getSystemPrompt();
    if (systemPrompt) {
      assembler.addSection('System Prompt', systemPrompt, PRIORITY_IDENTITY);
    }

    // Drain pending cancellation notifications (OB-884).
    const cancellations = this.deps.drainCancellationNotifications();
    if (cancellations.length > 0) {
      assembler.addSection(
        'Worker Cancellations',
        '## IMPORTANT — Worker Cancellation Events\n\n' + cancellations.join('\n'),
        95,
      );
    }

    // Drain pending Deep Mode resume offers (OB-1405).
    const resumeOffers = this.deps.drainDeepModeResumeOffers();
    if (resumeOffers.length > 0) {
      assembler.addSection(
        'Deep Mode Resume',
        '## IMPORTANT — Incomplete Deep Mode Sessions\n\n' + resumeOffers.join('\n\n'),
        93,
      );
    }

    // Batch context — important for task continuity (OB-1617)
    const batchManager = this.deps.getBatchManager();
    if (batchManager) {
      const activeBatchId = batchManager.getCurrentBatchId();
      if (activeBatchId) {
        const batchContext = batchManager.buildBatchContextSection(activeBatchId);
        if (batchContext) {
          assembler.addSection('Batch Context', batchContext, 85);
        }
      }
    }

    // Workspace knowledge — project type, frameworks, structure
    const explorationSummary = this.deps.getExplorationSummary();
    if (!skipWorkspaceContext && explorationSummary?.status === 'completed') {
      const mapContext = this.deps.getWorkspaceContextSummary();
      if (mapContext) {
        let contextText = mapContext;
        const mapLastVerifiedAt = this.deps.getMapLastVerifiedAt();
        if (mapLastVerifiedAt) {
          contextText += `\n\nMap last verified: ${formatTimeAgo(mapLastVerifiedAt)}`;
        }
        assembler.addSection(
          'Workspace Knowledge',
          '## Current Workspace Knowledge\n\n' + contextText,
          PRIORITY_WORKSPACE,
        );
      }
    }

    // Available DocTypes — registered business data entities
    const docTypesSection = this.buildDocTypesSection();
    if (docTypesSection) {
      assembler.addSection('Available DocTypes', docTypesSection, 75);
    }

    // Learned skills — top-10 reusable skill patterns (OB-1471)
    if (contextSections?.learnedSkillsContext) {
      assembler.addSection('Learned Skills', contextSections.learnedSkillsContext, 73);
    }

    // User preferences — per-sender format/language/working-hours (OB-1474)
    if (contextSections?.userPreferencesContext) {
      assembler.addSection('User Preferences', contextSections.userPreferencesContext, 71);
    }

    // Industry template suggestion — only when no DocTypes exist (OB-1466)
    if (contextSections?.templateSelectionContext) {
      assembler.addSection('Template Selection', contextSections.templateSelectionContext, 72);
    }

    // Conversation context — memory.md + session history + cross-session FTS5
    if (contextSections?.conversationContext) {
      assembler.addSection(
        'Conversation Context',
        contextSections.conversationContext,
        PRIORITY_MEMORY,
      );
    }

    // Pre-fetched knowledge (RAG)
    if (contextSections?.knowledgeContext) {
      assembler.addSection(
        'Knowledge Context',
        formatPreFetchedKnowledgeSection(contextSections.knowledgeContext),
        PRIORITY_RAG,
      );
    }

    // Targeted reader results
    if (contextSections?.targetedReaderContext) {
      assembler.addSection(
        'Targeted Reader',
        formatTargetedReaderSection(contextSections.targetedReaderContext),
        55,
      );
    }

    // Learned patterns — model success rates, effective prompt templates
    if (contextSections?.learnedPatternsContext) {
      assembler.addSection(
        'Learned Patterns',
        contextSections.learnedPatternsContext,
        PRIORITY_LEARNINGS + 5,
      );
    }

    // Learnings summary — past task outcomes
    const learningsSummary = this.deps.getLearningsSummary();
    if (learningsSummary) {
      assembler.addSection(
        'Learnings',
        '## Learnings from Past Tasks\n\n' + learningsSummary,
        PRIORITY_LEARNINGS,
      );
    }

    // Worker next steps — follow-up work from recent workers
    if (contextSections?.workerNextStepsContext) {
      assembler.addSection(
        'Worker Next Steps',
        contextSections.workerNextStepsContext,
        PRIORITY_WORKER_NEXT,
      );
    }

    // Analysis context — planning gate output
    if (contextSections?.analysisContext) {
      assembler.addSection('Analysis Context', contextSections.analysisContext, PRIORITY_ANALYSIS);
    }

    const assembled = assembler.assemble(budget.maxSystemPromptChars);
    if (assembled) {
      opts.systemPrompt = assembled;
    }

    return opts;
  }

  // -------------------------------------------------------------------------
  // buildDocTypesSection (OB-1385)
  // -------------------------------------------------------------------------

  /**
   * Build the "## Available Business Data (DocTypes)" section for injection into
   * the Master system prompt. Lists all registered DocTypes with their fields and
   * available state-machine actions. Returns null when no DocTypes are registered
   * or the database is unavailable.
   */
  private buildDocTypesSection(): string | null {
    const memory = this.deps.getMemory();
    if (!memory) return null;
    const db = memory.getDb();
    if (!db) return null;

    let doctypes: ReturnType<typeof listDocTypes>;
    try {
      doctypes = listDocTypes(db);
    } catch {
      return null;
    }
    if (doctypes.length === 0) return null;

    const lines: string[] = ['## Available Business Data (DocTypes)', ''];

    for (const dt of doctypes) {
      lines.push(`### ${dt.label_plural} (\`${dt.name}\`)`);

      let full: ReturnType<typeof getDocType> | null = null;
      try {
        full = getDocType(db, dt.id);
      } catch {
        // If full detail fails, show minimal info
      }

      if (full) {
        // Fields
        const visibleFields = full.fields.sort((a, b) => a.sort_order - b.sort_order).slice(0, 8); // cap at 8 fields to avoid prompt bloat
        if (visibleFields.length > 0) {
          const fieldList = visibleFields
            .map((f) => {
              const req = f.required ? '*' : '';
              return `  - \`${f.name}\` (${f.field_type})${req}`;
            })
            .join('\n');
          lines.push('**Fields:**');
          lines.push(fieldList);
        }

        // Available actions (transitions)
        const uniqueActions = [
          ...new Map(full.transitions.map((t) => [t.action_name, t.action_label])).entries(),
        ];
        if (uniqueActions.length > 0) {
          const actionList = uniqueActions.map(([, label]) => `  - ${label}`).join('\n');
          lines.push('**Actions:**');
          lines.push(actionList);
        }
      }

      // Example commands
      const singular = dt.label_singular.toLowerCase();
      const plural = dt.label_plural.toLowerCase();
      lines.push('**Example commands:**');
      lines.push(`  - "list ${plural}"`);
      lines.push(`  - "create ${singular} for X"`);
      if (full && full.transitions.length > 0) {
        const firstAction = full.transitions[0];
        if (firstAction) {
          lines.push(`  - "${firstAction.action_label} ${singular} #42"`);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // buildLearnedSkillsContext (OB-1471)
  // -------------------------------------------------------------------------

  /**
   * Build the "## Learned Skills" section listing the top 10 skills by effectiveness.
   * Returns null when no skills are stored or the database is unavailable.
   */
  buildLearnedSkillsContext(): string | null {
    const memory = this.deps.getMemory();
    if (!memory) return null;
    const db = memory.getDb();
    if (!db) return null;

    let skills: ReturnType<typeof getTopSkills>;
    try {
      skills = getTopSkills(db, 10);
    } catch {
      return null;
    }
    if (skills.length === 0) return null;

    const lines: string[] = [
      '## Learned Skills',
      '',
      'You have built up reusable skill patterns from past tasks. When a user request matches a skill below, **prefer executing that learned skill** over generating a new plan from scratch.',
      '',
    ];

    for (const skill of skills) {
      const usageLine =
        skill.usageCount > 0
          ? ` | used ${skill.usageCount}× | ${Math.round(skill.successRate * 100)}% success`
          : ' | not yet executed';
      const durationLine =
        skill.avgDurationMs !== null ? ` | avg ${Math.round(skill.avgDurationMs / 1000)}s` : '';
      lines.push(`### ${skill.name}${usageLine}${durationLine}`);
      lines.push(skill.description);
      if (skill.steps.length > 0) {
        lines.push(
          `**Steps:** ${skill.steps.slice(0, 5).join(' → ')}${skill.steps.length > 5 ? ` → … (${skill.steps.length} steps total)` : ''}`,
        );
      }
      if (skill.requiredDocTypes.length > 0) {
        lines.push(`**DocTypes:** ${skill.requiredDocTypes.join(', ')}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // buildUserPreferencesContext (OB-1474)
  // -------------------------------------------------------------------------

  /**
   * Build the "## User Preferences for {sender}" section for the given sender.
   * Returns null when no preference data is stored or the database is unavailable.
   */
  buildUserPreferencesContext(sender: string): string | null {
    const memory = this.deps.getMemory();
    if (!memory) return null;
    const db = memory.getDb();
    if (!db) return null;

    try {
      return buildUserPreferencesSection(db, sender);
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // buildTemplateSelectionContext (OB-1466)
  // -------------------------------------------------------------------------

  /**
   * Build the "## Industry Template Available" section for injection when
   * no DocTypes are registered but industry templates exist in the workspace.
   * Returns null when DocTypes already exist or no templates are available.
   */
  async buildTemplateSelectionContext(): Promise<string | null> {
    const memory = this.deps.getMemory();
    if (!memory) return null;
    const db = memory.getDb();
    if (!db) return null;

    // Only suggest templates when the user has no DocTypes yet
    let doctypeCount: number;
    try {
      doctypeCount = listDocTypes(db).length;
    } catch {
      return null;
    }
    if (doctypeCount > 0) return null;

    // List templates available in the workspace
    const templates = await this.deps.dotFolder.listAvailableTemplates();
    if (templates.length === 0) return null;

    return formatTemplateSelectionSection(templates);
  }

  // -------------------------------------------------------------------------
  // buildConversationContext (OB-731, OB-1022, OB-1025)
  // -------------------------------------------------------------------------

  /**
   * Retrieve conversation context for the Master's system prompt.
   *
   * Three layers (in order):
   *   1. Recent session messages — last 10 user+master turns from the current session.
   *   2. memory.md — Master's curated brain (always small, always relevant).
   *   3. Cross-session FTS5 — BM25-ranked hits from past sessions.
   */
  async buildConversationContext(userMessage: string, sessionId?: string): Promise<string | null> {
    const sections: string[] = [];
    const memory = this.deps.getMemory();

    // Layer 1: Recent conversation messages from the CURRENT session
    if (sessionId && memory) {
      try {
        const sessionMessages = await memory.getSessionHistory(sessionId, 20);
        const relevant = sessionMessages
          .filter((e) => e.role === 'user' || e.role === 'master')
          .slice(-10);
        if (relevant.length > 0) {
          const lines = relevant.map((e) => {
            const label = e.role === 'user' ? 'User' : 'You';
            const content = e.content.length > 400 ? e.content.slice(0, 400) + '…' : e.content;
            return `${label}: ${content}`;
          });
          sections.push('## Recent conversation (this session):\n' + lines.join('\n'));
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to load session history for context injection');
      }
    }

    // Layer 2: load memory.md (OB-1022)
    try {
      const memoryContent = await this.deps.dotFolder.readMemoryFile();
      if (memoryContent && memoryContent.trim().length > 0) {
        sections.push('## Memory:\n' + memoryContent.trim());
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to read memory.md for context injection');
    }

    // Layer 3: cross-session FTS5 search via searchConversations() (OB-1025).
    if (memory) {
      try {
        const crossSession = await memory.searchConversations(userMessage, 5);
        const relevant = crossSession.filter((e) => e.role === 'user' || e.role === 'master');
        if (relevant.length > 0) {
          const lines = relevant.map((e) => {
            const dateStr = e.created_at
              ? new Date(e.created_at).toISOString().replace('T', ' ').slice(0, 16)
              : '';
            const label = e.role === 'user' ? 'User' : 'Master';
            const snippet = e.content.length > 500 ? e.content.slice(0, 500) + '…' : e.content;
            return dateStr ? `[${dateStr}] ${label}: ${snippet}` : `${label}: ${snippet}`;
          });
          sections.push('## Related past conversations:\n' + lines.join('\n'));
        }
      } catch (err) {
        logger.warn(
          { err },
          'Failed to retrieve cross-session conversation history for context injection',
        );
      }
    }

    return sections.length > 0 ? sections.join('\n\n') : null;
  }

  // -------------------------------------------------------------------------
  // buildLearnedPatternsContext (OB-735)
  // -------------------------------------------------------------------------

  /**
   * Build the "## Learned Patterns" section for injection into the Master system prompt.
   * Returns null when there is insufficient data or MemoryManager is unavailable.
   */
  async buildLearnedPatternsContext(): Promise<string | null> {
    const memory = this.deps.getMemory();
    if (!memory) return null;
    try {
      const [allLearnings, effectivePrompts] = await Promise.all([
        memory.getLearnedTaskTypes(),
        memory.getHighEffectivenessPrompts(0.7, 5),
      ]);

      const modelLearnings = allLearnings
        .filter((l) => l.successCount + l.failureCount > 5)
        .map((l) => ({
          taskType: l.taskType,
          bestModel: l.bestModel,
          successRate: l.successRate,
          totalTasks: l.successCount + l.failureCount,
        }));

      const promptPatterns = effectivePrompts.map((p) => ({
        name: p.name,
        effectiveness: p.effectiveness,
        usageCount: p.usage_count,
      }));

      return formatLearnedPatternsSection({ modelLearnings, effectivePrompts: promptPatterns });
    } catch (err) {
      logger.warn({ err }, 'Failed to build learned patterns context');
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // buildWorkerNextStepsContext (OB-1635)
  // -------------------------------------------------------------------------

  /**
   * Read next_steps from the 5 most recent completed worker summaries.
   * Returns null when no workers have a summary or none reported follow-up work.
   */
  async buildWorkerNextStepsContext(): Promise<string | null> {
    const memory = this.deps.getMemory();
    if (!memory) return null;
    try {
      const recentWorkers = await memory.getRecentWorkerSpawns(5);
      const entries: WorkerNextStepsEntry[] = [];
      for (const worker of recentWorkers) {
        if (!worker.summary_json) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(worker.summary_json);
        } catch {
          continue;
        }
        const parsedRecord =
          typeof parsed === 'object' && parsed !== null
            ? (parsed as Record<string, unknown>)
            : null;
        const nextSteps =
          parsedRecord !== null && typeof parsedRecord['next_steps'] === 'string'
            ? parsedRecord['next_steps']
            : '';
        entries.push({
          taskSummary: worker.task_summary ?? '',
          nextSteps,
        });
      }
      return formatWorkerNextStepsSection(entries);
    } catch (err) {
      logger.warn({ err }, 'Failed to build worker next steps context');
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // buildLearningsSummary
  // -------------------------------------------------------------------------

  /**
   * Build a concise summary of past learnings for system prompt injection.
   * Groups the most recent entries by task type and computes stats.
   * Capped at ~2000 chars to avoid prompt bloat.
   */
  buildLearningsSummary(entries: LearningEntry[]): string | null {
    const recent = entries.slice(-50);
    if (recent.length === 0) return null;

    const byType = new Map<string, LearningEntry[]>();
    for (const entry of recent) {
      const group = byType.get(entry.taskType) ?? [];
      group.push(entry);
      byType.set(entry.taskType, group);
    }

    const lines: string[] = [`Based on ${recent.length} recent task executions:`, ''];

    for (const [taskType, group] of byType) {
      if (group.length < 3) continue;

      const successes = group.filter((e) => e.success);
      const successRate = ((successes.length / group.length) * 100).toFixed(0);
      const avgDuration = Math.round(
        group.reduce((sum, e) => sum + e.durationMs, 0) / group.length,
      );

      const modelStats = new Map<string, { total: number; success: number }>();
      for (const e of group) {
        const model = e.modelUsed ?? 'unknown';
        const stats = modelStats.get(model) ?? { total: 0, success: 0 };
        stats.total++;
        if (e.success) stats.success++;
        modelStats.set(model, stats);
      }
      const bestModel = [...modelStats.entries()]
        .filter(([, s]) => s.total >= 2)
        .sort((a, b) => b[1].success / b[1].total - a[1].success / a[1].total)[0];

      const profileStats = new Map<string, { total: number; success: number }>();
      for (const e of group) {
        const profile = e.profileUsed ?? 'unknown';
        const stats = profileStats.get(profile) ?? { total: 0, success: 0 };
        stats.total++;
        if (e.success) stats.success++;
        profileStats.set(profile, stats);
      }
      const bestProfile = [...profileStats.entries()]
        .filter(([, s]) => s.total >= 2)
        .sort((a, b) => b[1].success / b[1].total - a[1].success / a[1].total)[0];

      let line = `- **${taskType}**: ${successRate}% success (${group.length} tasks, avg ${avgDuration}ms)`;
      if (bestModel) {
        const modelRate = ((bestModel[1].success / bestModel[1].total) * 100).toFixed(0);
        line += ` — best model: ${bestModel[0]} (${modelRate}%)`;
      }
      if (bestProfile) {
        line += ` — best profile: ${bestProfile[0]}`;
      }
      lines.push(line);
    }

    if (lines.length <= 2) return null;

    const summary = lines.join('\n');
    if (summary.length > 2000) {
      return summary.slice(0, 1997) + '...';
    }
    return summary;
  }

  // -------------------------------------------------------------------------
  // buildContextSummary (session restart recovery)
  // -------------------------------------------------------------------------

  /**
   * Build a context summary for a restarted Master session.
   * Loads workspace-map.json and recent task history to seed the new session.
   */
  async buildContextSummary(): Promise<string> {
    const parts: string[] = [];

    parts.push(
      '# Session Context Recovery',
      '',
      'Your previous session ended unexpectedly. Here is the accumulated context to resume from:',
      '',
    );

    const map = await this.deps.readWorkspaceMapFromStore();
    if (map) {
      parts.push('## Workspace Summary');
      parts.push(`- **Project:** ${map.projectName} (${map.projectType})`);
      parts.push(`- **Path:** ${map.workspacePath}`);
      if (map.frameworks.length > 0) {
        parts.push(`- **Frameworks:** ${map.frameworks.join(', ')}`);
      }
      parts.push(`- **Summary:** ${map.summary}`);
      parts.push('');
    }

    const tasks = await this.deps.readAllTasksFromStore();
    if (tasks.length > 0) {
      const recentTasks = tasks
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, RESTART_CONTEXT_TASK_LIMIT);

      parts.push('## Recent Task History');
      for (const task of recentTasks) {
        const status = task.status === 'completed' ? 'completed' : task.status;
        parts.push(`- [${status}] "${task.description.slice(0, 100)}" (from ${task.sender})`);
        if (task.result) {
          parts.push(`  Result: ${task.result.slice(0, 200)}`);
        }
      }
      parts.push('');
    }

    parts.push('Continue operating normally. Respond to the next user message as usual.');

    return parts.join('\n');
  }
}
