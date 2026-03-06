import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import { setAccess } from '../../src/memory/access-store.js';
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

// ---------------------------------------------------------------------------
// getRoleForChannel — defaultRole + channelRoles config (OB-1719)
// ---------------------------------------------------------------------------

describe('getRoleForChannel()', () => {
  it('defaults to "owner" when defaultRole is not specified', () => {
    const auth = new AuthService({ whitelist: [], prefix: '/ai' });
    expect(auth.getRoleForChannel('whatsapp')).toBe('owner');
    expect(auth.getRoleForChannel('telegram')).toBe('owner');
  });

  it('returns the configured defaultRole for any channel', () => {
    const auth = new AuthService({ whitelist: [], prefix: '/ai', defaultRole: 'developer' });
    expect(auth.getRoleForChannel('whatsapp')).toBe('developer');
    expect(auth.getRoleForChannel('telegram')).toBe('developer');
    expect(auth.getRoleForChannel('discord')).toBe('developer');
  });

  it('returns channel-specific role from channelRoles', () => {
    const auth = new AuthService({
      whitelist: [],
      prefix: '/ai',
      defaultRole: 'developer',
      channelRoles: { telegram: 'viewer', discord: 'admin' },
    });
    expect(auth.getRoleForChannel('telegram')).toBe('viewer');
    expect(auth.getRoleForChannel('discord')).toBe('admin');
  });

  it('falls back to defaultRole when channel is not in channelRoles', () => {
    const auth = new AuthService({
      whitelist: [],
      prefix: '/ai',
      defaultRole: 'viewer',
      channelRoles: { telegram: 'admin' },
    });
    expect(auth.getRoleForChannel('whatsapp')).toBe('viewer');
    expect(auth.getRoleForChannel('webchat')).toBe('viewer');
  });

  it('reflects updated config after updateConfig()', () => {
    const auth = new AuthService({ whitelist: [], prefix: '/ai', defaultRole: 'owner' });
    expect(auth.getRoleForChannel('whatsapp')).toBe('owner');

    auth.updateConfig({
      whitelist: [],
      prefix: '/ai',
      defaultRole: 'viewer',
      channelRoles: { whatsapp: 'developer' },
    });
    expect(auth.getRoleForChannel('whatsapp')).toBe('developer');
    expect(auth.getRoleForChannel('telegram')).toBe('viewer');
  });
});

// ---------------------------------------------------------------------------
// Softened action classification — chat as default (OB-1724)
// ---------------------------------------------------------------------------

describe('softened action classification — chat action', () => {
  let db: Database.Database;
  let auth: AuthService;

  beforeEach(() => {
    db = openDatabase(':memory:');
    auth = new AuthService({ whitelist: ['+1234567890'], prefix: '/ai' });
    auth.setDatabase(db);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('allows conversational messages for viewer role (classified as chat)', () => {
    setAccess(db, { user_id: '+1234567890', channel: 'whatsapp', role: 'viewer' });
    const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'hello, how are you?');
    expect(result.allowed).toBe(true);
  });

  it('allows messages without action keywords for viewer role (chat is the default)', () => {
    setAccess(db, { user_id: '+1234567890', channel: 'whatsapp', role: 'viewer' });
    const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'what does this project do?');
    expect(result.allowed).toBe(true);
  });

  it('allows chat for developer role', () => {
    setAccess(db, { user_id: '+1234567890', channel: 'whatsapp', role: 'developer' });
    const result = auth.checkAccessControl(
      '+1234567890',
      'whatsapp',
      'can you explain the architecture?',
    );
    expect(result.allowed).toBe(true);
  });

  it('still denies edit-classified messages for viewer role', () => {
    setAccess(db, { user_id: '+1234567890', channel: 'whatsapp', role: 'viewer' });
    const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'edit the config file');
    expect(result.allowed).toBe(false);
  });

  it('still denies deploy-classified messages for developer role', () => {
    setAccess(db, { user_id: '+1234567890', channel: 'whatsapp', role: 'developer' });
    const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'deploy to production');
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Improved denial messages (OB-1714 / OB-1724)
// ---------------------------------------------------------------------------

describe('denial message format', () => {
  let db: Database.Database;
  let auth: AuthService;

  beforeEach(() => {
    db = openDatabase(':memory:');
    auth = new AuthService({ whitelist: ['+1234567890'], prefix: '/ai' });
    auth.setDatabase(db);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('denial message includes the user role', () => {
    setAccess(db, { user_id: '+1234567890', channel: 'whatsapp', role: 'viewer' });
    const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'deploy the app');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/viewer/i);
  });

  it('denial message includes the list of allowed actions for the role', () => {
    setAccess(db, { user_id: '+1234567890', channel: 'whatsapp', role: 'viewer' });
    const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'deploy the app');
    expect(result.reason).toMatch(/read/i);
    expect(result.reason).toMatch(/chat/i);
  });

  it('denial message names the blocked action', () => {
    setAccess(db, { user_id: '+1234567890', channel: 'whatsapp', role: 'developer' });
    const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'deploy to production');
    expect(result.reason).toMatch(/deploy/i);
  });

  it('blocked_actions denial message includes the action and role', () => {
    setAccess(db, {
      user_id: '+1234567890',
      channel: 'whatsapp',
      role: 'owner',
      blocked_actions: ['deploy'],
    });
    const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'deploy to production');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/deploy/i);
    expect(result.reason).toMatch(/owner/i);
  });

  it('inactive account denial message mentions revoked', () => {
    setAccess(db, {
      user_id: '+1234567890',
      channel: 'whatsapp',
      role: 'developer',
      active: false,
    });
    const result = auth.checkAccessControl('+1234567890', 'whatsapp');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/revoked/i);
  });
});
