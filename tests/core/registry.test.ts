import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginRegistry } from '../../src/core/registry.js';
import { MockConnector } from '../helpers/mock-connector.js';
import { MockProvider } from '../helpers/mock-provider.js';

describe('PluginRegistry', () => {
  it('should register and create connectors', () => {
    const registry = new PluginRegistry();
    registry.registerConnector('mock', () => new MockConnector());

    const connector = registry.createConnector('mock', {});
    expect(connector.name).toBe('mock');
  });

  it('should register and create providers', () => {
    const registry = new PluginRegistry();
    registry.registerProvider('mock', () => new MockProvider());

    const provider = registry.createProvider('mock', {});
    expect(provider.name).toBe('mock');
  });

  it('should throw for unknown connector type', () => {
    const registry = new PluginRegistry();
    expect(() => registry.createConnector('unknown', {})).toThrow('Unknown connector type');
  });

  it('should throw for unknown provider type', () => {
    const registry = new PluginRegistry();
    expect(() => registry.createProvider('unknown', {})).toThrow('Unknown provider type');
  });

  it('should list available connectors and providers', () => {
    const registry = new PluginRegistry();
    registry.registerConnector('whatsapp', () => new MockConnector());
    registry.registerProvider('claude-code', () => new MockProvider());

    expect(registry.availableConnectors).toEqual(['whatsapp']);
    expect(registry.availableProviders).toEqual(['claude-code']);
  });
});

describe('PluginRegistry.discoverPlugins', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openbridge-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should auto-discover a connector plugin from directory', async () => {
    const connectorsDir = path.join(tmpDir, 'connectors', 'test-connector');
    fs.mkdirSync(connectorsDir, { recursive: true });
    fs.writeFileSync(
      path.join(connectorsDir, 'index.js'),
      `
export const pluginName = 'test-connector';
export const connectorFactory = () => ({
  name: 'test-connector',
  initialize: async () => {},
  sendMessage: async () => {},
  on: () => {},
  shutdown: async () => {},
  isConnected: () => true,
});
      `.trim(),
    );

    const registry = new PluginRegistry();
    await registry.discoverPlugins(tmpDir);

    expect(registry.availableConnectors).toContain('test-connector');
    const connector = registry.createConnector('test-connector', {});
    expect(connector.name).toBe('test-connector');
  });

  it('should auto-discover a provider plugin from directory', async () => {
    const providersDir = path.join(tmpDir, 'providers', 'test-provider');
    fs.mkdirSync(providersDir, { recursive: true });
    fs.writeFileSync(
      path.join(providersDir, 'index.js'),
      `
export const pluginName = 'test-provider';
export const providerFactory = () => ({
  name: 'test-provider',
  initialize: async () => {},
  processMessage: async () => ({ content: 'test' }),
  isAvailable: async () => true,
  shutdown: async () => {},
});
      `.trim(),
    );

    const registry = new PluginRegistry();
    await registry.discoverPlugins(tmpDir);

    expect(registry.availableProviders).toContain('test-provider');
    const provider = registry.createProvider('test-provider', {});
    expect(provider.name).toBe('test-provider');
  });

  it('should skip directories without index.js', async () => {
    const connectorsDir = path.join(tmpDir, 'connectors', 'no-index');
    fs.mkdirSync(connectorsDir, { recursive: true });
    fs.writeFileSync(path.join(connectorsDir, 'other.js'), 'export const x = 1;');

    const registry = new PluginRegistry();
    await registry.discoverPlugins(tmpDir);

    expect(registry.availableConnectors).toEqual([]);
  });

  it('should skip modules without required exports', async () => {
    const connectorsDir = path.join(tmpDir, 'connectors', 'bad-plugin');
    fs.mkdirSync(connectorsDir, { recursive: true });
    fs.writeFileSync(
      path.join(connectorsDir, 'index.js'),
      'export const something = "not a plugin";',
    );

    const registry = new PluginRegistry();
    await registry.discoverPlugins(tmpDir);

    expect(registry.availableConnectors).toEqual([]);
  });

  it('should not overwrite manually registered plugins', async () => {
    const connectorsDir = path.join(tmpDir, 'connectors', 'mock');
    fs.mkdirSync(connectorsDir, { recursive: true });
    fs.writeFileSync(
      path.join(connectorsDir, 'index.js'),
      `
export const pluginName = 'mock';
export const connectorFactory = () => ({
  name: 'auto-mock',
  initialize: async () => {},
  sendMessage: async () => {},
  on: () => {},
  shutdown: async () => {},
  isConnected: () => true,
});
      `.trim(),
    );

    const registry = new PluginRegistry();
    registry.registerConnector('mock', () => new MockConnector());
    await registry.discoverPlugins(tmpDir);

    // Manual registration should take precedence
    const connector = registry.createConnector('mock', {});
    expect(connector.name).toBe('mock');
  });

  it('should handle non-existent directories gracefully', async () => {
    const registry = new PluginRegistry();
    await registry.discoverPlugins(path.join(tmpDir, 'nonexistent'));

    expect(registry.availableConnectors).toEqual([]);
    expect(registry.availableProviders).toEqual([]);
  });

  it('should handle modules that throw on import', async () => {
    const connectorsDir = path.join(tmpDir, 'connectors', 'broken');
    fs.mkdirSync(connectorsDir, { recursive: true });
    fs.writeFileSync(
      path.join(connectorsDir, 'index.js'),
      'throw new Error("module load failure");',
    );

    const registry = new PluginRegistry();
    await registry.discoverPlugins(tmpDir);

    expect(registry.availableConnectors).toEqual([]);
  });

  it('should skip non-directory entries', async () => {
    const connectorsDir = path.join(tmpDir, 'connectors');
    fs.mkdirSync(connectorsDir, { recursive: true });
    fs.writeFileSync(path.join(connectorsDir, 'index.ts'), 'export {}');

    const registry = new PluginRegistry();
    await registry.discoverPlugins(tmpDir);

    expect(registry.availableConnectors).toEqual([]);
  });
});
