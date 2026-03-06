import { z } from 'zod';

/** Schema for a connector configuration */
export const ConnectorConfigSchema = z.object({
  type: z.string(),
  enabled: z.boolean().default(true),
  options: z.record(z.unknown()).default({}),
});

/** Schema for a workspace configuration entry */
export const WorkspaceConfigSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
});

/** Schema for a provider configuration */
export const ProviderConfigSchema = z.object({
  type: z.string(),
  enabled: z.boolean().default(true),
  options: z.record(z.unknown()).default({}),
});

/** Schema for rate limit configuration */
export const RateLimitConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxMessages: z.number().int().positive().default(10),
  windowMs: z.number().int().positive().default(60_000),
});

/** Schema for command filter configuration */
export const CommandFilterConfigSchema = z.object({
  allowPatterns: z.array(z.string()).default([]),
  denyPatterns: z.array(z.string()).default([]),
  denyMessage: z.string().default('That command is not allowed.'),
});

/** Schema for auth configuration */
export const AuthConfigSchema = z.object({
  whitelist: z.array(z.string()).default([]),
  prefix: z.string().default('/ai'),
  rateLimit: RateLimitConfigSchema.default({}),
  commandFilter: CommandFilterConfigSchema.default({}),
  /**
   * Default role assigned to whitelisted users when auto-created in access_control.
   * Defaults to 'owner' so existing setups retain full access without config changes.
   */
  defaultRole: z.enum(['owner', 'admin', 'developer', 'viewer', 'custom']).default('owner'),
  /**
   * Per-channel role overrides — applied when creating new access_control entries.
   * Keys are channel type names (e.g. "webchat", "telegram"); values are role names.
   * Takes precedence over defaultRole for the matching channel.
   */
  channelRoles: z.record(z.enum(['owner', 'admin', 'developer', 'viewer', 'custom'])).optional(),
});

/** Schema for queue retry configuration */
export const QueueConfigSchema = z.object({
  maxRetries: z.number().int().nonnegative().default(3),
  retryDelayMs: z.number().int().positive().default(1_000),
});

/** Schema for router configuration */
export const RouterConfigSchema = z.object({
  progressIntervalMs: z.number().int().positive().default(15_000),
  escalationTimeoutMs: z.number().int().positive().default(180_000),
});

/** Schema for audit log configuration */
export const AuditConfigSchema = z.object({
  enabled: z.boolean().default(true),
  logPath: z.string().default('audit.log'),
});

/** Schema for health check endpoint configuration */
export const HealthConfigSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().positive().default(8080),
});

/** Schema for metrics endpoint configuration */
export const MetricsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().positive().default(9090),
});

/** Root configuration schema */
export const AppConfigSchema = z
  .object({
    connectors: z.array(ConnectorConfigSchema).min(1),
    providers: z.array(ProviderConfigSchema).min(1),
    defaultProvider: z.string(),
    workspaces: z.array(WorkspaceConfigSchema).default([]),
    defaultWorkspace: z.string().optional(),
    auth: AuthConfigSchema,
    queue: QueueConfigSchema.default({}),
    router: RouterConfigSchema.default({}),
    audit: AuditConfigSchema.default({}),
    health: HealthConfigSchema.default({}),
    metrics: MetricsConfigSchema.default({}),
    logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  })
  .refine(
    (config) => config.providers.some((p) => p.type === config.defaultProvider),
    (config) => ({
      message: `defaultProvider "${config.defaultProvider}" does not match any provider type. Available: ${config.providers.map((p) => p.type).join(', ')}`,
      path: ['defaultProvider'],
    }),
  );

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;
export type CommandFilterConfig = z.infer<typeof CommandFilterConfigSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type QueueConfig = z.infer<typeof QueueConfigSchema>;
export type RouterConfig = z.infer<typeof RouterConfigSchema>;
export type AuditConfig = z.infer<typeof AuditConfigSchema>;
export type HealthConfig = z.infer<typeof HealthConfigSchema>;
export type MetricsConfig = z.infer<typeof MetricsConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

/** V2 channel schema — simplified connector config */
export const V2ChannelSchema = z.object({
  type: z.string(),
  enabled: z.boolean().default(true),
  options: z.record(z.unknown()).optional(),
});

