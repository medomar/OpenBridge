/** WorkerOrchestrator — extracted from MasterManager (OB-1281, OB-F158). */

import {
  AgentRunner,
  TOOLS_READ_ONLY,
  DEFAULT_MAX_TURNS_TASK,
  classifyError,
  resolveProfile,
  manifestToSpawnOptions,
  getMaxPromptLength,
} from '../core/agent-runner.js';
import type { SpawnOptions, AgentResult } from '../core/agent-runner.js';
import { classifyTaskType } from './classification-engine.js';
import { getRecommendedModel, avoidHighFailureModel } from '../core/model-selector.js';
import { createModelRegistry } from '../core/model-registry.js';
import type { ModelRegistry } from '../core/model-registry.js';
import { BuiltInProfileNameSchema } from '../types/agent.js';
import type { ToolProfile, ProfilesRegistry, TaskManifest, SkillPack } from '../types/agent.js';
import type { ParsedSpawnMarker } from './spawn-parser.js';
import { formatWorkerBatch } from './worker-result-formatter.js';
import { WorkersRegistrySchema } from './worker-registry.js';
import type { WorkerRegistry } from './worker-registry.js';
import type { DelegationCoordinator } from './delegation.js';
import { applyToolPromptPrefix } from './seed-prompts.js';
import {
  getBuiltInSkillPacks,
  findSkillByFormat,
  selectSkillPackForTask,
} from './skill-pack-loader.js';
import { classifyDocumentIntent } from '../core/router.js';
import { performReasoningCheckpoint } from './planning-gate.js';
import type { BatchManager } from './batch-manager.js';
import type { MasterState, TaskRecord, MasterSession } from '../types/master.js';
import { AgentsRegistrySchema } from '../types/master.js';
import type { DiscoveredTool } from '../types/discovery.js';
import type { InboundMessage } from '../types/message.js';
import type {
  MemoryManager,
  ConversationEntry,
  TaskRecord as MemoryTaskRecord,
  ActivityRecord,
} from '../memory/index.js';
import type { Router } from '../core/router.js';
import type { DotFolderManager } from './dotfolder-manager.js';
import { consentModeToTrustLevel } from '../core/adapter-registry.js';
import type { AdapterRegistry } from '../core/adapter-registry.js';
import { SecurityConfigSchema, type WorkspaceTrustLevel } from '../types/config.js';
import type { KnowledgeRetriever } from '../core/knowledge-retriever.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('worker-orchestrator');

/**
 * Regex matching file-operation keywords that trigger auto-escalation from
 * `code-edit` to `file-management` profile (OB-1548).
 */
export const FILE_OP_KEYWORDS = /\b(delete|remove|rm|rmdir|rename|move|mv|copy|cp|mkdir)\b/i;

// ---------------------------------------------------------------------------
// Standalone exported interfaces + functions (moved from master-manager.ts)
// ---------------------------------------------------------------------------

/** Result of a tool-access failure scan on a worker result. */
export interface ToolAccessFailure {
  /** The tool name extracted from the error message, if identifiable. */
  tool: string | undefined;
  /** The raw error snippet that matched a tool-access pattern. */
  reason: string;
}

/**
 * Pre-flight tool prediction result (OB-1595).
 * Returned by `predictToolRequirements()` when the task prompt suggests the
 * worker will need more tools than its current profile allows.
 */
export interface ToolPrediction {
  /** The minimum profile needed to execute this task. */
  suggestedProfile: string;
  /** Human-readable reason for the predicted upgrade. */
  reason: string;
  /** Keywords in the prompt that triggered the prediction. */
  triggerKeywords: string[];
}

/**
 * Rules mapping prompt keyword patterns to minimum required tool profiles.
 * Ordered from most-restrictive (full-access) to least, so the first match wins.
 */
const PREFLIGHT_RULES: Array<{
  pattern: RegExp;
  requiredProfile: 'code-edit' | 'full-access';
  label: string;
}> = [
  {
    // Unrestricted shell: deploy, docker, kubectl, system daemons, curl/wget scripts
    pattern:
      /\b(deploy(?:ment)?|docker\s+\w|kubectl\s+\w|apt(?:-get)?\s+\w|brew\s+install|curl\s+https?|wget\s+https?|systemctl\s+\w|pm2\s+\w|sh\s+\S|bash\s+\S)\b/i,
    requiredProfile: 'full-access',
    label: 'deploy/docker/system commands',
  },
  {
    // npm/npx/pip/cargo/make + common task verbs (test, lint, build, install)
    pattern:
      /\b(npm\s+(test|install|run\s+\w+|build|ci)|npx\s+\w|pip\s+install|cargo\s+(build|test|run)|make\s+\w|run\s+tests?|run\s+(?:the\s+)?(?:lint|build|test)|lint\s+(?:the\s+)?code|build\s+(?:the\s+)?(?:project|app|package)|compile\s+\w|typecheck|type-check|install\s+(?:packages?|dep(?:endencies)?s?))\b/i,
    requiredProfile: 'code-edit',
    label: 'build/test/install commands',
  },
];

/**
 * Predict the minimum tool profile needed to execute a task prompt (OB-1595).
 *
 * Scans the task prompt for keywords that suggest the worker will need
 * bash/shell access (test, lint, build, deploy, install, etc.).  Returns a
 * `ToolPrediction` when the predicted minimum profile exceeds the current
 * profile, so the caller can request upfront escalation before spawning.
 *
 * Returns `undefined` when:
 *  - The profile is already `full-access` or `master` (no escalation needed)
 *  - No prediction-triggering keywords are found
 *  - The predicted profile is <= the current profile
 */
export function predictToolRequirements(
  prompt: string,
  profile: string,
): ToolPrediction | undefined {
  if (profile === 'full-access' || profile === 'master') return undefined;

  // Profile capability order (ascending access level)
  const PROFILE_ORDER = ['read-only', 'code-audit', 'code-edit', 'full-access'];
  const currentIndex = PROFILE_ORDER.indexOf(profile);

  for (const rule of PREFLIGHT_RULES) {
    const match = rule.pattern.exec(prompt);
    if (!match) continue;

    const suggestedIndex = PROFILE_ORDER.indexOf(rule.requiredProfile);
    // Only escalate if the prediction exceeds the current profile
    if (suggestedIndex <= currentIndex) continue;

    const triggerKeywords = match[0]
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .map((k) => k.replace(/[^a-zA-Z0-9:*-]/g, ''));
    return {
      suggestedProfile: rule.requiredProfile,
      reason: rule.label,
      triggerKeywords,
    };
  }

  return undefined;
}

/**
 * Default per-worker cost caps in USD by tool profile (OB-1521).
 * Applied when no explicit maxCostUsd is provided in the SPAWN marker.
 * These are tighter than the session-level PROFILE_COST_CAPS — designed to
 * catch runaway individual workers (e.g. a Codex worker that burned $0.28).
 */
const PROFILE_DEFAULT_COST_CAPS: Record<string, number> = {
  'read-only': 0.05,
  'data-query': 0.05,
  'code-audit': 0.05,
  'code-edit': 0.1,
  'file-management': 0.1,
  'full-access': 0.15,
};

/**
 * Detect tool-access failures in a worker result (OB-1592).
 *
 * Scans both stdout and stderr for the error patterns the Claude CLI emits
 * when a tool call is blocked by `--allowedTools` restrictions:
 *   - "tool not allowed"
 *   - "permission denied"
 *   - "not in allowedTools"
 *
 * Returns a `ToolAccessFailure` describing the blocked tool when a match is
 * found, or `undefined` when no tool-access error is present.
 */
export function detectToolAccessFailure(result: {
  stdout: string;
  stderr: string;
}): ToolAccessFailure | undefined {
  const combined = `${result.stderr}\n${result.stdout}`.toLowerCase();

  const PATTERNS = [
    'tool not allowed',
    'permission denied',
    'not in allowedtools',
    'not allowed to use',
    'tool is not allowed',
  ] as const;

  const matched = PATTERNS.find((p) => combined.includes(p));
  if (!matched) return undefined;

  // Extract the tool name from the error line.
  // Common Claude CLI formats:
  //   "Tool 'Bash' is not allowed"
  //   "Bash is not in allowedTools"
  //   "not allowed to use tool: Bash"
  const searchText = `${result.stderr}\n${result.stdout}`;
  let tool: string | undefined;

  const patterns = [
    // "Tool 'Bash' is not allowed"  /  "tool 'Bash(npm:test)' is not allowed"
    /[Tt]ool\s+'([^']+)'/,
    // "Bash is not in allowedTools"
    /(\w[\w():*]*)\s+is\s+not\s+in\s+allowedTools/i,
    // "not allowed to use tool: Bash"
    /not\s+allowed\s+to\s+use\s+(?:tool:\s*)?([^\s,.:]+)/i,
    // "not in allowedTools: Bash"
    /not\s+in\s+allowedTools[:\s]+([^\s,.:]+)/i,
  ];

  for (const re of patterns) {
    const m = re.exec(searchText);
    if (m?.[1]) {
      tool = m[1];
      break;
    }
  }

  // Provide a short reason snippet (first matching line, truncated)
  const lines = searchText.split('\n');
  const matchedLine = lines.find((l) => PATTERNS.some((p) => l.toLowerCase().includes(p)));
  const reason = (matchedLine ?? matched).trim().slice(0, 200);

  return { tool, reason };
}

// ---------------------------------------------------------------------------
// Dependencies interface — callbacks + shared references from MasterManager
// ---------------------------------------------------------------------------

export interface WorkerOrchestratorDeps {
  workspacePath: string;
  masterTool: DiscoveredTool;
  discoveredTools: DiscoveredTool[];
  dotFolder: DotFolderManager;
  agentRunner: AgentRunner;
  workerRegistry: WorkerRegistry;
  adapterRegistry: AdapterRegistry;
  modelRegistry: ModelRegistry;
  workerRetryDelayMs: number;
  workerMaxFixIterations: number;
  trustLevel?: WorkspaceTrustLevel;

  // Mutable references
  getMemory: () => MemoryManager | null;
  getRouter: () => Router | null;
  getMasterSession: () => MasterSession | null;
  getActiveMessage: () => InboundMessage | null;
  getState: () => MasterState;
  setState: (state: MasterState) => void;
  getActiveSkillPacks: () => SkillPack[];
  getKnowledgeRetriever: () => KnowledgeRetriever | null;
  getBatchManager: () => BatchManager | null;
  getBatchTimers: () => Set<ReturnType<typeof setTimeout>>;
  getDelegationCoordinator: () => DelegationCoordinator | null;

