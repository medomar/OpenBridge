import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationHub } from '../../src/integrations/hub.js';
import type {
  BusinessIntegration,
  HealthStatus,
  IntegrationCapability,
  IntegrationConfig,
} from '../../src/types/integration.js';

function makeIntegration(
  name: string,
  overrides?: Partial<BusinessIntegration>,
): BusinessIntegration {
  return {
    name,
    type: 'api',
    initialize: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({
      status: 'healthy',
      message: 'OK',
      checkedAt: new Date().toISOString(),
      details: {},
    } satisfies HealthStatus),
    shutdown: vi.fn().mockResolvedValue(undefined),
    describeCapabilities: vi.fn().mockReturnValue([
      {
        name: 'test_op',
        description: 'A test operation',
        category: 'read',
        requiresApproval: false,
      } satisfies IntegrationCapability,
    ]),
    query: vi.fn().mockResolvedValue(null),
    execute: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('IntegrationHub', () => {
  let hub: IntegrationHub;

  beforeEach(() => {
    hub = new IntegrationHub();
  });

  describe('register and retrieve', () => {
    it('registers an integration and retrieves it by name', () => {
      const integration = makeIntegration('my-service');
      hub.register(integration);
      expect(hub.get('my-service')).toBe(integration);
    });

    it('overwrites a registration with the same name', () => {
      const first = makeIntegration('svc');
      const second = makeIntegration('svc');
      hub.register(first);
      hub.register(second);
      expect(hub.get('svc')).toBe(second);
    });
  });

  describe('list', () => {
    it('returns empty array when no integrations registered', () => {
      expect(hub.list()).toEqual([]);
    });

    it('lists all registered integrations with summary info', () => {
      hub.register(makeIntegration('alpha'));
      hub.register(makeIntegration('beta'));
      const list = hub.list();
      expect(list).toHaveLength(2);
      const names = list.map((i) => i.name);
      expect(names).toContain('alpha');
      expect(names).toContain('beta');
    });

    it('includes connected=false and capabilityCount for newly registered integrations', () => {
      hub.register(makeIntegration('svc'));
      const [info] = hub.list();
      expect(info.connected).toBe(false);
      expect(info.healthStatus).toBe('unknown');
      expect(info.capabilityCount).toBe(1);
    });

    it('reflects connected=true after successful initialize', async () => {
      const integration = makeIntegration('svc');
      hub.register(integration);
      const config: IntegrationConfig = { name: 'svc', options: {} };
      await hub.initialize('svc', config);
      const [info] = hub.list();
      expect(info.connected).toBe(true);
    });
  });

  describe('healthCheck', () => {
    it("calls the integration's healthCheck and returns the result", async () => {
      const integration = makeIntegration('svc');
      hub.register(integration);
      const result = await hub.healthCheck('svc');
      expect(integration.healthCheck).toHaveBeenCalledOnce();
      expect(result.status).toBe('healthy');
    });

    it('updates in-memory health status after health check', async () => {
      const integration = makeIntegration('svc', {
        healthCheck: vi.fn().mockResolvedValue({
          status: 'degraded',
          checkedAt: new Date().toISOString(),
          details: {},
        } satisfies HealthStatus),
      });
      hub.register(integration);
      await hub.healthCheck('svc');
      expect(hub.getHealthStatus('svc')).toBe('degraded');
    });

    it('throws for unknown integration name', async () => {
      await expect(hub.healthCheck('ghost')).rejects.toThrow('Integration not found: ghost');
    });
  });

  describe('shutdown', () => {
    it('calls shutdown on all registered integrations', async () => {
      const a = makeIntegration('a');
      const b = makeIntegration('b');
      hub.register(a);
      hub.register(b);
      await hub.shutdown();
      expect(a.shutdown).toHaveBeenCalledOnce();
      expect(b.shutdown).toHaveBeenCalledOnce();
    });

    it('does not throw if one integration shutdown rejects', async () => {
      const good = makeIntegration('good');
      const bad = makeIntegration('bad', {
        shutdown: vi.fn().mockRejectedValue(new Error('shutdown failed')),
      });
      hub.register(good);
      hub.register(bad);
      await expect(hub.shutdown()).resolves.toBeUndefined();
    });
  });

  describe('get — non-existent integration', () => {
    it('throws when integration name is not registered', () => {
      expect(() => hub.get('nonexistent')).toThrow('Integration not found: nonexistent');
    });
  });
});
