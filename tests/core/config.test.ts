import { homedir } from 'node:os';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AppConfigSchema,
  V2ConfigSchema,
  SecurityConfigSchema,
  getEffectiveConfirmHighRisk,
} from '../../src/types/config.js';
import {
  isV2Config,
  convertV2ToInternal,
  expandTilde,
  injectDevConnectors,
  applyEnvOverrides,
  buildV2ConfigFromEnv,
} from '../../src/core/config.js';
import type { AppConfig, V2Config } from '../../src/types/config.js';

describe('AppConfigSchema', () => {
  it('should validate a valid config', () => {
    const config = {
      connectors: [{ type: 'whatsapp', enabled: true, options: {} }],
      providers: [{ type: 'claude-code', enabled: true, options: {} }],
      defaultProvider: 'claude-code',
      auth: { whitelist: ['+1234567890'], prefix: '/ai' },
      logLevel: 'info',
    };

    const result = AppConfigSchema.parse(config);
    expect(result.defaultProvider).toBe('claude-code');
    expect(result.connectors).toHaveLength(1);
    expect(result.providers).toHaveLength(1);
  });

  it('should apply defaults', () => {
    const config = {
      connectors: [{ type: 'whatsapp' }],
      providers: [{ type: 'claude-code' }],
      defaultProvider: 'claude-code',
      auth: {},
    };

    const result = AppConfigSchema.parse(config);
    expect(result.auth.prefix).toBe('/ai');
    expect(result.auth.whitelist).toEqual([]);
    expect(result.logLevel).toBe('info');
    expect(result.connectors[0]?.enabled).toBe(true);
  });

  it('should apply rateLimit defaults when not specified', () => {
    const config = {
      connectors: [{ type: 'whatsapp' }],
      providers: [{ type: 'claude-code' }],
      defaultProvider: 'claude-code',
      auth: {},
    };

    const result = AppConfigSchema.parse(config);
    expect(result.auth.rateLimit.enabled).toBe(true);
    expect(result.auth.rateLimit.maxMessages).toBe(10);
    expect(result.auth.rateLimit.windowMs).toBe(60_000);
  });

  it('should accept custom rateLimit config', () => {
    const config = {
      connectors: [{ type: 'whatsapp' }],
      providers: [{ type: 'claude-code' }],
      defaultProvider: 'claude-code',
      auth: { rateLimit: { enabled: false, maxMessages: 5, windowMs: 30_000 } },
    };

    const result = AppConfigSchema.parse(config);
    expect(result.auth.rateLimit.enabled).toBe(false);
    expect(result.auth.rateLimit.maxMessages).toBe(5);
    expect(result.auth.rateLimit.windowMs).toBe(30_000);
  });

  it('should reject config with no connectors', () => {
    const config = {
      connectors: [],
      providers: [{ type: 'claude-code' }],
      defaultProvider: 'claude-code',
      auth: {},
    };

    expect(() => AppConfigSchema.parse(config)).toThrow();
  });

  it('should reject config with no providers', () => {
    const config = {
      connectors: [{ type: 'whatsapp' }],
      providers: [],
      defaultProvider: 'claude-code',
      auth: {},
    };

    expect(() => AppConfigSchema.parse(config)).toThrow();
  });

  it('should reject config when defaultProvider does not match any provider type', () => {
    const config = {
      connectors: [{ type: 'whatsapp' }],
      providers: [{ type: 'claude-code' }],
      defaultProvider: 'nonexistent-provider',
      auth: {},
    };

    expect(() => AppConfigSchema.parse(config)).toThrow(/does not match any provider type/);
  });

  it('should accept config when defaultProvider matches one of multiple providers', () => {
    const config = {
      connectors: [{ type: 'whatsapp' }],
      providers: [{ type: 'claude-code' }, { type: 'openai' }],
      defaultProvider: 'openai',
      auth: {},
    };

    const result = AppConfigSchema.parse(config);
    expect(result.defaultProvider).toBe('openai');
  });
});