/** V2 auth schema — simplified auth config with optional advanced features */
export const V2AuthSchema = z.object({
  whitelist: z.array(z.string()).min(1),
  prefix: z.string().default('/ai'),
  rateLimit: RateLimitConfigSchema.optional(),
  commandFilter: CommandFilterConfigSchema.optional(),
  /**
   * Default role assigned to whitelisted users when they are auto-created in access_control.
   * Defaults to 'owner' so existing setups retain full access without config changes.
   */
  defaultRole: z.enum(['owner', 'admin', 'developer', 'viewer', 'custom']).default('owner'),
  /**
   * Per-channel role overrides — applied when creating new access_control entries.
   * Keys are channel type names (e.g. "webchat", "telegram"); values are role names.
   * Takes precedence over defaultRole for the matching channel.
   * Example: `{ "webchat": "owner", "telegram": "developer" }`
   */
  channelRoles: z.record(z.enum(['owner', 'admin', 'developer', 'viewer', 'custom'])).optional(),
});

/** Schema for worker watchdog timeout configuration */
export const WorkerWatchdogConfigSchema = z.object({
  /** Timeout in minutes for read-only workers before force-kill (default: 10) */
  readOnly: z.number().int().positive().default(10),
  /** Timeout in minutes for code-edit and full-access workers before force-kill (default: 30) */
  codeEdit: z.number().int().positive().default(30),
});

export type WorkerWatchdogConfig = z.infer<typeof WorkerWatchdogConfigSchema>;

/**
 * Schema for per-profile worker cost cap overrides in USD.
 * Keys are tool profile names; values are cost caps in USD.
 * Merged on top of the built-in PROFILE_COST_CAPS defaults — user-supplied values win.
 * Example: `{ "read-only": 0.25, "code-edit": 0.75 }` to tighten defaults.
 */
export const WorkerCostCapsSchema = z.record(z.number().positive());

export type WorkerCostCaps = z.infer<typeof WorkerCostCapsSchema>;

/** V2 master AI override schema */
export const V2MasterSchema = z.object({
  tool: z.string().optional(),
  /** Tools to exclude from discovery — e.g. ["claude"] to force Codex-only operation */
  excludeTools: z.array(z.string()).optional(),
  explorationPrompt: z.string().optional(),
  sessionTtlMs: z.number().int().positive().optional(),
  /** Worker watchdog timeout configuration — force-kills stuck workers */
  workerWatchdogMinutes: WorkerWatchdogConfigSchema.optional(),
  /**
   * Per-profile worker cost cap overrides in USD.
   * Merged with built-in defaults: read-only $0.50, code-edit $1.00, code-audit $1.00, full-access $2.00.
   * Example: `{ "read-only": 0.25 }` to tighten the read-only cap.
   */
  workerCostCaps: WorkerCostCapsSchema.optional(),
});

/** V2 workspace options — remote git clone + auto-pull configuration + visibility controls */
export const V2WorkspaceSchema = z.object({
  /** Polling interval in seconds for remote workspace auto-pull (default: 300) */
  pullInterval: z.number().int().positive().optional(),
  /**
   * Glob patterns for files to include — only these files are visible to the AI.
   * If omitted, all non-excluded files are visible.
   * Example: ["src/**", "docs/**"]
   */
  include: z.array(z.string()).optional(),
  /**
   * Glob patterns for files to exclude — these files are hidden from the AI.
   * Always combined with DEFAULT_EXCLUDE_PATTERNS.
   * Example: ["tests/**", "*.log"]
   */
  exclude: z.array(z.string()).optional(),
});

/**
 * Default glob patterns for files and directories that are always excluded from
 * AI visibility. Applied before user-configured workspace.exclude patterns.
 * Users can override by setting workspace.exclude explicitly.
 */
export const DEFAULT_EXCLUDE_PATTERNS: readonly string[] = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  'credentials.*',
  'secrets/',
  'id_rsa*',
  'id_ed25519*',
  '*.sqlite',
  '.git/objects/',
  'node_modules/',
  '.DS_Store',
];

/** Schema for a single MCP server definition */
export const MCPServerSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

/** Schema for the MCP configuration block */
export const MCPConfigSchema = z.object({
  enabled: z.boolean().default(true),
  servers: z.array(MCPServerSchema).default([]),
  configPath: z.string().optional(),
});

/**
 * Default glob patterns for environment variables that should be stripped from
 * worker processes. Matches common secret/credential variable naming conventions.
 */
export const ENV_DENY_PATTERNS: readonly string[] = [
  'AWS_*',
  'GITHUB_*',
  'GH_*',
  'TOKEN*',
  '*_TOKEN',
  'SECRET*',
  '*_SECRET',
  'PASSWORD*',
  '*_PASSWORD',
  'PRIVATE_*',
  'DB_*',
  'DATABASE_*',
  'SMTP_*',
  'OPENAI_*',
  'ANTHROPIC_*',
  'API*KEY*',
  '*_CREDENTIAL',
  'REDIS_*',
  'MONGO_*',
  'MYSQL_*',
  'POSTGRES_*',
];

