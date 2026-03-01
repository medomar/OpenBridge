import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import { deflateSync } from 'zlib';
import { bridgeProcess, type BridgeStatus } from './bridge-process.js';

// ---------------------------------------------------------------------------
// Minimal 16×16 PNG generator — creates a colored circle icon without any
// external image file dependencies.
// ---------------------------------------------------------------------------

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

function buildCirclePng(r: number, g: number, b: number): Buffer {
  const SIZE = 16;
  const cx = (SIZE - 1) / 2;
  const cy = (SIZE - 1) / 2;
  const radius = SIZE / 2 - 1;

  // Build raw scanlines: filter byte (0x00 = None) followed by RGBA pixels
  const raw: number[] = [];
  for (let y = 0; y < SIZE; y++) {
    raw.push(0); // filter type: None
    for (let x = 0; x < SIZE; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const alpha = dist <= radius ? 255 : 0;
      raw.push(r, g, b, alpha);
    }
  }

  // zlib.deflateSync produces zlib-wrapped deflate — exactly what PNG IDAT expects
  const compressed = deflateSync(Buffer.from(raw));

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0); // width
  ihdr.writeUInt32BE(SIZE, 4); // height
  ihdr.writeUInt8(8, 8); // bit depth: 8
  ihdr.writeUInt8(6, 9); // color type: RGBA (6)
  // compression (0), filter method (0), interlace (0) remain 0

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Pre-build icons once at module load time
// Green (#22c55e) = bridge running, Red (#ef4444) = bridge stopped
const ICON_RUNNING = nativeImage.createFromBuffer(buildCirclePng(34, 197, 94));
const ICON_STOPPED = nativeImage.createFromBuffer(buildCirclePng(239, 68, 68));

// ---------------------------------------------------------------------------
// TrayManager — manages the system tray icon, tooltip, and context menu.
// ---------------------------------------------------------------------------

class TrayManager {
  private tray: Tray | null = null;
  private getWindow: (() => BrowserWindow | null) | null = null;
  private isRunning = false;

  /**
   * Initialize the system tray icon. Call once after `app.whenReady()`.
   * @param getMainWindow - Getter that returns the current BrowserWindow or null.
   */
  init(getMainWindow: () => BrowserWindow | null): void {
    if (this.tray !== null) return;

    this.getWindow = getMainWindow;
    this.tray = new Tray(ICON_STOPPED);
    this.tray.setToolTip('OpenBridge — stopped');

    // Left-click: show the main window (primary action on all platforms)
    this.tray.on('click', () => {
      this.showMainWindow();
    });

    this.buildContextMenu();
  }

  /**
   * Update the tray icon and context menu to reflect the current bridge status.
   * Called from main.ts whenever bridge-process emits a status change.
   */
  update(status: BridgeStatus): void {
    if (this.tray === null) return;
    this.isRunning = status === 'running' || status === 'starting';
    this.tray.setImage(this.isRunning ? ICON_RUNNING : ICON_STOPPED);
    this.tray.setToolTip(`OpenBridge — ${status}`);
    this.buildContextMenu();
  }

  /** Destroy the tray icon (e.g., on app quit). */
  destroy(): void {
    if (this.tray !== null) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  private showMainWindow(): void {
    const win = this.getWindow?.();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  private buildContextMenu(): void {
    if (this.tray === null) return;

    const menu = Menu.buildFromTemplate([
      {
        label: 'Open Dashboard',
        click: () => {
          this.showMainWindow();
        },
      },
      {
        label: this.isRunning ? 'Stop Bridge' : 'Start Bridge',
        click: () => {
          if (this.isRunning) {
            void bridgeProcess.stop();
          } else {
            bridgeProcess.start();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Quit OpenBridge',
        click: () => {
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(menu);
  }
}

export const trayManager = new TrayManager();