describe('V2ConfigSchema', () => {
  it('should validate a minimal V2 config', () => {
    const config = {
      workspacePath: '/path/to/workspace',
      channels: [{ type: 'whatsapp', enabled: true }],
      auth: {
        whitelist: ['+1234567890'],
        prefix: '/ai',
      },
    };

    const result = V2ConfigSchema.parse(config);
    expect(result.workspacePath).toBe('/path/to/workspace');
    expect(result.channels).toHaveLength(1);
    expect(result.auth.whitelist).toEqual(['+1234567890']);
  });

  it('should apply defaults for optional V2 fields', () => {
    const config = {
      workspacePath: '/path/to/workspace',
      channels: [{ type: 'console' }],
      auth: {
        whitelist: ['+1234567890'],
      },
    };

    const result = V2ConfigSchema.parse(config);
    expect(result.channels[0]?.enabled).toBe(true);
    expect(result.auth.prefix).toBe('/ai');
  });

  it('should reject V2 config with unknown fields (strict mode)', () => {
    const config = {
      workspacePath: '/path/to/workspace',
      channels: [{ type: 'whatsapp', enabled: true }],
      auth: {
        whitelist: ['+1234567890'],
      },
      unknownField: 'value',
    };

    expect(() => V2ConfigSchema.parse(config)).toThrow();
  });

  it('should reject V2 config with empty whitelist', () => {
    const config = {
      workspacePath: '/path/to/workspace',
      channels: [{ type: 'whatsapp', enabled: true }],
      auth: {
        whitelist: [],
      },
    };

    expect(() => V2ConfigSchema.parse(config)).toThrow();
  });

  it('should reject V2 config with empty channels', () => {
    const config = {
      workspacePath: '/path/to/workspace',
      channels: [],
      auth: {
        whitelist: ['+1234567890'],
      },
    };

    expect(() => V2ConfigSchema.parse(config)).toThrow();
  });
});

describe('isV2Config', () => {
  it('should return true for valid V2 config', () => {
    const config = {
      workspacePath: '/path/to/workspace',
      channels: [{ type: 'whatsapp', enabled: true }],
      auth: {
        whitelist: ['+1234567890'],
        prefix: '/ai',
      },
    };

    expect(isV2Config(config)).toBe(true);
  });

  it('should return false for V0 config', () => {
    const config = {
      connectors: [{ type: 'whatsapp', enabled: true }],
      providers: [{ type: 'claude-code', enabled: true }],
      defaultProvider: 'claude-code',
      auth: { whitelist: ['+1234567890'] },
    };

    expect(isV2Config(config)).toBe(false);
  });

  it('should return false for invalid config', () => {
    expect(isV2Config(null)).toBe(false);
    expect(isV2Config(undefined)).toBe(false);
    expect(isV2Config({})).toBe(false);
    expect(isV2Config('string')).toBe(false);
  });
});

describe('expandTilde', () => {
  it('should expand ~ to home directory', () => {
    expect(expandTilde('~/Desktop/project')).toBe(`${homedir()}/Desktop/project`);
  });

  it('should expand bare ~ to home directory', () => {
    expect(expandTilde('~')).toBe(homedir());
  });

  it('should not modify absolute paths', () => {
    expect(expandTilde('/absolute/path')).toBe('/absolute/path');
  });

  it('should not modify relative paths', () => {
    expect(expandTilde('relative/path')).toBe('relative/path');
  });

  it('should not expand ~ when not at the start', () => {
    expect(expandTilde('/path/with/~/tilde')).toBe('/path/with/~/tilde');
  });
});

