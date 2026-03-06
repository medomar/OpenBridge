import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { AppConfigSchema, V2ConfigSchema } from '../types/config.js';
import { getConfigDir } from './utils.js';

const require = createRequire(import.meta.url);

// Check registry interface — every check returns { pass, message }
export interface CheckResult {
  pass: boolean;
  message: string;
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
      message: `no AI tools found — install one of: ${AI_TOOLS.map((t) => t.name).join(', ')}`,
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
      message: `config.json not found (looked in: ${candidates.join(', ')}) — run: npx openbridge init`,
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
        pass: false,
        message: `not installed (optional — run: npm install ${pkg})`,
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
      pass: false,
      message: `not found — install from ${installUrl}`,
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
    pass: false,
    message: 'not installed — needed for PDF generation (run: npm install puppeteer)',
  };
}

// ---------------------------------------------------------------------------
// Check registry — add checks here; they run in order
// ---------------------------------------------------------------------------

const CHECKS: Check[] = [
  { label: 'Node.js', run: checkNodeVersion },
  { label: 'AI tools', run: checkAITools },
  { label: 'Config', run: checkConfig },
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
  console.log('OpenBridge Doctor — checking document generation prerequisites\n');

  let allPass = true;
  const failed: string[] = [];

  for (const check of CHECKS) {
    const result = check.run();
    const icon = result.pass ? '✓' : '✗';
    console.log(`  ${icon}  ${check.label.padEnd(16)} ${result.message}`);
    if (!result.pass) {
      allPass = false;
      failed.push(check.label);
    }
  }

  console.log('');

  if (allPass) {
    console.log('All prerequisites satisfied. Document generation is fully operational.');
  } else {
    console.log(
      `Missing: ${failed.join(', ')}. Document features that depend on these will be unavailable.`,
    );
    console.log('');
    console.log('Install optional npm packages:');
    console.log('  npm install docx pptxgenjs exceljs puppeteer');
    console.log('');
    console.log('Install LibreOffice (for DOCX/PPTX → PDF conversion):');
    console.log('  https://www.libreoffice.org/download/');
  }
}