  // Callbacks into MasterManager
  readProfilesFromStore: () => Promise<ProfilesRegistry | null>;
  persistWorkerRegistry: () => Promise<void>;
  recordWorkerLearning: (
    task: TaskRecord,
    result: AgentResult,
    profile: string,
    model?: string,
  ) => Promise<void>;
  recordPromptEffectiveness: (task: TaskRecord, result: AgentResult) => Promise<void>;
  recordConversationMessage: (
    sessionId: string,
    role: ConversationEntry['role'],
    content: string,
  ) => Promise<void>;
}

// ---------------------------------------------------------------------------
// WorkerOrchestrator class
// ---------------------------------------------------------------------------

export class WorkerOrchestrator {
  private deps: WorkerOrchestratorDeps;

  /** Map from workerId → abort callback. Moved from MasterManager. */
  readonly workerAbortHandles: Map<string, () => void> = new Map();

  constructor(deps: WorkerOrchestratorDeps) {
    this.deps = deps;
  }

  /** Update mutable dependencies (e.g. when memory becomes available after init). */
  updateDeps(partial: Partial<WorkerOrchestratorDeps>): void {
    this.deps = { ...this.deps, ...partial };
  }

  // -------------------------------------------------------------------------
  // Max-turns helpers
  // -------------------------------------------------------------------------

  defaultMaxTurnsForProfile(profile: string): number {
    if (profile === 'code-edit' || profile === 'full-access') return 15;
    if (profile === 'read-only') return 10;
    return DEFAULT_MAX_TURNS_TASK;
  }

  maxTurnsCapForProfile(profile: string): number {
    if (profile === 'read-only') return 25;
    if (profile === 'code-edit' || profile === 'full-access') return 40;
    return 50;
  }

  /**
   * Compute adaptive max-turns for a worker based on profile baseline + prompt heuristics (OB-902, OB-1677).
   *
   * If the SPAWN marker explicitly set maxTurns, that value is used directly (caller's
   * responsibility). This method only computes the fallback value when maxTurns is absent.
   *
   * Formula:
   *   1. baselineTurns (profile-based)
   *   2. + ceil(promptLength / 1000)   — scales with prompt complexity
   *   3. + 5 if promptLength > 200     — longer tasks need more room (OB-1677)
   *   4. + 10 if prompt contains "thorough", "comprehensive", or "detailed" (OB-1677)
   *   5. capped at maxTurnsCapForProfile(profile)
   *
   * Examples (code-edit, baseline 15, cap 40):
   *   200-char prompt, no keywords -> 15 + 1 = 16 turns
   *   500-char prompt, no keywords -> 15 + 1 + 5 = 21 turns
   *   500-char prompt + "thorough" -> 15 + 1 + 5 + 10 = 31 turns
   */
  computeAdaptiveMaxTurns(profile: string, prompt: string): number {
    const baselineTurns = this.defaultMaxTurnsForProfile(profile);
    const profileCap = this.maxTurnsCapForProfile(profile);

    const promptExtra = Math.ceil(prompt.length / 1000);

    // OB-1677: Add 5 turns for prompts longer than 200 chars (more context = more work).
    const longPromptExtra = prompt.length > 200 ? 5 : 0;

    // OB-1677: Add 10 turns when the task explicitly requests thoroughness.
    const THOROUGHNESS_KEYWORDS = ['thorough', 'comprehensive', 'detailed'];
    const lowerPrompt = prompt.toLowerCase();
    const keywordExtra = THOROUGHNESS_KEYWORDS.some((kw) => lowerPrompt.includes(kw)) ? 10 : 0;

    const adaptive = Math.min(
      baselineTurns + promptExtra + longPromptExtra + keywordExtra,
      profileCap,
    );

    logger.debug(
      {
        profile,
        baselineTurns,
        profileCap,
        promptLength: prompt.length,
        promptExtra,
        longPromptExtra,
        keywordExtra,
        adaptive,
      },
      'Computed adaptive max-turns for worker',
    );
    return adaptive;
  }

  // -------------------------------------------------------------------------
  // SPAWN marker handling
  // -------------------------------------------------------------------------

  /**
   * Handle SPAWN markers found in Master output.
   * Spawns worker agents via AgentRunner based on parsed task manifests,
   * collects results, and returns a structured feedback prompt for injection
   * into the Master session.
   *
   * Workers are tracked in the WorkerRegistry with full lifecycle management:
   * pending -> running -> completed/failed. The registry enforces concurrency
   * limits and persists to .openbridge/workers.json for cross-restart visibility.
   *
   * Worker results include metadata (model, profile, duration, exit code)
   * so the Master can reason about what happened and synthesize a response.
   *
   * @param onProgress - Optional callback invoked after each worker completes.
   *   Receives (completedCount, totalCount) so the caller can send progress updates.
   */
  async handleSpawnMarkers(
    markers: ParsedSpawnMarker[],
    onProgress?: (
      completed: number,
      total: number,
      result?: AgentResult,
      marker?: ParsedSpawnMarker,
    ) => Promise<void>,
    attachments?: InboundMessage['attachments'],
    taskClass?: string,
  ): Promise<string> {
    // Load custom profiles once for all workers
    const customProfilesRegistry = await this.deps.readProfilesFromStore();
    const customProfiles = customProfilesRegistry?.profiles;

    // Register all workers in the registry BEFORE spawning
    // This checks concurrency limits and creates worker records
    const workerIds: string[] = [];
    const workerManifests = markers.map((marker) => ({
      prompt: marker.body.prompt,
      workspacePath: this.deps.workspacePath,
      profile: marker.profile,
      model: marker.body.model,
      maxTurns: marker.body.maxTurns ?? this.defaultMaxTurnsForProfile(marker.profile),
      timeout: marker.body.timeout,
      retries: marker.body.retries,
      maxBudgetUsd: marker.body.maxBudgetUsd,
    }));

    for (const manifest of workerManifests) {
      try {
        const workerId = this.deps.workerRegistry.addWorker(manifest);
        workerIds.push(workerId);
      } catch {
        // Max concurrency reached — wait for a slot to free up (backpressure)
        logger.info(
          { runningCount: this.deps.workerRegistry.getRunningCount() },
          'Concurrency limit reached — waiting for a worker slot',
        );
        try {
          await this.deps.workerRegistry.waitForSlot();
          // Slot freed — retry registration
          const workerId = this.deps.workerRegistry.addWorker(manifest);
          workerIds.push(workerId);
        } catch (waitError) {
          // Timeout waiting for slot — skip this worker
          logger.warn(
            { error: waitError instanceof Error ? waitError.message : String(waitError) },
            'Timed out waiting for worker slot — skipping worker',
          );
          workerIds.push('');
        }
      }
    }

    // Persist registry after adding workers
    await this.deps.persistWorkerRegistry();

    // Count only workers that were actually registered (not skipped)
    const total = workerIds.filter((id) => id !== '').length;
    let completedCount = 0;

    // Spawn all workers concurrently via Promise.allSettled
    const workerPromises = markers.map((marker, index) => {
      const workerId = workerIds[index];
      if (!workerId) {
        // Worker was skipped due to concurrency limit
        return Promise.resolve({
          exitCode: 1,
          stdout: '',
          stderr: 'Worker skipped: concurrency limit reached',
          durationMs: 0,
          retryCount: 0,
        } as AgentResult);
      }
      const workerPromise = this.spawnWorker(workerId, marker, index, customProfiles, attachments);
      if (onProgress) {
        return workerPromise.then(async (result) => {
          completedCount++;
          await onProgress(completedCount, total, result, marker);
          return result;
        });
      }
      return workerPromise;
    });

    const settled = await Promise.allSettled(workerPromises);

    // Persist registry after all workers complete
    await this.deps.persistWorkerRegistry();

    // Log aggregated worker batch stats for observability
    const stats = this.deps.workerRegistry.getAggregatedStats();
    logger.info(stats, 'Worker batch stats');

    // Record task efficiency metrics for escalation suppression (OB-1572)
    const memory = this.deps.getMemory();
    if (memory && taskClass) {
      memory
        .recordTaskEfficiency(taskClass, {
          turnsUsed: stats.totalTurnsUsed ?? 0,
          workerCount: stats.totalWorkers,
          durationMs: stats.avgDurationMs * stats.totalWorkers,
        })
        .catch((err) => logger.warn({ err, taskClass }, 'Failed to record task efficiency'));
    }

    // Format all results with structured metadata and build the feedback prompt
    const { feedbackPrompt, observations, workerSummaries } = formatWorkerBatch(
      settled,
      markers,
      workerIds,
      this.deps.getMasterSession()?.sessionId,
    );

    // Persist extracted observations (fire-and-forget — don't block the response)
    if (observations.length > 0 && memory) {
      Promise.all(observations.map((obs) => memory.insertObservation(obs))).catch((err) =>
        logger.warn({ err }, 'Failed to store worker observations'),
      );
    }

    // Append learned items from worker summaries to memory.md (OB-1636)
    if (workerSummaries.length > 0) {
      this.deps.dotFolder
        .appendLearnedToMemory(workerSummaries)
        .catch((err) => logger.warn({ err }, 'Failed to append learned items to memory.md'));
    }

    return feedbackPrompt;
  }

  /**
   * Handle SPAWN markers with progress streaming.
   * Yields progress updates as workers complete, allowing the user to see
   * real-time status (e.g., "Working on it... (3/5 subtasks done)").
   *
   * Returns the final feedback prompt after all workers complete.
   */
  async *handleSpawnMarkersWithProgress(
    markers: ParsedSpawnMarker[],
    onProgress?: (
      completed: number,
      total: number,
      result?: AgentResult,
      marker?: ParsedSpawnMarker,
    ) => Promise<void>,
    attachments?: InboundMessage['attachments'],
    taskClass?: string,
  ): AsyncGenerator<string, string> {
    // Load custom profiles once for all workers
    const customProfilesRegistry = await this.deps.readProfilesFromStore();
    const customProfiles = customProfilesRegistry?.profiles;

    // Register all workers in the registry BEFORE spawning
    const workerIds: string[] = [];
    const workerManifests = markers.map((marker) => ({
      prompt: marker.body.prompt,
      workspacePath: this.deps.workspacePath,
      profile: marker.profile,
      model: marker.body.model,
      maxTurns: marker.body.maxTurns ?? this.defaultMaxTurnsForProfile(marker.profile),
      timeout: marker.body.timeout,
      retries: marker.body.retries,
      maxBudgetUsd: marker.body.maxBudgetUsd,
    }));

    for (const manifest of workerManifests) {
      try {
        const workerId = this.deps.workerRegistry.addWorker(manifest);
        workerIds.push(workerId);
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'Failed to register worker (concurrency limit reached)',
        );
        workerIds.push('');
      }
    }

