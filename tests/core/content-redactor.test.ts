import { describe, it, expect } from 'vitest';
import { ContentRedactor } from '../../src/core/content-redactor.js';

describe('ContentRedactor', () => {
  // ── disabled by default ────────────────────────────────────────────────────

  it('returns content unchanged when disabled (default)', () => {
    const redactor = new ContentRedactor();
    const content = 'sk-secret123456789012345678901234';
    const { redacted, redactionCount } = redactor.redact(content);
    expect(redacted).toBe(content);
    expect(redactionCount).toBe(0);
  });

  // ── OpenAI key redaction ───────────────────────────────────────────────────

  it('replaces OpenAI API key with REDACTED:openai_key token', () => {
    const redactor = new ContentRedactor({ enabled: true });
    // sk- followed by 20+ base64url chars
    const key = 'sk-abcdefghijklmnopqrstuvwxyz01234';
    const content = `Use key ${key} to access the API`;
    const { redacted, redactionCount } = redactor.redact(content);
    expect(redacted).not.toContain(key);
    expect(redacted).toContain('REDACTED:openai_key');
    expect(redactionCount).toBe(1);
  });

  // ── AWS key redaction ──────────────────────────────────────────────────────

  it('replaces AWS access key ID with REDACTED:aws_key token', () => {
    const redactor = new ContentRedactor({ enabled: true });
    const awsKey = 'AKIAIOSFODNN7EXAMPLE'; // 20 chars: AKIA + 16 uppercase alphanumeric
    const content = `AWS Key: ${awsKey}`;
    const { redacted, redactionCount } = redactor.redact(content);
    expect(redacted).not.toContain(awsKey);
    expect(redacted).toContain('REDACTED:aws_key');
    expect(redactionCount).toBe(1);
  });

  // ── GitHub PAT redaction ──────────────────────────────────────────────────

  it('replaces GitHub PAT with REDACTED:github_pat token', () => {
    const redactor = new ContentRedactor({ enabled: true });
    const pat = 'ghp_' + 'A'.repeat(36);
    const content = `Authorization: token ${pat}`;
    const { redacted, redactionCount } = redactor.redact(content);
    expect(redacted).not.toContain(pat);
    expect(redacted).toContain('REDACTED:github_pat');
    expect(redactionCount).toBe(1);
  });

  // ── multiple matches ──────────────────────────────────────────────────────

  it('counts multiple replacements across a single pattern', () => {
    const redactor = new ContentRedactor({ enabled: true });
    const key1 = 'sk-aaaa1234567890abcdefghijklmnopq';
    const key2 = 'sk-bbbb1234567890abcdefghijklmnopq';
    const content = `key1=${key1}&key2=${key2}`;
    const { redactionCount } = redactor.redact(content);
    expect(redactionCount).toBe(2);
  });

  // ── PEM private key redaction ─────────────────────────────────────────────

  it('replaces PEM private key block with REDACTED:pem_private_key token', () => {
    const redactor = new ContentRedactor({ enabled: true });
    const pemBlock = '-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBg==\n-----END PRIVATE KEY-----';
    const content = `Key material:\n${pemBlock}\nEnd of file`;
    const { redacted, redactionCount } = redactor.redact(content);
    expect(redacted).not.toContain('MIIEvAIBADANBg==');
    expect(redacted).toContain('REDACTED:pem_private_key');
    expect(redactionCount).toBe(1);
  });

  // ── connection string redaction ───────────────────────────────────────────

  it('replaces MongoDB connection string with REDACTED:mongodb_connection_string token', () => {
    const redactor = new ContentRedactor({ enabled: true });
    const connStr = 'mongodb://user:pass@host:27017/mydb';
    const content = `DB_URL=${connStr}`;
    const { redacted, redactionCount } = redactor.redact(content);
    expect(redacted).not.toContain('user:pass');
    expect(redacted).toContain('REDACTED:mongodb_connection_string');
    expect(redactionCount).toBe(1);
  });
});
