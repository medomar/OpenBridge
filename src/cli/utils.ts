import { execFile } from 'node:child_process';
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