    await this.deps.persistWorkerRegistry();

    // Yield initial progress message
    const totalWorkers = workerIds.filter((id) => id !== '').length;
    yield `\n\n_[Starting ${totalWorkers} parallel subtasks...]_\n`;

    let progressCompletedCount = 0;

    // Spawn all workers concurrently
    const workerPromises = markers.map((marker, index) => {
      const workerId = workerIds[index];
      if (!workerId) {
        return Promise.resolve({
          exitCode: 1,
          stdout: '',
          stderr: 'Worker skipped: concurrency limit reached',
          durationMs: 0,
          retryCount: 0,
        } as AgentResult);
      }
      const workerPromise = this.spawnWorker(workerId, marker, index, customProfiles, attachments);
      if (onProgress) {
        return workerPromise.then(async (result) => {
          progressCompletedCount++;
          await onProgress(progressCompletedCount, totalWorkers, result, marker);
          return result;
        });
      }
      return workerPromise;
    });

    // Wait for all workers to complete
    const finalSettled = await Promise.allSettled(workerPromises);

    // Yield final progress message
    const completedCount = finalSettled.filter(
      (r) => r.status === 'fulfilled' && r.value.exitCode === 0,
    ).length;
    yield `\n\n_[All subtasks complete: ${completedCount}/${totalWorkers} successful]_\n`;

    await this.deps.persistWorkerRegistry();

    // Record task efficiency metrics for escalation suppression (OB-1572)
    if (taskClass) {
      const progressStats = this.deps.workerRegistry.getAggregatedStats();
      const progressMemory = this.deps.getMemory();
      if (progressMemory) {
        progressMemory
          .recordTaskEfficiency(taskClass, {
            turnsUsed: progressStats.totalTurnsUsed ?? 0,
            workerCount: progressStats.totalWorkers,
            durationMs: progressStats.avgDurationMs * progressStats.totalWorkers,
          })
          .catch((err) => logger.warn({ err, taskClass }, 'Failed to record task efficiency'));
      }
    }

    // Format all results and build the feedback prompt
    const { feedbackPrompt, observations, workerSummaries } = formatWorkerBatch(
      finalSettled,
      markers,
      workerIds,
      this.deps.getMasterSession()?.sessionId,
    );

    // Persist extracted observations (fire-and-forget — don't block the response)
    const memoryForObs = this.deps.getMemory();
    if (observations.length > 0 && memoryForObs) {
      Promise.all(observations.map((obs) => memoryForObs.insertObservation(obs))).catch((err) =>
        logger.warn({ err }, 'Failed to store worker observations'),
      );
    }

    // Append learned items from worker summaries to memory.md (OB-1636)
    if (workerSummaries.length > 0) {
      this.deps.dotFolder
        .appendLearnedToMemory(workerSummaries)
        .catch((err) => logger.warn({ err }, 'Failed to append learned items to memory.md'));
    }

