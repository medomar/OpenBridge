import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CredentialStore } from '../../src/integrations/credential-store.js';
import { closeDatabase, openDatabase } from '../../src/memory/database.js';

describe('CredentialStore', () => {
  let workspacePath: string;
  let store: CredentialStore;

  beforeEach(() => {
    workspacePath = join(
      tmpdir(),
      `ob-cred-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(workspacePath, '.openbridge'), { recursive: true });
    store = new CredentialStore(workspacePath);
  });

  afterEach(() => {
    try {
      rmSync(workspacePath, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('encrypt / decrypt round-trip', () => {
    it('encrypt then decrypt returns original data', () => {
      const data = { apiKey: 'sk-test-12345', secret: 'my-secret-value', nested: { a: 1 } };
      const encrypted = store.encryptCredential(data);
      const decrypted = store.decryptCredential(
        encrypted.encrypted,
        encrypted.iv,
        encrypted.authTag,
      );
      expect(decrypted).toEqual(data);
    });

    it('handles empty object', () => {
      const data = {};
      const encrypted = store.encryptCredential(data);
      const decrypted = store.decryptCredential(
        encrypted.encrypted,
        encrypted.iv,
        encrypted.authTag,
      );
      expect(decrypted).toEqual(data);
    });
  });

  describe('IV uniqueness', () => {
    it('different IVs produce different ciphertext', () => {
      const data = { apiKey: 'same-key' };
      const enc1 = store.encryptCredential(data);
      const enc2 = store.encryptCredential(data);

      // IVs should differ (random)
      expect(enc1.iv).not.toBe(enc2.iv);
      // Ciphertext should differ due to different IVs
      expect(enc1.encrypted).not.toBe(enc2.encrypted);

      // But both should decrypt to the same value
      const dec1 = store.decryptCredential(enc1.encrypted, enc1.iv, enc1.authTag);
      const dec2 = store.decryptCredential(enc2.encrypted, enc2.iv, enc2.authTag);
      expect(dec1).toEqual(dec2);
    });
  });

  describe('wrong key fails to decrypt', () => {
    it('throws when decrypting with a different key', () => {
      const data = { apiKey: 'sk-secret' };
      const encrypted = store.encryptCredential(data);

      // Create a second store with a different workspace (different key)
      const otherPath = join(
        tmpdir(),
        `ob-cred-test-other-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      mkdirSync(join(otherPath, '.openbridge'), { recursive: true });
      const otherStore = new CredentialStore(otherPath);

      // Force generate a different key
      otherStore.loadOrGenerateKey();

      expect(() => {
        otherStore.decryptCredential(encrypted.encrypted, encrypted.iv, encrypted.authTag);
      }).toThrow();

      try {
        rmSync(otherPath, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });
  });

  describe('secrets.key file', () => {
    it('creates secrets.key with correct permissions on first use', () => {
      const keyPath = store.getSecretsKeyPath();
      expect(existsSync(keyPath)).toBe(false);

      store.loadOrGenerateKey();

      expect(existsSync(keyPath)).toBe(true);

      // Key should be 32 bytes
      const keyData = readFileSync(keyPath);
      expect(keyData.length).toBe(32);

      // Check permissions (owner-only read/write = 0o600)
      if (process.platform !== 'win32') {
        const stats = statSync(keyPath);
        const mode = stats.mode & 0o777;
        expect(mode).toBe(0o600);
      }
    });

    it('reuses existing key on subsequent calls', () => {
      const key1 = store.loadOrGenerateKey();
      const key2 = store.loadOrGenerateKey();
      expect(key1.equals(key2)).toBe(true);
    });

    it('reuses key across store instances', () => {
      const key1 = store.loadOrGenerateKey();
      const store2 = new CredentialStore(workspacePath);
      const key2 = store2.loadOrGenerateKey();
      expect(key1.equals(key2)).toBe(true);
    });
  });

  describe('credentials table migration', () => {
    it('migration applies cleanly and supports CRUD operations', () => {
      const db = openDatabase(':memory:');

      try {
        // Verify the table exists
        const tableCheck = db
          .prepare(
            `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='integration_credentials'`,
          )
          .get() as { c: number };
        expect(tableCheck.c).toBe(1);

        // Store a credential
        store.storeCredential(db, 'test-integration', { apiKey: 'sk-123' });

        // Retrieve it
        const cred = store.getCredential(db, 'test-integration');
        expect(cred).toEqual({ apiKey: 'sk-123' });

        // Non-existent returns null
        expect(store.getCredential(db, 'nonexistent')).toBeNull();

        // Upsert overwrites
        store.storeCredential(db, 'test-integration', { apiKey: 'sk-456', extra: true });
        const updated = store.getCredential(db, 'test-integration');
        expect(updated).toEqual({ apiKey: 'sk-456', extra: true });

        // Delete
        expect(store.deleteCredential(db, 'test-integration')).toBe(true);
        expect(store.getCredential(db, 'test-integration')).toBeNull();
        expect(store.deleteCredential(db, 'test-integration')).toBe(false);

        // Health status update
        store.storeCredential(db, 'health-test', { key: 'val' });
        store.updateHealthStatus(db, 'health-test', 'healthy');
        const row = db
          .prepare('SELECT health_status FROM integration_credentials WHERE integration_name = ?')
          .get('health-test') as { health_status: string };
        expect(row.health_status).toBe('healthy');
      } finally {
        closeDatabase(db);
      }
    });
  });
});