describe('convertV2ToInternal', () => {
  it('should expand tilde in workspacePath', () => {
    const v2Config = {
      workspacePath: '~/Desktop/project',
      channels: [{ type: 'console', enabled: true }],
      auth: { whitelist: ['+1234567890'], prefix: '/ai' },
    };

    const internalConfig = convertV2ToInternal(v2Config);

    expect(internalConfig.workspaces[0]?.path).toBe(`${homedir()}/Desktop/project`);
  });

  it('should convert minimal V2 config to internal AppConfig format', () => {
    const v2Config = {
      workspacePath: '/path/to/workspace',
      channels: [{ type: 'whatsapp', enabled: true }],
      auth: {
        whitelist: ['+1234567890'],
        prefix: '/ai',
      },
    };

    const internalConfig = convertV2ToInternal(v2Config);

    expect(internalConfig.connectors).toEqual([{ type: 'whatsapp', enabled: true, options: {} }]);
    expect(internalConfig.providers).toEqual([
      { type: 'auto-discovered', enabled: true, options: {} },
    ]);
    expect(internalConfig.defaultProvider).toBe('auto-discovered');
    expect(internalConfig.workspaces).toEqual([{ name: 'default', path: '/path/to/workspace' }]);
    expect(internalConfig.defaultWorkspace).toBe('default');
    expect(internalConfig.auth.whitelist).toEqual(['+1234567890']);
    expect(internalConfig.auth.prefix).toBe('/ai');
  });

  it('should convert multiple channels to connectors', () => {
    const v2Config = {
      workspacePath: '/path/to/workspace',
      channels: [
        { type: 'whatsapp', enabled: true, options: { foo: 'bar' } },
        { type: 'console', enabled: false },
      ],
      auth: {
        whitelist: ['+1234567890'],
      },
    };

    const internalConfig = convertV2ToInternal(v2Config);

    expect(internalConfig.connectors).toEqual([
      { type: 'whatsapp', enabled: true, options: { foo: 'bar' } },
      { type: 'console', enabled: false, options: {} },
    ]);
  });

  it('should apply default values for optional V2 fields', () => {
    const v2Config = {
      workspacePath: '/path/to/workspace',
      channels: [{ type: 'whatsapp', enabled: true }],
      auth: {
        whitelist: ['+1234567890'],
        prefix: '/ai',
      },
    };

    const internalConfig = convertV2ToInternal(v2Config);

    expect(internalConfig.queue).toEqual({
      maxRetries: 3,
      retryDelayMs: 1_000,
    });
    expect(internalConfig.router).toEqual({
      progressIntervalMs: 15_000,
      escalationTimeoutMs: 180_000,
    });
    expect(internalConfig.audit).toEqual({
      enabled: false,
      logPath: 'audit.log',
    });
    expect(internalConfig.health).toEqual({
      enabled: false,
      port: 8080,
    });
    expect(internalConfig.metrics).toEqual({
      enabled: false,
      port: 9090,
    });
    expect(internalConfig.logLevel).toBe('info');
  });

  it('should preserve custom optional V2 config values', () => {
    const v2Config = {
      workspacePath: '/path/to/workspace',
      channels: [{ type: 'whatsapp', enabled: true }],
      auth: {
        whitelist: ['+1234567890'],
        prefix: '/custom',
        rateLimit: {
          enabled: true,
          maxMessages: 20,
          windowMs: 120_000,
        },
      },
      queue: {
        maxRetries: 5,
        retryDelayMs: 2_000,
      },
      logLevel: 'debug' as const,
    };

    const internalConfig = convertV2ToInternal(v2Config);

    expect(internalConfig.auth.prefix).toBe('/custom');
    expect(internalConfig.auth.rateLimit).toEqual({
      enabled: true,
      maxMessages: 20,
      windowMs: 120_000,
    });
    expect(internalConfig.queue).toEqual({
      maxRetries: 5,
      retryDelayMs: 2_000,
    });
    expect(internalConfig.logLevel).toBe('debug');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeV2Config(overrides: Partial<V2Config> = {}): V2Config {
  return V2ConfigSchema.parse({
    workspacePath: '/path/to/workspace',
    channels: [{ type: 'console', enabled: true }],
    auth: { whitelist: ['+1234567890'], prefix: '/ai' },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// applyEnvOverrides
// ---------------------------------------------------------------------------

describe('applyEnvOverrides', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns unchanged config when no env vars are set', () => {
    const config = makeV2Config();
    const result = applyEnvOverrides(config);
    expect(result.workspacePath).toBe('/path/to/workspace');
    expect(result.auth.whitelist).toEqual(['+1234567890']);
    expect(result.auth.prefix).toBe('/ai');
    expect(result.logLevel).toBeUndefined();
  });

  it('overrides workspacePath from OPENBRIDGE_WORKSPACE_PATH', () => {
    vi.stubEnv('OPENBRIDGE_WORKSPACE_PATH', '/new/workspace');
    const config = makeV2Config();
    const result = applyEnvOverrides(config);
    expect(result.workspacePath).toBe('/new/workspace');
  });

  it('overrides channels from OPENBRIDGE_CHANNELS', () => {
    vi.stubEnv('OPENBRIDGE_CHANNELS', '[{"type":"whatsapp","enabled":true}]');
    const config = makeV2Config();
    const result = applyEnvOverrides(config);
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]?.type).toBe('whatsapp');
  });

  it('throws on invalid OPENBRIDGE_CHANNELS JSON', () => {
    vi.stubEnv('OPENBRIDGE_CHANNELS', 'not-json');
    const config = makeV2Config();
    expect(() => applyEnvOverrides(config)).toThrow(
      'OPENBRIDGE_CHANNELS must be a valid JSON array',
    );
  });

  it('overrides auth.whitelist from OPENBRIDGE_AUTH_WHITELIST (comma-separated)', () => {
    vi.stubEnv('OPENBRIDGE_AUTH_WHITELIST', '+9999999999, +8888888888');
    const config = makeV2Config();
    const result = applyEnvOverrides(config);
    expect(result.auth.whitelist).toEqual(['+9999999999', '+8888888888']);
  });

  it('filters empty entries from OPENBRIDGE_AUTH_WHITELIST', () => {
    vi.stubEnv('OPENBRIDGE_AUTH_WHITELIST', '+9999999999,,+8888888888,');
    const config = makeV2Config();
    const result = applyEnvOverrides(config);
    expect(result.auth.whitelist).toEqual(['+9999999999', '+8888888888']);
  });

  it('overrides auth.prefix from OPENBRIDGE_AUTH_PREFIX', () => {
    vi.stubEnv('OPENBRIDGE_AUTH_PREFIX', '/bot');
    const config = makeV2Config();
    const result = applyEnvOverrides(config);
    expect(result.auth.prefix).toBe('/bot');
  });

  it('overrides logLevel from OPENBRIDGE_LOG_LEVEL', () => {
    vi.stubEnv('OPENBRIDGE_LOG_LEVEL', 'debug');
    const config = makeV2Config();
    const result = applyEnvOverrides(config);
    expect(result.logLevel).toBe('debug');
  });

  it('throws on invalid OPENBRIDGE_LOG_LEVEL value', () => {
    vi.stubEnv('OPENBRIDGE_LOG_LEVEL', 'verbose');
    const config = makeV2Config();
    expect(() => applyEnvOverrides(config)).toThrow('OPENBRIDGE_LOG_LEVEL must be one of');
  });

  it('does not mutate the original config', () => {
    vi.stubEnv('OPENBRIDGE_WORKSPACE_PATH', '/new/workspace');
    const config = makeV2Config();
    const original = config.workspacePath;
    applyEnvOverrides(config);
    expect(config.workspacePath).toBe(original);
  });

  it('applies multiple overrides at once', () => {
    vi.stubEnv('OPENBRIDGE_WORKSPACE_PATH', '/my/project');
    vi.stubEnv('OPENBRIDGE_AUTH_PREFIX', '/cmd');
    vi.stubEnv('OPENBRIDGE_LOG_LEVEL', 'warn');
    const config = makeV2Config();
    const result = applyEnvOverrides(config);
    expect(result.workspacePath).toBe('/my/project');
    expect(result.auth.prefix).toBe('/cmd');
    expect(result.logLevel).toBe('warn');
  });
});

// ---------------------------------------------------------------------------
// buildV2ConfigFromEnv
// ---------------------------------------------------------------------------

describe('buildV2ConfigFromEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds a valid V2Config from required ENV vars', () => {
    vi.stubEnv('OPENBRIDGE_WORKSPACE_PATH', '/my/workspace');
    vi.stubEnv('OPENBRIDGE_AUTH_WHITELIST', '+1234567890');
    const config = buildV2ConfigFromEnv();
    expect(config.workspacePath).toBe('/my/workspace');
    expect(config.auth.whitelist).toEqual(['+1234567890']);
  });

  it('defaults to console channel when OPENBRIDGE_CHANNELS is not set', () => {
    vi.stubEnv('OPENBRIDGE_WORKSPACE_PATH', '/my/workspace');
    vi.stubEnv('OPENBRIDGE_AUTH_WHITELIST', '+1234567890');
    const config = buildV2ConfigFromEnv();
    expect(config.channels).toHaveLength(1);
    expect(config.channels[0]?.type).toBe('console');
  });

  it('uses OPENBRIDGE_CHANNELS when provided', () => {
    vi.stubEnv('OPENBRIDGE_WORKSPACE_PATH', '/my/workspace');
    vi.stubEnv('OPENBRIDGE_AUTH_WHITELIST', '+1234567890');
    vi.stubEnv('OPENBRIDGE_CHANNELS', '[{"type":"whatsapp","enabled":true}]');
    const config = buildV2ConfigFromEnv();
    expect(config.channels[0]?.type).toBe('whatsapp');
  });

  it('uses OPENBRIDGE_AUTH_PREFIX when provided', () => {
    vi.stubEnv('OPENBRIDGE_WORKSPACE_PATH', '/my/workspace');
    vi.stubEnv('OPENBRIDGE_AUTH_WHITELIST', '+1234567890');
    vi.stubEnv('OPENBRIDGE_AUTH_PREFIX', '/mybot');
    const config = buildV2ConfigFromEnv();
    expect(config.auth.prefix).toBe('/mybot');
  });

  it('defaults auth.prefix to /ai when not set', () => {
    vi.stubEnv('OPENBRIDGE_WORKSPACE_PATH', '/my/workspace');
    vi.stubEnv('OPENBRIDGE_AUTH_WHITELIST', '+1234567890');
    const config = buildV2ConfigFromEnv();
    expect(config.auth.prefix).toBe('/ai');
  });

  it('uses OPENBRIDGE_LOG_LEVEL when provided', () => {
    vi.stubEnv('OPENBRIDGE_WORKSPACE_PATH', '/my/workspace');
    vi.stubEnv('OPENBRIDGE_AUTH_WHITELIST', '+1234567890');
    vi.stubEnv('OPENBRIDGE_LOG_LEVEL', 'error');
    const config = buildV2ConfigFromEnv();
    expect(config.logLevel).toBe('error');
  });

  it('throws when OPENBRIDGE_WORKSPACE_PATH is missing', () => {
    vi.stubEnv('OPENBRIDGE_AUTH_WHITELIST', '+1234567890');
    expect(() => buildV2ConfigFromEnv()).toThrow('OPENBRIDGE_WORKSPACE_PATH');
  });

  it('throws when OPENBRIDGE_AUTH_WHITELIST is missing', () => {
    vi.stubEnv('OPENBRIDGE_WORKSPACE_PATH', '/my/workspace');
    expect(() => buildV2ConfigFromEnv()).toThrow('OPENBRIDGE_AUTH_WHITELIST');
  });

  it('throws when both required vars are missing with helpful message', () => {
    expect(() => buildV2ConfigFromEnv()).toThrow('npx openbridge init');
  });

  it('throws on invalid OPENBRIDGE_CHANNELS JSON', () => {
    vi.stubEnv('OPENBRIDGE_WORKSPACE_PATH', '/my/workspace');
    vi.stubEnv('OPENBRIDGE_AUTH_WHITELIST', '+1234567890');
    vi.stubEnv('OPENBRIDGE_CHANNELS', '{bad json}');
    expect(() => buildV2ConfigFromEnv()).toThrow('OPENBRIDGE_CHANNELS must be a valid JSON array');
  });

  it('throws on invalid OPENBRIDGE_LOG_LEVEL', () => {
    vi.stubEnv('OPENBRIDGE_WORKSPACE_PATH', '/my/workspace');
    vi.stubEnv('OPENBRIDGE_AUTH_WHITELIST', '+1234567890');
    vi.stubEnv('OPENBRIDGE_LOG_LEVEL', 'verbose');
    expect(() => buildV2ConfigFromEnv()).toThrow('OPENBRIDGE_LOG_LEVEL must be one of');
  });

  it('handles multiple whitelist entries', () => {
    vi.stubEnv('OPENBRIDGE_WORKSPACE_PATH', '/my/workspace');
    vi.stubEnv('OPENBRIDGE_AUTH_WHITELIST', '+1111111111, +2222222222, +3333333333');
    const config = buildV2ConfigFromEnv();
    expect(config.auth.whitelist).toEqual(['+1111111111', '+2222222222', '+3333333333']);
  });
});

