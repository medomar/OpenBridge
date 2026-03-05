import { z } from 'zod';

/**
 * Zod schema for Docker availability status
 */
export const DockerStatusSchema = z.object({
  /** Whether the docker binary is in PATH */
  installed: z.boolean(),
  /** Whether the Docker daemon is running (docker info succeeded) */
  daemonRunning: z.boolean(),
  /** Whether Docker is fully usable (installed AND daemon running) */
  available: z.boolean(),
  /** Docker version string (e.g., '24.0.5') — null if not installed */
  version: z.string().nullable(),
});

export type DockerStatus = z.infer<typeof DockerStatusSchema>;

/**
 * Zod schema for a discovered AI tool
 */
export const DiscoveredToolSchema = z.object({
  /** Tool name (e.g., 'claude', 'codex', 'aider') */
  name: z.string(),

  /** Absolute path to the tool executable */
  path: z.string(),

  /** Tool version string (e.g., '1.2.3') */
  version: z.string(),

  /** List of capabilities the tool provides */
  capabilities: z.array(z.string()),

  /** Role assignment for this tool (e.g., 'master', 'specialist', 'backup') */
  role: z.enum(['master', 'specialist', 'backup', 'none']),

  /** Whether the tool is currently available for use */
  available: z.boolean(),
});

export type DiscoveredTool = z.infer<typeof DiscoveredToolSchema>;

/**
 * Zod schema for scan results from AI tool discovery
 */
export const ScanResultSchema = z.object({
  /** CLI tools discovered via which/where commands */
  cliTools: z.array(DiscoveredToolSchema),

  /** VS Code extensions discovered via extension directory scan */
  vscodeExtensions: z.array(DiscoveredToolSchema),

  /** Tunnel tools discovered via which/where commands (cloudflared, ngrok, localtunnel) */
  tunnelTools: z.array(DiscoveredToolSchema),

  /** Docker availability status */
  dockerStatus: DockerStatusSchema,

  /** Selected master AI tool (highest priority available tool) */
  master: DiscoveredToolSchema.nullable(),

  /** Timestamp of the scan */
  timestamp: z.string(),

  /** Total number of tools discovered */
  totalDiscovered: z.number(),
});

export type ScanResult = z.infer<typeof ScanResultSchema>;
