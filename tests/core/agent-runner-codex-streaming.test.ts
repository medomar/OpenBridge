/**
 * Tests for Codex streaming output parsing in AgentRunner.
 *
 * Covers OB-1566:
 *  1. execOnceStreaming applies parseOutput before returning result
 *  2. parseCodexStreamChunk extracts readable text from JSONL events
 *  3. spawnWithStreamingHandle returns parsed output (not raw JSONL)
 *  4. sanitizeWorkerOutput in formatter detects and parses raw JSONL fallback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { AgentRunner } from '../../src/core/agent-runner.js';
import { parseCodexStreamChunk } from '../../src/core/adapters/codex-adapter.js';
import { sanitizeWorkerOutput } from '../../src/master/worker-result-formatter.js';
import type { CLIAdapter, CLISpawnConfig } from '../../src/core/cli-adapter.js';
import type { SpawnOptions } from '../../src/core/agent-runner.js';

// ── Mock node:fs/promises ────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock child_process.spawn ─────────────────────────────────────────────────

interface MockChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid?: number;
  kill: (signal?: string) => boolean;
}

let mockChildren: MockChild[] = [];

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = Math.floor(Math.random() * 100_000) + 1;
  child.kill = vi.fn(() => true);
  mockChildren.push(child);
  return child;
}

vi.mock('node:child_process', () => ({
  spawn: () => createMockChild(),
  // DockerSandbox (imported transitively via agent-runner) uses execFile.
  // Provide a no-op stub so tests that don't exercise docker mode still pass.
  execFile: vi.fn(
    (_cmd: string, _args: string[], _opts: unknown, cb?: (...a: unknown[]) => void) => {
      if (cb) cb(null, '', '');
    },
  ),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function lastChild(): MockChild {
  const child = mockChildren[mockChildren.length - 1];
  if (!child) throw new Error('No mock child created');
  return child;
}

/** Emit stdout data then close the process */
function resolveChild(child: MockChild, stdout: string, exitCode = 0, stderr = ''): void {
  if (stdout) child.stdout.emit('data', Buffer.from(stdout));
  if (stderr) child.stderr.emit('data', Buffer.from(stderr));
  child.emit('close', exitCode, null);
}

// ── Minimal CLIAdapter stub ──────────────────────────────────────────────────

function makeAdapter(
  parseOutput?: (stdout: string) => string,
  parseStreamChunk?: (chunk: string) => string | null,
): CLIAdapter {
  return {
    name: 'stub',
    buildSpawnConfig(_opts: SpawnOptions): CLISpawnConfig {
      return {
        binary: 'stub-cli',
        args: ['run'],
        env: {},
        parseOutput,
        parseStreamChunk,
      };
    },
    mapCapabilityLevel: () => undefined,
    isValidModel: () => true,
  };
}

const BASE_OPTS: SpawnOptions = {
  prompt: 'test prompt',
  workspacePath: '/tmp/ws',
  retries: 0,
};

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockChildren = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Test 1: execOnceStreaming applies parseOutput ─────────────────────────────

describe('execOnceStreaming — parseOutput applied', () => {
  it('applies parseOutput to accumulated stdout before returning the result', async () => {
    const rawJsonl = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"message","content":"Hello, world!"}',
    ].join('\n');

    // Adapter whose parseOutput extracts just the message content
    const adapter = makeAdapter((stdout) => {
      const match = stdout.match(/"content":"([^"]+)"/);
      return match ? match[1]! : stdout;
    });

    const runner = new AgentRunner(adapter);
    const handle = runner.spawnWithStreamingHandle(BASE_OPTS);

    // Emit the raw JSONL and close with success
    resolveChild(lastChild(), rawJsonl, 0);

    const result = await handle.promise;
    // parseOutput should have extracted "Hello, world!" from the JSONL
    expect(result.stdout).toBe('Hello, world!');
    expect(result.exitCode).toBe(0);
  });

  it('falls back to raw stdout when parseOutput throws', async () => {
    const rawOutput = 'plain text output';

    const adapter = makeAdapter((_stdout) => {
      throw new Error('parse failure');
    });

    const runner = new AgentRunner(adapter);
    const handle = runner.spawnWithStreamingHandle(BASE_OPTS);

    resolveChild(lastChild(), rawOutput, 0);

    const result = await handle.promise;
    // Graceful fallback — raw stdout preserved
    expect(result.stdout).toBe(rawOutput);
    expect(result.exitCode).toBe(0);
  });
});

// ── Test 2: parseCodexStreamChunk ────────────────────────────────────────────

