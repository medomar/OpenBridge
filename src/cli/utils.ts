import { execFile, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** @deprecated SDK-only mode — always returns false */
export function isPackagedMode(): boolean {
  return false;
}

/** @deprecated SDK-only mode — always returns process.cwd() */
export function getConfigDir(): string {
  return process.cwd();
}

export function detectOS(): 'macos' | 'windows' | 'linux' {
  switch (process.platform) {
    case 'darwin':
      return 'macos';
    case 'win32':
      return 'windows';
    default:
      return 'linux';
  }
}

export async function isCommandAvailable(cmd: string): Promise<boolean> {
  try {
    if (detectOS() === 'windows') {
      await execFileAsync('where.exe', [cmd]);
    } else {
      await execFileAsync('which', [cmd]);
    }
    return true;
  } catch {
    return false;
  }
}

export function getNodeVersion(): string {
  return process.version;
}

export function meetsNodeVersion(min: string): boolean {
  const parse = (v: string): [number, number, number] => {
    const cleaned = v.replace(/^v/, '');
    const parts = cleaned.split('.').map(Number);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };

  const [curMajor, curMinor, curPatch] = parse(process.version);
  const [minMajor, minMinor, minPatch] = parse(min);

  if (curMajor !== minMajor) return curMajor > minMajor;
  if (curMinor !== minMinor) return curMinor > minMinor;
  return curPatch >= minPatch;
}

export function runCommand(
  cmd: string,
  args: string[],
  timeoutMs = 120_000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args);
    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];
    let settled = false;

    const done = (exitCode: number, stdout: string, stderr: string): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode, stdout, stderr });
      }
    };

    const timer = setTimeout(() => {
      child.kill();
      done(1, stdoutParts.join(''), 'Command timed out');
    }, timeoutMs);

    child.stdout?.on('data', (data: Buffer) => stdoutParts.push(data.toString()));
    child.stderr?.on('data', (data: Buffer) => stderrParts.push(data.toString()));

    child.on('close', (code) => {
      done(code ?? 1, stdoutParts.join(''), stderrParts.join(''));
    });

    child.on('error', (err: Error) => {
      done(1, stdoutParts.join(''), err.message);
    });
  });
}

export function printStep(stepNum: number, total: number, title: string): void {
  process.stdout.write(`\x1b[1m[${stepNum}/${total}]\x1b[0m ${title}\n`);
}

export function printSuccess(msg: string): void {
  process.stdout.write(`\x1b[32m✔\x1b[0m ${msg}\n`);
}

export function printWarning(msg: string): void {
  process.stdout.write(`\x1b[33m⚠\x1b[0m ${msg}\n`);
}

export function printError(msg: string): void {
  process.stdout.write(`\x1b[31m✖\x1b[0m ${msg}\n`);
}

export function writeEnvFile(envPath: string, vars: Record<string, string>): void {
  let existingContent = '';
  try {
    existingContent = readFileSync(envPath, 'utf8');
  } catch {
    // File doesn't exist — will be created
  }

  // Parse existing keys to avoid overwriting them
  const existingKeys = new Set<string>();
  for (const line of existingContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        existingKeys.add(trimmed.slice(0, eqIdx).trim());
      }
    }
  }

  // Collect new vars that aren't already present
  const newLines: string[] = [];
  for (const [key, value] of Object.entries(vars)) {
    if (!existingKeys.has(key)) {
      newLines.push(`${key}=${value}`);
    }
  }

  if (newLines.length === 0) {
    return; // Nothing new to write
  }

  // Append new vars, ensuring the file ends with a newline before them
  let content = existingContent;
  if (content && !content.endsWith('\n')) {
    content += '\n';
  }
  content += newLines.join('\n') + '\n';

  writeFileSync(envPath, content, 'utf8');
}

export interface UpdateInfo {
  available: boolean;
  latest: string;
  current: string;
  downloadUrl: string;
}

function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string): [number, number, number] => {
    const parts = v.replace(/^v/, '').split('.').map(Number);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const [lMaj, lMin, lPatch] = parse(latest);
  const [cMaj, cMin, cPatch] = parse(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPatch > cPatch;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(thisDir, '../../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      version: string;
      repository?: { url?: string };
    };
    const current = pkg.version;

    const repoUrl = pkg.repository?.url ?? '';
    const repoMatch = repoUrl.match(/github\.com[/:]([\w-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (!repoMatch) return null;
    const [, owner, repo] = repoMatch;

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    const response = await fetch(apiUrl, {
      headers: { 'User-Agent': 'OpenBridge-UpdateCheck/1.0' },
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      tag_name?: string;
      html_url?: string;
    };
    const tagName = data.tag_name;
    if (!tagName) return null;

    const latest = tagName.replace(/^v/, '');
    const downloadUrl = data.html_url ?? `https://github.com/${owner}/${repo}/releases/latest`;

    return { available: isNewerVersion(latest, current), latest, current, downloadUrl };
  } catch {
    return null;
  }
}

export async function validateApiKey(
  provider: 'anthropic' | 'openai',
  key: string,
): Promise<boolean> {
  const label = provider === 'anthropic' ? 'Anthropic' : 'OpenAI';
  try {
    let response: Response;

    if (provider === 'anthropic') {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } else {
      response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
        },
        signal: AbortSignal.timeout(10_000),
      });
    }

    if (response.status === 401) {
      printWarning(`${label} API key appears invalid (401 Unauthorized)`);
      return false;
    }

    if (response.ok) {
      printSuccess(`${label} API key validated successfully`);
      return true;
    }

    printWarning(
      `${label} API key validation returned unexpected status ${response.status} — continuing anyway`,
    );
    return false;
  } catch {
    printWarning(`Could not reach ${label} API for key validation — continuing anyway`);
    return false;
  }
}
