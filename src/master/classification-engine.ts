/**
 * ClassificationEngine — extracted from MasterManager (OB-1279, OB-F158).
 *
 * Handles task classification via keyword heuristics and AI-powered analysis.
 * Manages the classification cache (in-memory + persisted to DB/JSON).
 */

import type { ClassificationCacheEntry, ClassificationCache } from '../types/master.js';
import { ClassificationCacheSchema } from '../types/master.js';
import type { CLIAdapter } from '../core/cli-adapter.js';
import type { AgentRunner } from '../core/agent-runner.js';
import type { ModelRegistry } from '../core/model-registry.js';
import type { MemoryManager } from '../memory/index.js';
import type { DotFolderManager } from './dotfolder-manager.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('classification-engine');

// ---------------------------------------------------------------------------
// Constants — classification turn budgets and timeout computation
// ---------------------------------------------------------------------------

/**
 * Per-turn wall-clock budget in milliseconds.
 * Used to compute per-class timeouts: timeout = CLI_STARTUP_BUDGET_MS + maxTurns × PER_TURN_BUDGET_MS.
 * 30s/turn gives quick-answer(5) = 60+150=210s, tool-use(15) = 60+450=510s, complex-task(25) = 60+750=810s.
 */
export const PER_TURN_BUDGET_MS = 30_000;

/**
 * Fixed startup budget added to every timeout.
 * Covers CLI cold-start overhead (model loading, API connection, MCP init).
 * Without this, low-turn tasks (quick-answer=5 turns) can timeout before
 * the CLI even starts generating output.
 */
export const CLI_STARTUP_BUDGET_MS = 60_000;

/** Compute wall-clock timeout from a turn budget (includes CLI startup overhead). */
export function turnsToTimeout(maxTurns: number): number {
  return CLI_STARTUP_BUDGET_MS + maxTurns * PER_TURN_BUDGET_MS;
}

/**
 * Max turns for message processing — varies by task classification.
 * quick-answer: questions, lookups, explanations → 5 turns
 * text-generation: articles, strategies, long-form content → 10 turns
 * tool-use: file generation, single edits, targeted fixes → 15 turns
 * complex-task (planning): forces Master to output SPAWN markers → 25 turns
 */
export const MESSAGE_MAX_TURNS_QUICK = 5;
export const MESSAGE_MAX_TURNS_MENU_SELECTION = 2;
export const MESSAGE_MAX_TURNS_TEXT_GEN = 10;
export const MESSAGE_MAX_TURNS_TOOL_USE = 15;
export const MESSAGE_MAX_TURNS_PLANNING = 25;

/**
 * Classifier logic version — bump this when keyword/compound rules change.
 * Cache entries with a different version are treated as stale and re-classified.
 */
export const CLASSIFIER_VERSION = 3;

/** Maximum number of entries in the in-memory classification cache before LRU eviction (OB-F169). */
const MAX_CLASSIFICATION_CACHE_SIZE = 10_000;

// ---------------------------------------------------------------------------
// ClassificationResult — the public interface returned by classifyTask()
// ---------------------------------------------------------------------------

/**
 * Result returned by classifyTask() — includes class, suggested turn budget, and reasoning.
 * The maxTurns value is AI-suggested based on message content and workspace context,
 * replacing the fixed MESSAGE_MAX_TURNS_QUICK / MESSAGE_MAX_TURNS_TOOL_USE constants.
 */
export interface ClassificationResult {
  /** One of quick-answer, tool-use, complex-task, or menu-selection */
  class: 'quick-answer' | 'tool-use' | 'complex-task' | 'menu-selection';
  /** AI-suggested turn budget for this specific message */
  maxTurns: number;
  /** Computed wall-clock timeout in milliseconds (maxTurns × PER_TURN_BUDGET_MS) */
  timeout: number;
  /** Brief reason for the classification (for logging/debugging) */
  reason: string;
  /** When true, the task matches deep-mode keywords (audit, thorough review, etc.)
   *  and the Master should offer or activate Deep Mode analysis (OB-1404). */
  suggestDeepMode?: boolean;
  /** When true, the message matches batch-mode keywords (implement all, for each, etc.)
   *  and the Master should activate Batch Task Continuation (OB-1605). */
  batchMode?: boolean;
  /** When true, the message includes "commit after each" — BatchManager sets commitAfterEach (OB-1615). */
  commitAfterEach?: boolean;
  /** When true, RAG retrieval is skipped for this message (e.g. menu-selection, very short inputs). */
  skipRag?: boolean;
  /** When true, the message is a numeric menu selection from a previous numbered list (OB-1658). */
  menuSelection?: boolean;
  /** The option text extracted from the previous bot response for this menu selection (OB-1658). */
  selectedOptionText?: string;
}

