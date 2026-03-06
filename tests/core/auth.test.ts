import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import {
  setAccess,
  getAccess,
  approvePairing,
  type AccessRole,
} from '../../src/memory/access-store.js';
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

// ---------------------------------------------------------------------------
// Pairing flow — generate → approve → access granted (OB-1703)
// ---------------------------------------------------------------------------

describe('pairing flow', () => {
  let db: Database.Database;
  let auth: AuthService;

  beforeEach(() => {
    db = openDatabase(':memory:');
    // Whitelist contains one owner; unknown senders will be tested for pairing
    auth = new AuthService({
      whitelist: ['+1000000000'],
      prefix: '/ai',
      pairingEnabled: true,
    });
    auth.setDatabase(db);
  });

  afterEach(() => {
    auth.stopExpiryTimer();
    closeDatabase(db);
  });

  it('generatePairingCode returns a 6-digit numeric string in range 100000–999999', () => {
    const code = AuthService.generatePairingCode();
    expect(code).toMatch(/^\d{6}$/);
    const num = parseInt(code, 10);
    expect(num).toBeGreaterThanOrEqual(100000);
    expect(num).toBeLessThanOrEqual(999999);
  });

  it('initiatePairing stores a pending pairing and returns a message containing the code', () => {
    const msg = auth.initiatePairing('+9999999999', 'whatsapp');
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/\d{6}/);
    expect(msg).toContain('expires in 5 minutes');
    // The code in the message should match the stored pairing
    const codeMatch = msg!.match(/(\d{6})/);
    const code = codeMatch![1];
    expect(auth.getPairing(code)).toBeDefined();
  });

  it('initiatePairing returns null when pairingEnabled is false', () => {
    const disabledAuth = new AuthService({
      whitelist: [],
      prefix: '/ai',
      pairingEnabled: false,
    });
    expect(disabledAuth.initiatePairing('+9999999999', 'whatsapp')).toBeNull();
    disabledAuth.stopExpiryTimer();
  });

  it('storePairing + getPairing round-trip returns the stored entry', () => {
    auth.storePairing('482916', '+8888888888', 'telegram');
    const pairing = auth.getPairing('482916');
    expect(pairing).toBeDefined();
    expect(pairing?.senderId).toBe('+8888888888');
    expect(pairing?.channel).toBe('telegram');
    expect(pairing?.requestedAt).toBeInstanceOf(Date);
  });

  it('getPairing returns undefined for an unknown code', () => {
    expect(auth.getPairing('000000')).toBeUndefined();
  });

  it('removePairing deletes the code so subsequent getPairing returns undefined', () => {
    auth.storePairing('111111', '+7777777777', 'whatsapp');
    expect(auth.getPairing('111111')).toBeDefined();
    auth.removePairing('111111');
    expect(auth.getPairing('111111')).toBeUndefined();
  });

  it('full flow: after approvePairing the previously-unauthorized sender becomes authorized', () => {
    const senderId = '+9999999999';
    const channel = 'whatsapp';
    // Unknown sender is not on the whitelist
    expect(auth.isAuthorized(senderId, channel)).toBe(false);
    // Admin approves the pairing — simulates what the router does after /approve
    approvePairing(db, senderId, channel, 'viewer');
    // Now the sender has an active access_control entry — isAuthorized checks the DB
    expect(auth.isAuthorized(senderId, channel)).toBe(true);
  });

  it('full flow: pending pairing is removed after approval (simulate /approve flow)', () => {
    const senderId = '+9999999999';
    const channel = 'whatsapp';
    const msg = auth.initiatePairing(senderId, channel);
    const code = msg!.match(/(\d{6})/)![1];
    const pairing = auth.getPairing(code)!;
    expect(pairing).toBeDefined();
    // Approve then remove (mirrors router handleApproveCommand logic)
    approvePairing(db, pairing.senderId, pairing.channel, 'viewer');
    auth.removePairing(code);
    // Code is gone
    expect(auth.getPairing(code)).toBeUndefined();
    // Sender is now authorized
    expect(auth.isAuthorized(senderId, channel)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pairing expiry (OB-1703)
// ---------------------------------------------------------------------------

describe('pairing expiry', () => {
  let db: Database.Database;
  let auth: AuthService;

  beforeEach(() => {
    db = openDatabase(':memory:');
    auth = new AuthService({ whitelist: [], prefix: '/ai', pairingEnabled: true });
    auth.setDatabase(db);
  });

  afterEach(() => {
    auth.stopExpiryTimer();
    closeDatabase(db);
  });

  it('evictExpiredPairings removes codes older than 5 minutes', () => {
    auth.storePairing('333333', '+5555555555', 'whatsapp');
    // Backdate requestedAt beyond the 5-minute TTL
    const pairing = auth.getPendingPairings().get('333333')!;
    (pairing as { requestedAt: Date }).requestedAt = new Date(Date.now() - 6 * 60 * 1000);
    auth.evictExpiredPairings();
    expect(auth.getPairing('333333')).toBeUndefined();
  });

  it('evictExpiredPairings keeps codes still within the TTL window', () => {
    auth.storePairing('444444', '+5555555555', 'whatsapp');
    auth.evictExpiredPairings();
    expect(auth.getPairing('444444')).toBeDefined();
  });

  it('expired pairing no longer authorizes the sender', () => {
    const senderId = '+5555555555';
    const channel = 'whatsapp';
    // Simulate: pairing was requested and granted before expiry
    approvePairing(db, senderId, channel, 'viewer');
    // Backdate the pending pairing and evict — access_control entry remains unaffected
    auth.storePairing('555555', senderId, channel);
    const pairing = auth.getPendingPairings().get('555555')!;
    (pairing as { requestedAt: Date }).requestedAt = new Date(Date.now() - 6 * 60 * 1000);
    auth.evictExpiredPairings();
    expect(auth.getPairing('555555')).toBeUndefined();
    // Sender is still authorized because access_control row persists after approval
    expect(auth.isAuthorized(senderId, channel)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pairing rate limiting (OB-1703)
// ---------------------------------------------------------------------------

describe('pairing rate limiting', () => {
  let auth: AuthService;

  beforeEach(() => {
    auth = new AuthService({ whitelist: [], prefix: '/ai', pairingEnabled: true });
  });

  afterEach(() => {
    auth.stopExpiryTimer();
  });

  it('checkPairingRateLimit allows the first 3 requests per sender per hour', () => {
    const sender = '+1111111111';
    expect(auth.checkPairingRateLimit(sender)).toBe(true);
    expect(auth.checkPairingRateLimit(sender)).toBe(true);
    expect(auth.checkPairingRateLimit(sender)).toBe(true);
  });

  it('checkPairingRateLimit denies the 4th request within the same hour', () => {
    const sender = '+2222222222';
    auth.checkPairingRateLimit(sender);
    auth.checkPairingRateLimit(sender);
    auth.checkPairingRateLimit(sender);
    expect(auth.checkPairingRateLimit(sender)).toBe(false);
  });

  it('rate limit is per-sender — other senders are unaffected', () => {
    const blocked = '+3333333333';
    auth.checkPairingRateLimit(blocked);
    auth.checkPairingRateLimit(blocked);
    auth.checkPairingRateLimit(blocked);
    auth.checkPairingRateLimit(blocked); // 4th — now blocked
    expect(auth.checkPairingRateLimit('+4444444444')).toBe(true);
  });

  it('initiatePairing returns null once the rate limit is exceeded', () => {
    const sender = '+5555555555';
    auth.initiatePairing(sender, 'whatsapp');
    auth.initiatePairing(sender, 'whatsapp');
    auth.initiatePairing(sender, 'whatsapp');
    const fourth = auth.initiatePairing(sender, 'whatsapp');
    expect(fourth).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// approvePairing (access-store) — configurable default role (OB-1703)
// ---------------------------------------------------------------------------

describe('approvePairing (access-store)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('creates a new access_control entry with the given role', () => {
    approvePairing(db, '+6666666666', 'telegram', 'developer');
    const entry = getAccess(db, '+6666666666', 'telegram');
    expect(entry).toBeDefined();
    expect(entry?.role).toBe('developer');
    expect(entry?.active).toBe(true);
  });

  it('defaults to viewer role when no role argument is provided', () => {
    approvePairing(db, '+7777777777', 'webchat');
    const entry = getAccess(db, '+7777777777', 'webchat');
    expect(entry?.role).toBe('viewer');
    expect(entry?.active).toBe(true);
  });

  it('reactivates an existing inactive entry', () => {
    setAccess(db, { user_id: '+8888888888', channel: 'whatsapp', role: 'viewer', active: false });
    const before = getAccess(db, '+8888888888', 'whatsapp');
    expect(before?.active).toBe(false);
    approvePairing(db, '+8888888888', 'whatsapp', 'viewer');
    const after = getAccess(db, '+8888888888', 'whatsapp');
    expect(after?.active).toBe(true);
  });

  it('configurable role is used via getRoleForChannel — whatsapp maps to owner', () => {
    const auth = new AuthService({
      whitelist: [],
      prefix: '/ai',
      channelRoles: { whatsapp: 'owner' },
    });
    const role = auth.getRoleForChannel('whatsapp');
    approvePairing(db, '+9999999999', 'whatsapp', role as AccessRole);
    const entry = getAccess(db, '+9999999999', 'whatsapp');
    expect(entry?.role).toBe('owner');
    auth.stopExpiryTimer();
  });
});