describe('parseCodexStreamChunk — Codex JSONL chunks to readable text', () => {
  it('extracts content from type:message events', () => {
    const chunk = JSON.stringify({ type: 'message', content: 'The answer is 42.' });
    expect(parseCodexStreamChunk(chunk)).toBe('The answer is 42.');
  });

  it('extracts output from completed command_execution items', () => {
    const chunk = JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_1', type: 'command_execution', output: 'file1.ts\nfile2.ts' },
    });
    expect(parseCodexStreamChunk(chunk)).toBe('[cmd] file1.ts\nfile2.ts');
  });

  it('extracts text from completed reasoning items', () => {
    const chunk = JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_0', type: 'reasoning', text: 'Planning the approach.' },
    });
    expect(parseCodexStreamChunk(chunk)).toBe('[thinking] Planning the approach.');
  });

  it('returns null for non-user-visible events (thread.started, item.started)', () => {
    const threadStarted = JSON.stringify({ type: 'thread.started', thread_id: 'xyz' });
    expect(parseCodexStreamChunk(threadStarted)).toBeNull();

    const itemStarted = JSON.stringify({ type: 'item.started', item: { id: 'item_0' } });
    expect(parseCodexStreamChunk(itemStarted)).toBeNull();
  });

  it('returns null for non-JSON input', () => {
    expect(parseCodexStreamChunk('not json at all')).toBeNull();
    expect(parseCodexStreamChunk('')).toBeNull();
    expect(parseCodexStreamChunk('   ')).toBeNull();
  });
});

// ── Test 3: spawnWithStreamingHandle returns parsed output ────────────────────

describe('spawnWithStreamingHandle — parsed output returned to caller', () => {
  it('returns human-readable text when adapter has parseStreamChunk and parseOutput', async () => {
    const jsonlChunk1 = '{"type":"thread.started","thread_id":"t1"}\n';
    const jsonlChunk2 = '{"type":"message","content":"Task complete."}\n';

    // Adapter with both stream chunk parser and output parser
    const adapter = makeAdapter(
      // parseOutput: extract last message content from accumulated JSONL
      (stdout) => {
        const lines = stdout.split('\n').filter(Boolean);
        for (const line of lines.reverse()) {
          try {
            const ev = JSON.parse(line) as Record<string, unknown>;
            if (ev['type'] === 'message' && typeof ev['content'] === 'string') {
              return ev['content'];
            }
          } catch {
            /* skip */
          }
        }
        return stdout;
      },
      // parseStreamChunk: return content for message events
      parseCodexStreamChunk,
    );

    const progressEvents: string[] = [];
    const runner = new AgentRunner(adapter);
    const handle = runner.spawnWithStreamingHandle(BASE_OPTS, (indicator) => {
      progressEvents.push(indicator.lastAction);
    });

    // Emit chunks separately (simulating real streaming)
    const child = lastChild();
    child.stdout.emit('data', Buffer.from(jsonlChunk1));
    child.stdout.emit('data', Buffer.from(jsonlChunk2));
    child.emit('close', 0, null);

    const result = await handle.promise;

    // parseOutput should produce the readable final answer
    expect(result.stdout).toBe('Task complete.');
    expect(result.exitCode).toBe(0);

    // parseStreamChunk-driven progress: the message chunk produced a visible event
    expect(progressEvents).toContain('Task complete.');
  });

  it('returns raw stdout when adapter has no parseOutput', async () => {
    const rawOutput = 'plain output';
    const adapter = makeAdapter(undefined, undefined); // no parsing

    const runner = new AgentRunner(adapter);
    const handle = runner.spawnWithStreamingHandle(BASE_OPTS);

    resolveChild(lastChild(), rawOutput, 0);

    const result = await handle.promise;
    expect(result.stdout).toBe(rawOutput);
  });
});

// ── Test 4: sanitizeWorkerOutput — raw JSONL fallback in formatter ────────────

describe('sanitizeWorkerOutput — raw JSONL fallback', () => {
  it('passes through plain text unchanged', () => {
    const plain = 'The task is done. Created /tmp/report.md';
    expect(sanitizeWorkerOutput(plain)).toBe(plain);
  });

  it('parses raw Codex JSONL output that starts with {"type":', () => {
    const jsonl = [
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"message","content":"Analysis complete."}',
    ].join('\n');

    const result = sanitizeWorkerOutput(jsonl);
    expect(result).toBe('Analysis complete.');
  });

  it('handles raw JSONL with leading whitespace', () => {
    const jsonl = '\n{"type":"message","content":"Done."}\n';
    const result = sanitizeWorkerOutput(jsonl);
    expect(result).toBe('Done.');
  });

  it('falls back to raw stdout when no message event exists in the JSONL', () => {
    const jsonl = '{"type":"thread.started","thread_id":"t1"}';
    // No message event — parseCodexJsonlOutput falls back to raw stdout
    const result = sanitizeWorkerOutput(jsonl);
    expect(result).toBe(jsonl);
  });
});
