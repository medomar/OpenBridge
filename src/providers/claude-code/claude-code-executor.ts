import { spawn } from 'node:child_process';
import { createLogger } from '../../core/logger.js';

const logger = createLogger('claude-executor');

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Execute a Claude Code CLI command in a given workspace */
export function executeClaudeCode(
  prompt: string,
  workspacePath: string,
  timeout: number,
): Promise<ExecutionResult> {
  return new Promise((resolve, reject) => {
    const args = ['--print', prompt];

    logger.debug({ workspacePath, timeout }, 'Executing Claude Code CLI');

    const child = spawn('claude', args, {
      cwd: workspacePath,
      timeout,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });

    child.on('error', (error) => {
      logger.error({ error }, 'Claude Code execution error');
      reject(error);
    });
  });
}
