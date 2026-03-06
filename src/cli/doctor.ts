import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { AppConfigSchema, V2ConfigSchema } from '../types/config.js';
import { getConfigDir } from './utils.js';

const require = createRequire(import.meta.url);

// ANSI color helpers
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

function c(text: string, color: string): string {
  if (!process.stdout.isTTY) return text;
  return `${color}${text}${RESET}`;
}

// Check registry interface — every check returns { pass, message }
export interface CheckResult {
  pass: boolean | 'warn';
  message: string;
  /** Actionable fix displayed below a failing/warning line */
  fixHint?: string;
}

export type CheckFn = () => CheckResult;

export interface Check {
  label: string;
  run: CheckFn;
}

// ---------------------------------------------------------------------------
// System checks
// ---------------------------------------------------------------------------

function checkNodeVersion(): CheckResult {
  const raw = process.version; // e.g. "v22.1.0"
  const major = parseInt(raw.replace(/^v/, '').split('.')[0] ?? '0', 10);
  if (major >= 22) {
    return { pass: true, message: `${raw} (>= 22 required)` };
  }
  return {
    pass: false,
    message: `${raw} — Node.js >= 22 required (current major: ${major})`,
  };
}

// ---------------------------------------------------------------------------
// AI tools check (OB-1686)
// ---------------------------------------------------------------------------

const AI_TOOLS: Array<{ name: string; versionFlag: string }> = [
  { name: 'claude', versionFlag: '--version' },
  { name: 'codex', versionFlag: '--version' },
  { name: 'aider', versionFlag: '--version' },
];

function checkAITools(): CheckResult {
  const found: string[] = [];
  const missing: string[] = [];

  for (const tool of AI_TOOLS) {
    try {
      execSync(`which ${tool.name}`, { stdio: 'pipe' });
      // Tool exists — try to get version output
      let version = 'found';
      try {
        const raw = execSync(`${tool.name} ${tool.versionFlag} 2>&1`, {
          stdio: 'pipe',
          timeout: 5000,
        })
          .toString()
          .trim()
          .split('\n')[0];
        if (raw) version = raw;
      } catch {
        // version flag may not work — tool is still present
      }
      found.push(`${tool.name} (${version})`);
    } catch {
      missing.push(tool.name);
    }
  }

  if (found.length === 0) {
    return {
      pass: false,
      message: `no AI tools found`,
      fixHint: `install one of: ${AI_TOOLS.map((t) => t.name).join(', ')}`,
    };
  }

  const msg = found.join(', ') + (missing.length > 0 ? ` | not found: ${missing.join(', ')}` : '');
  return { pass: true, message: msg };
}

// ---------------------------------------------------------------------------
// Config file check (OB-1687)
// ---------------------------------------------------------------------------

