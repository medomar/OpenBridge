import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { closeDatabase, openDatabase } from '../memory/database.js';
import { approvePairing } from '../memory/access-store.js';
import type { AccessRole } from '../memory/access-store.js';

const PAIRING_CODE_RE = /^\d{6}$/;
const PAIRING_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getWorkspacePath(): string {
  const configPath = resolve('config.json');
  if (!existsSync(configPath)) {
    throw new Error(
      `config.json not found at ${configPath}. Run this command from your OpenBridge directory.`,
    );
  }
  const raw = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(raw) as { workspacePath?: string };
  if (!config.workspacePath) {
    throw new Error('workspacePath not found in config.json');
  }
  return config.workspacePath;
}

function printHelp(): void {
  console.log('Usage: openbridge pairing <subcommand> [options]');
  console.log('');
  console.log('Subcommands:');
  console.log('  approve <code> [--role <role>]  Approve a pending pairing code and grant access');
  console.log('');
  console.log('Options:');
  console.log('  --role <role>  Role to assign (default: viewer)');
  console.log('');
  console.log('Roles: owner, admin, developer, viewer, custom');
  console.log('');
  console.log('Example:');
  console.log('  openbridge pairing approve 123456');
  console.log('  openbridge pairing approve 123456 --role developer');
}

function parseFlags(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg?.startsWith('--') && i + 1 < args.length) {
      result[arg.slice(2)] = args[i + 1]!;
      i++;
    }
  }
  return result;
}

interface PendingPairingRow {
  code: string;
  sender_id: string;
  channel: string;
  requested_at: string;
  attempts: number;
}

export function runPairing(subArgs: string[]): void {
  const subcommand = subArgs[0];

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return;
  }

  if (subcommand !== 'approve') {
    throw new Error(
      `Unknown subcommand "${subcommand}". Run "openbridge pairing --help" for usage.`,
    );
  }

  const code = subArgs[1];
  if (!code) {
    throw new Error('Usage: openbridge pairing approve <code> [--role <role>]');
  }

  if (!PAIRING_CODE_RE.test(code)) {
    throw new Error(`Invalid pairing code "${code}". Expected a 6-digit number.`);
  }

  const flags = parseFlags(subArgs.slice(2));
  const role = (flags['role'] ?? 'viewer') as AccessRole;
  const validRoles: AccessRole[] = ['owner', 'admin', 'developer', 'viewer', 'custom'];
  if (!validRoles.includes(role)) {
    throw new Error(`Invalid role "${role}". Valid roles: ${validRoles.join(', ')}`);
  }

  const workspacePath = getWorkspacePath();
  const dbPath = join(workspacePath, '.openbridge', 'openbridge.db');

  if (!existsSync(dbPath)) {
    throw new Error(
      `Database not found at ${dbPath}. Start OpenBridge at least once to initialize it.`,
    );
  }

  const db = openDatabase(dbPath);

  try {
    const row = db.prepare('SELECT * FROM pending_pairings WHERE code = ?').get(code) as
      | PendingPairingRow
      | undefined;

    if (!row) {
      throw new Error(
        `Pairing code "${code}" not found. It may have expired or already been used.`,
      );
    }

    const requestedAt = new Date(row.requested_at).getTime();
    const now = Date.now();
    if (now - requestedAt > PAIRING_TTL_MS) {
      // Clean up expired code
      db.prepare('DELETE FROM pending_pairings WHERE code = ?').run(code);
      throw new Error(
        `Pairing code "${code}" has expired (codes are valid for 5 minutes). Ask the user to reconnect to receive a new code.`,
      );
    }

    approvePairing(db, row.sender_id, row.channel, role);

    db.prepare('DELETE FROM pending_pairings WHERE code = ?').run(code);

    console.log(`  Pairing approved: ${row.sender_id} on ${row.channel} → ${role}`);
    console.log(`  The user can now send messages to OpenBridge.`);
  } finally {
    closeDatabase(db);
  }
}
