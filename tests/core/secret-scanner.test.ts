import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { SecretScanner } from '../../src/core/secret-scanner.js';

describe('SecretScanner', () => {
  // ── .env detection ─────────────────────────────────────────────────────────

  it('detects .env files as high-severity', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ob-scan-'));
    try {
      await fs.writeFile(path.join(tmpDir, '.env'), 'DB_PASSWORD=hunter2');

      const scanner = new SecretScanner();
      const matches = await scanner.scanWorkspace(tmpDir);

      const envMatch = matches.find((m) => path.basename(m.path) === '.env');
      expect(envMatch).toBeDefined();
      expect(envMatch?.severity).toBe('high');
      expect(envMatch?.pattern).toBe('.env');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects .env.local variant', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ob-scan-'));
    try {
      await fs.writeFile(path.join(tmpDir, '.env.local'), 'SECRET=abc');

      const scanner = new SecretScanner();
      const matches = await scanner.scanWorkspace(tmpDir);

      const envMatch = matches.find((m) => path.basename(m.path) === '.env.local');
      expect(envMatch).toBeDefined();
      expect(envMatch?.severity).toBe('high');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ── *.pem detection ────────────────────────────────────────────────────────

  it('detects *.pem files as critical-severity', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ob-scan-'));
    try {
      await fs.writeFile(
        path.join(tmpDir, 'server.pem'),
        '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----',
      );

      const scanner = new SecretScanner();
      const matches = await scanner.scanWorkspace(tmpDir);

      const pemMatch = matches.find((m) => path.basename(m.path) === 'server.pem');
      expect(pemMatch).toBeDefined();
      expect(pemMatch?.severity).toBe('critical');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ── clean workspace ────────────────────────────────────────────────────────

  it('returns empty array for a workspace with no sensitive files', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ob-scan-'));
    try {
      await fs.writeFile(path.join(tmpDir, 'index.ts'), 'console.log("hello")');
      await fs.writeFile(path.join(tmpDir, 'README.md'), '# Project');

      const scanner = new SecretScanner();
      const matches = await scanner.scanWorkspace(tmpDir);

      expect(matches).toHaveLength(0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
