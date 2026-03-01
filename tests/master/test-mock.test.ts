import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from '../../src/core/agent-runner.js';

const mockSpawn = vi.fn();
vi.mock('../../src/core/agent-runner.js', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return {
    ...actual,
    AgentRunner: vi.fn().mockImplementation(() => ({
      spawn: mockSpawn,
      stream: vi.fn(),
    })),
  };
});

describe('Mock test', () => {
  it('should mock AgentRunner', () => {
    const runner = new AgentRunner();
    expect(runner.spawn).toBe(mockSpawn);
  });
});
