import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { closeDatabase, openDatabase } from '../memory/database.js';

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

function fmt(n: number): string {
  if (n >= 1_000_000) return `~${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `~${Math.round(n / 1_000)}K`;
  return `${n}`;
}

export function runStats(): void {
  const workspacePath = getWorkspacePath();
  const dbPath = join(workspacePath, '.openbridge', 'openbridge.db');

  if (!existsSync(dbPath)) {
    throw new Error(
      `Database not found at ${dbPath}. Start OpenBridge at least once to initialize it.`,
    );
  }

  const db = openDatabase(dbPath);

  try {
    const tableExists =
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='token_economics'`,
          )
          .get() as { c: number }
      ).c > 0;

    if (!tableExists) {
      console.log('Exploration Stats');
      console.log('');
      console.log('No data yet — stats are collected as the workspace is explored and queried.');
      return;
    }

    interface StatsRow {
      total_discovery: number;
      total_read: number;
      total_retrievals: number;
      chunks_tracked: number;
    }

    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(discovery_tokens), 0)  AS total_discovery,
           COALESCE(SUM(total_read_tokens), 0) AS total_read,
           COALESCE(SUM(retrieval_count), 0)   AS total_retrievals,
           COUNT(*)                             AS chunks_tracked
         FROM token_economics`,
      )
      .get() as StatsRow;

    const { total_discovery, total_read, total_retrievals, chunks_tracked } = row;

    console.log('Exploration Stats');
    console.log('');

    if (chunks_tracked === 0) {
      console.log('No data yet — stats are collected as the workspace is explored and queried.');
      return;
    }

    const roi = total_discovery > 0 ? (total_read / total_discovery).toFixed(1) : null;
    const roiStr = roi !== null ? ` (${roi}x ROI)` : '';

    console.log(
      `Explored with ${fmt(total_discovery)} tokens, saved ${fmt(total_read)} tokens across ${total_retrievals} retrieval${total_retrievals !== 1 ? 's' : ''}${roiStr}`,
    );
    console.log(`Chunks tracked: ${chunks_tracked}`);
  } finally {
    closeDatabase(db);
  }
}