// ---------------------------------------------------------------------------
// Helper to build a minimal AppConfig for injectDevConnectors tests
// ---------------------------------------------------------------------------

function makeConfig(connectorTypes: string[] = ['console']): AppConfig {
  return {
    connectors: connectorTypes.map((type) => ({ type, enabled: true, options: {} })),
    providers: [{ type: 'auto-discovered', enabled: true, options: {} }],
    defaultProvider: 'auto-discovered',
    workspaces: [{ name: 'default', path: '/workspace' }],
    defaultWorkspace: 'default',
    auth: {
      whitelist: ['+1234567890'],
      prefix: '/ai',
      rateLimit: { enabled: true, maxMessages: 10, windowMs: 60_000 },
      commandFilter: { allowPatterns: [], denyPatterns: [], denyMessage: '' },
    },
    queue: { maxRetries: 3, retryDelayMs: 1_000 },
    router: { progressIntervalMs: 15_000 },
    audit: { enabled: true, logPath: 'audit.log' },
    health: { enabled: false, port: 8080 },
    metrics: { enabled: false, port: 9090 },
    logLevel: 'info',
  };
}

describe('injectDevConnectors', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('injects webchat connector when NODE_ENV is not set', () => {
    vi.stubEnv('NODE_ENV', '');
    const config = makeConfig(['console']);

    injectDevConnectors(config);

    expect(config.connectors).toHaveLength(2);
    expect(config.connectors.some((c) => c.type === 'webchat')).toBe(true);
  });

  it('adds webchat-user to whitelist for local connector auth', () => {
    vi.stubEnv('NODE_ENV', '');
    const config = makeConfig(['console']);

    injectDevConnectors(config);

    expect(config.auth.whitelist).toContain('webchat-user');
  });

  it('does not inject when NODE_ENV=production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const config = makeConfig(['console']);

    injectDevConnectors(config);

    expect(config.connectors).toHaveLength(1);
    expect(config.connectors.some((c) => c.type === 'webchat')).toBe(false);
  });

  it('does not inject duplicate webchat if already configured', () => {
    vi.stubEnv('NODE_ENV', '');
    const config = makeConfig(['console', 'webchat']);

    injectDevConnectors(config);

    const webchatCount = config.connectors.filter((c) => c.type === 'webchat').length;
    expect(webchatCount).toBe(1);
  });

  it('does not duplicate webchat-user in whitelist if already present', () => {
    vi.stubEnv('NODE_ENV', '');
    const config = makeConfig(['console']);
    config.auth.whitelist.push('webchat-user');

    injectDevConnectors(config);

    const count = config.auth.whitelist.filter((w) => w === 'webchat-user').length;
    expect(count).toBe(1);
  });

  it('injected webchat connector has enabled:true and empty options', () => {
    vi.stubEnv('NODE_ENV', '');
    const config = makeConfig(['console']);

    injectDevConnectors(config);

    const webchat = config.connectors.find((c) => c.type === 'webchat');
    expect(webchat).toEqual({ type: 'webchat', enabled: true, options: {} });
  });
});

