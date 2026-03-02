import { describe, it, expect } from 'vitest';
import { sanitizeEnv, warnAboutExposedSecrets } from '../../src/core/env-sanitizer.js';
import type { SecurityConfig } from '../../src/types/config.js';
import { ENV_DENY_PATTERNS } from '../../src/types/config.js';

// Helper to build a SecurityConfig with defaults matching the schema defaults
function makeConfig(
  overrides: Partial<{ envDenyPatterns: string[]; envAllowPatterns: string[] }> = {},
): SecurityConfig {
  return {
    envDenyPatterns: overrides.envDenyPatterns ?? [...ENV_DENY_PATTERNS],
    envAllowPatterns: overrides.envAllowPatterns ?? [],
  };
}

// ── sanitizeEnv ───────────────────────────────────────────────────────────────

describe('sanitizeEnv', () => {
  it('strips AWS_SECRET_KEY from the environment', () => {
    const env = { AWS_SECRET_KEY: 'very-secret', PATH: '/usr/bin' };
    const result = sanitizeEnv(env, makeConfig());
    expect(result).not.toHaveProperty('AWS_SECRET_KEY');
    expect(result.PATH).toBe('/usr/bin');
  });

  it('strips DATABASE_URL from the environment', () => {
    const env = { DATABASE_URL: 'postgres://user:pass@host/db', HOME: '/home/user' };
    const result = sanitizeEnv(env, makeConfig());
    expect(result).not.toHaveProperty('DATABASE_URL');
    expect(result.HOME).toBe('/home/user');
  });

  it('does not strip PATH or HOME', () => {
    const env = { PATH: '/usr/bin:/bin', HOME: '/home/user', LANG: 'en_US.UTF-8' };
    const result = sanitizeEnv(env, makeConfig());
    expect(result.PATH).toBe('/usr/bin:/bin');
    expect(result.HOME).toBe('/home/user');
    expect(result.LANG).toBe('en_US.UTF-8');
  });

  it('preserves GITHUB_ACTIONS when it is in the allow list', () => {
    const env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_TOKEN: 'ghp_secret',
      CI: 'true',
    };
    const result = sanitizeEnv(env, makeConfig({ envAllowPatterns: ['GITHUB_ACTIONS'] }));
    expect(result.GITHUB_ACTIONS).toBe('true');
    // GITHUB_TOKEN is denied and not in allow list — still stripped
    expect(result).not.toHaveProperty('GITHUB_TOKEN');
    expect(result.CI).toBe('true');
  });

  it('wildcard *_TOKEN pattern matches AUTH_TOKEN', () => {
    const env = { AUTH_TOKEN: 'abc123', USER: 'alice' };
    const result = sanitizeEnv(env, makeConfig());
    expect(result).not.toHaveProperty('AUTH_TOKEN');
    expect(result.USER).toBe('alice');
  });

  it('passes everything through when deny list is empty', () => {
    const env = {
      AWS_SECRET_KEY: 'secret',
      DATABASE_URL: 'postgres://...',
      PATH: '/usr/bin',
    };
    const result = sanitizeEnv(env, makeConfig({ envDenyPatterns: [], envAllowPatterns: [] }));
    expect(result.AWS_SECRET_KEY).toBe('secret');
    expect(result.DATABASE_URL).toBe('postgres://...');
    expect(result.PATH).toBe('/usr/bin');
  });

  it('matching is case-sensitive — lowercase variants are not stripped', () => {
    // The deny patterns use uppercase names; lowercase should pass through
    const env = { aws_secret_key: 'lowercase', database_url: 'lowercase', PATH: '/bin' };
    const result = sanitizeEnv(env, makeConfig());
    // Lowercase keys should NOT be matched by uppercase patterns
    expect(result.aws_secret_key).toBe('lowercase');
    expect(result.database_url).toBe('lowercase');
    expect(result.PATH).toBe('/bin');
  });

  it('strips multiple secret patterns from the same env object', () => {
    const env = {
      OPENAI_API_KEY: 'sk-...',
      ANTHROPIC_API_KEY: 'sk-ant-...',
      SMTP_PASSWORD: 'mailpass',
      REDIS_URL: 'redis://localhost',
      NODE_ENV: 'production',
    };
    const result = sanitizeEnv(env, makeConfig());
    expect(result).not.toHaveProperty('OPENAI_API_KEY');
    expect(result).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(result).not.toHaveProperty('SMTP_PASSWORD');
    expect(result).not.toHaveProperty('REDIS_URL');
    expect(result.NODE_ENV).toBe('production');
  });

  it('does not mutate the original env object', () => {
    const env = { AWS_SECRET_KEY: 'secret', PATH: '/bin' };
    const original = { ...env };
    sanitizeEnv(env, makeConfig());
    expect(env).toEqual(original);
  });

  it('allow list overrides deny for matching entries', () => {
    const env = { DB_PASSWORD: 'dbpass', DB_HOST: 'localhost' };
    const result = sanitizeEnv(env, makeConfig({ envAllowPatterns: ['DB_*'] }));
    // Both DB_ vars are in the allow list — both preserved
    expect(result.DB_PASSWORD).toBe('dbpass');
    expect(result.DB_HOST).toBe('localhost');
  });
});

// ── warnAboutExposedSecrets ───────────────────────────────────────────────────

describe('warnAboutExposedSecrets', () => {
  it('returns matching secret variable names', () => {
    const env = { AWS_ACCESS_KEY_ID: 'key', PATH: '/bin', GITHUB_TOKEN: 'tok' };
    const found = warnAboutExposedSecrets(env, [...ENV_DENY_PATTERNS]);
    expect(found).toContain('AWS_ACCESS_KEY_ID');
    expect(found).toContain('GITHUB_TOKEN');
    expect(found).not.toContain('PATH');
  });

  it('returns empty array when no secrets are present', () => {
    const env = { PATH: '/usr/bin', HOME: '/home/user', USER: 'alice' };
    const found = warnAboutExposedSecrets(env, [...ENV_DENY_PATTERNS]);
    expect(found).toHaveLength(0);
  });

  it('ignores env vars with undefined values', () => {
    const env: Record<string, string | undefined> = { AWS_SECRET_KEY: undefined };
    const found = warnAboutExposedSecrets(env, [...ENV_DENY_PATTERNS]);
    expect(found).not.toContain('AWS_SECRET_KEY');
  });
});
