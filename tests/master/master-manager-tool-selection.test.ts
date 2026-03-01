/**
 * Tests for per-worker tool selection in MasterManager.
 *
 * Verifies that workers can be routed to different AI tools (claude, codex, aider)
 * based on the `tool` field in SPAWN markers, and that the worker result formatter
 * includes tool labels.
 */

import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../../src/core/adapters/claude-adapter.js';
import { CodexAdapter } from '../../src/core/adapters/codex-adapter.js';
import { AiderAdapter } from '../../src/core/adapters/aider-adapter.js';
import { createAdapterRegistry } from '../../src/core/adapter-registry.js';
import { createModelRegistry } from '../../src/core/model-registry.js';
import {
  formatWorkerResult,
  formatWorkerError,
  formatWorkerBatch,
} from '../../src/master/worker-result-formatter.js';
import type { WorkerResultMeta } from '../../src/master/worker-result-formatter.js';
import type { AgentResult } from '../../src/core/agent-runner.js';
import { generateMasterSystemPrompt } from '../../src/master/master-system-prompt.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';

// ── Helper ──────────────────────────────────────────────────────────

function makeTool(name: string, available = true): DiscoveredTool {
  return {
    name,
    path: `/usr/local/bin/${name}`,
    version: '1.0.0',
    capabilities: ['code-generation', 'code-editing'],
    role: 'worker',
    available,
  };
}

// ── Per-tool model resolution ───────────────────────────────────────

describe('Per-tool model resolution via ModelRegistry', () => {
  it('resolves "fast" to haiku for claude', () => {
    const registry = createModelRegistry('claude');
    expect(registry.resolveModelOrTier('fast')).toBe('haiku');
  });

  it('resolves "fast" to gpt-5.2-codex for codex', () => {
    const registry = createModelRegistry('codex');
    expect(registry.resolveModelOrTier('fast')).toBe('gpt-5.2-codex');
  });

  it('resolves "fast" to gpt-4o-mini for aider', () => {
    const registry = createModelRegistry('aider');
    expect(registry.resolveModelOrTier('fast')).toBe('gpt-4o-mini');
  });

  it('passes through unknown raw model IDs without tier resolution', () => {
    const registry = createModelRegistry('claude');
    expect(registry.resolveModelOrTier('my-custom-model')).toBe('my-custom-model');
  });

  it('translates foreign provider models to equivalent tier (cross-provider)', () => {
    // "haiku" is Claude's fast model → codex registry should resolve to "gpt-5.2-codex"
    const codexRegistry = createModelRegistry('codex');
    expect(codexRegistry.resolveModelOrTier('haiku')).toBe('gpt-5.2-codex');
    expect(codexRegistry.resolveModelOrTier('sonnet')).toBe('gpt-5.2-codex');
    expect(codexRegistry.resolveModelOrTier('opus')).toBe('gpt-5.2-codex');

    // "gpt-5.2-codex" is Codex's fast model → claude registry should resolve to "haiku"
    const claudeRegistry = createModelRegistry('claude');
    expect(claudeRegistry.resolveModelOrTier('gpt-5.2-codex')).toBe('haiku');

    // "gpt-4o-mini" is Aider's fast model → codex registry should resolve to "gpt-5.2-codex"
    expect(codexRegistry.resolveModelOrTier('gpt-4o-mini')).toBe('gpt-5.2-codex');
  });

  it('resolves "balanced" to provider-specific models', () => {
    expect(createModelRegistry('claude').resolveModelOrTier('balanced')).toBe('sonnet');
    expect(createModelRegistry('codex').resolveModelOrTier('balanced')).toBe('gpt-5.2-codex');
    expect(createModelRegistry('aider').resolveModelOrTier('balanced')).toBe('gpt-4o');
  });

  it('resolves "powerful" to provider-specific models', () => {
    expect(createModelRegistry('claude').resolveModelOrTier('powerful')).toBe('opus');
    expect(createModelRegistry('codex').resolveModelOrTier('powerful')).toBe('gpt-5.2-codex');
    expect(createModelRegistry('aider').resolveModelOrTier('powerful')).toBe('o1');
  });
});

// ── AdapterRegistry tool lookup ─────────────────────────────────────

