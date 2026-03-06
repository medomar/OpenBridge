// ---------------------------------------------------------------------------
// EmbeddingProvider — abstract interface for vector embedding backends
// ---------------------------------------------------------------------------

/**
 * Result of a single embedding operation.
 */
export interface EmbeddingResult {
  /** The embedding vector as a 32-bit float array. */
  vector: Float32Array;
  /** Model identifier used to produce this embedding (e.g. 'nomic-embed-text'). */
  model: string;
  /** Number of dimensions in the vector. */
  dimensions: number;
}

/**
 * Abstract interface every embedding backend must implement.
 *
 * Implementations live in `src/memory/embeddings/`:
 *   - `local.ts`  — Ollama (nomic-embed-text, 768 dims)
 *   - `openai.ts` — OpenAI text-embedding-3-small (1536 dims)
 *
 * When no provider is configured (`provider: 'none'`), the retrieval layer
 * falls back to FTS5-only search with zero degradation (see OB-1657).
 */
export interface EmbeddingProvider {
  /** Human-readable provider name, e.g. 'ollama' or 'openai'. */
  readonly name: string;

  /** Number of dimensions produced by this provider's model. */
  readonly dimensions: number;

  /**
   * Embed a single text string.
   *
   * @param text  The input text to embed.
   * @returns     A resolved {@link EmbeddingResult} containing the vector.
   * @throws      On provider errors (network failure, model not loaded, etc.).
   */
  embed(text: string): Promise<EmbeddingResult>;

  /**
   * Embed a batch of text strings.
   *
   * Implementations should use the provider's native batching API where
   * available, falling back to sequential `embed()` calls otherwise.
   *
   * @param texts  Array of input strings to embed.
   * @returns      Array of {@link EmbeddingResult} in the same order as `texts`.
   * @throws       On provider errors.
   */
  embedBatch(texts: string[]): Promise<EmbeddingResult[]>;

  /**
   * Check whether the provider is reachable and ready to serve embeddings.
   *
   * Used by `openbridge doctor` (OB-1688) to surface configuration issues.
   */
  isAvailable(): Promise<boolean>;
}

/**
 * A no-op embedding provider that always returns empty vectors.
 *
 * Used when `memory.embedding.provider` is `'none'` (the default).
 * Retrieval will skip vector search and use FTS5 only.
 */
export class NoOpEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'none';
  readonly dimensions = 0;

  embed(_text: string): Promise<EmbeddingResult> {
    return Promise.resolve({ vector: new Float32Array(0), model: 'none', dimensions: 0 });
  }

  embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    return Promise.resolve(
      texts.map(() => ({ vector: new Float32Array(0), model: 'none', dimensions: 0 })),
    );
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