/** Schema for sandbox configuration — controls how worker processes are isolated */
export const SandboxConfigSchema = z.object({
  /**
   * Sandbox mode for worker processes.
   * - none:       No sandboxing (default). Workers run as regular child processes.
   * - docker:     Workers run inside Docker containers (requires Docker daemon).
   * - bubblewrap: Workers run inside bubblewrap namespaces (Linux only).
   */
  mode: z.enum(['none', 'docker', 'bubblewrap']).default('none'),
  /**
   * Network mode for sandboxed workers.
   * - none:   No network access (most secure, default).
   * - host:   Full host network access.
   * - bridge: Docker bridge network only (Docker mode only).
   */
  network: z.enum(['none', 'host', 'bridge']).default('none'),
  /** Memory limit per worker in megabytes (default: 512) */
  memoryMB: z.number().int().positive().default(512),
  /** CPU limit per worker — fractional values allowed, e.g. 0.5 (default: 1) */
  cpus: z.number().positive().default(1),
});

export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;

/** Schema for security configuration — env var sanitization for workers */
export const SecurityConfigSchema = z.object({
  /** Glob patterns for env vars to strip from worker environments (denylist mode) */
  envDenyPatterns: z.array(z.string()).default([...ENV_DENY_PATTERNS]),
  /** Glob patterns for env vars to always allow even if matched by deny list (e.g. GITHUB_ACTIONS for CI) */
  envAllowPatterns: z.array(z.string()).default([]),
  /**
   * When true, Router intercepts SPAWN markers for high/critical risk profiles
   * and sends a confirmation prompt to the user before dispatching the worker.
   * Default: true (require confirmation for high-risk operations).
   */
  confirmHighRisk: z.boolean().default(true),
  /** Sandbox configuration for worker process isolation */
  sandbox: SandboxConfigSchema.default({}),
  /**
   * Glob patterns for file basenames to exclude from sensitive file detection.
   * Files matching any of these patterns will not be flagged as secrets,
   * even if their names match a sensitive pattern (e.g. `.env.*`).
   * Default: [".env.example", ".env.sample", ".env.template"] — documentation/template files.
   */
  sensitiveFileExceptions: z
    .array(z.string())
    .default(['.env.example', '.env.sample', '.env.template']),
});

export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

/** Schema for email (SMTP) configuration */
export const EmailConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().default(587),
  user: z.string().min(1),
  pass: z.string().min(1),
  from: z.string().email(),
  allowlist: z.array(z.string().email()).default([]),
});

/** Schema for tunnel configuration — exposes the local file server to the internet */
export const TunnelConfigSchema = z.object({
  /** Enable tunnel on startup (default: false) */
  enabled: z.boolean().default(false),
  /**
   * Preferred tunnel provider.
   * - auto: use the first detected tool (cloudflared > ngrok > localtunnel)
   * - cloudflared: force cloudflared (free, no signup)
   * - ngrok: force ngrok (requires auth token for reserved domains)
   */
  provider: z.enum(['auto', 'cloudflared', 'ngrok']).default('auto'),
  /** Optional subdomain hint (supported by some tunnel providers) */
  subdomain: z.string().optional(),
});

export type TunnelConfig = z.infer<typeof TunnelConfigSchema>;

/** Schema for app server resource limits */
export const AppsConfigSchema = z.object({
  /** Maximum number of apps that can run concurrently (default: 5) */
  maxConcurrent: z.number().int().positive().default(5),
  /** Memory limit per app process in megabytes (default: 256) */
  maxMemoryMB: z.number().int().positive().default(256),
  /** Minutes of inactivity before an app is automatically stopped (default: 30) */
  idleTimeoutMinutes: z.number().int().positive().default(30),
});

export type AppsConfig = z.infer<typeof AppsConfigSchema>;

