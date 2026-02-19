import type { InboundMessage } from './message.js';

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

  /** Process an inbound message and return the AI response */
  processMessage(message: InboundMessage): Promise<ProviderResult>;

  /** Stream an AI response, yielding chunks as they arrive. Optional — providers that don't support streaming fall back to processMessage. */
  streamMessage?(message: InboundMessage): AsyncGenerator<string, ProviderResult>;

  /** Check if the provider is available and ready */
  isAvailable(): Promise<boolean>;

  /** Gracefully shut down the provider */
  shutdown(): Promise<void>;
}
