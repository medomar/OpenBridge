import { z } from 'zod';

import { MCPServerSchema } from './config.js';

// ── Agent Status ─────────────────────────────────────────────────

/** Possible lifecycle states for an agent */
export const AgentStatusSchema = z.enum([
  'idle',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
]);

// ── Agent Role ───────────────────────────────────────────────────

/** Distinguishes main orchestrator agents from task-specific workers */
export const AgentRoleSchema = z.enum(['main', 'task']);

// ── Task Item ────────────────────────────────────────────────────

/** Status of an individual task within an agent's task list */
export const TaskStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'failed',
  'skipped',
]);

/** A single task item assigned to an agent */
export const TaskItemSchema = z.object({
  /** Unique task identifier */
  id: z.string().min(1),
  /** Human-readable description of what this task does */
  description: z.string().min(1),
  /** Current status */
  status: TaskStatusSchema.default('pending'),
  /** Result or error message after execution */
  result: z.string().optional(),
  /** When the task started executing */
  startedAt: z.string().datetime().optional(),
  /** When the task finished */
  completedAt: z.string().datetime().optional(),
});

// ── Agent ────────────────────────────────────────────────────────

/** Schema for a base agent — the unit of work in the orchestrator */
export const AgentSchema = z.object({
  /** Unique agent identifier */
  id: z.string().min(1),
  /** Human-readable name (e.g., "inventory-sync-agent") */
  name: z.string().min(1),
  /** Agent role — main orchestrator or task worker */
  role: AgentRoleSchema,
  /** Current lifecycle status */
  status: AgentStatusSchema.default('idle'),
  /** Workspace this agent operates in */
  workspaceId: z.string().min(1),
  /** The provider to use for AI processing */
  providerId: z.string().min(1),
  /** Ordered list of tasks assigned to this agent */
  tasks: z.array(TaskItemSchema).default([]),
  /** When this agent was created */
  createdAt: z.string().datetime(),
  /** When this agent last changed status */
  updatedAt: z.string().datetime(),
  /** Agent-specific metadata (provider options, context, etc.) */
  metadata: z.record(z.unknown()).default({}),
});

// ── Task Agent ───────────────────────────────────────────────────

/** Schema for a task agent — a worker created by a main agent to handle a subtask */
export const TaskAgentSchema = AgentSchema.extend({
  /** Always 'task' for task agents */
  role: z.literal('task'),
  /** ID of the parent (main) agent that created this task agent */
  parentAgentId: z.string().min(1),
  /** ID of the specific task in the parent's task list that this agent fulfills */
  parentTaskId: z.string().min(1),
});

// ── Script Events ────────────────────────────────────────────────

/** Event types emitted during agent orchestration */
export const ScriptEventTypeSchema = z.enum([
  'agent_started',
  'agent_done',
  'agent_failed',
  'task_started',
  'task_complete',
  'task_failed',
  'task_progress',
]);

/** Base fields shared by all script events */
const ScriptEventBaseSchema = z.object({
  /** Unique event identifier */
  id: z.string().min(1),
  /** When the event occurred */
  timestamp: z.string().datetime(),
  /** ID of the agent that produced this event */
  agentId: z.string().min(1),
});

/** Emitted when an agent starts executing */
export const AgentStartedEventSchema = ScriptEventBaseSchema.extend({
  type: z.literal('agent_started'),
  payload: z.object({
    agentName: z.string(),
    taskCount: z.number().int().nonnegative(),
  }),
});

/** Emitted when an agent finishes all tasks successfully */
export const AgentDoneEventSchema = ScriptEventBaseSchema.extend({
  type: z.literal('agent_done'),
  payload: z.object({
    completedTasks: z.number().int().nonnegative(),
    totalTasks: z.number().int().nonnegative(),
  }),
});

/** Emitted when an agent fails irrecoverably */
export const AgentFailedEventSchema = ScriptEventBaseSchema.extend({
  type: z.literal('agent_failed'),
  payload: z.object({
    error: z.string(),
    failedTaskId: z.string().optional(),
  }),
});

/** Emitted when a task begins execution */
export const TaskStartedEventSchema = ScriptEventBaseSchema.extend({
  type: z.literal('task_started'),
  payload: z.object({
    taskId: z.string(),
    description: z.string(),
  }),
});

/** Emitted when a task completes successfully */
export const TaskCompleteEventSchema = ScriptEventBaseSchema.extend({
  type: z.literal('task_complete'),
  payload: z.object({
    taskId: z.string(),
    result: z.string().optional(),
  }),
});

/** Emitted when a task fails */
export const TaskFailedEventSchema = ScriptEventBaseSchema.extend({
  type: z.literal('task_failed'),
  payload: z.object({
    taskId: z.string(),
    error: z.string(),
    retryable: z.boolean().default(false),
  }),
});

/** Emitted to report progress on a long-running task */
export const TaskProgressEventSchema = ScriptEventBaseSchema.extend({
  type: z.literal('task_progress'),
  payload: z.object({
    taskId: z.string(),
    message: z.string(),
    /** 0–100 percent completion, if known */
    percent: z.number().min(0).max(100).optional(),
  }),
});

/** Discriminated union of all script events */
export const ScriptEventSchema = z.discriminatedUnion('type', [
  AgentStartedEventSchema,
  AgentDoneEventSchema,
  AgentFailedEventSchema,
  TaskStartedEventSchema,
  TaskCompleteEventSchema,
  TaskFailedEventSchema,
  TaskProgressEventSchema,
]);