/** Schema for Deep Mode configuration */
export const DeepConfigSchema = z.object({
  /**
   * Execution profile that controls whether and how Deep Mode operates.
   * - fast:     Skips Deep Mode entirely (default behaviour).
   * - thorough: Runs all phases automatically without pausing.
   * - manual:   Pauses between phases and waits for user confirmation.
   */
  defaultProfile: z.enum(['fast', 'thorough', 'manual']).default('fast'),
  /**
   * Per-phase model tier overrides. When set, each entry replaces the built-in
   * PHASE_MODEL_MAP default for that phase. Omitted phases use the built-in default.
   * Tiers: fast (haiku), balanced (sonnet), powerful (opus).
   */
  phaseModels: z
    .object({
      investigate: z.enum(['fast', 'balanced', 'powerful']).optional(),
      report: z.enum(['fast', 'balanced', 'powerful']).optional(),
      plan: z.enum(['fast', 'balanced', 'powerful']).optional(),
      execute: z.enum(['fast', 'balanced', 'powerful']).optional(),
      verify: z.enum(['fast', 'balanced', 'powerful']).optional(),
    })
    .optional(),
});

export type DeepConfig = z.infer<typeof DeepConfigSchema>;

/** Schema for batch task continuation configuration */
export const BatchConfigSchema = z.object({
  /** Maximum number of batch iterations before pausing (default: 20) */
  maxBatchIterations: z.number().int().positive().default(20),
  /** Maximum cumulative cost in USD before pausing the batch (default: 5.00) */
  batchBudgetUsd: z.number().positive().default(5.0),
  /** Maximum elapsed time in minutes before pausing the batch (default: 120) */
  batchTimeoutMinutes: z.number().int().positive().default(120),
});

export type BatchConfig = z.infer<typeof BatchConfigSchema>;

/** Schema for embedding provider configuration within the memory section */
export const MemoryEmbeddingConfigSchema = z.object({
  /**
   * Embedding provider to use for vector search.
   * - none:   Disable embeddings — FTS5-only retrieval (default, zero dependencies).
   * - local:  Use local Ollama instance (nomic-embed-text, 768 dims).
   * - openai: Use OpenAI API (text-embedding-3-small, 1536 dims) — requires OPENAI_API_KEY.
   */
  provider: z.enum(['none', 'local', 'openai']).default('none'),
  /** Model name override — defaults per provider: local → nomic-embed-text, openai → text-embedding-3-small */
  model: z.string().optional(),
  /** Number of chunks to embed in a single batch call (default: 50) */
  batchSize: z.number().int().positive().default(50),
  /** Vector dimensions — inferred from provider/model if omitted */
  dimensions: z.number().int().positive().optional(),
});

export type MemoryEmbeddingConfig = z.infer<typeof MemoryEmbeddingConfigSchema>;

/** Schema for the memory subsystem configuration */
export const MemoryConfigSchema = z.object({
  embedding: MemoryEmbeddingConfigSchema.default({}),
});

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

/** V2 config schema — autonomous AI bridge with 3 core fields */
export const V2ConfigSchema = z
  .object({
    workspacePath: z.string().min(1),
    channels: z.array(V2ChannelSchema).min(1),
    auth: V2AuthSchema,
    master: V2MasterSchema.optional(),
    workspace: V2WorkspaceSchema.optional(),
    mcp: MCPConfigSchema.optional(),
    memory: MemoryConfigSchema.optional(),
    tunnel: TunnelConfigSchema.optional(),
    apps: AppsConfigSchema.optional(),
    deep: DeepConfigSchema.optional(),
    batch: BatchConfigSchema.optional(),
    security: SecurityConfigSchema.optional(),
    email: EmailConfigSchema.optional(),
    queue: QueueConfigSchema.optional(),
    router: RouterConfigSchema.optional(),
    audit: AuditConfigSchema.optional(),
    health: HealthConfigSchema.optional(),
    metrics: MetricsConfigSchema.optional(),
    logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  })
  .strict();

export type V2Channel = z.infer<typeof V2ChannelSchema>;
export type V2Auth = z.infer<typeof V2AuthSchema>;
export type V2Master = z.infer<typeof V2MasterSchema>;
export type V2Workspace = z.infer<typeof V2WorkspaceSchema>;
export type MCPServer = z.infer<typeof MCPServerSchema>;
export type MCPConfig = z.infer<typeof MCPConfigSchema>;
export type EmailConfig = z.infer<typeof EmailConfigSchema>;
export type V2Config = z.infer<typeof V2ConfigSchema>;

/** Schema for an MCP catalog entry — describes a known MCP server users can install */
export const MCPCatalogEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(['code', 'productivity', 'communication', 'data', 'design']),
  command: z.string().min(1),
  args: z.array(z.string()),
  envVars: z.array(
    z.object({
      key: z.string().min(1),
      description: z.string().min(1),
      required: z.boolean(),
    }),
  ),
  docsUrl: z.string().url(),
});

export type MCPCatalogEntry = z.infer<typeof MCPCatalogEntrySchema>;
