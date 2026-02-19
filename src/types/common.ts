/**
 * Result type for operations that can fail gracefully.
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

/**
 * Plugin metadata shared by connectors and providers.
 */
export interface PluginMeta {
  /** Unique identifier (e.g., 'whatsapp', 'claude-code') */
  readonly name: string;
  /** Human-readable display name */
  readonly displayName: string;
  /** Short description of the plugin */
  readonly description: string;
  /** Semantic version */
  readonly version: string;
}
