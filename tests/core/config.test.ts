import { describe, it, expect } from 'vitest';
import { AppConfigSchema } from '../../src/types/config.js';

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
});
