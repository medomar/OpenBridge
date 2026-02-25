import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { closeDatabase, openDatabase } from '../memory/database.js';
import { getAccess, listAccess, removeAccess, setAccess } from '../memory/access-store.js';
import type { AccessControlEntry, AccessRole } from '../memory/access-store.js';

const VALID_ROLES: AccessRole[] = ['owner', 'admin', 'developer', 'viewer', 'custom'];
const VALID_CHANNELS = ['whatsapp', 'telegram', 'discord', 'webchat', 'console'];

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

function formatTable(entries: AccessControlEntry[]): void {
  if (entries.length === 0) {
    console.log('  (no entries)');
    return;
  }

  const headers = ['User ID', 'Channel', 'Role', 'Active', 'Daily Cost', 'Max Cost/Day'];
  const rows = entries.map((e) => [
    e.user_id,
    e.channel,
    e.role,
    e.active !== false ? 'yes' : 'no',
    `$${(e.daily_cost_used ?? 0).toFixed(4)}`,
    e.max_cost_per_day_usd != null ? `$${e.max_cost_per_day_usd.toFixed(2)}` : '—',
  ]);

  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));

  const separator = widths.map((w) => '-'.repeat(w + 2)).join('+');
  const formatRow = (row: string[]): string =>
    row.map((cell, i) => ` ${cell.padEnd(widths[i] ?? 0)} `).join('|');

  console.log(`+${separator}+`);
  console.log(`|${formatRow(headers)}|`);
  console.log(`+${separator}+`);
  for (const row of rows) {
    console.log(`|${formatRow(row)}|`);
  }
  console.log(`+${separator}+`);
}

function printHelp(): void {
  console.log('Usage: openbridge access <subcommand> [options]');
  console.log('');
  console.log('Subcommands:');
  console.log('  add <user_id> --role <role> --channel <channel>  Add or update user access');
  console.log('  remove <user_id> --channel <channel>             Remove user access');
  console.log('  list                                              List all access entries');
  console.log('');
  console.log('Roles: owner, admin, developer, viewer, custom');
  console.log('Channels: whatsapp, telegram, discord, webchat, console');
}

export function runAccess(subArgs: string[]): void {
  const subcommand = subArgs[0];

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return;
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
    if (subcommand === 'list') {
      const entries = listAccess(db);
      formatTable(entries);
    } else if (subcommand === 'add') {
      const userId = subArgs[1];
      if (!userId) {
        throw new Error('Usage: openbridge access add <user_id> --role <role> --channel <channel>');
      }

      const flags = parseFlags(subArgs.slice(2));
      const role = flags['role'] as AccessRole | undefined;
      const channel = flags['channel'];

      if (!role) {
        throw new Error(`--role is required. Valid roles: ${VALID_ROLES.join(', ')}`);
      }
      if (!VALID_ROLES.includes(role)) {
        throw new Error(`Invalid role "${role}". Valid roles: ${VALID_ROLES.join(', ')}`);
      }
      if (!channel) {
        throw new Error(`--channel is required. Valid channels: ${VALID_CHANNELS.join(', ')}`);
      }
      if (!VALID_CHANNELS.includes(channel)) {
        throw new Error(
          `Invalid channel "${channel}". Valid channels: ${VALID_CHANNELS.join(', ')}`,
        );
      }

      const entry: AccessControlEntry = { user_id: userId, channel, role };
      setAccess(db, entry);
      console.log(`  Access set: ${userId} on ${channel} → ${role}`);
    } else if (subcommand === 'remove') {
      const userId = subArgs[1];
      if (!userId) {
        throw new Error('Usage: openbridge access remove <user_id> --channel <channel>');
      }

      const flags = parseFlags(subArgs.slice(2));
      const channel = flags['channel'];

      if (!channel) {
        throw new Error('--channel is required');
      }

      const existing = getAccess(db, userId, channel);
      if (!existing) {
        throw new Error(`No access entry found for "${userId}" on channel "${channel}"`);
      }

      removeAccess(db, userId, channel);
      console.log(`  Removed access: ${userId} on ${channel}`);
    } else {
      throw new Error(
        `Unknown subcommand "${subcommand}". Run "openbridge access --help" for usage.`,
      );
    }
  } finally {
    closeDatabase(db);
  }
}