describe('AdapterRegistry per-worker tool lookup', () => {
  it('returns correct adapter for each tool name', () => {
    const registry = createAdapterRegistry();
    expect(registry.get('claude')).toBeInstanceOf(ClaudeAdapter);
    expect(registry.get('codex')).toBeInstanceOf(CodexAdapter);
    expect(registry.get('aider')).toBeInstanceOf(AiderAdapter);
  });

  it('returns undefined for unregistered tools', () => {
    const registry = createAdapterRegistry();
    expect(registry.get('cursor')).toBeUndefined();
    expect(registry.get('cody')).toBeUndefined();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('getForTool routes discovered tools to adapters', () => {
    const registry = createAdapterRegistry();
    expect(registry.getForTool(makeTool('claude'))).toBeInstanceOf(ClaudeAdapter);
    expect(registry.getForTool(makeTool('codex'))).toBeInstanceOf(CodexAdapter);
    expect(registry.getForTool(makeTool('aider'))).toBeInstanceOf(AiderAdapter);
    expect(registry.getForTool(makeTool('cursor'))).toBeUndefined();
  });
});

// ── Worker result formatter with tool label ─────────────────────────

describe('Worker result formatter with tool label', () => {
  const baseMeta: WorkerResultMeta = {
    workerIndex: 1,
    totalWorkers: 2,
    profile: 'code-edit',
    model: 'gpt-5.2-codex',
    durationMs: 1500,
    success: true,
    exitCode: 0,
    retryCount: 0,
  };

  it('includes tool/model label when tool is specified', () => {
    const meta = { ...baseMeta, tool: 'codex' };
    const result = formatWorkerResult(meta, 'Refactored auth module');

    expect(result).toContain('codex/gpt-5.2-codex');
    expect(result).toContain('[WORKER RESULT');
  });

  it('shows model only (no slash) when tool is not specified', () => {
    const result = formatWorkerResult(baseMeta, 'Output');

    expect(result).toContain('gpt-5.2-codex');
    expect(result).not.toContain('/gpt-5.2-codex');
  });

  it('includes tool/model label in error formatting', () => {
    const meta: WorkerResultMeta = {
      ...baseMeta,
      tool: 'aider',
      model: 'gpt-4o-mini',
      success: false,
      exitCode: 1,
    };
    const result = formatWorkerError(meta, 'Git conflict');

    expect(result).toContain('aider/gpt-4o-mini');
    expect(result).toContain('[WORKER ERROR');
    expect(result).toContain('exit 1');
  });

  it('shows tool/default when tool is set but model is undefined', () => {
    const meta: WorkerResultMeta = {
      ...baseMeta,
      tool: 'codex',
      model: undefined,
    };
    const result = formatWorkerResult(meta, 'Done');

    expect(result).toContain('codex/default');
  });

  it('formatWorkerBatch passes tool through from markers', () => {
    const outcomes: PromiseSettledResult<AgentResult>[] = [
      {
        status: 'fulfilled',
        value: {
          stdout: 'Worker 1 output',
          stderr: '',
          exitCode: 0,
          durationMs: 1200,
          retryCount: 0,
        },
      },
      {
        status: 'fulfilled',
        value: {
          stdout: 'Worker 2 output',
          stderr: '',
          exitCode: 0,
          durationMs: 800,
          retryCount: 0,
        },
      },
    ];

    const markers = [
      { profile: 'read-only', body: { model: 'haiku', tool: 'claude' } },
      { profile: 'code-edit', body: { model: 'gpt-5.2-codex', tool: 'codex' } },
    ];

    const { formattedResults } = formatWorkerBatch(outcomes, markers);

    expect(formattedResults[0]).toContain('claude/haiku');
    expect(formattedResults[1]).toContain('codex/gpt-5.2-codex');
  });

  it('formatWorkerBatch omits tool prefix when tool is absent', () => {
    const outcomes: PromiseSettledResult<AgentResult>[] = [
      {
        status: 'fulfilled',
        value: {
          stdout: 'Output',
          stderr: '',
          exitCode: 0,
          durationMs: 500,
          retryCount: 0,
        },
      },
    ];

    const markers = [{ profile: 'read-only', body: { model: 'haiku' } }];

    const { formattedResults } = formatWorkerBatch(outcomes, markers);

    expect(formattedResults[0]).toContain('haiku');
    expect(formattedResults[0]).not.toContain('/haiku');
  });
});

// ── System prompt tool selection guidance ───────────────────────────

describe('System prompt tool selection guidance', () => {
  it('includes tool field documentation in SPAWN format', () => {
    const prompt = generateMasterSystemPrompt({
      workspacePath: '/test/project',
      masterToolName: 'claude',
      discoveredTools: [makeTool('claude'), makeTool('codex')],
    });

    expect(prompt).toContain('`tool` (optional)');
    expect(prompt).toContain('`claude`');
    expect(prompt).toContain('`codex`');
  });

  it('includes tool selection guidelines when multiple tools available', () => {
    const prompt = generateMasterSystemPrompt({
      workspacePath: '/test/project',
      masterToolName: 'claude',
      discoveredTools: [makeTool('claude'), makeTool('codex'), makeTool('aider')],
    });

    expect(prompt).toContain('Tool Selection Guidelines');
    expect(prompt).toContain('Deep reasoning');
    expect(prompt).toContain('Quick code edits');
    expect(prompt).toContain('Git-aware refactors');
  });

  it('omits tool selection guidelines when only one tool available', () => {
    const prompt = generateMasterSystemPrompt({
      workspacePath: '/test/project',
      masterToolName: 'claude',
      discoveredTools: [makeTool('claude')],
    });

    expect(prompt).not.toContain('Tool Selection Guidelines');
  });

  it('includes "Best for:" in discovered tools section', () => {
    const prompt = generateMasterSystemPrompt({
      workspacePath: '/test/project',
      masterToolName: 'claude',
      discoveredTools: [makeTool('claude'), makeTool('codex')],
    });

    expect(prompt).toContain('Best for:');
  });

  it('includes SPAWN example with tool field', () => {
    const prompt = generateMasterSystemPrompt({
      workspacePath: '/test/project',
      masterToolName: 'claude',
      discoveredTools: [makeTool('claude'), makeTool('codex')],
    });

    expect(prompt).toContain('"tool":"codex"');
    expect(prompt).toContain('Worker using a specific AI tool');
  });

  it('shows fallback notice when multiple tools are available', () => {
    const prompt = generateMasterSystemPrompt({
      workspacePath: '/test/project',
      masterToolName: 'claude',
      discoveredTools: [makeTool('claude'), makeTool('codex')],
    });

    expect(prompt).toContain('falls back to the Master tool');
  });

  it('only lists available tools (skips unavailable)', () => {
    const prompt = generateMasterSystemPrompt({
      workspacePath: '/test/project',
      masterToolName: 'claude',
      discoveredTools: [
        makeTool('claude', true),
        makeTool('codex', false),
        makeTool('aider', true),
      ],
    });

    // Tool names in the "Available:" line should only list available ones
    expect(prompt).toContain('`claude`');
    expect(prompt).toContain('`aider`');
    // codex is still listed in discovered tools section but marked unavailable
  });
});
