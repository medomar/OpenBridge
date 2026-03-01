import { describe, it, expect } from 'vitest';
import { AdapterRegistry, createAdapterRegistry } from '../../src/core/adapter-registry.js';
import { ClaudeAdapter } from '../../src/core/adapters/claude-adapter.js';
import { CodexAdapter } from '../../src/core/adapters/codex-adapter.js';
import { AiderAdapter } from '../../src/core/adapters/aider-adapter.js';
import type { CLIAdapter, CLISpawnConfig, CapabilityLevel } from '../../src/core/cli-adapter.js';
import type { SpawnOptions } from '../../src/core/agent-runner.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';

// ── AdapterRegistry ─────────────────────────────────────────────────

describe('AdapterRegistry', () => {
  it('returns ClaudeAdapter for "claude" (lazy-created from built-in)', () => {
    const registry = new AdapterRegistry();
    const adapter = registry.get('claude');
    expect(adapter).toBeDefined();
    expect(adapter!.name).toBe('claude');
    expect(adapter).toBeInstanceOf(ClaudeAdapter);
  });

  it('returns CodexAdapter for "codex" (lazy-created from built-in)', () => {
    const registry = new AdapterRegistry();
    const adapter = registry.get('codex');
    expect(adapter).toBeDefined();
    expect(adapter!.name).toBe('codex');
    expect(adapter).toBeInstanceOf(CodexAdapter);
  });

  it('returns AiderAdapter for "aider" (lazy-created from built-in)', () => {
    const registry = new AdapterRegistry();
    const adapter = registry.get('aider');
    expect(adapter).toBeDefined();
    expect(adapter!.name).toBe('aider');
    expect(adapter).toBeInstanceOf(AiderAdapter);
  });

  it('returns undefined for unknown tool names', () => {
    const registry = new AdapterRegistry();
    expect(registry.get('unknown-tool')).toBeUndefined();
    expect(registry.get('cursor')).toBeUndefined();
    expect(registry.get('cody')).toBeUndefined();
  });

  it('caches adapters after first creation', () => {
    const registry = new AdapterRegistry();
    const first = registry.get('codex');
    const second = registry.get('codex');
    expect(first).toBe(second); // Same instance
  });

  it('custom adapters registered via register() take priority', () => {
    const registry = new AdapterRegistry();

    const customAdapter: CLIAdapter = {
      name: 'claude',
      buildSpawnConfig: (_opts: SpawnOptions): CLISpawnConfig => ({
        binary: 'custom-claude',
        args: [],
        env: {},
      }),
      cleanEnv: (env) => env,
      mapCapabilityLevel: (_level: CapabilityLevel) => undefined,
      isValidModel: () => true,
    };

    registry.register('claude', customAdapter);
    const adapter = registry.get('claude');
    expect(adapter).toBe(customAdapter);
    expect(adapter!.buildSpawnConfig({ prompt: 'test', workspacePath: '/' }).binary).toBe(
      'custom-claude',
    );
  });

  it('getForTool routes by DiscoveredTool.name', () => {
    const registry = new AdapterRegistry();

    const codexTool: DiscoveredTool = {
      name: 'codex',
      path: '/usr/local/bin/codex',
      version: '1.0.0',
      capabilities: ['code-generation'],
      role: 'master',
      available: true,
    };

    const adapter = registry.getForTool(codexTool);
    expect(adapter).toBeDefined();
    expect(adapter!.name).toBe('codex');
  });

  it('getForTool returns undefined for unregistered tools', () => {
    const registry = new AdapterRegistry();

    const unknownTool: DiscoveredTool = {
      name: 'cursor',
      path: '/usr/local/bin/cursor',
      version: '0.5.0',
      capabilities: ['code-generation'],
      role: 'backup',
      available: true,
    };

    expect(registry.getForTool(unknownTool)).toBeUndefined();
  });

  it('has() returns true for built-in adapter names', () => {
    const registry = new AdapterRegistry();
    expect(registry.has('claude')).toBe(true);
    expect(registry.has('codex')).toBe(true);
    expect(registry.has('aider')).toBe(true);
  });

  it('has() returns false for unknown names', () => {
    const registry = new AdapterRegistry();
    expect(registry.has('cursor')).toBe(false);
    expect(registry.has('cody')).toBe(false);
  });

  it('has() returns true for custom-registered names', () => {
    const registry = new AdapterRegistry();
    const customAdapter: CLIAdapter = {
      name: 'custom',
      buildSpawnConfig: () => ({ binary: 'custom', args: [], env: {} }),
      cleanEnv: (env) => env,
      mapCapabilityLevel: () => undefined,
      isValidModel: () => true,
    };
    registry.register('custom', customAdapter);
    expect(registry.has('custom')).toBe(true);
  });
});

// ── createAdapterRegistry factory ───────────────────────────────────

describe('createAdapterRegistry', () => {
  it('pre-registers the Claude adapter', () => {
    const registry = createAdapterRegistry();
    const adapter = registry.get('claude');
    expect(adapter).toBeInstanceOf(ClaudeAdapter);
  });

  it('still provides codex and aider via lazy-loading', () => {
    const registry = createAdapterRegistry();
    expect(registry.get('codex')).toBeInstanceOf(CodexAdapter);
    expect(registry.get('aider')).toBeInstanceOf(AiderAdapter);
  });
});