// ---------------------------------------------------------------------------
// classifyTaskType — simple heuristic for learning analysis
// ---------------------------------------------------------------------------

/**
 * Classify task type based on prompt content.
 * Uses heuristics to categorize tasks for learning analysis.
 */
export function classifyTaskType(prompt: string): string {
  const lower = prompt.toLowerCase();

  if (lower.includes('refactor') || lower.includes('restructure') || lower.includes('reorganize')) {
    return 'refactoring';
  }
  if (
    lower.includes('bug') ||
    lower.includes('fix') ||
    lower.includes('error') ||
    lower.includes('issue')
  ) {
    return 'bug-fix';
  }
  if (lower.includes('test') || lower.includes('spec') || lower.includes('verify')) {
    return 'testing';
  }
  if (
    lower.includes('add') ||
    lower.includes('implement') ||
    lower.includes('create') ||
    lower.includes('feature')
  ) {
    return 'feature';
  }
  if (
    lower.includes('explore') ||
    lower.includes('analyze') ||
    lower.includes('investigate') ||
    lower.includes('find')
  ) {
    return 'exploration';
  }
  if (lower.includes('document') || lower.includes('explain') || lower.includes('describe')) {
    return 'documentation';
  }
  if (lower.includes('optimize') || lower.includes('improve') || lower.includes('performance')) {
    return 'optimization';
  }

  return 'task';
}

// ---------------------------------------------------------------------------
// ClassificationEngine — manages classification cache + keyword/AI classifiers
// ---------------------------------------------------------------------------

export interface ClassificationEngineDeps {
  memory: MemoryManager | null;
  dotFolder: DotFolderManager;
  agentRunner: AgentRunner;
  modelRegistry: ModelRegistry;
  workspacePath: string;
  adapter?: CLIAdapter;
  /** Callback to get the current workspace context summary for AI classifier prompts. */
  getWorkspaceContext: () => string | null;
}

export class ClassificationEngine {
  private readonly classificationCache = new Map<string, ClassificationCacheEntry>();
  private cacheLoaded = false;
  private deps: ClassificationEngineDeps;

  constructor(deps: ClassificationEngineDeps) {
    this.deps = deps;
  }

