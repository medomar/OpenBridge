import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type Database from 'better-sqlite3';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 12 bytes for GCM
const KEY_LENGTH = 32; // 256 bits

/** Result of encrypting credential data. All values are hex-encoded. */
export interface EncryptedCredential {
  encrypted: string;
  iv: string;
  authTag: string;
}

/**
 * Manages AES-256-GCM encryption of integration credentials at rest.
 *
 * On first use, generates a 32-byte random key and writes it to
 * `.openbridge/secrets.key` with chmod 600. All credential data is
 * encrypted before storage and decrypted only on demand.
 */
export class CredentialStore {
  private key: Buffer | null = null;
  private readonly workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /** Returns the path to the secrets key file. */
  getSecretsKeyPath(): string {
    return join(this.workspacePath, '.openbridge', 'secrets.key');
  }

  /**
   * Loads the encryption key from disk, or generates a new one if it
   * does not exist. The key file is written with mode 0o600 (owner-only).
   */
  loadOrGenerateKey(): Buffer {
    if (this.key) return this.key;

    const keyPath = this.getSecretsKeyPath();

    if (existsSync(keyPath)) {
      this.key = readFileSync(keyPath);
      if (this.key.length !== KEY_LENGTH) {
        throw new Error(
          `Invalid secrets.key length: expected ${KEY_LENGTH}, got ${this.key.length}`,
        );
      }
      return this.key;
    }

    // Generate new key
    mkdirSync(dirname(keyPath), { recursive: true });
    const newKey = randomBytes(KEY_LENGTH);
    writeFileSync(keyPath, newKey, { mode: 0o600 });

    // Ensure permissions even if the file existed with different mode
    try {
      chmodSync(keyPath, 0o600);
    } catch {
      // chmod may fail on Windows — non-fatal
    }

    this.key = newKey;
    return this.key;
  }

  /**
   * Encrypts a credential data object using AES-256-GCM.
   * Returns hex-encoded ciphertext, IV, and auth tag.
   */
  encryptCredential(data: Record<string, unknown>): EncryptedCredential {
    const key = this.loadOrGenerateKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const plaintext = JSON.stringify(data);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: cipher.getAuthTag().toString('hex'),
    };
  }

  /**
   * Decrypts a credential using AES-256-GCM.
   * All inputs are hex-encoded strings.
   */
  decryptCredential(encrypted: string, iv: string, authTag: string): Record<string, unknown> {
    const key = this.loadOrGenerateKey();
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted) as Record<string, unknown>;
  }

  // ── SQLite credential CRUD ──────────────────────────────────────

  /** Store an encrypted credential for an integration. Upserts by integration name. */
  storeCredential(
    db: Database.Database,
    integrationName: string,
    data: Record<string, unknown>,
  ): void {
    const { encrypted, iv, authTag } = this.encryptCredential(data);
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO integration_credentials (integration_name, encrypted, iv, auth_tag, health_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'unknown', ?, ?)
       ON CONFLICT(integration_name) DO UPDATE SET
         encrypted = excluded.encrypted,
         iv = excluded.iv,
         auth_tag = excluded.auth_tag,
         updated_at = excluded.updated_at`,
    ).run(integrationName, encrypted, iv, authTag, now, now);
  }

  /** Retrieve and decrypt a credential for an integration. Returns null if not found. */
  getCredential(db: Database.Database, integrationName: string): Record<string, unknown> | null {
    const row = db
      .prepare(
        'SELECT encrypted, iv, auth_tag FROM integration_credentials WHERE integration_name = ?',
      )
      .get(integrationName) as { encrypted: string; iv: string; auth_tag: string } | undefined;

    if (!row) return null;

    return this.decryptCredential(row.encrypted, row.iv, row.auth_tag);
  }

  /** Delete a credential for an integration. */
  deleteCredential(db: Database.Database, integrationName: string): boolean {
    const result = db
      .prepare('DELETE FROM integration_credentials WHERE integration_name = ?')
      .run(integrationName);
    return result.changes > 0;
  }

  /** Update the health status for a credential record. */
  updateHealthStatus(db: Database.Database, integrationName: string, healthStatus: string): void {
    const now = new Date().toISOString();
    db.prepare(
      'UPDATE integration_credentials SET health_status = ?, updated_at = ? WHERE integration_name = ?',
    ).run(healthStatus, now, integrationName);
  }
}
