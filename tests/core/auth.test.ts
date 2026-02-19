import { describe, it, expect } from 'vitest';
import { AuthService } from '../../src/core/auth.js';

describe('AuthService', () => {
  const config = { whitelist: ['+1234567890', '+0987654321'], prefix: '/ai' };

  it('should authorize whitelisted senders', () => {
    const auth = new AuthService(config);
    expect(auth.isAuthorized('+1234567890')).toBe(true);
    expect(auth.isAuthorized('+0987654321')).toBe(true);
  });

  it('should reject non-whitelisted senders', () => {
    const auth = new AuthService(config);
    expect(auth.isAuthorized('+1111111111')).toBe(false);
  });

  it('should allow all senders when whitelist is empty', () => {
    const auth = new AuthService({ whitelist: [], prefix: '/ai' });
    expect(auth.isAuthorized('+anyone')).toBe(true);
  });

  it('should detect the command prefix', () => {
    const auth = new AuthService(config);
    expect(auth.hasPrefix('/ai do something')).toBe(true);
    expect(auth.hasPrefix('  /ai do something')).toBe(true);
    expect(auth.hasPrefix('hello world')).toBe(false);
  });

  it('should strip the prefix from messages', () => {
    const auth = new AuthService(config);
    expect(auth.stripPrefix('/ai do something')).toBe('do something');
    expect(auth.stripPrefix('  /ai  do something')).toBe('do something');
  });

  it('should return original content if no prefix', () => {
    const auth = new AuthService(config);
    expect(auth.stripPrefix('hello world')).toBe('hello world');
  });
});