  /** Update mutable dependencies (e.g. when memory becomes available after init). */
  updateDeps(partial: Partial<ClassificationEngineDeps>): void {
    this.deps = { ...this.deps, ...partial };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Normalize a message for cache lookup.
   * Converts to lowercase, strips punctuation, and collapses whitespace.
   * This ensures "Create a README" and "create a readme" share the same cache entry.
   */
  normalizeForCache(content: string): string {
    return content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Record feedback for a classification after the task completes.
   * Updates the cached entry's feedback array and adjusts maxTurns if the
   * budget consistently proves insufficient.
   */
  async recordClassificationFeedback(
    normalizedKey: string,
    turnBudgetSufficient: boolean,
    timedOut: boolean,
    turnsUsed?: number,
  ): Promise<void> {
    const entry = this.classificationCache.get(normalizedKey);
    if (!entry) return;

    entry.feedback.push({
      recordedAt: new Date().toISOString(),
      turnBudgetSufficient,
      timedOut,
    });

    const recent = entry.feedback.slice(-3);
    const timeoutCount = recent.filter((f) => f.timedOut).length;
    if (recent.length >= 2 && timeoutCount >= 2) {
      logger.warn(
        {
          normalizedKey,
          taskClass: entry.result.class,
          maxTurns: entry.result.maxTurns,
          timeoutCount,
          recentFeedback: recent.length,
        },
        'Classification cache: repeated timeouts detected — task may need a higher wall-clock timeout',
      );
    }

    await this.persistClassificationCache();

    if (this.deps.memory) {
      void (async (): Promise<void> => {
        try {
          await this.deps.memory!.recordLearning(
            'classification',
            entry.result.class,
            turnBudgetSufficient,
            turnsUsed ?? 0,
            0,
          );
        } catch (err) {
          logger.warn({ err }, 'Failed to record classification learning to DB — non-fatal');
        }
      })();
    }
  }

  /**
   * AI-powered task classifier using a 1-turn haiku call.
   * Returns a ClassificationResult with class, AI-suggested maxTurns, and reason.
   * Falls back to keyword heuristics if the AI call fails or takes >3s.
   * Falls back to 'tool-use' with default turns if the JSON cannot be parsed.
   *
   * @param sessionId - When provided, fetches the last few user messages from the
   *   session so the keyword classifier can apply conversation context (OB-1582).
   */
  async classifyTask(content: string, sessionId?: string): Promise<ClassificationResult> {
    const CLASSIFIER_TIMEOUT_MS = 5000;

    await this.loadClassificationCache();
    const cacheKey = this.normalizeForCache(content);
    const cached = this.classificationCache.get(cacheKey);
    if (cached && (cached as Record<string, unknown>)['classifierVersion'] === CLASSIFIER_VERSION) {
      cached.hitCount++;
      logger.debug(
        { cacheKey, class: cached.result.class, hitCount: cached.hitCount },
        'Classification cache hit',
      );
      void this.persistClassificationCache();
      return { ...cached.result };
    }
    if (cached) {
      this.classificationCache.delete(cacheKey);
    }

    // Fetch recent user messages from session history for conversation context (OB-1582).
    let recentUserMessages: string[] | undefined;
    let lastBotResponse: string | undefined;
    if (sessionId && this.deps.memory) {
      try {
        const sessionMessages = await this.deps.memory.getSessionHistory(sessionId, 6);
        const userMessages = sessionMessages
          .filter((e) => e.role === 'user')
          .slice(-3)
          .map((e) => e.content);
        if (userMessages.length > 0) {
          recentUserMessages = userMessages;
        }
        const botMessages = sessionMessages
          .filter((e) => e.role === 'master')
          .slice(-1)
          .map((e) => e.content);
        if (botMessages.length > 0) {
          lastBotResponse = botMessages[0];
        }
      } catch {
        // Non-fatal: conversation context is a best-effort enhancement
      }
    }

    // Skip AI classifier for non-Claude adapters
    if (this.deps.adapter && this.deps.adapter.name !== 'claude') {
      logger.debug(
        { adapter: this.deps.adapter.name },
        'Skipping AI classifier for non-Claude adapter, using keyword heuristics',
      );
      const keywordResult = this.classifyTaskByKeywords(
        content,
        recentUserMessages,
        lastBotResponse,
      );
      this.classificationCache.set(cacheKey, {
        normalizedKey: cacheKey,
        result: keywordResult,
        recordedAt: new Date().toISOString(),
        hitCount: 0,
        feedback: [],
        classifierVersion: CLASSIFIER_VERSION,
        cachedAt: Date.now(),
      } as ClassificationCacheEntry);
      this.evictClassificationCacheIfNeeded();
      void this.persistClassificationCache();
      return keywordResult;
    }

    // Include workspace context so the AI can calibrate scope
    const workspaceCtx = this.deps.getWorkspaceContext();
    const contextSection = workspaceCtx ? `Workspace context:\n${workspaceCtx}\n\n` : '';

    const prompt =
      `You are a task classifier for an AI assistant. Analyze the user message and suggest how to handle it.\n\n` +
      contextSection +
      `User message: "${content}"\n\n` +
      `Classify the message and suggest a turn budget. Reply with ONLY a JSON object — no markdown, no explanation:\n` +
      `{"class":"<category>","maxTurns":<number>,"reason":"<brief reason>"}\n\n` +
      `Important rule: If the message references files, documents, spreadsheets, or has attachments, classify as tool-use or higher — never quick-answer.\n\n` +
      `Categories and turn guidance:\n` +
      `- "quick-answer": question, explanation, or lookup (no file changes) → maxTurns 1-5\n` +
      `- "tool-use": generate/create/write/fix a file or single targeted edit → maxTurns 5-20\n` +
      `- "complex-task": multi-step work requiring planning, many files, or full implementation → maxTurns 10-30`;

    let classificationResult: ClassificationResult;

    try {
      const result = await Promise.race([
        this.deps.agentRunner.spawn({
          prompt,
          workspacePath: this.deps.workspacePath,
          model: this.deps.modelRegistry.resolveModelOrTier('fast'),
          maxTurns: 1,
          retries: 0,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('classifier timeout')), CLASSIFIER_TIMEOUT_MS),
        ),
      ]);

      const raw = result.stdout.trim();

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
          const cls = parsed['class'];
          const turns = parsed['maxTurns'];
          const reason = typeof parsed['reason'] === 'string' ? parsed['reason'] : '';

          if (cls === 'quick-answer' || cls === 'tool-use' || cls === 'complex-task') {
            const maxTurns =
              typeof turns === 'number' && turns > 0 && turns <= 50
                ? turns
                : cls === 'quick-answer'
                  ? MESSAGE_MAX_TURNS_QUICK
                  : cls === 'tool-use'
                    ? MESSAGE_MAX_TURNS_TOOL_USE
                    : MESSAGE_MAX_TURNS_PLANNING;
            logger.debug({ class: cls, maxTurns, reason }, 'AI classifier result');
            classificationResult = {
              class: cls,
              maxTurns,
              timeout: turnsToTimeout(maxTurns),
              reason,
            };
          } else {
            classificationResult = {
              class: 'tool-use',
              maxTurns: MESSAGE_MAX_TURNS_TOOL_USE,
              timeout: turnsToTimeout(MESSAGE_MAX_TURNS_TOOL_USE),
              reason: 'parse failure default',
            };
          }
        } catch {
          const lower = raw.toLowerCase();
          if (lower.includes('quick-answer')) {
            classificationResult = {
              class: 'quick-answer',
              maxTurns: MESSAGE_MAX_TURNS_QUICK,
              timeout: turnsToTimeout(MESSAGE_MAX_TURNS_QUICK),
              reason: 'text scan fallback',
            };
          } else if (lower.includes('complex-task')) {
            classificationResult = {
              class: 'complex-task',
              maxTurns: MESSAGE_MAX_TURNS_PLANNING,
              timeout: turnsToTimeout(MESSAGE_MAX_TURNS_PLANNING),
              reason: 'text scan fallback',
            };
          } else if (lower.includes('tool-use')) {
            classificationResult = {
              class: 'tool-use',
              maxTurns: MESSAGE_MAX_TURNS_TOOL_USE,
              timeout: turnsToTimeout(MESSAGE_MAX_TURNS_TOOL_USE),
              reason: 'text scan fallback',
            };
          } else {
            classificationResult = {
              class: 'tool-use',
              maxTurns: MESSAGE_MAX_TURNS_TOOL_USE,
              timeout: turnsToTimeout(MESSAGE_MAX_TURNS_TOOL_USE),
              reason: 'parse failure default',
            };
          }
        }
      } else {
        const lower = raw.toLowerCase();
        if (lower.includes('quick-answer')) {
          classificationResult = {
            class: 'quick-answer',
            maxTurns: MESSAGE_MAX_TURNS_QUICK,
            timeout: turnsToTimeout(MESSAGE_MAX_TURNS_QUICK),
            reason: 'text scan fallback',
          };
        } else if (lower.includes('complex-task')) {
          classificationResult = {
            class: 'complex-task',
            maxTurns: MESSAGE_MAX_TURNS_PLANNING,
            timeout: turnsToTimeout(MESSAGE_MAX_TURNS_PLANNING),
            reason: 'text scan fallback',
          };
        } else if (lower.includes('tool-use')) {
          classificationResult = {
            class: 'tool-use',
            maxTurns: MESSAGE_MAX_TURNS_TOOL_USE,
            timeout: turnsToTimeout(MESSAGE_MAX_TURNS_TOOL_USE),
            reason: 'text scan fallback',
          };
        } else {
          logger.warn(
            { response: raw },
            'AI classifier returned unexpected response, defaulting to tool-use',
          );
          classificationResult = {
            class: 'tool-use',
            maxTurns: MESSAGE_MAX_TURNS_TOOL_USE,
            timeout: turnsToTimeout(MESSAGE_MAX_TURNS_TOOL_USE),
            reason: 'parse failure default',
          };
        }
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.debug({ reason }, 'AI classifier failed, falling back to keyword heuristics');
      classificationResult = this.classifyTaskByKeywords(
        content,
        recentUserMessages,
        lastBotResponse,
      );
    }

    // Apply classification learning: if aggregate data shows this class underperforms,
    // escalate to the best-performing class seen in the learnings table (OB-732)
    if (this.deps.memory) {
      try {
        const learned = await this.deps.memory.getLearnedParams('classification');
        if (learned) {
          const classRank: Record<string, number> = {
            'quick-answer': 0,
            'tool-use': 1,
            'complex-task': 2,
          };
          const validClasses = new Set(['quick-answer', 'tool-use', 'complex-task']);
          const currentRank = classRank[classificationResult.class] ?? 0;
          const learnedRank = classRank[learned.model] ?? 0;
          if (
            validClasses.has(learned.model) &&
            learnedRank > currentRank &&
            learned.success_rate > 0.5 &&
            currentRank > 0
          ) {
            const escalatedClass = learned.model as ClassificationResult['class'];
            const escalatedMaxTurns =
              escalatedClass === 'quick-answer'
                ? MESSAGE_MAX_TURNS_QUICK
                : escalatedClass === 'tool-use'
                  ? MESSAGE_MAX_TURNS_TOOL_USE
                  : MESSAGE_MAX_TURNS_PLANNING;
            logger.info(
              {
                original: classificationResult.class,
                escalated: escalatedClass,
                successRate: learned.success_rate,
                totalTasks: learned.total_tasks,
              },
              'Classification escalated based on learning data',
            );
            classificationResult = {
              class: escalatedClass,
              maxTurns: escalatedMaxTurns,
              timeout: turnsToTimeout(escalatedMaxTurns),
              reason: `${classificationResult.reason} (escalated: ${Math.round(learned.success_rate * 100)}% success rate for ${escalatedClass})`,
            };
          }
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to query classification learning — using original result');
      }
    }

    // Store result in cache
    this.classificationCache.set(cacheKey, {
      normalizedKey: cacheKey,
      result: { ...classificationResult },
      recordedAt: new Date().toISOString(),
      hitCount: 0,
      feedback: [],
      classifierVersion: CLASSIFIER_VERSION,
      cachedAt: Date.now(),
    } as ClassificationCacheEntry);
    this.evictClassificationCacheIfNeeded();
    void this.persistClassificationCache();

    return classificationResult;
  }

  // -------------------------------------------------------------------------
  // Keyword-based classifier
  // -------------------------------------------------------------------------

  /**
   * Keyword-based task classifier — instant fallback when the AI classifier
   * is unavailable or times out. Returns 'quick-answer' as the default so that
   * unrecognized conversational messages don't waste turns on tools (OB-1581).
   */
  classifyTaskByKeywords(
    content: string,
    recentUserMessages?: string[],
    lastBotResponse?: string,
  ): ClassificationResult {
    const lower = content.toLowerCase();

    // Menu-selection: single numeric digit (1–9) (OB-1658)
    const trimmedContent = content.trim();
    if (/^\d$/.test(trimmedContent) && trimmedContent >= '1' && trimmedContent <= '9') {
      const digitValue = parseInt(trimmedContent, 10);
      let selectedOptionText: string | undefined;
      const hasNumberedList = lastBotResponse ? /^\s*\d+[.)]\s+\S/m.test(lastBotResponse) : false;
      if (hasNumberedList && lastBotResponse) {
        const lines = lastBotResponse.split('\n');
        const optionPattern = new RegExp(`^\\s*${digitValue}[.)]\\s+(.+)`);
        const matchedLine = lines.find((l) => optionPattern.test(l));
        if (matchedLine) {
          const match = optionPattern.exec(matchedLine);
          selectedOptionText = match && match[1] ? match[1].trim() : undefined;
        }
      }
      return {
        class: 'menu-selection',
        maxTurns: MESSAGE_MAX_TURNS_MENU_SELECTION,
        timeout: turnsToTimeout(MESSAGE_MAX_TURNS_MENU_SELECTION),
        skipRag: true,
        menuSelection: true,
        selectedOptionText,
        reason: hasNumberedList
          ? `menu-selection: digit ${trimmedContent} from numbered list`
          : `menu-selection: single digit ${trimmedContent}`,
      };
    }

    // Batch Mode keywords (OB-1605)
    const batchKeywords = [
      'one by one',
      'all tasks',
      'each one',
      'implement all',
      'go through all',
      'for each',
      'iterate through',
      'all pending',
    ];
    if (batchKeywords.some((kw) => lower.includes(kw))) {
      const commitAfterEachKeywords = ['commit after each', 'commit each', 'commit after every'];
      const commitAfterEach = commitAfterEachKeywords.some((kw) => lower.includes(kw));
      return {
        class: 'complex-task',
        maxTurns: MESSAGE_MAX_TURNS_PLANNING,
        timeout: turnsToTimeout(MESSAGE_MAX_TURNS_PLANNING),
        reason: 'keyword match: batch-mode',
        batchMode: true,
        commitAfterEach: commitAfterEach || undefined,
      };
    }

    // Deep Mode keywords (OB-1404)
    const deepModeKeywords = [
      'audit',
      'deep analysis',
      'deep analyse',
      'deep analy',
      'thorough review',
      'security review',
      'full review',
      'full analysis',
      'full analyse',
      'investigate',
      'root cause',
      'in-depth',
      'in depth',
    ];
    if (deepModeKeywords.some((kw) => lower.includes(kw))) {
      return {
        class: 'complex-task',
        maxTurns: MESSAGE_MAX_TURNS_PLANNING,
        timeout: turnsToTimeout(MESSAGE_MAX_TURNS_PLANNING),
        reason: 'keyword match: complex-task (deep-mode candidate)',
        suggestDeepMode: true,
      };
    }

    // Length-based heuristic for complex-task (OB-1651)
    const planningPatterns = [
      'plan',
      'planning',
      'strategy',
      'strategic',
      'vision',
      'goals',
      'objective',
      'approach',
      'framework',
      'roadmap',
      'milestone',
      'proposal',
      'initiative',
      'project',
      'scope',
      'phase',
      'timeline',
      'deliverable',
      'outcome',
      'model',
    ];
    if (lower.length > 200 && planningPatterns.some((kw) => lower.includes(kw))) {
      return {
        class: 'complex-task',
        maxTurns: MESSAGE_MAX_TURNS_PLANNING,
        timeout: turnsToTimeout(MESSAGE_MAX_TURNS_PLANNING),
        reason: 'length heuristic: long message with planning/strategy language → complex-task',
      };
    }

    // Complex task keywords
    const complexKeywords = [
      'implement',
      'build',
      'refactor',
      'develop',
      'set up',
      'setup',
      'redesign',
      'migrate',
      'overhaul',
      'execute',
      'start',
      'proceed',
      'begin',
      'launch',
      'run tasks',
      'start execution',
      'execute group',
      'start group',
      'brainstorm',
      'strategy',
      'business model',
      'commercialise',
      'commercialize',
      'roadmap review',
      'strategic plan',
      'market analysis',
      'go-to-market',
    ];
    const complexWordBoundary = [/\barchitect\b/];
    const delegationPhrases = [
      /\bstart\s+the\s+\w+/,
      /\bexecute\s+\w+/,
      /\bbegin\s+\w+/,
      /\blaunch\s+\w+/,
      /\brun\s+the\s+\w+/,
    ];
    if (
      complexKeywords.some((kw) => lower.includes(kw)) ||
      complexWordBoundary.some((re) => re.test(lower)) ||
      delegationPhrases.some((re) => re.test(lower))
    ) {
      return {
        class: 'complex-task',
        maxTurns: MESSAGE_MAX_TURNS_PLANNING,
        timeout: turnsToTimeout(MESSAGE_MAX_TURNS_PLANNING),
        reason: 'keyword match: complex-task',
      };
    }

    // Compound action pattern
    const actionVerbs = [
      'review',
      'analyze',
      'audit',
      'check',
      'fix',
      'add',
      'update',
      'create',
      'remove',
      'test',
      'write',
      'optimize',
      'improve',
    ];
    const matchedVerbs = actionVerbs.filter((v) => lower.includes(v));
    if (matchedVerbs.length >= 2 && lower.includes(' and ')) {
      return {
        class: 'complex-task',
        maxTurns: MESSAGE_MAX_TURNS_PLANNING,
        timeout: turnsToTimeout(MESSAGE_MAX_TURNS_PLANNING),
        reason: `keyword match: complex-task (compound: ${matchedVerbs.join('+')})`,
      };
    }

    // File-reference keywords (OB-1258)
    const fileReferencePattern =
      /\b(the file|xl|xls|xlsx|pdf|csv|document|attachment|spreadsheet|image|photo|picture)\b/i;
    if (fileReferencePattern.test(content)) {
      return {
        class: 'tool-use',
        maxTurns: MESSAGE_MAX_TURNS_TOOL_USE,
        timeout: turnsToTimeout(MESSAGE_MAX_TURNS_TOOL_USE),
        reason: 'keyword match: file-reference → tool-use',
      };
    }

    // Text-generation keywords (OB-1580)
    const textGenKeywords = [
      'create post',
      'linkedin',
      'tweet',
      'rewrite',
      'rephrase',
      'reformulate',
      'draft',
      'compose',
      'shorter',
      'longer',
      'attractive',
      'generate',
      'write',
    ];
    if (textGenKeywords.some((kw) => lower.includes(kw))) {
      return {
        class: 'quick-answer',
        maxTurns: MESSAGE_MAX_TURNS_TEXT_GEN,
        timeout: turnsToTimeout(MESSAGE_MAX_TURNS_TEXT_GEN),
        reason: 'keyword match: text-generation',
      };
    }

    // Conversation context — text-generation follow-up (OB-1582)
    if (recentUserMessages && recentUserMessages.length > 0) {
      const recentTextGenCount = recentUserMessages
        .slice(-3)
        .filter((msg) => textGenKeywords.some((kw) => msg.toLowerCase().includes(kw))).length;
      if (recentTextGenCount >= 1 && lower.length <= 120) {
        return {
          class: 'quick-answer',
          maxTurns: MESSAGE_MAX_TURNS_TEXT_GEN,
          timeout: turnsToTimeout(MESSAGE_MAX_TURNS_TEXT_GEN),
          reason: 'conversation context: text-generation follow-up',
        };
      }
    }

    // Tool-use keywords
    const toolUseKeywords = ['create', 'fix', 'update file', 'add to', 'make a'];
    if (toolUseKeywords.some((kw) => lower.includes(kw))) {
      return {
        class: 'tool-use',
        maxTurns: MESSAGE_MAX_TURNS_TOOL_USE,
        timeout: turnsToTimeout(MESSAGE_MAX_TURNS_TOOL_USE),
        reason: 'keyword match: tool-use',
      };
    }

    // Question/lookup patterns
    const questionPatterns = [
      'what is',
      'what are',
      'how does',
      'how do',
      'explain',
      'describe',
      'show me',
      'list all',
      'list the',
      'tell me',
    ];
    const trimmed = lower.trim();
    const isShortQuestion = trimmed.endsWith('?') && trimmed.length <= 80;
    const hasQuestionKeyword = questionPatterns.some((qp) => lower.includes(qp));
    if (isShortQuestion || (hasQuestionKeyword && trimmed.length <= 120)) {
      return {
        class: 'quick-answer',
        maxTurns: MESSAGE_MAX_TURNS_QUICK,
        timeout: turnsToTimeout(MESSAGE_MAX_TURNS_QUICK),
        reason: 'keyword match: quick-answer',
      };
    }

    // Length-based fallback (OB-1650)
    const hasQuestionMark = lower.includes('?');
    const sentenceEndCount = (lower.match(/[.!?]/g) || []).length;
    const hasMultipleSentences = sentenceEndCount >= 2;
    if (lower.length > 100 && (hasQuestionMark || hasMultipleSentences)) {
      return {
        class: 'tool-use',
        maxTurns: MESSAGE_MAX_TURNS_TOOL_USE,
        timeout: turnsToTimeout(MESSAGE_MAX_TURNS_TOOL_USE),
        reason: 'length heuristic: long message with question/multi-sentence → tool-use',
      };
    }

    // Default: quick-answer (OB-1581)
    return {
      class: 'quick-answer',
      maxTurns: MESSAGE_MAX_TURNS_QUICK,
      timeout: turnsToTimeout(MESSAGE_MAX_TURNS_QUICK),
      reason: 'keyword fallback: quick-answer',
    };
  }

