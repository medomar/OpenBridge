// ---------------------------------------------------------------------------
// Tests: LocalEmbeddingProvider (Ollama)
// Covers: mock HTTP, embed single, batch embed, connection failure fallback
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalEmbeddingProvider } from '../../src/memory/embeddings/local.js';
import { NoOpEmbeddingProvider } from '../../src/memory/embedding-provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmbeddingResponse(size = 768): object {
  return { embedding: Array.from({ length: size }, (_, i) => i * 0.001) };
}

function makeFetchOk(body: object): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as unknown as Response);
}

function makeFetchError(status: number, statusText: string): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
    json: async () => ({}),
  } as unknown as Response);
}

function makeFetchThrow(error: Error): typeof fetch {
  return vi.fn().mockRejectedValue(error);
}

// ---------------------------------------------------------------------------
// LocalEmbeddingProvider
// ---------------------------------------------------------------------------

describe('LocalEmbeddingProvider', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Constructor defaults
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('has name "ollama"', () => {
      const provider = new LocalEmbeddingProvider();
      expect(provider.name).toBe('ollama');
    });

    it('defaults to 768 dimensions', () => {
      const provider = new LocalEmbeddingProvider();
      expect(provider.dimensions).toBe(768);
    });

    it('accepts custom dimensions', () => {
      const provider = new LocalEmbeddingProvider({ dimensions: 1536 });
      expect(provider.dimensions).toBe(1536);
    });

    it('trims trailing slash from baseUrl', async () => {
      globalThis.fetch = makeFetchOk(makeEmbeddingResponse());
      const provider = new LocalEmbeddingProvider({ baseUrl: 'http://localhost:11434/' });
      await provider.embed('test');
      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toBe('http://localhost:11434/api/embeddings');
    });
  });

  // -------------------------------------------------------------------------
  // embed — single text
  // -------------------------------------------------------------------------

  describe('embed()', () => {
    it('returns EmbeddingResult with correct shape', async () => {
      globalThis.fetch = makeFetchOk(makeEmbeddingResponse(768));
      const provider = new LocalEmbeddingProvider();
      const result = await provider.embed('hello world');

      expect(result.vector).toBeInstanceOf(Float32Array);
      expect(result.vector.length).toBe(768);
      expect(result.model).toBe('nomic-embed-text');
      expect(result.dimensions).toBe(768);
    });

    it('sends POST to /api/embeddings with correct body', async () => {
      globalThis.fetch = makeFetchOk(makeEmbeddingResponse());
      const provider = new LocalEmbeddingProvider();
      await provider.embed('test text');

      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toBe('http://localhost:11434/api/embeddings');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string) as { model: string; prompt: string };
      expect(body.model).toBe('nomic-embed-text');
      expect(body.prompt).toBe('test text');
    });

    it('uses custom baseUrl and model from config', async () => {
      globalThis.fetch = makeFetchOk(makeEmbeddingResponse(256));
      const provider = new LocalEmbeddingProvider({
        baseUrl: 'http://custom:11434',
        model: 'all-minilm',
        dimensions: 256,
      });
      const result = await provider.embed('custom model test');

      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
      expect(url).toBe('http://custom:11434/api/embeddings');
      expect(result.model).toBe('all-minilm');
    });

    it('converts number array to Float32Array', async () => {
      const raw = [0.1, 0.2, 0.3];
      globalThis.fetch = makeFetchOk({ embedding: raw });
      const provider = new LocalEmbeddingProvider({ dimensions: 3 });
      const result = await provider.embed('tiny');

      expect(result.vector).toBeInstanceOf(Float32Array);
      expect(Array.from(result.vector)).toHaveLength(3);
      expect(result.vector[0]).toBeCloseTo(0.1, 5);
    });

    it('throws when Ollama returns HTTP error', async () => {
      globalThis.fetch = makeFetchError(503, 'Service Unavailable');
      const provider = new LocalEmbeddingProvider();
      await expect(provider.embed('test')).rejects.toThrow(
        'Ollama embedding request failed: 503 Service Unavailable',
      );
    });

    it('throws when Ollama returns empty embedding array', async () => {
      globalThis.fetch = makeFetchOk({ embedding: [] });
      const provider = new LocalEmbeddingProvider();
      await expect(provider.embed('test')).rejects.toThrow(
        'Ollama returned empty or invalid embedding',
      );
    });

    it('throws when Ollama returns non-array embedding', async () => {
      globalThis.fetch = makeFetchOk({ embedding: null });
      const provider = new LocalEmbeddingProvider();
      await expect(provider.embed('test')).rejects.toThrow(
        'Ollama returned empty or invalid embedding',
      );
    });

    it('propagates network errors', async () => {
      globalThis.fetch = makeFetchThrow(new TypeError('Failed to fetch'));
      const provider = new LocalEmbeddingProvider();
      await expect(provider.embed('test')).rejects.toThrow('Failed to fetch');
    });
  });

  // -------------------------------------------------------------------------
  // embedBatch — multiple texts
  // -------------------------------------------------------------------------

  describe('embedBatch()', () => {
    it('returns one result per input text', async () => {
      globalThis.fetch = makeFetchOk(makeEmbeddingResponse(768));
      const provider = new LocalEmbeddingProvider();
      const results = await provider.embedBatch(['text a', 'text b', 'text c']);

      expect(results).toHaveLength(3);
    });

    it('each result is a valid EmbeddingResult', async () => {
      globalThis.fetch = makeFetchOk(makeEmbeddingResponse(768));
      const provider = new LocalEmbeddingProvider();
      const results = await provider.embedBatch(['hello', 'world']);

      for (const r of results) {
        expect(r.vector).toBeInstanceOf(Float32Array);
        expect(r.vector.length).toBe(768);
        expect(r.model).toBe('nomic-embed-text');
      }
    });

    it('calls embed() once per text (sequential, no native batch API)', async () => {
      globalThis.fetch = makeFetchOk(makeEmbeddingResponse(768));
      const provider = new LocalEmbeddingProvider();
      await provider.embedBatch(['a', 'b', 'c']);

      // Three texts → three fetch calls
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
    });

    it('returns empty array for empty input', async () => {
      globalThis.fetch = makeFetchOk(makeEmbeddingResponse());
      const provider = new LocalEmbeddingProvider();
      const results = await provider.embedBatch([]);

      expect(results).toHaveLength(0);
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it('propagates error from first failing embed', async () => {
      globalThis.fetch = makeFetchError(500, 'Internal Server Error');
      const provider = new LocalEmbeddingProvider();
      await expect(provider.embedBatch(['ok', 'fail'])).rejects.toThrow(
        'Ollama embedding request failed',
      );
    });
  });

  // -------------------------------------------------------------------------
  // isAvailable — connection check / failure fallback
  // -------------------------------------------------------------------------

  describe('isAvailable()', () => {
    it('returns true when Ollama /api/tags responds ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
      const provider = new LocalEmbeddingProvider();
      await expect(provider.isAvailable()).resolves.toBe(true);
    });

    it('returns false when Ollama /api/tags responds with non-ok status', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false } as Response);
      const provider = new LocalEmbeddingProvider();
      await expect(provider.isAvailable()).resolves.toBe(false);
    });

    it('returns false on connection refused (network error)', async () => {
      globalThis.fetch = makeFetchThrow(new TypeError('fetch failed'));
      const provider = new LocalEmbeddingProvider();
      await expect(provider.isAvailable()).resolves.toBe(false);
    });

    it('returns false on timeout (AbortError)', async () => {
      globalThis.fetch = makeFetchThrow(
        Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
      );
      const provider = new LocalEmbeddingProvider();
      await expect(provider.isAvailable()).resolves.toBe(false);
    });

    it('calls GET /api/tags on the configured baseUrl', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
      const provider = new LocalEmbeddingProvider({ baseUrl: 'http://custom:11434' });
      await provider.isAvailable();

      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
      expect(url).toBe('http://custom:11434/api/tags');
    });
  });
});

