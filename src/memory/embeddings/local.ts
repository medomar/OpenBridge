// ---------------------------------------------------------------------------
// LocalEmbeddingProvider — Ollama-backed local embedding provider
// Uses nomic-embed-text model (768 dimensions) via HTTP API
// ---------------------------------------------------------------------------

import type { EmbeddingProvider, EmbeddingResult } from '../embedding-provider.js';

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'nomic-embed-text';
const DEFAULT_DIMENSIONS = 768;

export interface LocalEmbeddingConfig {
  baseUrl?: string;
  model?: string;
  dimensions?: number;
}

interface OllamaEmbeddingResponse {
  embedding: number[];
}

/**
 * Ollama-backed local embedding provider.
 *
 * Calls `POST /api/embeddings` on a locally-running Ollama instance.
 * Default model: `nomic-embed-text` (768 dimensions).
 *
 * @example
 * ```ts
 * const provider = new LocalEmbeddingProvider();
 * const result = await provider.embed('hello world');
 * // result.vector: Float32Array(768)
 * ```
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly dimensions: number;

  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: LocalEmbeddingConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.model = config.model ?? DEFAULT_MODEL;
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as OllamaEmbeddingResponse;

    if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
      throw new Error('Ollama returned empty or invalid embedding');
    }

    return {
      vector: new Float32Array(data.embedding),
      model: this.model,
      dimensions: data.embedding.length,
    };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    // Ollama does not have a native batch API — run sequentially
    const results: EmbeddingResult[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
