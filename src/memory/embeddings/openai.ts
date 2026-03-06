// ---------------------------------------------------------------------------
// OpenAIEmbeddingProvider — OpenAI-backed embedding provider
// Uses text-embedding-3-small model (1536 dimensions) via REST API
// Requires OPENAI_API_KEY environment variable
// ---------------------------------------------------------------------------

import type { EmbeddingProvider, EmbeddingResult } from '../embedding-provider.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_DIMENSIONS = 1536;

export interface OpenAIEmbeddingConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  dimensions?: number;
}

interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenAI-backed embedding provider.
 *
 * Calls `POST /v1/embeddings` on the OpenAI API.
 * Default model: `text-embedding-3-small` (1536 dimensions).
 *
 * Requires `OPENAI_API_KEY` environment variable or `apiKey` in config.
 *
 * @example
 * ```ts
 * const provider = new OpenAIEmbeddingProvider();
 * const result = await provider.embed('hello world');
 * // result.vector: Float32Array(1536)
 * ```
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly dimensions: number;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string;

  constructor(config: OpenAIEmbeddingConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.model = config.model ?? DEFAULT_MODEL;
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
    this.apiKey = config.apiKey ?? process.env['OPENAI_API_KEY'] ?? '';
  }

  async embed(text: string): Promise<EmbeddingResult> {
    if (!this.apiKey) {
      throw new Error('OpenAI embedding provider requires OPENAI_API_KEY');
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        encoding_format: 'float',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `OpenAI embedding request failed: ${response.status} ${response.statusText}${errorText ? ` — ${errorText}` : ''}`,
      );
    }

    const data = (await response.json()) as OpenAIEmbeddingResponse;

    if (!data.data?.[0]?.embedding || data.data[0].embedding.length === 0) {
      throw new Error('OpenAI returned empty or invalid embedding');
    }

    return {
      vector: new Float32Array(data.data[0].embedding),
      model: data.model ?? this.model,
      dimensions: data.data[0].embedding.length,
    };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return [];

    if (!this.apiKey) {
      throw new Error('OpenAI embedding provider requires OPENAI_API_KEY');
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        encoding_format: 'float',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `OpenAI batch embedding request failed: ${response.status} ${response.statusText}${errorText ? ` — ${errorText}` : ''}`,
      );
    }

    const data = (await response.json()) as OpenAIEmbeddingResponse;

    if (!Array.isArray(data.data) || data.data.length === 0) {
      throw new Error('OpenAI returned empty or invalid batch embedding response');
    }

    // Sort by index to preserve original order (OpenAI may reorder)
    const sorted = [...data.data].sort((a, b) => a.index - b.index);

    return sorted.map((item) => ({
      vector: new Float32Array(item.embedding),
      model: data.model ?? this.model,
      dimensions: item.embedding.length,
    }));
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;

    try {
      const response = await fetch(`${this.baseUrl}/models/${encodeURIComponent(this.model)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
