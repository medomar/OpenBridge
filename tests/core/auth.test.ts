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

  describe('filterCommand', () => {
    it('should allow all commands when no patterns are configured', () => {
      const auth = new AuthService(config);
      expect(auth.filterCommand('do anything').allowed).toBe(true);
      expect(auth.filterCommand('rm -rf /').allowed).toBe(true);
    });

    it('should block commands matching deny patterns', () => {
      const auth = new AuthService({
        ...config,
        commandFilter: {
          denyPatterns: ['rm\\s+-rf', 'drop\\s+table'],
          allowPatterns: [],
          denyMessage: 'Blocked!',
        },
      });
      const result = auth.filterCommand('please rm -rf everything');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Blocked!');
    });

    it('should allow commands not matching deny patterns', () => {
      const auth = new AuthService({
        ...config,
        commandFilter: {
          denyPatterns: ['rm\\s+-rf'],
          allowPatterns: [],
          denyMessage: 'Blocked!',
        },
      });
      expect(auth.filterCommand('list all files').allowed).toBe(true);
    });

    it('should block commands not matching allow patterns', () => {
      const auth = new AuthService({
        ...config,
        commandFilter: {
          allowPatterns: ['^list', '^show', '^explain'],
          denyPatterns: [],
          denyMessage: 'Not permitted.',
        },
      });
      const result = auth.filterCommand('delete everything');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Not permitted.');
    });

    it('should allow commands matching allow patterns', () => {
      const auth = new AuthService({
        ...config,
        commandFilter: {
          allowPatterns: ['^list', '^show', '^explain'],
          denyPatterns: [],
          denyMessage: 'Not permitted.',
        },
      });
      expect(auth.filterCommand('list all files').allowed).toBe(true);
      expect(auth.filterCommand('show me the code').allowed).toBe(true);
      expect(auth.filterCommand('explain this function').allowed).toBe(true);
    });

    it('should deny first when both allow and deny match', () => {
      const auth = new AuthService({
        ...config,
        commandFilter: {
          allowPatterns: ['.*'],
          denyPatterns: ['delete'],
          denyMessage: 'Denied.',
        },
      });
      const result = auth.filterCommand('delete the file');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Denied.');
    });

    it('should be case-insensitive', () => {
      const auth = new AuthService({
        ...config,
        commandFilter: {
          denyPatterns: ['drop\\s+table'],
          allowPatterns: [],
          denyMessage: 'No.',
        },
      });
      expect(auth.filterCommand('DROP TABLE users').allowed).toBe(false);
    });

    it('should use default deny message', () => {
      const auth = new AuthService({
        ...config,
        commandFilter: {
          denyPatterns: ['blocked'],
          allowPatterns: [],
          denyMessage: 'That command is not allowed.',
        },
      });
      const result = auth.filterCommand('this is blocked');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('That command is not allowed.');
    });
  });
});