    return feedbackPrompt;
  }

  // -------------------------------------------------------------------------
  // Worker re-spawn after grant
  // -------------------------------------------------------------------------

  /**
   * Re-spawn a worker with upgraded tool access after a user grant (OB-1594).
   *
   * Called by the respawn callback registered in requestToolEscalation(). Receives the
   * granted tool/profile name(s) from the /allow command handler and re-submits the
   * original SPAWN marker with an upgraded profile or merged tool list.
   *
   * - If grantedTools contains a built-in profile name (e.g. "code-edit"), the marker
   *   is re-submitted with that profile, overriding the original.
   * - If grantedTools contains individual tool names (e.g. "Bash(npm:test)"), they are
   *   merged with the original profile's tools and passed via a transient custom profile.
   */
  async respawnWorkerAfterGrant(
    originalWorkerId: string,
    marker: ParsedSpawnMarker,
    index: number,
    originalProfile: string,
    grantedTools: string[],
    attachments?: InboundMessage['attachments'],
  ): Promise<void> {
    // Defense-in-depth: block respawning in sandbox mode (OB-1603, OB-F216)
    if (this.deps.trustLevel === 'sandbox') {
      logger.warn('respawnWorkerAfterGrant called in sandbox mode — ignoring');
      return;
    }

    // Guard against infinite escalation loops (OB-F214): cap at depth 3.
    const escalationDepth = (originalProfile.match(/-escalated/g) ?? []).length;
    if (escalationDepth >= 3) {
      logger.warn(
        { workerId: originalWorkerId, profile: originalProfile, escalationDepth },
        'Max escalation depth reached — not respawning',
      );
      return;
    }

    const newWorkerId = `${originalWorkerId}-escalated`;

    // Determine whether the grant is a profile upgrade or individual tool names.
    const profileGrant = grantedTools.find((g) => BuiltInProfileNameSchema.safeParse(g).success);

    let upgradedMarker: ParsedSpawnMarker;
    let customProfiles: Record<string, ToolProfile> | undefined;

    if (profileGrant) {
      // Profile upgrade — re-submit the marker under the higher profile.
      upgradedMarker = { ...marker, profile: profileGrant };
      logger.info(
        { originalWorkerId, newWorkerId, originalProfile, upgradedProfile: profileGrant },
        'Worker re-spawned with profile upgrade after grant',
      );
    } else {
      // Individual tool grant — merge with the original profile's tool list.
      const baseTools = resolveProfile(originalProfile) ?? [];
      const mergedTools = [...new Set([...baseTools, ...grantedTools])];
      // Strip any existing `-escalated` suffix chain so profile names stay `{base}-escalated`
      // regardless of how many re-grants occur (OB-F214).
      const baseProfile = originalProfile.replace(/-escalated(-escalated)*$/, '');
      const upgradedProfileName = `${baseProfile}-escalated`;
      customProfiles = {
        [upgradedProfileName]: {
          name: upgradedProfileName,
          description: `${baseProfile} + escalated access (${grantedTools.join(', ')})`,
          tools: mergedTools,
        },
      };
      upgradedMarker = { ...marker, profile: upgradedProfileName };
      logger.info(
        { originalWorkerId, newWorkerId, originalProfile, mergedTools },
        'Worker re-spawned with merged tool access after grant',
      );
    }

    // Register the escalated worker in the WorkerRegistry BEFORE spawning so that
    // markRunning / markCompleted / markFailed can find it by ID (OB-1626).
    // Registration is inside the try block (OB-1645) so that if registration itself
    // fails (e.g. capacity exceeded), the original worker is still marked as failed
    // rather than left orphaned in 'pending' state.
    const escalatedManifest: TaskManifest = {
      prompt: upgradedMarker.body.prompt,
      workspacePath: this.deps.workspacePath,
      profile: upgradedMarker.profile,
      model: upgradedMarker.body.model,
      maxTurns: upgradedMarker.body.maxTurns,
      timeout: upgradedMarker.body.timeout,
      retries: upgradedMarker.body.retries,
      maxBudgetUsd: upgradedMarker.body.maxBudgetUsd,
    };

    try {
      this.deps.workerRegistry.registerWorkerWithId(newWorkerId, escalatedManifest);
      await this.spawnWorker(newWorkerId, upgradedMarker, index, customProfiles, attachments);
    } catch (spawnError) {
      const errorMessage = spawnError instanceof Error ? spawnError.message : String(spawnError);
      logger.error(
        { originalWorkerId, newWorkerId, error: errorMessage },
        'Worker re-spawn failed after grant',
      );

      // Mark escalated worker as failed and clean up to prevent orphaned state (OB-1627, OB-1628).
      const failedResult: AgentResult = {
        exitCode: -1,
        stdout: '',
        stderr: errorMessage,
        durationMs: 0,
        retryCount: 0,
        status: 'completed',
      };
      try {
        this.deps.workerRegistry.markFailed(newWorkerId, failedResult, 'respawn-failed');
      } catch (markErr) {
        logger.warn({ newWorkerId, err: markErr }, 'Failed to mark escalated worker as failed');
        // OB-1628: If markFailed fails, remove the entry entirely to prevent the worker
        // from remaining orphaned in 'pending' state in the registry.
        this.deps.workerRegistry.removeWorker(newWorkerId);
      }

      // Also attempt to mark original worker as failed (OB-1627).
      // The original may already be in a terminal state — guard with try-catch.
      try {
        this.deps.workerRegistry.markFailed(originalWorkerId, failedResult, 'respawn-failed');
      } catch {
        // Original worker already in a terminal state — this is expected.
      }

      // Notify the user so they can retry (OB-1627).
      const router = this.deps.getRouter();
      const activeMessage = this.deps.getActiveMessage();
      if (router && activeMessage) {
        void router.sendDirect(
          activeMessage.source,
          activeMessage.sender,
          'Worker re-spawn failed after grant, please retry',
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Single worker spawn
  // -------------------------------------------------------------------------

  /**
   * Spawn a single worker from a parsed SPAWN marker.
   * Resolves the profile to tools via AgentRunner's manifest resolution.
   * Tracks the worker lifecycle in the registry: pending -> running -> completed/failed.
   * Logs each worker execution to .openbridge/tasks/ for audit trail and learning.
   *
   * **Depth Limiting (OB-164):**
   * Workers are spawned WITHOUT sessionId, so they get --print mode (single-turn, stateless).
   * This enforces maxSpawnDepth=1 — only the Master can spawn workers, workers cannot spawn.
   */
  async spawnWorker(
    workerId: string,
    marker: ParsedSpawnMarker,
    index: number,
    customProfiles?: Record<string, ToolProfile>,
    attachments?: InboundMessage['attachments'],
  ): Promise<AgentResult> {
    const { body } = marker;
    // profile may be overridden by skill pack selection (OB-1753)
    // OB-1600: In trusted mode, force full-access from the start so the /allow
    // escalation flow is never triggered — workers already have maximum tools.
    const workerProfile =
      this.deps.trustLevel === 'trusted' ? 'full-access' : (marker.profile ?? 'read-only');
    let profile = workerProfile;
    if (this.deps.trustLevel === 'trusted' && marker.profile !== 'full-access') {
      logger.debug(
        { workerId, originalProfile: marker.profile, effectiveProfile: 'full-access' },
        'Trusted mode — worker profile forced to full-access',
      );
    }

    // OB-1596: Compute session-level tool grants for this sender.
    // If the user approved tools earlier this session via /allow, auto-apply them
    // to every subsequent worker spawn so we don't re-ask for the same permissions.
    const router = this.deps.getRouter();
    const activeMessage = this.deps.getActiveMessage();
    const senderSessionGrants: ReadonlySet<string> =
      router && activeMessage ? router.getSessionGrants(activeMessage.sender) : new Set<string>();
    // Expand profile-name grants (e.g. "code-edit") to their individual tool lists
    // so we can check coverage and merge them into allowedTools uniformly.
    const expandedSessionGrants = new Set<string>();
    for (const grant of senderSessionGrants) {
      if (BuiltInProfileNameSchema.safeParse(grant).success) {
        const profileTools = resolveProfile(grant, undefined, this.deps.trustLevel) ?? [];
        profileTools.forEach((t) => expandedSessionGrants.add(t));
      } else {
        expandedSessionGrants.add(grant);
      }
    }

    // OB-1600: Fetch permanent tool grants for this user from the DB.
    // These survive session restarts — once granted via /allow-permanent they
    // are always merged into worker allowedTools without re-asking the user.
    const memory = this.deps.getMemory();
    const permanentGrants: string[] =
      memory && activeMessage
        ? await memory
            .getApprovedEscalations(activeMessage.sender, activeMessage.source)
            .catch(() => [])
        : [];

    // If the originating message had attachments, prepend a ## Referenced Files section
    // so the worker knows which files to read and analyze (OB-1148).
    let workerPrompt = body.prompt;
    if (attachments && attachments.length > 0) {
      const fileLines = attachments
        .map((att) => {
          const name = att.filename ? ` (${att.filename})` : '';
          const sizeMb = (att.sizeBytes / (1024 * 1024)).toFixed(2);
          return `- **${att.type}**${name}: \`${att.filePath}\` — ${att.mimeType}, ${sizeMb} MB`;
        })
        .join('\n');
      workerPrompt = `## Referenced Files\n\nThe following files were attached to the user's message and are available for analysis:\n\n${fileLines}\n\n---\n\n${body.prompt}`;
    }

    // OB-1588: Inject workspace boundary instruction when trustLevel is 'trusted'.
    // This must be prepended to the entire prompt (including referenced files) so the
    // boundary constraint is the first thing the worker sees. Only inject for trusted
    // mode — standard and sandbox modes rarely get Bash access, so this is primarily
    // a defense-in-depth for unrestricted bash workers in trusted mode.
    if (this.deps.trustLevel === 'trusted') {
      const boundaryInstruction = `WORKSPACE BOUNDARY: You are operating inside ${this.deps.workspacePath}. All file reads, writes, and Bash commands must target files within this directory. Do not access files outside this workspace (no ~/.ssh, no ~/.env, no /etc). If you need system information, use safe commands like 'node --version' or 'which <tool>'.\n\n`;
      workerPrompt = boundaryInstruction + workerPrompt;
    }

    // Resolve per-worker tool and adapter
    let workerRunner = this.deps.agentRunner;
    let resolvedModel = body.model;
    const requestedTool = body.tool;
    const toolUsed = requestedTool ?? this.deps.masterTool.name;

    // Resolve the sender's trust level from consent mode so adapter selection
    // honours /trust settings (OB-1501).
    const senderConsentMode =
      memory && activeMessage
        ? await memory
            .getConsentMode(activeMessage.sender, activeMessage.source)
            .catch(() => 'always-ask' as const)
        : ('always-ask' as const);
    const senderTrustLevel = consentModeToTrustLevel(senderConsentMode);

    if (requestedTool && requestedTool !== this.deps.masterTool.name) {
      const tool = this.resolveDiscoveredTool(requestedTool);
      const toolAdapter = tool
        ? this.deps.adapterRegistry.getForTrustLevel(requestedTool, senderTrustLevel)
        : undefined;

      if (!tool || !toolAdapter) {
        logger.warn(
          { requestedTool, workerId },
          'Requested tool not available — falling back to master tool',
        );
      } else {
        workerRunner = new AgentRunner(toolAdapter);
        logger.info(
          { requestedTool, workerId, trustLevel: senderTrustLevel },
          'Worker using tool-specific adapter',
        );
      }
    } else {
      // Default tool (master tool) — select adapter based on trust level so that
      // /trust ask/edit routes to the SDK adapter for per-tool approval.
      const masterToolName = this.deps.masterTool.name;
      const trustAdapter = this.deps.adapterRegistry.getForTrustLevel(
        masterToolName,
        senderTrustLevel,
      );
      if (trustAdapter) {
        workerRunner = new AgentRunner(trustAdapter);
        logger.debug(
          { masterToolName, trustLevel: senderTrustLevel },
          'Worker using trust-level-selected adapter',
        );
      }
    }

    // Apply tool-specific worker prompt prefix (OB-1576).
    // Codex workers waste turns on shell gymnastics — the prefix steers them
    // toward simple, direct file-reading commands (OB-F91).
    workerPrompt = applyToolPromptPrefix(workerPrompt, toolUsed);

    // OB-1737: Inject skill pack prompt extension when the worker task involves
    // document generation. classifyDocumentIntent maps task text to a file format
    // (docx, pptx, xlsx, pdf), then we locate the matching built-in skill pack and
    // append its workerPrompt section so the worker has precise generation guidance.
    const docFormat = classifyDocumentIntent(body.prompt);
    if (docFormat) {
      const skillPacks = new Map(getBuiltInSkillPacks().map((s) => [s.name, s]));
      const skill = findSkillByFormat(skillPacks, docFormat);
      if (skill) {
        workerPrompt = `${workerPrompt}\n\n---\n\n${skill.prompts.workerPrompt}`;
        logger.debug(
          { workerId, skillName: skill.name, docFormat },
          'Injected skill pack prompt extension into worker',
        );
      }
    }

    // OB-1752: Select the best-matching SkillPack for this worker based on task
    // type and inject its systemPromptExtension into the worker prompt. Only
    // runs when no document-generation skill was already applied (avoids double
    // injection). Uses keyword scoring to match security-audit, code-review,
    // test-writer, data-analysis, and documentation packs.
    let selectedPack: SkillPack | undefined;
    if (!docFormat) {
      selectedPack = selectSkillPackForTask(body.prompt, this.deps.getActiveSkillPacks());
      if (selectedPack) {
        workerPrompt = `${workerPrompt}\n\n---\n\n${selectedPack.systemPromptExtension}`;
        logger.debug(
          { workerId, skillPack: selectedPack.name },
          'Injected skill pack prompt extension into worker',
        );
      }
    }

    // OB-1753: Apply the selected skill pack's toolProfile to the effective
    // profile. When a pack like security-audit specifies toolProfile:'code-audit',
    // the worker should use that profile instead of a broader one (e.g. code-edit)
    // to enforce the pack's read-only constraints. The pack profile is only
    // applied when it differs from the SPAWN marker profile — an explicit user
    // grant or a more-permissive SPAWN marker is respected over the pack default.
    if (selectedPack?.toolProfile && selectedPack.toolProfile !== profile) {
      logger.debug(
        {
          workerId,
          previousProfile: profile,
          newProfile: selectedPack.toolProfile,
          skillPack: selectedPack.name,
        },
        'Skill pack tool profile applied to worker',
      );
      profile = selectedPack.toolProfile;
    }

    // OB-1548: Auto-escalate from code-edit to file-management for file operation tasks.
    // When the worker prompt contains file management keywords and the current profile is
    // code-edit, escalate to file-management which includes Bash(rm:*), Bash(mv:*), etc.
    if (profile === 'code-edit' && FILE_OP_KEYWORDS.test(body.prompt)) {
      logger.debug(
        { workerId, previousProfile: 'code-edit', newProfile: 'file-management' },
        'Auto-escalating profile from code-edit to file-management for file operation task',
      );
      profile = 'file-management';
    }

    // Adaptive model selection (OB-724): marker override -> learned best model -> heuristics
    if (!resolvedModel && memory) {
      const taskType = classifyTaskType(body.prompt);
      const learned = await getRecommendedModel(memory, taskType);
      if (learned) {
        resolvedModel = learned.model;
        logger.debug(
          { workerId, model: learned.model, reason: learned.reason },
          'Adaptive model selected for worker',
        );
      }
    }

    // Always resolve model tiers to concrete model IDs for the target provider.
    // This handles "fast" -> "haiku" (claude), "fast" -> "codex-mini" (codex), etc.
    if (resolvedModel) {
      const providerName =
        requestedTool && this.resolveDiscoveredTool(requestedTool)
          ? requestedTool
          : this.deps.masterTool.name;
      const modelRegistry = createModelRegistry(providerName);
      resolvedModel = modelRegistry.resolveModelOrTier(resolvedModel);
    }

    // Default Claude workers to Sonnet tier (OB-1560, OB-F205): when no model is specified
    // (SPAWN markers often omit model), undefined flows through to getClaudePromptBudget()
    // which returns 32K Haiku tier instead of 128K Sonnet. Sonnet is the correct default.
    // Codex/Aider workers keep undefined — they have their own budget logic.
    if (!resolvedModel && this.deps.masterTool.name === 'claude') {
      resolvedModel = 'sonnet';
      logger.debug({ workerId }, 'Worker model defaulted to sonnet (no explicit model)');
    }

    // Avoid high-failure-rate models (OB-907): if the resolved model has >50% failure rate
    // for this task type (with >=3 data points), prefer a better-performing alternative.
    if (resolvedModel && memory) {
      const taskTypeForAvoidance = classifyTaskType(body.prompt);
      const alternative = await avoidHighFailureModel(memory, taskTypeForAvoidance, resolvedModel);
      if (alternative) {
        logger.info(
          {
            workerId,
            previousModel: resolvedModel,
            newModel: alternative.model,
            reason: alternative.reason,
          },
          'Model replaced due to high failure rate in learnings',
        );
        resolvedModel = alternative.model;
      }
    }

    // Adaptive max-turns (OB-902): scale budget by prompt length when the SPAWN marker
    // didn't explicitly specify maxTurns. A longer prompt usually means a more complex
    // task that needs more turns to complete.
    const resolvedMaxTurns = body.maxTurns ?? this.computeAdaptiveMaxTurns(profile, body.prompt);

    logger.info(
      {
        workerId,
        workerIndex: index,
        profile,
        model: resolvedModel,
        tool: toolUsed,
        maxTurns: resolvedMaxTurns,
        maxTurnsSource: body.maxTurns != null ? 'spawn-marker' : 'adaptive',
        promptLength: body.prompt.length,
      },
      'Spawning worker from SPAWN marker',
    );

    // OB-1780: Reasoning checkpoint — "What could go wrong?" before full-access workers.
    // Scans the task prompt for destructive, broad-scope, and security-sensitive patterns.
    // The checkpoint is analytical only (does not block execution); it surfaces risks in
    // the log so engineers and the audit trail can review the reasoning before a high-
    // privilege worker modifies files, installs packages, or runs system commands.
    if (profile === 'full-access') {
      const checkpoint = performReasoningCheckpoint(body.prompt);
      logger.info(
        {
          workerId,
          riskLevel: checkpoint.riskLevel,
          risks: checkpoint.risks.map((r) => ({ pattern: r.pattern, level: r.level })),
          riskCount: checkpoint.risks.length,
        },
        'Reasoning checkpoint: pre-spawn risk analysis for full-access worker',
      );
    }

    // Pre-flight tool prediction (OB-1595): before spending any turns, analyze the
    // task prompt for keywords that suggest the worker will need tools beyond what
    // its current profile allows (e.g. "npm test" with a read-only profile).
    // When a mismatch is predicted, request escalation upfront — the user is asked
    // before the worker is spawned, and the actual spawn is deferred to the respawn
    // callback so no turns are wasted on a predictably blocked worker.
    const toolPrediction = predictToolRequirements(body.prompt, profile);
    if (toolPrediction && router && activeMessage) {
      logger.info(
        {
          workerId,
          currentProfile: profile,
          suggestedProfile: toolPrediction.suggestedProfile,
          triggerKeywords: toolPrediction.triggerKeywords,
          reason: toolPrediction.reason,
        },
        'Pre-flight tool prediction: requesting upfront escalation before spawn',
      );
      const origMessage = activeMessage;
      const connector = router.getConnector(origMessage.source);
      if (connector) {
        const suggestedTools =
          resolveProfile(toolPrediction.suggestedProfile, undefined, this.deps.trustLevel) ?? [];
        const currentTools = resolveProfile(profile, undefined, this.deps.trustLevel) ?? [];
        const additionalTools = suggestedTools.filter((t) => !currentTools.includes(t));

        // OB-1596/OB-1600: If session or permanent grants already cover all additional
        // tools, skip escalation — they will be auto-merged into allowedTools below.
        const grantsCoversTools =
          additionalTools.length > 0 &&
          additionalTools.every((t) => expandedSessionGrants.has(t) || permanentGrants.includes(t));

        if (!grantsCoversTools) {
          const respawnCallback = async (grantedTools: string[]): Promise<void> => {
            await this.respawnWorkerAfterGrant(
              workerId,
              marker,
              index,
              profile,
              grantedTools,
              attachments,
            );
          };

          await router.requestToolEscalation(
            workerId,
            additionalTools.length > 0 ? additionalTools : [toolPrediction.suggestedProfile],
            profile,
            `Pre-flight prediction: ${toolPrediction.reason} (keywords: ${toolPrediction.triggerKeywords.join(', ')})`,
            origMessage,
            connector,
            respawnCallback,
          );

          // Return a deferred result — the actual spawn happens asynchronously
          // via respawnCallback when the user grants tool access.
          return {
            stdout: `[Pre-flight] Tool grant requested for worker ${workerId}: ${toolPrediction.reason}. Spawn deferred pending user confirmation.`,
            stderr: '',
            exitCode: 0,
            durationMs: 0,
            retryCount: 0,
            status: 'completed' as const,
          };
        }

        logger.info(
          {
            workerId,
            additionalTools,
            sessionGrants: [...senderSessionGrants],
            permanentGrants,
          },
          'Pre-flight: required tools already granted (session or permanent) — skipping escalation',
        );
      }
    }

    // OB-1787: Per-worker test modification permission grant.
    // The Master AI is instructed (via system prompt) to include either:
    //   a) "Do not modify test files ... unless explicitly authorized." — protection
    //   b) "AUTHORIZED: test modification permitted"                   — explicit grant
    // Additionally, the SPAWN marker may carry allowTestModification:true as a
    // structured alternative to the in-prompt text marker.
    //
    // Enforcement logic for code-edit and full-access workers:
    // 1. If test modification is explicitly granted (flag OR in-prompt marker):
    //    - Log the authorization for the audit trail.
    //    - Ensure the authorization header is present at the top of the prompt
    //      so the worker receives a clear, unambiguous grant even if the Master
    //      placed the text mid-prompt.
    // 2. If NOT granted and no protection instruction is already present:
    //    - Inject the protection reminder so workers always have an explicit guard,
    //      regardless of whether the Master included it in the prompt.
    const TEST_PROTECTION_PROFILES = new Set(['code-edit', 'full-access']);
    const AUTHORIZED_MARKER = 'AUTHORIZED: test modification permitted';
    const TEST_PROTECTION_INSTRUCTION =
      'Do not modify test files (files in `tests/`, `__tests__/`, or files matching ' +
      '`*.test.ts`, `*.spec.ts`, `*.test.js`, `*.spec.js`) unless explicitly authorized.';

    if (TEST_PROTECTION_PROFILES.has(profile)) {
      const hasAuthFlag = body.allowTestModification === true;
      const hasAuthText = workerPrompt.includes(AUTHORIZED_MARKER);
      const hasProtectionText = workerPrompt.includes(TEST_PROTECTION_INSTRUCTION.slice(0, 40));

      if (hasAuthFlag || hasAuthText) {
        // Grant: worker is authorized to touch test files.
        logger.info(
          { workerId, profile, source: hasAuthFlag ? 'spawn-flag' : 'prompt-marker' },
          'Test modification permission granted for this worker',
        );
        // Normalize: ensure the authorization header is at the very top of the prompt
        // so the worker cannot miss it (it may have been buried mid-prompt by the Master).
        if (!workerPrompt.startsWith(AUTHORIZED_MARKER)) {
          // Remove any existing AUTHORIZED marker to avoid duplication, then prepend.
          const cleaned = workerPrompt.replace(AUTHORIZED_MARKER, '').trimStart();
          workerPrompt = `${AUTHORIZED_MARKER}\n\n${cleaned}`;
        }
      } else if (!hasProtectionText) {
        // No grant and no protection text — the Master omitted the guard. Inject it.
        logger.debug(
          { workerId, profile },
          'Test protection instruction injected (Master omitted it)',
        );
        workerPrompt = `${TEST_PROTECTION_INSTRUCTION}\n\n${workerPrompt}`;
      }
    }

    // OB-1562: Pre-spawn prompt size validation — catch oversized prompts before they reach
    // the adapter's sanitizePrompt(). This logs the workerId at the decision point, enabling
    // smarter handling (e.g. prompt splitting) in the future.
    const maxChars = getMaxPromptLength(resolvedModel);
    if (workerPrompt.length > maxChars) {
      const originalLen = workerPrompt.length;
      workerPrompt = workerPrompt.slice(0, maxChars);
      logger.warn(
        { workerId, originalLen, maxChars, truncated: originalLen - maxChars },
        'Pre-budgeted worker prompt to fit model limit',
      );
    }

    // NOTE: No sessionId provided here — workers get --print mode (depth limiting)
    // manifestToSpawnOptions is async: when manifest.mcpServers is set, it writes a
    // per-worker temp MCP config file and returns a cleanup callback to delete it.
    // OB-1521: Apply per-worker cost cap — marker override takes precedence over profile default.
    const resolvedMaxCostUsd: number | undefined =
      body.maxCostUsd ?? PROFILE_DEFAULT_COST_CAPS[profile];

    const { spawnOptions: spawnOpts, cleanup: mcpCleanup } = await manifestToSpawnOptions(
      {
        prompt: workerPrompt,
        workspacePath: this.deps.workspacePath,
        profile,
        model: resolvedModel,
        maxTurns: resolvedMaxTurns,
        timeout: body.timeout,
        retries: body.retries,
        maxBudgetUsd: body.maxBudgetUsd,
        maxCostUsd: resolvedMaxCostUsd,
      },
      customProfiles,
    );

    // OB-1791: Apply configurable fix iteration cap to workers.
    // Sourced from config.worker.maxFixIterations (default: 3).
    spawnOpts.maxFixIterations = this.deps.workerMaxFixIterations;

    // OB-1593: Thread trustLevel into securityConfig so agent-runner cost caps scale correctly.
    spawnOpts.securityConfig = SecurityConfigSchema.parse({
      trustLevel: this.deps.trustLevel ?? 'standard',
    });

    // OB-1596: Auto-merge session-granted tools into this worker's allowedTools.
    // Tools previously approved by the user this session (via /allow) are applied
    // automatically so repeated worker spawns don't re-ask for the same permissions.
    if (expandedSessionGrants.size > 0) {
      const existing = spawnOpts.allowedTools ?? [];
      const toolsToAdd = [...expandedSessionGrants].filter((t) => !existing.includes(t));
      if (toolsToAdd.length > 0) {
        spawnOpts.allowedTools = [...existing, ...toolsToAdd];
        logger.debug(
          { workerId, toolsAdded: toolsToAdd },
          'Session grants auto-merged into worker allowedTools',
        );
      }
    }

    // OB-1600: Auto-merge permanent tool grants from the DB into this worker's allowedTools.
    // These are tools the user permanently approved (via /allow-permanent or the access CLI).
    // They persist across sessions and are applied without asking the user again.
    if (permanentGrants.length > 0) {
      const existing = spawnOpts.allowedTools ?? [];
      const toolsToAdd = permanentGrants.filter((t) => !existing.includes(t));
      if (toolsToAdd.length > 0) {
        spawnOpts.allowedTools = [...existing, ...toolsToAdd];
        logger.debug(
          { workerId, toolsAdded: toolsToAdd },
          'Permanent grants auto-merged into worker allowedTools',
        );
      }
    }

    // Auto-merge skill pack requiredTools into worker allowedTools.
    // Skill packs declare tools they need (e.g. Bash(sqlite3:*)) that may not be
    // included in the base profile. Without this merge, the worker would be blocked
    // by Claude's permission system — and in --print mode with remote users
    // (WebChat, Telegram, WhatsApp), there is no terminal to approve the prompt.
    if (selectedPack && selectedPack.requiredTools.length > 0) {
      const existing = spawnOpts.allowedTools ?? [];
      const toolsToAdd = selectedPack.requiredTools.filter((t) => !existing.includes(t));
      if (toolsToAdd.length > 0) {
        spawnOpts.allowedTools = [...existing, ...toolsToAdd];
        logger.info(
          { workerId, toolsAdded: toolsToAdd, skillPack: selectedPack.name },
          'Skill pack requiredTools merged into worker allowedTools',
        );
      }
    }

    // Create task record for this worker execution (OB-165: task history + audit trail)
    const taskRecord: TaskRecord = {
      id: workerId,
      userMessage: body.prompt,
      sender: 'master',
      description: `Worker ${index}: ${body.prompt.slice(0, 100)}`,
      status: 'processing',
      handledBy: 'worker',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      metadata: {
        workerIndex: index,
        profile,
        model: resolvedModel,
        tool: toolUsed,
        maxTurns: resolvedMaxTurns,
        timeout: body.timeout,
        retries: body.retries,
        manifest: {
          prompt: body.prompt,
          workspacePath: this.deps.workspacePath,
          profile,
          model: resolvedModel,
          maxTurns: body.maxTurns,
          timeout: body.timeout,
          retries: body.retries,
        },
      },
    };

    // Inject memory briefing as system prompt so the worker starts with project context (OB-723)
    if (memory) {
      try {
        const briefing = await memory.buildBriefing(body.prompt);
        if (briefing) {
          spawnOpts.systemPrompt = briefing;
        }
      } catch (briefingErr) {
        logger.warn(
          { workerId, error: briefingErr },
          'Failed to build worker briefing — proceeding without context',
        );
      }
    }

    // INSERT agent_activity row with status='starting' (OB-742)
    const workerStartedAt = new Date().toISOString();
    if (memory) {
      try {
        const masterSessionId = this.deps.getMasterSession()?.sessionId;
        const workerActivity: ActivityRecord = {
          id: workerId,
          type: 'worker',
          model: resolvedModel ?? body.model ?? undefined,
          profile,
          task_summary: body.prompt.slice(0, 120),
          status: 'starting',
          parent_id: masterSessionId,
          started_at: workerStartedAt,
          updated_at: workerStartedAt,
        };
        await memory.insertActivity(workerActivity);
      } catch (actErr) {
        logger.warn({ workerId, error: actErr }, 'Failed to record worker activity (starting)');
      }
    }

    // Track whether agent_activity was updated to a terminal state (OB-1517).
    // Used by the finally block as a safety-net for streaming agents (Codex path)
    // whose activity could remain 'running' if an intermediate step throws.
    let activityUpdated = false;

    try {
      // Build a streaming progress callback — broadcasts worker-turn-progress events
      // to all connectors as each agent turn is parsed from stdout (OB-1051).
      const routerRef = router;
      const workerMaxTurns = spawnOpts.maxTurns ?? DEFAULT_MAX_TURNS_TASK;
      const onTurnProgress = routerRef
        ? (indicator: { turnsUsed: number; lastAction?: string }): void => {
            void routerRef.broadcastProgress({
              type: 'worker-turn-progress',
              workerId,
              turnsUsed: indicator.turnsUsed,
              turnsMax: workerMaxTurns,
              lastAction: indicator.lastAction,
            });
          }
        : undefined;

      // Use spawnWithStreamingHandle() to capture the real PID and abort function (OB-873)
      // and broadcast real-time turn progress via worker-turn-progress events (OB-1051).
      let currentHandle = workerRunner.spawnWithStreamingHandle(spawnOpts, onTurnProgress);
      this.workerAbortHandles.set(workerId, currentHandle.abort);
      this.deps.workerRegistry.markRunning(workerId, currentHandle.pid);
      logger.debug(
        { workerId, pid: currentHandle.pid },
        'Worker process started — real PID captured',
      );

      // UPDATE agent_activity to 'running' now that spawn is about to start (OB-742)
      if (memory) {
        try {
          await memory.updateActivity(workerId, { status: 'running' });
        } catch (actErr) {
          logger.warn({ workerId, error: actErr }, 'Failed to update worker activity (running)');
        }
      }

      // Worker-level retry with exponential backoff (OB-905).
      // Default retries = 2. Only retry on retryable error categories:
      //   retryable:     'rate-limit', 'timeout', 'crash'
      //   non-retryable: 'auth', 'context-overflow', 'unknown'
      const maxWorkerRetries = body.retries ?? 2;
      let workerRetryCount = 0;
      let result: AgentResult;
      let isFirstWorkerAttempt = true;

      while (true) {
        if (isFirstWorkerAttempt) {
          result = await currentHandle.promise;
          isFirstWorkerAttempt = false;
        } else {
          // Worker-level retry — spawn a new process and update the abort handle (OB-873)
          currentHandle = workerRunner.spawnWithStreamingHandle(spawnOpts, onTurnProgress);
          this.workerAbortHandles.set(workerId, currentHandle.abort);
          result = await currentHandle.promise;
        }

        if (result.exitCode === 0) {
          break; // Success — no retry needed
        }

        // Classify the error to decide retry strategy (OB-904, OB-905)
        const errorCategory = classifyError(result.stderr, result.exitCode);
        const isRetryable =
          errorCategory === 'rate-limit' ||
          errorCategory === 'timeout' ||
          errorCategory === 'crash';

        if (!isRetryable) {
          // Non-retryable failure (auth, context-overflow, unknown) — break immediately
          logger.warn(
            {
              workerId,
              exitCode: result.exitCode,
              errorCategory,
              durationMs: result.durationMs,
            },
            'Worker failed with non-retryable error',
          );
          break;
        }

        // Check if we have retries left
        if (workerRetryCount >= maxWorkerRetries) {
          break; // Exhausted retries
        }

        // Retryable failure — apply exponential backoff and retry
        workerRetryCount++;
        const delay = this.deps.workerRetryDelayMs * Math.pow(2, workerRetryCount - 1);
        logger.info(
          {
            workerId,
            workerRetry: workerRetryCount,
            maxWorkerRetries,
            exitCode: result.exitCode,
            errorCategory,
            delayMs: delay,
            stderrPreview: result.stderr.slice(0, 150),
          },
          'Worker failed with retryable error — retrying after backoff',
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // Update worker record with retry count
      const workerRecord = this.deps.workerRegistry.getWorker(workerId);
      if (workerRecord) {
        workerRecord.workerRetries = workerRetryCount;
      }

      // Detect max-turns exhaustion: Claude exits 0 but work may be incomplete (OB-900)
      // Auto-retry with an escalated turn budget (OB-903): max 1 turn-escalation retry.
      // Skip for non-Claude tools — --max-turns is a Claude-only feature. Other tools
      // (Codex, Aider) may produce false positives from pattern matching on their output.
      if (result.turnsExhausted && toolUsed === 'claude') {
        const originalMaxTurns = spawnOpts.maxTurns ?? DEFAULT_MAX_TURNS_TASK;
        logger.warn(
          {
            workerId,
            maxTurns: originalMaxTurns,
            model: result.model,
            durationMs: result.durationMs,
          },
          'Worker hit max-turns limit — attempting turn-escalation retry',
        );

        const escalatedMaxTurns = Math.min(Math.ceil(originalMaxTurns * 1.5), 50);
        const partialOutput = result.stdout.trim();

        // Extract [INCOMPLETE: step X/Y] marker injected by the worker (OB-901)
        const incompleteMatch = partialOutput.match(/\[INCOMPLETE:\s*([^\]]+)\]/i);
        const incompleteHint =
          incompleteMatch && incompleteMatch[1] ? incompleteMatch[1].trim() : null;

        const continuationNote = incompleteHint
          ? `Previous attempt was incomplete: ${incompleteHint}. Continue from where it left off.`
          : 'Previous attempt hit the turn limit before completing. Continue from where it left off.';

        // Append partial output (last 2 000 chars) as context so the worker can resume
        const escalationPrompt = [
          body.prompt,
          '',
          '---',
          'CONTEXT FROM PREVIOUS ATTEMPT (partial output):',
          partialOutput.slice(-2000),
          '---',
          continuationNote,
        ].join('\n');

        const escalatedSpawnOpts: SpawnOptions = {
          ...spawnOpts,
          prompt: escalationPrompt,
          maxTurns: escalatedMaxTurns,
        };

        logger.info(
          { workerId, originalMaxTurns, escalatedMaxTurns, incompleteHint },
          'Turn-escalation retry: re-spawning with higher turn budget',
        );

        // Use spawnWithStreamingHandle() so the abort handle stays current during escalation (OB-873)
        // Pass a dedicated callback with the escalated max-turns value (OB-1051).
        const escalationHandle = workerRunner.spawnWithStreamingHandle(
          escalatedSpawnOpts,
          routerRef
            ? (indicator): void => {
                void routerRef.broadcastProgress({
                  type: 'worker-turn-progress',
                  workerId,
                  turnsUsed: indicator.turnsUsed,
                  turnsMax: escalatedMaxTurns,
                  lastAction: indicator.lastAction,
                });
              }
            : undefined,
        );
        this.workerAbortHandles.set(workerId, escalationHandle.abort);
        result = await escalationHandle.promise;

        if (result.turnsExhausted) {
          logger.warn(
            { workerId, escalatedMaxTurns },
            'Turn-escalation retry also exhausted — returning partial result',
          );
        }
      }

      // Update registry based on final result
      if (result.exitCode === 0) {
        this.deps.workerRegistry.markCompleted(workerId, result);
      } else {
        const isTimeout = result.exitCode === 143 || result.exitCode === 137;
        const errorMessage = isTimeout
          ? `Worker timeout: process terminated after ${body.timeout ?? 'default'}ms (exit code ${result.exitCode})`
          : `Exit code ${result.exitCode}: ${result.stderr.slice(0, 200)}`;

        this.deps.workerRegistry.markFailed(workerId, result, errorMessage);
      }

      // Persist registry after worker completion or failure
      await this.deps.persistWorkerRegistry();

      // Detect tool-access failures in the worker result (OB-1592).
      // Even a zero-exit worker may report a tool-denial in its output.
      const toolFailure = detectToolAccessFailure(result);
      if (toolFailure) {
        logger.warn(
          {
            workerId,
            tool: toolFailure.tool,
            profile,
            reason: toolFailure.reason,
            exitCode: result.exitCode,
          },
          'Worker tool-access failure detected — tool was blocked by allowedTools restrictions',
        );
        // Store on the result metadata for audit trail.
        taskRecord.metadata = {
          ...taskRecord.metadata,
          toolAccessFailure: { tool: toolFailure.tool, reason: toolFailure.reason },
        };

        // Wire to Router escalation (OB-1593): ask the user to approve the needed tool.
        // Only fires when a router and an active user message are available (i.e. during
        // processMessage / streamMessage — not during background exploration workers).
        if (router && activeMessage) {
          const origMessage = activeMessage;
          const connector = router.getConnector(origMessage.source);
          if (connector) {
            const requestedTools = toolFailure.tool ? [toolFailure.tool] : [];
            // OB-1594: Provide a respawn callback so /allow can re-spawn the worker
            // with the granted tools merged into its profile.
            const respawnCallback = async (grantedTools: string[]): Promise<void> => {
              await this.respawnWorkerAfterGrant(
                workerId,
                marker,
                index,
                profile,
                grantedTools,
                attachments,
              );
            };
            await router.requestToolEscalation(
              workerId,
              requestedTools,
              profile,
              toolFailure.reason,
              origMessage,
              connector,
              respawnCallback,
            );
          } else {
            logger.warn(
              { workerId, source: origMessage.source },
              'Tool escalation skipped — connector not found for source',
            );
          }
        }
      }

      // Update task record with result (OB-165)
      taskRecord.status = result.exitCode === 0 ? 'completed' : 'failed';
      taskRecord.result = result.exitCode === 0 ? result.stdout : undefined;
      taskRecord.error = result.exitCode === 0 ? undefined : result.stderr;
      taskRecord.completedAt = new Date().toISOString();
      taskRecord.durationMs = result.durationMs;
      taskRecord.metadata = {
        ...taskRecord.metadata,
        exitCode: result.exitCode,
        retryCount: result.retryCount,
        workerRetries: workerRetryCount,
        modelUsed: result.model,
        modelFallbacks: result.modelFallbacks,
        resolvedTools: spawnOpts.allowedTools,
      };

      // Write worker task to store (memory) (OB-165: task history + audit trail)
      if (memory) {
        const statusMap: Record<string, MemoryTaskRecord['status']> = {
          completed: 'completed',
          failed: 'failed',
        };
        await memory.recordTask({
          id: taskRecord.id,
          type: 'worker',
          status: statusMap[taskRecord.status] ?? 'failed',
          prompt: taskRecord.userMessage,
          response: taskRecord.result,
          model: (taskRecord.metadata?.['modelUsed'] as string | undefined) ?? spawnOpts.model,
          profile,
          max_turns: spawnOpts.maxTurns,
          duration_ms: taskRecord.durationMs,
          exit_code: (taskRecord.metadata?.['exitCode'] as number | undefined) ?? result.exitCode,
          retries: result.retryCount,
          created_at: taskRecord.createdAt,
          completed_at: taskRecord.completedAt,
        });
      } else {
        logger.warn({ workerId }, 'MemoryManager not available — worker task record not persisted');
      }

      // UPDATE agent_activity to 'done' or 'failed' with cost (OB-742, OB-746)
      if (memory) {
        try {
          const activityStatus = result.exitCode === 0 ? 'done' : 'failed';
          await memory.updateActivity(workerId, {
            status: activityStatus,
            progress_pct: result.exitCode === 0 ? 100 : undefined,
            completed_at: taskRecord.completedAt,
            cost_usd: result.costUsd,
          });
          activityUpdated = true;
        } catch (actErr) {
          logger.warn({ workerId, error: actErr }, 'Failed to update worker activity (completion)');
        }
      }

      // Record worker output to conversation history (OB-730)
      if (result.exitCode === 0 && result.stdout.trim()) {
        const workerSessionId = this.deps.getMasterSession()?.sessionId ?? workerId;
        await this.deps.recordConversationMessage(workerSessionId, 'worker', result.stdout.trim());
      }

      // Auto-store worker results in chunk store for future RAG retrieval (OB-1570)
      const knowledgeRetriever = this.deps.getKnowledgeRetriever();
      if (result.exitCode === 0 && result.stdout.trim() && knowledgeRetriever) {
        try {
          await knowledgeRetriever.storeWorkerResult(result.stdout.trim(), body.prompt, []);
        } catch (storeErr) {
          logger.warn(
            { workerId, error: storeErr },
            'Failed to store worker result in chunk store',
          );
        }
      }

      // Record learning entry for this worker execution (OB-171: learnings store)
      await this.deps.recordWorkerLearning(taskRecord, result, profile, spawnOpts.model);

      // Record prompt effectiveness (OB-172: prompt effectiveness tracking)
      await this.deps.recordPromptEffectiveness(taskRecord, result);

      // Clean up per-worker MCP temp file (no-op when no MCP servers were requested)
      await mcpCleanup();

      return result;
    } catch (error) {
      // Worker threw an exception (spawn error, exhausted retries, etc.)
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedResult: AgentResult = {
        exitCode: -1,
        stdout: '',
        stderr: errorMessage,
        durationMs: 0,
        retryCount: 0,
        status: 'completed',
      };

      this.deps.workerRegistry.markFailed(workerId, failedResult, errorMessage);

      // Remove worker from registry to free the concurrency slot and prevent orphaned
      // pending workers from accumulating (OB-1264 / OB-F153)
      this.deps.workerRegistry.removeWorker(workerId);

      // Persist registry after exception
      await this.deps.persistWorkerRegistry();

      // Update task record with error (OB-165)
      taskRecord.status = 'failed';
      taskRecord.error = errorMessage;
      taskRecord.completedAt = new Date().toISOString();
      taskRecord.durationMs = 0;
      taskRecord.metadata = {
        ...taskRecord.metadata,
        exitCode: -1,
        retryCount: 0,
        exceptionThrown: true,
      };

      // Write worker task to store (memory) even on exception (OB-165)
      if (memory) {
        await memory.recordTask({
          id: taskRecord.id,
          type: 'worker',
          status: 'failed',
          prompt: taskRecord.userMessage,
          model: taskRecord.metadata?.['modelUsed'] as string | undefined,
          profile,
          max_turns: spawnOpts.maxTurns,
          duration_ms: 0,
          exit_code: -1,
          retries: 0,
          created_at: taskRecord.createdAt,
          completed_at: taskRecord.completedAt,
        });
      } else {
        logger.warn(
          { workerId },
          'MemoryManager not available — worker exception task record not persisted',
        );
      }

      // UPDATE agent_activity to 'failed' on exception (OB-742)
      if (memory) {
        try {
          await memory.updateActivity(workerId, {
            status: 'failed',
            completed_at: taskRecord.completedAt,
          });
          activityUpdated = true;
        } catch (actErr) {
          logger.warn({ workerId, error: actErr }, 'Failed to update worker activity (failed)');
        }
      }

      // Record learning entry even on exception (OB-171: learnings store)
      await this.deps.recordWorkerLearning(taskRecord, failedResult, profile, body.model);

      // Record prompt effectiveness even on exception (OB-172: prompt effectiveness tracking)
      await this.deps.recordPromptEffectiveness(taskRecord, failedResult);

      // Clean up per-worker MCP temp file even on exception
      await mcpCleanup();

      // Re-throw so Promise.allSettled captures it as rejected
      throw error;
    } finally {
      // Always clean up abort handle — ensures no stale handles even on pre-spawn
      // exceptions (escalation timeout, slot wait timeout, spawn error). (OB-F171)
      this.workerAbortHandles.delete(workerId);

      // Safety-net: ensure agent_activity transitions out of 'running' for ALL agent
      // types (Claude, Codex, Aider). Without this, streaming workers (especially Codex)
      // can remain stuck as 'running' if an intermediate step throws after the process
      // completes but before the activity update runs. (OB-1517 / OB-F196)
      if (!activityUpdated && memory) {
        try {
          await memory.updateActivity(workerId, {
            status: 'failed',
            completed_at: new Date().toISOString(),
          });
          logger.warn(
            { workerId },
            'Safety-net: forced agent_activity to failed — normal completion path did not update status',
          );
        } catch {
          // Best-effort — if DB is unavailable, nothing more we can do
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Targeted reader
  // -------------------------------------------------------------------------

  /**
   * Spawns a lightweight read-only worker to answer a focused question about
   * specific files. Used by the targeted reader path when RAG confidence < 0.3.
   *
   * OB-1353
   */
  async spawnTargetedReader(filePaths: string[], question: string): Promise<string> {
    const fileList = filePaths.map((p) => `- ${p}`).join('\n');
    const prompt = [
      'Read these files and answer the following question.',
      '',
      '## Files to Read',
      fileList,
      '',
      '## Question',
      question,
    ].join('\n');

    const model = this.deps.modelRegistry.resolveModelOrTier('fast');

    logger.debug(
      { fileCount: filePaths.length, question: question.slice(0, 80) },
      'Spawning targeted reader worker',
    );

    const result = await this.deps.agentRunner.spawn({
      prompt,
      workspacePath: this.deps.workspacePath,
      allowedTools: [...TOOLS_READ_ONLY],
      maxTurns: 5,
      model,
    });

    if (result.exitCode !== 0) {
      logger.warn(
        { exitCode: result.exitCode, fileCount: filePaths.length },
        'Targeted reader worker failed',
      );
      return '';
    }

    return result.stdout.trim();
  }

  // -------------------------------------------------------------------------
  // Delegation handling
  // -------------------------------------------------------------------------

  /**
   * Parse delegation markers from Master AI output.
   * Format: [DELEGATE:tool-name]prompt text[/DELEGATE]
   *
   * Returns parsed delegations or null if none found.
   */
  parseDelegationMarkers(response: string): Array<{ toolName: string; prompt: string }> | null {
    const delegationPattern = /\[DELEGATE:([^\]]+)\]([\s\S]*?)\[\/DELEGATE\]/g;
    const delegations: Array<{ toolName: string; prompt: string }> = [];

    let match;
    while ((match = delegationPattern.exec(response)) !== null) {
      const toolName = match[1]?.trim();
      const prompt = match[2]?.trim();
      if (toolName && prompt) {
        delegations.push({ toolName, prompt });
      }
    }

    return delegations.length > 0 ? delegations : null;
  }

  /**
   * Resolve a discovered tool by name (synchronous, exact match only).
   * Used for per-worker tool selection from SPAWN markers.
   */
  resolveDiscoveredTool(toolName: string): DiscoveredTool | undefined {
    return this.deps.discoveredTools.find((t) => t.name === toolName && t.available);
  }

  async findSpecialistTool(toolName: string): Promise<DiscoveredTool | null> {
    // First check discovered tools
    const tool = this.deps.discoveredTools.find(
      (t) =>
        t.name.toLowerCase() === toolName.toLowerCase() ||
        t.name.toLowerCase().includes(toolName.toLowerCase()),
    );

    if (tool) {
      return tool;
    }

    // Check agents registry — DB first, JSON fallback
    let agents = null;
    const memory = this.deps.getMemory();
    if (memory) {
      const raw = await memory.getSystemConfig('agents');
      if (raw) {
        try {
          agents = AgentsRegistrySchema.parse(JSON.parse(raw));
        } catch {
          // fall through to JSON file
        }
      }
    }
    if (!agents) {
      agents = await this.deps.dotFolder.readAgents();
    }
    if (!agents) {
      return null;
    }

    const specialist = agents.specialists.find(
      (s) =>
        s.name.toLowerCase() === toolName.toLowerCase() ||
        s.name.toLowerCase().includes(toolName.toLowerCase()),
    );

    if (specialist) {
      // Convert specialist to DiscoveredTool format
      return {
        name: specialist.name,
        path: specialist.path,
        version: specialist.version,
        available: true,
        role: specialist.role,
        capabilities: specialist.capabilities,
      };
    }

    return null;
  }

  /**
   * Handle delegations found in Master AI output.
   * Executes delegations and returns results to feed back to Master.
   */
  async handleDelegations(
    delegations: Array<{ toolName: string; prompt: string }>,
    message: InboundMessage,
  ): Promise<string> {
    const results: string[] = [];
    const delegationCoordinator = this.deps.getDelegationCoordinator();

    for (const delegation of delegations) {
      logger.info(
        { toolName: delegation.toolName, prompt: delegation.prompt.slice(0, 100) },
        'Handling delegation request',
      );

      // Find the specialist tool
      const tool = await this.findSpecialistTool(delegation.toolName);
      if (!tool) {
        const errorMsg = `Tool "${delegation.toolName}" not found in available specialists`;
        logger.warn({ toolName: delegation.toolName }, errorMsg);
        results.push(`[DELEGATION ERROR: ${errorMsg}]`);
        continue;
      }

      // Execute delegation
      this.deps.setState('delegating');
      if (!delegationCoordinator) {
        results.push(`[DELEGATION ERROR: DelegationCoordinator not available]`);
        continue;
      }
      const result = await delegationCoordinator.delegate({
        prompt: delegation.prompt,
        workspacePath: this.deps.workspacePath,
        tool,
        sender: message.sender,
        userMessage: message.rawContent,
      });

      if (result.success) {
        results.push(
          `[DELEGATION RESULT from ${tool.name}]\n${result.response}\n[/DELEGATION RESULT]`,
        );
      } else {
        results.push(`[DELEGATION ERROR from ${tool.name}]\n${result.error}\n[/DELEGATION ERROR]`);
      }
    }

    return results.join('\n\n');
  }

  // -------------------------------------------------------------------------
  // Batch command handling
  // -------------------------------------------------------------------------

  /**
   * Handle batch commands (pause, resume, skip, retry, abort).
   */
  async handleBatchCommand(
    action: 'pause' | 'resume' | 'skip' | 'retry' | 'abort',
    sender: string,
    source: string,
  ): Promise<string> {
    const batchManager = this.deps.getBatchManager();
    if (!batchManager) return 'No active batch.';

    const batchId = batchManager.getCurrentBatchId();
    if (!batchId) return 'No active batch found.';

    // Update stored sender info in case it changed (e.g. source connector switch) (OB-1667).
    batchManager.setSenderInfo(batchId, { sender, source });

    if (action === 'pause') {
      await batchManager.pauseBatch(batchId);
      const state = batchManager.getStatus(batchId);
      const current = state ? state.currentIndex + 1 : '?';
      const total = state ? state.totalItems : '?';
      logger.info({ batchId, current, total }, 'Batch paused by user command (OB-1619)');
      return `\u23F8 Batch paused at item ${current}/${total}. Reply '/continue' to resume.`;
    }

    if (action === 'resume') {
      const resumed = await batchManager.resumeBatch(batchId);
      if (!resumed) return 'No paused batch found to resume.';
      const state = batchManager.getStatus(batchId);
      const current = state ? state.currentIndex + 1 : '?';
      logger.info({ batchId, current }, 'Batch resumed by user command (OB-1620)');
      // Re-inject continuation to trigger the next item
      const router = this.deps.getRouter();
      const batchTimers = this.deps.getBatchTimers();
      if (router) {
        const handle = setTimeout(() => {
          batchTimers.delete(handle);
          if (this.deps.getState() === 'shutdown') return;
          router.routeBatchContinuation(batchId, sender).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            void batchManager.pauseBatch(batchId);
            void router.sendDirect(source, sender, `Batch paused due to error: ${msg}`);
            logger.error(
              { batchId, err },
              'routeBatchContinuation failed — batch paused (OB-1666)',
            );
          });
        }, 500);
        batchTimers.add(handle);
      }
      return `\u25B6 Resuming batch from item ${current}...`;
    }

    if (action === 'abort') {
      await batchManager.abortBatch(batchId);
      batchManager.deleteSenderInfo(batchId);
      logger.info({ batchId }, 'Batch aborted by user command');
      // Retrieve the abort summary built by abortBatch() before state was deleted (OB-1622).
      const abortSummary = batchManager.popCompletionSummary();
      return abortSummary ?? '\uD83D\uDED1 Batch aborted.';
    }

    if (action === 'skip') {
      const result = await batchManager.skipCurrentItem(batchId);
      if (!result) return 'Failed to skip — batch not found.';
      if (result.finished) {
        batchManager.deleteSenderInfo(batchId);
        return '\u23ED Item skipped. Batch complete — no more items.';
      }
      // Schedule next continuation
      const router = this.deps.getRouter();
      const batchTimers = this.deps.getBatchTimers();
      if (router) {
        const handle = setTimeout(() => {
          batchTimers.delete(handle);
          if (this.deps.getState() === 'shutdown') return;
          router.routeBatchContinuation(batchId, sender).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            void batchManager.pauseBatch(batchId);
            void router.sendDirect(source, sender, `Batch paused due to error: ${msg}`);
            logger.error(
              { batchId, err },
              'routeBatchContinuation failed — batch paused (OB-1666)',
            );
          });
        }, 1000);
        batchTimers.add(handle);
      }
      logger.info(
        { batchId, nextIndex: result.nextIndex },
        'Batch item skipped, continuing (OB-1623)',
      );
      return '\u23ED Item skipped. Continuing with next item...';
    }

    // action === 'retry'
    const retried = await batchManager.retryCurrentItem(batchId);
    if (!retried) return 'Failed to retry — batch not found.';
    // Schedule continuation (same index, so same item runs again)
    const router = this.deps.getRouter();
    const batchTimers = this.deps.getBatchTimers();
    if (router) {
      const handle = setTimeout(() => {
        batchTimers.delete(handle);
        if (this.deps.getState() === 'shutdown') return;
        router.routeBatchContinuation(batchId, sender).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          void batchManager.pauseBatch(batchId);
          void router.sendDirect(source, sender, `Batch paused due to error: ${msg}`);
          logger.error({ batchId, err }, 'routeBatchContinuation failed — batch paused (OB-1666)');
        });
      }, 1000);
      batchTimers.add(handle);
    }
    logger.info({ batchId }, 'Batch item retry scheduled by user command');
    return '\uD83D\uDD04 Retrying item...';
  }

  /**
   * Return a formatted batch status message for the `/batch` command (OB-1621).
   *
   * Shows the current item, progress (N/total), elapsed time, accumulated cost,
   * and a list of failed items. Returns "No active batch." when no batch is running.
   */
  getBatchStatus(): string {
    const batchManager = this.deps.getBatchManager();
    if (!batchManager) return 'No active batch.';

    const batchId = batchManager.getCurrentBatchId();
    if (!batchId) return 'No active batch.';

    const state = batchManager.getStatus(batchId);
    if (!state) return 'No active batch.';

    const current = state.currentIndex + 1;
    const total = state.totalItems;
    const currentItem = state.plan[state.currentIndex];

    // Elapsed time
    const elapsedMs = Date.now() - new Date(state.startedAt).getTime();
    const totalSeconds = Math.round(elapsedMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    let elapsedStr: string;
    if (hours > 0) {
      elapsedStr = `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      elapsedStr = `${minutes}m ${seconds}s`;
    } else {
      elapsedStr = `${seconds}s`;
    }

    const costStr = state.totalCostUsd > 0 ? `$${state.totalCostUsd.toFixed(4)}` : 'not tracked';
    const statusIcon = state.paused ? '\u23F8 Paused' : '\u25B6 Running';

    const lines: string[] = [
      `\uD83D\uDCCB Batch Status: ${statusIcon}`,
      `**Progress:** ${current}/${total} items`,
    ];

    if (currentItem) {
      const desc = currentItem.description ? ` \u2014 ${currentItem.description}` : '';
      lines.push(`**Current item:** ${currentItem.id}${desc}`);
    }

    lines.push(`**Elapsed:** ${elapsedStr}`);
    lines.push(`**Cost:** ${costStr}`);

    if (state.failedItems.length > 0) {
      lines.push(`**Failed:** ${state.failedItems.join(', ')}`);
    }

    logger.info({ batchId, current, total }, 'Batch status queried by user (OB-1621)');
    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // Worker registry loading
  // -------------------------------------------------------------------------

  /**
   * Load worker registry from DB or JSON file on startup.
   */
  async loadWorkerRegistry(): Promise<void> {
    try {
      let registry = null;

      // Try DB first
      const memory = this.deps.getMemory();
      if (memory) {
        const raw = await memory.getSystemConfig('workers');
        if (raw) {
          try {
            registry = WorkersRegistrySchema.parse(JSON.parse(raw));
          } catch {
            // fall through to JSON file
          }
        }
      }

      // Fall back to JSON file
      if (!registry) {
        registry = await this.deps.dotFolder.readWorkers();
      }

      if (registry) {
        this.deps.workerRegistry.fromJSON(registry);
        logger.info(
          { workerCount: Object.keys(registry.workers).length },
          'Loaded worker registry from disk',
        );
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to load worker registry from disk (will start fresh)');
    }
  }
}
