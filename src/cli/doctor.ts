import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

function checkNpmPackage(pkg: string): CheckResult {
  try {
    require.resolve(pkg);
    return { name: pkg, ok: true, detail: 'installed' };
  } catch {
    try {
      // Try resolving from the project root
      require.resolve(pkg, { paths: [process.cwd()] });
      return { name: pkg, ok: true, detail: 'installed' };
    } catch {
      return {
        name: pkg,
        ok: false,
        detail: 'not installed (optional — run: npm install ' + pkg + ')',
      };
    }
  }
}

function checkBinary(binary: string, displayName: string): CheckResult {
  try {
    execSync(`which ${binary}`, { stdio: 'pipe' });
    return { name: displayName, ok: true, detail: `found (${binary})` };
  } catch {
    return {
      name: displayName,
      ok: false,
      detail: `not found — install from https://www.libreoffice.org/download/`,
    };
  }
}

function checkPuppeteer(): CheckResult {
  // Puppeteer can ship as 'puppeteer' or 'puppeteer-core'
  for (const pkg of ['puppeteer', 'puppeteer-core']) {
    try {
      require.resolve(pkg);
      return { name: 'Puppeteer', ok: true, detail: `installed (${pkg})` };
    } catch {
      try {
        require.resolve(pkg, { paths: [process.cwd()] });
        return { name: 'Puppeteer', ok: true, detail: `installed (${pkg})` };
      } catch {
        // continue to next
      }
    }
  }
  return {
    name: 'Puppeteer',
    ok: false,
    detail: 'not installed — needed for PDF generation (run: npm install puppeteer)',
  };
}

export function runDoctor(): void {
  console.log('OpenBridge Doctor — checking document generation prerequisites\n');

  const checks: CheckResult[] = [
    checkNpmPackage('docx'),
    checkNpmPackage('pptxgenjs'),
    checkNpmPackage('exceljs'),
    checkPuppeteer(),
    checkBinary('soffice', 'LibreOffice'),
  ];

  let allOk = true;
  for (const check of checks) {
    const icon = check.ok ? '✓' : '✗';
    console.log(`  ${icon}  ${check.name.padEnd(16)} ${check.detail}`);
    if (!check.ok) allOk = false;
  }

  console.log('');

  if (allOk) {
    console.log('All prerequisites satisfied. Document generation is fully operational.');
  } else {
    const missing = checks.filter((c) => !c.ok).map((c) => c.name);
    console.log(
      `Missing: ${missing.join(', ')}. Document features that depend on these will be unavailable.`,
    );
    console.log('');
    console.log('Install optional npm packages:');
    console.log('  npm install docx pptxgenjs exceljs puppeteer');
    console.log('');
    console.log('Install LibreOffice (for DOCX/PPTX → PDF conversion):');
    console.log('  https://www.libreoffice.org/download/');
  }
}
