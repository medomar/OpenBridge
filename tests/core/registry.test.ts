import { describe, it, expect } from 'vitest';
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
