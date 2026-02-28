import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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
