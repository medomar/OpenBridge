import { fork, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { BrowserWindow } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type BridgeStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

class BridgeProcessManager {
  private child: ChildProcess | null = null;
  private status: BridgeStatus = 'stopped';
  private stopTimeout: ReturnType<typeof setTimeout> | null = null;

  private getWindow(): BrowserWindow | null {
    const windows = BrowserWindow.getAllWindows();
    return windows.length > 0 ? windows[0] : null;
  }

  private send(channel: string, data: unknown): void {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }

  private setStatus(status: BridgeStatus): void {
    this.status = status;
    this.send('bridge-status-change', status);
  }

  start(configPath?: string): void {
    if (this.child !== null) {
      return;
    }

    const bridgePath = path.resolve(__dirname, '../../dist/index.js');

    this.setStatus('starting');

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (configPath) {
      env['CONFIG_PATH'] = configPath;
    }

    this.child = fork(bridgePath, [], {
      silent: true,
      env,
    });

    this.child.stdout?.on('data', (chunk: Buffer) => {
      this.send('bridge-log', chunk.toString());
    });

    this.child.stderr?.on('data', (chunk: Buffer) => {
      const msg = chunk.toString();
      this.send('bridge-log', msg);
      this.send('bridge-error', msg);
    });

    this.child.on('spawn', () => {
      this.setStatus('running');
    });

    this.child.on('error', (err: Error) => {
      this.send('bridge-error', err.message);
      this.setStatus('error');
      this.child = null;
    });

    this.child.on('exit', (code: number | null, signal: string | null) => {
      if (this.stopTimeout !== null) {
        clearTimeout(this.stopTimeout);
        this.stopTimeout = null;
      }
      this.child = null;
      if (this.status === 'stopping') {
        this.setStatus('stopped');
      } else {
        this.send('bridge-error', `Bridge exited unexpectedly (code=${code}, signal=${signal})`);
        this.setStatus('error');
      }
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.child === null) {
        resolve();
        return;
      }

      this.setStatus('stopping');

      this.stopTimeout = setTimeout(() => {
        if (this.child !== null) {
          this.child.kill('SIGKILL');
        }
      }, 10_000);

      this.child.once('exit', () => {
        resolve();
      });

      this.child.kill('SIGTERM');
    });
  }

  async restart(): Promise<void> {
    await this.stop();
    this.start();
  }

  getStatus(): BridgeStatus {
    return this.status;
  }
}

export const bridgeProcess = new BridgeProcessManager();