// ---------------------------------------------------------------------------
// NoOpEmbeddingProvider
// ---------------------------------------------------------------------------

describe('NoOpEmbeddingProvider', () => {
  it('has name "none"', () => {
    const provider = new NoOpEmbeddingProvider();
    expect(provider.name).toBe('none');
  });

  it('has dimensions 0', () => {
    const provider = new NoOpEmbeddingProvider();
    expect(provider.dimensions).toBe(0);
  });

  it('embed() returns empty Float32Array', async () => {
    const provider = new NoOpEmbeddingProvider();
    const result = await provider.embed('anything');
    expect(result.vector).toBeInstanceOf(Float32Array);
    expect(result.vector.length).toBe(0);
    expect(result.model).toBe('none');
    expect(result.dimensions).toBe(0);
  });

  it('embedBatch() returns one empty result per input', async () => {
    const provider = new NoOpEmbeddingProvider();
    const results = await provider.embedBatch(['a', 'b', 'c']);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.vector.length).toBe(0);
      expect(r.model).toBe('none');
    }
  });

  it('embedBatch() returns empty array for empty input', async () => {
    const provider = new NoOpEmbeddingProvider();
    const results = await provider.embedBatch([]);
    expect(results).toHaveLength(0);
  });

  it('isAvailable() always returns true', async () => {
    const provider = new NoOpEmbeddingProvider();
    await expect(provider.isAvailable()).resolves.toBe(true);
  });
});
