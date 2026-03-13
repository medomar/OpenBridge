import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectIndustry } from '../../src/intelligence/industry-detector.js';

// ---------------------------------------------------------------------------
// Mock AgentRunner — intercepted by vitest even for dynamic imports
// ---------------------------------------------------------------------------

const mockSpawn = vi.fn();

vi.mock('../../src/core/agent-runner.js', () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    spawn: mockSpawn,
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function workerResult(
  templateId: string,
  confidence = 'high',
): { exitCode: number; stdout: string } {
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      templateId,
      confidence,
      reasoning: `Detected ${templateId} business type`,
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('detectIndustry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns "restaurant" for restaurant-related messages', async () => {
    mockSpawn.mockResolvedValue(workerResult('restaurant'));

    const result = await detectIndustry('Food service workspace', [
      'We need to track our menu items',
      'How many tables did we serve yesterday?',
      "What are today's specials?",
    ]);

    expect(result).toBe('restaurant');
  });

  it('returns "car-rental" for car-related messages', async () => {
    mockSpawn.mockResolvedValue(workerResult('car-rental'));

    const result = await detectIndustry('Fleet management workspace', [
      'Show me all available cars for next week',
      'How many bookings do we have?',
      'Track maintenance for vehicle ID 42',
    ]);

    expect(result).toBe('car-rental');
  });

  it('falls back to "services" when the AI cannot confidently classify the industry', async () => {
    // When AI is uncertain it returns "services" as the default per the prompt rules.
    // This represents the "unknown industry → no template forced" scenario.
    mockSpawn.mockResolvedValue(workerResult('services', 'low'));

    const result = await detectIndustry('', ['I need help with my business']);

    expect(result).toBe('services');
  });

  it('falls back to "services" when worker exits with non-zero code', async () => {
    mockSpawn.mockResolvedValue({ exitCode: 1, stdout: '' });

    const result = await detectIndustry('workspace', ['some message']);

    expect(result).toBe('services');
  });

  it('falls back to "services" when worker stdout is empty', async () => {
    mockSpawn.mockResolvedValue({ exitCode: 0, stdout: '' });

    const result = await detectIndustry('workspace', ['message']);

    expect(result).toBe('services');
  });

  it('falls back to "services" when the worker throws', async () => {
    mockSpawn.mockRejectedValue(new Error('spawn failed'));

    const result = await detectIndustry('workspace', ['message']);

    expect(result).toBe('services');
  });

  it('falls back to "services" when AI returns an unrecognised template ID', async () => {
    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        templateId: 'totally-unknown-industry',
        confidence: 'high',
        reasoning: 'Made up industry type',
      }),
    });

    const result = await detectIndustry('workspace', ['message']);

    expect(result).toBe('services');
  });

  it('includes workspace context and user messages in the prompt sent to the worker', async () => {
    mockSpawn.mockResolvedValue(workerResult('retail'));

    await detectIndustry('This is a retail shop selling clothes', ['Show me all products']);

    expect(mockSpawn).toHaveBeenCalledOnce();
    const { prompt } = mockSpawn.mock.calls[0][0] as { prompt: string };
    expect(prompt).toContain('This is a retail shop selling clothes');
    expect(prompt).toContain('Show me all products');
  });

  it('uses read-only tools and bounded max-turns for the worker', async () => {
    mockSpawn.mockResolvedValue(workerResult('retail'));

    await detectIndustry('workspace', ['message']);

    const opts = mockSpawn.mock.calls[0][0] as {
      allowedTools: string[];
      maxTurns: number;
    };
    expect(opts.allowedTools).toEqual(expect.arrayContaining(['Read', 'Glob', 'Grep']));
    expect(opts.maxTurns).toBeGreaterThan(0);
    expect(opts.maxTurns).toBeLessThanOrEqual(5);
  });
});