  // -------------------------------------------------------------------------
  // Cache management (private)
  // -------------------------------------------------------------------------

  /**
   * Load the classification cache from disk into the in-memory map.
   * Called lazily on the first classifyTask() call. Non-blocking on failure.
   */
  private async loadClassificationCache(): Promise<void> {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    try {
      let stored = null;

      if (this.deps.memory) {
        try {
          const raw = await this.deps.memory.getSystemConfig('classifications');
          if (raw) {
            stored = ClassificationCacheSchema.parse(JSON.parse(raw));
          }
        } catch {
          // DB read failed — fall through to JSON
        }
      }

      if (!stored) {
        stored = await this.deps.dotFolder.readClassifications();
      }

      if (stored) {
        for (const [key, entry] of Object.entries(stored.entries)) {
          this.classificationCache.set(key, entry);
        }
        logger.debug({ size: this.classificationCache.size }, 'Classification cache loaded');
      }
    } catch {
      // Cache load failure is non-fatal — we'll just re-classify
    }
  }

  /**
   * Persist the in-memory classification cache to system_config (DB) and
   * classifications.json (fallback).
   */
  private async persistClassificationCache(): Promise<void> {
    try {
      const entries: Record<string, ClassificationCacheEntry> = {};
      for (const [key, entry] of this.classificationCache) {
        entries[key] = entry;
      }
      const cache: ClassificationCache = {
        entries,
        updatedAt: new Date().toISOString(),
        schemaVersion: '1.0.0',
      };

      if (this.deps.memory) {
        await this.deps.memory.setSystemConfig('classifications', JSON.stringify(cache));
      } else {
        await this.deps.dotFolder.writeClassifications(cache);
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to persist classification cache — non-fatal');
    }
  }

  /**
   * Evict the oldest 20% of classification cache entries when the cache exceeds
   * MAX_CLASSIFICATION_CACHE_SIZE.
   */
  private evictClassificationCacheIfNeeded(): void {
    if (this.classificationCache.size <= MAX_CLASSIFICATION_CACHE_SIZE) return;

    const evictCount = Math.ceil(MAX_CLASSIFICATION_CACHE_SIZE * 0.2);
    const entries = Array.from(this.classificationCache.entries()).sort(([, a], [, b]) => {
      const aTime = a.cachedAt ?? 0;
      const bTime = b.cachedAt ?? 0;
      return aTime - bTime;
    });

    let deleted = 0;
    for (const [key] of entries) {
      if (deleted >= evictCount) break;
      this.classificationCache.delete(key);
      deleted++;
    }

    logger.warn(
      { evicted: deleted, remaining: this.classificationCache.size },
      'Classification cache eviction: removed oldest entries',
    );
  }
}