// ── Script Event Listener ────────────────────────────────────────

/** Callback signature for script event listeners */
export type ScriptEventListener = (event: ScriptEvent) => void;

/** Map of event types to listener callbacks */
export type ScriptEventListeners = {
  [K in ScriptEventType]?: Array<(event: Extract<ScriptEvent, { type: K }>) => void>;
};

// ── Tool Profiles ───────────────────────────────────────────────

/** A named set of allowed tools that defines what a worker agent can do */
export const ToolProfileSchema = z.object({
  /** Profile identifier (e.g., 'read-only', 'code-edit', 'full-access') */
  name: z.string().min(1),
  /** Human-readable description of this profile's purpose */
  description: z.string().optional(),
  /** List of tools the agent is allowed to use (passed as --allowedTools) */
  tools: z.array(z.string().min(1)).min(1),
});

/** Built-in profile names that ship with OpenBridge */
export const BuiltInProfileNameSchema = z.enum(['read-only', 'code-edit', 'full-access', 'master']);

/**
 * Built-in tool profiles.
 *
 * These mirror the tool group constants in agent-runner.ts but wrapped
 * as named profiles so the Master AI can reference them by name.
 *
 * - read-only:    safe for exploration and information gathering
 * - code-edit:    for implementation tasks that modify files
 * - full-access:  unrestricted (use sparingly)
 */
export const BUILT_IN_PROFILES: Record<BuiltInProfileName, ToolProfile> = {
  'read-only': {
    name: 'read-only',
    description: 'Safe for exploration and information gathering',
    tools: ['Read', 'Glob', 'Grep'],
  },
  'code-edit': {
    name: 'code-edit',
    description: 'For implementation tasks that modify files',
    tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(git:*)', 'Bash(npm:*)', 'Bash(npx:*)'],
  },
  'full-access': {
    name: 'full-access',
    description: 'Unrestricted tool access (use sparingly)',
    tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'],
  },
  master: {
    name: 'master',
    description:
      'Master AI profile — file management for .openbridge/ but no Bash (delegates execution to workers)',
    tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
  },
};

// ── Profiles Registry ───────────────────────────────────────────

/**
 * Registry of custom tool profiles stored in .openbridge/profiles.json.
 * Master AI can create domain-specific profiles beyond the built-in ones.
 *
 * Example: a "test-runner" profile with [Read, Glob, Grep, Bash(npm:test)]
 */
export const ProfilesRegistrySchema = z.object({
  /** Custom profiles keyed by name */
  profiles: z.record(z.string(), ToolProfileSchema),
  /** When the registry was last updated */
  updatedAt: z.string().datetime(),
});

// ── Task Manifest ───────────────────────────────────────────────

/**
 * A task manifest describes everything needed to spawn a worker agent.
 * The Master AI produces these; AgentRunner consumes them.
 */
export const TaskManifestSchema = z.object({
  /** The prompt to send to the worker agent */
  prompt: z.string().min(1),
  /** Working directory for the worker */
  workspacePath: z.string().min(1),
  /** Model to use: 'haiku', 'sonnet', 'opus', or a full model ID */
  model: z.string().optional(),
  /** Named tool profile — resolved to tools[] by AgentRunner */
  profile: z.string().optional(),
  /** Explicit tools list — overrides profile if both are provided */
  allowedTools: z.array(z.string().min(1)).optional(),
  /** Maximum number of agentic turns */
  maxTurns: z.number().int().positive().optional(),
  /** Timeout in milliseconds for each attempt */
  timeout: z.number().int().positive().optional(),
  /** Number of retry attempts on failure */
  retries: z.number().int().nonnegative().optional(),
  /** Delay in milliseconds between retries */
  retryDelay: z.number().int().nonnegative().optional(),
  /** Maximum spend in USD for this worker (passed as --max-budget-usd) */
  maxBudgetUsd: z.number().positive().optional(),
  /** MCP servers this worker is allowed to use (per-worker isolation) */
  mcpServers: z.array(MCPServerSchema).optional(),
});

// ── Inferred Types ───────────────────────────────────────────────

export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type AgentRole = z.infer<typeof AgentRoleSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskItem = z.infer<typeof TaskItemSchema>;
export type Agent = z.infer<typeof AgentSchema>;
export type TaskAgent = z.infer<typeof TaskAgentSchema>;
export type ScriptEventType = z.infer<typeof ScriptEventTypeSchema>;
export type AgentStartedEvent = z.infer<typeof AgentStartedEventSchema>;
export type AgentDoneEvent = z.infer<typeof AgentDoneEventSchema>;
export type AgentFailedEvent = z.infer<typeof AgentFailedEventSchema>;
export type TaskStartedEvent = z.infer<typeof TaskStartedEventSchema>;
export type TaskCompleteEvent = z.infer<typeof TaskCompleteEventSchema>;
export type TaskFailedEvent = z.infer<typeof TaskFailedEventSchema>;
export type TaskProgressEvent = z.infer<typeof TaskProgressEventSchema>;
export type ScriptEvent = z.infer<typeof ScriptEventSchema>;
export type ToolProfile = z.infer<typeof ToolProfileSchema>;
export type BuiltInProfileName = z.infer<typeof BuiltInProfileNameSchema>;
export type ProfilesRegistry = z.infer<typeof ProfilesRegistrySchema>;
export type TaskManifest = z.infer<typeof TaskManifestSchema>;