function checkConfig(): CheckResult {
  // Locate config.json — check config dir first, then cwd fallback
  const configDir = getConfigDir();
  const candidates = [join(configDir, 'config.json'), join(process.cwd(), 'config.json')];
  const configPath = candidates.find((p) => existsSync(p));

  if (!configPath) {
    return {
      pass: false,
      message: `config.json not found (looked in: ${candidates.join(', ')})`,
      fixHint: 'run: npx openbridge init',
    };
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (err) {
    return {
      pass: false,
      message: `config.json unreadable: ${(err as Error).message}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      pass: false,
      message: `config.json is not valid JSON: ${(err as Error).message}`,
    };
  }

  // Detect V2 vs V0 by presence of workspacePath
  const isV2 = typeof parsed === 'object' && parsed !== null && 'workspacePath' in parsed;

  const schema = isV2 ? V2ConfigSchema : AppConfigSchema;
  const result = schema.safeParse(parsed);

  if (result.success) {
    return { pass: true, message: `${configPath} — valid ${isV2 ? 'V2' : 'V0'} config` };
  }

  // Format per-field errors from ZodError
  const errors = result.error.errors.map((e) => {
    const path = e.path.length > 0 ? e.path.join('.') : '(root)';
    return `${path}: ${e.message}`;
  });
  return {
    pass: false,
    message: `${configPath} — validation failed:\n    ${errors.join('\n    ')}`,
  };
}

// ---------------------------------------------------------------------------
// SQLite database health check (OB-1688)
// ---------------------------------------------------------------------------

const TRACKED_TABLES = [
  'schema_versions',
  'context_chunks',
  'conversations',
  'tasks',
  'learnings',
  'agent_activity',
  'prompts',
  'observations',
] as const;

function findDbPath(): string | null {
  // Try to resolve workspacePath from config.json first
  const configDir = getConfigDir();
  const candidates = [join(configDir, 'config.json'), join(process.cwd(), 'config.json')];
  const configPath = candidates.find((p) => existsSync(p));

  if (configPath) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'workspacePath' in parsed &&
        typeof (parsed as Record<string, unknown>)['workspacePath'] === 'string'
      ) {
        const wsPath = (parsed as Record<string, unknown>)['workspacePath'] as string;
        const wsDbPath = join(wsPath, '.openbridge', 'openbridge.db');
        if (existsSync(wsDbPath)) return wsDbPath;
      }
    } catch {
      // ignore — fall through to default
    }
  }

  // Fall back to default location alongside config
  const defaultPath = join(getConfigDir(), 'openbridge.db');
  if (existsSync(defaultPath)) return defaultPath;

  return null;
}

function checkSQLiteDatabase(): CheckResult {
  const dbPath = findDbPath();

  if (!dbPath) {
    return {
      pass: true,
      message: 'no database found (not yet initialised — will be created on first run)',
    };
  }

  let BetterSQLite: (
    path: string,
    opts?: object,
  ) => {
    pragma: (sql: string) => unknown;
    prepare: (sql: string) => { all: () => unknown[]; get: () => unknown };
  };
  try {
    BetterSQLite = require('better-sqlite3') as typeof BetterSQLite;
  } catch {
    return {
      pass: false,
      message: 'better-sqlite3 not available',
      fixHint: 'run: npm install better-sqlite3',
    };
  }

  let db: ReturnType<typeof BetterSQLite>;
  try {
    db = BetterSQLite(dbPath, { readonly: true });
  } catch (err) {
    return {
      pass: false,
      message: `cannot open database at ${dbPath}: ${(err as Error).message}`,
    };
  }

  try {
    // Integrity check
    const integrityRows = db.prepare('PRAGMA integrity_check').all() as Array<{
      integrity_check: string;
    }>;
    const integrityOk = integrityRows.length === 1 && integrityRows[0]?.integrity_check === 'ok';

    if (!integrityOk) {
      const issues = integrityRows.map((r) => r.integrity_check).join(', ');
      return {
        pass: false,
        message: `integrity_check FAILED at ${dbPath}: ${issues}`,
      };
    }

    // Schema version
    let schemaVersion = 0;
    try {
      const vRow = db.prepare('SELECT MAX(version) as v FROM schema_versions').get() as
        | { v: number | null }
        | undefined;
      schemaVersion = vRow?.v ?? 0;
    } catch {
      // schema_versions table may not exist yet in very early DBs
    }

    // Row counts for key tables
    const counts: string[] = [];
    for (const table of TRACKED_TABLES) {
      try {
        const row = db.prepare(`SELECT COUNT(*) as n FROM "${table}"`).get() as
          | { n: number }
          | undefined;
        counts.push(`${table}:${row?.n ?? 0}`);
      } catch {
        // table may not exist in older schema versions
      }
    }

    const summary = counts.join(' | ');
    return {
      pass: true,
      message: `${dbPath} — schema v${schemaVersion} — ${summary}`,
    };
  } finally {
    (db as unknown as { close: () => void }).close();
  }
}

// ---------------------------------------------------------------------------
// .openbridge/ state check (OB-1689)
// ---------------------------------------------------------------------------

function getWorkspacePath(): string | null {
  const configDir = getConfigDir();
  const candidates = [join(configDir, 'config.json'), join(process.cwd(), 'config.json')];
  const configPath = candidates.find((p) => existsSync(p));
  if (!configPath) return null;
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'workspacePath' in parsed &&
      typeof (parsed as Record<string, unknown>)['workspacePath'] === 'string'
    ) {
      return (parsed as Record<string, unknown>)['workspacePath'] as string;
    }
  } catch {
    // ignore
  }
  return null;
}

const JSON_FILES_IN_OPENBRIDGE = [
  'workspace-map.json',
  'agents.json',
  'exploration/exploration-state.json',
  'exploration/structure-scan.json',
  'exploration/classification.json',
];

function checkOpenBridgeState(): CheckResult {
  const wsPath = getWorkspacePath();

  if (!wsPath) {
    return {
      pass: true,
      message: '.openbridge/ check skipped (no workspacePath in config)',
    };
  }

  const openbridgeDir = join(wsPath, '.openbridge');
  if (!existsSync(openbridgeDir)) {
    return {
      pass: true,
      message: `${openbridgeDir} not found (will be created on first run)`,
    };
  }

  const issues: string[] = [];
  const info: string[] = [];

  // Check memory.md freshness
  const memoryPath = join(openbridgeDir, 'context', 'memory.md');
  let memoryStale = false;
  if (existsSync(memoryPath)) {
    try {
      const ageMs = Date.now() - statSync(memoryPath).mtimeMs;
      const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
      if (ageHours >= 72) {
        memoryStale = true;
        info.push(`memory.md stale (${ageHours}h ago)`);
      } else {
        info.push(`memory.md fresh (${ageHours}h ago)`);
      }
    } catch {
      issues.push('memory.md unreadable');
    }
  } else {
    info.push('memory.md not yet created');
  }

  // Check workspace-map.json existence
  const wsMapPath = join(openbridgeDir, 'workspace-map.json');
  if (existsSync(wsMapPath)) {
    info.push('workspace-map.json present');
  } else {
    info.push('workspace-map.json not yet created');
  }

  // Check for corrupted JSON files
  for (const relPath of JSON_FILES_IN_OPENBRIDGE) {
    const fullPath = join(openbridgeDir, relPath);
    if (existsSync(fullPath)) {
      try {
        JSON.parse(readFileSync(fullPath, 'utf-8'));
      } catch {
        issues.push(`${relPath} corrupted (invalid JSON)`);
      }
    }
  }

  if (issues.length > 0) {
    return {
      pass: false,
      message: `${openbridgeDir} — ${issues.join('; ')} | ${info.join(', ')}`,
      fixHint: 'delete corrupted files and restart OpenBridge to regenerate them',
    };
  }

  if (memoryStale) {
    return {
      pass: 'warn',
      message: `${openbridgeDir} — ${info.join(', ')}`,
      fixHint: 'send a message to trigger a session and refresh memory.md',
    };
  }

  return {
    pass: true,
    message: `${openbridgeDir} — ${info.join(', ')}`,
  };
}

// ---------------------------------------------------------------------------
// Channel prerequisites check (OB-1690)
// ---------------------------------------------------------------------------

function isPortAvailable(port: number): boolean {
  try {
    execSync(`lsof -i :${port} -t 2>/dev/null`, { stdio: 'pipe', timeout: 3000 });
    // lsof exited 0 — process found using the port → not available
    return false;
  } catch {
    // lsof exited non-zero (no matches = available) or lsof not installed → assume available
    return true;
  }
}

function checkChannelPrerequisites(): CheckResult {
  const configDir = getConfigDir();
  const candidates = [join(configDir, 'config.json'), join(process.cwd(), 'config.json')];
  const configPath = candidates.find((p) => existsSync(p));

  if (!configPath) {
    return { pass: true, message: 'skipped (no config.json found)' };
  }

  let parsed: unknown;
  try {
    const raw = readFileSync(configPath, 'utf-8');
    parsed = JSON.parse(raw);
  } catch {
    return { pass: true, message: 'skipped (config.json unreadable)' };
  }

  if (typeof parsed !== 'object' || parsed === null || !('channels' in parsed)) {
    return { pass: true, message: 'skipped (V0 config — no channels array)' };
  }

  const channels = (parsed as Record<string, unknown>)['channels'];
  if (!Array.isArray(channels) || channels.length === 0) {
    return { pass: true, message: 'no channels configured' };
  }

  const issues: string[] = [];
  const hints: string[] = [];
  const info: string[] = [];

  for (const ch of channels) {
    if (typeof ch !== 'object' || ch === null) continue;
    const channel = ch as Record<string, unknown>;
    const type = typeof channel['type'] === 'string' ? channel['type'] : '';
    if (channel['enabled'] === false) continue;

    const options =
      typeof channel['options'] === 'object' && channel['options'] !== null
        ? (channel['options'] as Record<string, unknown>)
        : {};

    if (type === 'whatsapp') {
      const sessionName =
        typeof options['sessionName'] === 'string' ? options['sessionName'] : 'openbridge-default';
      const sessionPath =
        typeof options['sessionPath'] === 'string' ? options['sessionPath'] : '.wwebjs_auth';
      const sessionDir = join(sessionPath, `session-${sessionName}`);
      if (existsSync(sessionDir)) {
        info.push(`whatsapp: session found (${sessionDir})`);
      } else {
        info.push(`whatsapp: no session yet — scan QR code on first run`);
      }
    } else if (type === 'telegram') {
      const token = options['token'];
      if (typeof token === 'string' && token.length > 0) {
        info.push('telegram: token configured');
      } else {
        issues.push('telegram: BOT_TOKEN missing');
        hints.push('telegram: add token to channels[].options.token in config.json');
      }
    } else if (type === 'discord') {
      const token = options['token'];
      if (typeof token === 'string' && token.length > 0) {
        info.push('discord: token configured');
      } else {
        issues.push('discord: BOT_TOKEN missing');
        hints.push('discord: add token to channels[].options.token in config.json');
      }
    } else if (type === 'webchat') {
      const port = typeof options['port'] === 'number' ? options['port'] : 3000;
      if (isPortAvailable(port)) {
        info.push(`webchat: port ${port} available`);
      } else {
        issues.push(`webchat: port ${port} already in use`);
        hints.push(`webchat: stop the conflicting process or change options.port to a free port`);
      }
    }
  }

  if (issues.length > 0) {
    return {
      pass: false,
      message: issues.join('; ') + (info.length > 0 ? ` | ${info.join(', ')}` : ''),
      fixHint: hints.join(' | '),
    };
  }

  if (info.length === 0) {
    return { pass: true, message: 'no recognized channels to check' };
  }

  return { pass: true, message: info.join(', ') };
}

// ---------------------------------------------------------------------------
// Document generation prerequisite checks (Phase 99)
// ---------------------------------------------------------------------------

function checkNpmPackage(pkg: string): CheckResult {
  try {
    require.resolve(pkg);
    return { pass: true, message: 'installed' };
  } catch {
    try {
      require.resolve(pkg, { paths: [process.cwd()] });
      return { pass: true, message: 'installed' };
    } catch {
      return {
        pass: 'warn',
        message: `not installed (optional)`,
        fixHint: `npm install ${pkg}`,
      };
    }
  }
}

function checkBinary(binary: string, installUrl: string): CheckResult {
  try {
    execSync(`which ${binary}`, { stdio: 'pipe' });
    return { pass: true, message: `found (${binary})` };
  } catch {
    return {
      pass: 'warn',
      message: `not found (optional)`,
      fixHint: `install from ${installUrl}`,
    };
  }
}

function checkPuppeteer(): CheckResult {
  for (const pkg of ['puppeteer', 'puppeteer-core']) {
    try {
      require.resolve(pkg);
      return { pass: true, message: `installed (${pkg})` };
    } catch {
      try {
        require.resolve(pkg, { paths: [process.cwd()] });
        return { pass: true, message: `installed (${pkg})` };
      } catch {
        // continue to next
      }
    }
  }
  return {
    pass: 'warn',
    message: 'not installed (optional — needed for PDF generation)',
    fixHint: 'npm install puppeteer',
  };
}

// ---------------------------------------------------------------------------
// Check registry — add checks here; they run in order
// ---------------------------------------------------------------------------

export const CHECKS: Check[] = [
  { label: 'Node.js', run: checkNodeVersion },
  { label: 'AI tools', run: checkAITools },
  { label: 'Config', run: checkConfig },
  { label: 'SQLite DB', run: checkSQLiteDatabase },
  { label: '.openbridge/', run: checkOpenBridgeState },
  { label: 'Channels', run: checkChannelPrerequisites },
  { label: 'docx', run: () => checkNpmPackage('docx') },
  { label: 'pptxgenjs', run: () => checkNpmPackage('pptxgenjs') },
  { label: 'exceljs', run: () => checkNpmPackage('exceljs') },
  { label: 'Puppeteer', run: checkPuppeteer },
  {
    label: 'LibreOffice',
    run: () => checkBinary('soffice', 'https://www.libreoffice.org/download/'),
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export function runDoctor(): void {
  console.log('OpenBridge Doctor\n');

  let hasFail = false;
  const failed: string[] = [];
  const warned: string[] = [];

  for (const check of CHECKS) {
    const result = check.run();
    let icon: string;

    if (result.pass === true) {
      icon = c('✓', GREEN);
    } else if (result.pass === 'warn') {
      icon = c('⚠', YELLOW);
      warned.push(check.label);
    } else {
      icon = c('✗', RED);
      hasFail = true;
      failed.push(check.label);
    }

    console.log(`  ${icon}  ${check.label.padEnd(16)} ${result.message}`);

    if (result.pass !== true && result.fixHint) {
      console.log(`     ${c('→', DIM)} ${result.fixHint}`);
    }
  }

  console.log('');

  if (!hasFail && warned.length === 0) {
    console.log(c('All checks passed.', GREEN));
  } else if (!hasFail) {
    console.log(
      c(
        `Warnings: ${warned.join(', ')}. These are non-critical but may affect some features.`,
        YELLOW,
      ),
    );
  } else {
    console.log(c(`Failed: ${failed.join(', ')}.`, RED));
    if (warned.length > 0) {
      console.log(c(`Warnings: ${warned.join(', ')}.`, YELLOW));
    }
  }
}