describe('SecurityConfigSchema trustLevel', () => {
  it('defaults trustLevel to standard when not specified', () => {
    const result = SecurityConfigSchema.parse({});
    expect(result.trustLevel).toBe('standard');
  });

  it('parses trusted trustLevel correctly', () => {
    const result = SecurityConfigSchema.parse({ trustLevel: 'trusted' });
    expect(result.trustLevel).toBe('trusted');
  });

  it('parses sandbox trustLevel correctly', () => {
    const result = SecurityConfigSchema.parse({ trustLevel: 'sandbox' });
    expect(result.trustLevel).toBe('sandbox');
  });

  it('throws ZodError for invalid trustLevel', () => {
    expect(() => SecurityConfigSchema.parse({ trustLevel: 'invalid' })).toThrow();
  });

  describe('getEffectiveConfirmHighRisk', () => {
    it('returns false for trusted level', () => {
      const security = SecurityConfigSchema.parse({ trustLevel: 'trusted' });
      expect(getEffectiveConfirmHighRisk(security)).toBe(false);
    });

    it('returns true for sandbox level', () => {
      const security = SecurityConfigSchema.parse({ trustLevel: 'sandbox' });
      expect(getEffectiveConfirmHighRisk(security)).toBe(true);
    });

    it('returns false for standard with confirmHighRisk: false', () => {
      const security = SecurityConfigSchema.parse({
        trustLevel: 'standard',
        confirmHighRisk: false,
      });
      expect(getEffectiveConfirmHighRisk(security)).toBe(false);
    });

    it('returns true for standard with confirmHighRisk: true', () => {
      const security = SecurityConfigSchema.parse({
        trustLevel: 'standard',
        confirmHighRisk: true,
      });
      expect(getEffectiveConfirmHighRisk(security)).toBe(true);
    });
  });
});
