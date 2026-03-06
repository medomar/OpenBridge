import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

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
