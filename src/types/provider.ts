import type { InboundMessage } from './message.js';
import type { Agent } from './agent.js';

/**
 * Result returned by an AI provider after processing a task.
 */
export interface ProviderResult {
  /** The AI-generated response text */
  content: string;
  /** Optional metadata about the processing */
  metadata?: {
    /** Processing duration in milliseconds */
    durationMs?: number;
    /** Token count or similar usage metric */
    usage?: Record<string, number>;
    /** Provider-specific data */
    [key: string]: unknown;
  };
}

/**
 * Workspace context passed to providers so they can be workspace-aware.
 * Contains available tools and active agents.
 */
export interface ProviderContext {
  /** Workspace name this context belongs to */
  workspaceId?: string;
  /** Available tools the provider can request (tool-use protocol identifiers) */
  availableTools?: string[];
  /** Currently active agents in the orchestrator */
  activeAgents?: Array<{ id: string; name: string; role: Agent['role']; status: Agent['status'] }>;
  /** The agent that is driving this provider call (if orchestrated) */
  agent?: { id: string; name: string; role: Agent['role'] };
  /** Additional provider-specific context */
  metadata?: Record<string, unknown>;
}

/**
 * Interface that every AI provider must implement.
 *
 * To add a new provider (e.g., OpenAI, local LLM):
 * 1. Create src/providers/your-provider/
 * 2. Implement this interface
 * 3. Register in src/core/registry.ts
 */
export interface AIProvider {
  /** Unique identifier for this provider (e.g., 'claude-code', 'openai') */
  readonly name: string;

  /** Initialize the provider (validate credentials, warm up, etc.) */
  initialize(): Promise<void>;

  /** Process an inbound message and return the AI response. Context is optional for backward compatibility. */
  processMessage(message: InboundMessage, context?: ProviderContext): Promise<ProviderResult>;

  /** Stream an AI response, yielding chunks as they arrive. Optional — providers that don't support streaming fall back to processMessage. Context is optional for backward compatibility. */
  streamMessage?(
    message: InboundMessage,
    context?: ProviderContext,
  ): AsyncGenerator<string, ProviderResult>;

  /** Check if the provider is available and ready */
  isAvailable(): Promise<boolean>;

  /** Gracefully shut down the provider */
  shutdown(): Promise<void>;
}
