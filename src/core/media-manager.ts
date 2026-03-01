import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLogger } from './logger.js';

const logger = createLogger('media-manager');

/** Default TTL for media files: 1 hour in milliseconds */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

/** Default size cap for the media directory: 100 MB in bytes */
const DEFAULT_SIZE_CAP_BYTES = 100 * 1024 * 1024;

/** Maps MIME types to file extensions */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/mpeg': '.mpeg',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/ogg': '.ogv',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/ogg': '.oga',
  'audio/wav': '.wav',
  'audio/webm': '.weba',
  'audio/opus': '.opus',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/zip': '.zip',
  'text/plain': '.txt',
  'text/csv': '.csv',
};

/** Result of saving a media file */
export interface SaveMediaResult {
  filePath: string;
  sizeBytes: number;
}

/**
 * MediaManager — manages a TTL-based, size-capped temp directory for incoming media.
 *
 * Files are saved to `<workspacePath>/.openbridge/media/` with UUID-based names.
 * Expired files (older than TTL) and excess files (when total size > cap) are
 * removed by `cleanExpired()`.
 */
export class MediaManager {
  private readonly mediaDir: string;
  private readonly ttlMs: number;
  private readonly sizeCapBytes: number;

  constructor(
    workspacePath: string,
    ttlMs: number = DEFAULT_TTL_MS,
    sizeCapBytes: number = DEFAULT_SIZE_CAP_BYTES,
  ) {
    this.mediaDir = path.join(workspacePath, '.openbridge', 'media');
    this.ttlMs = ttlMs;
    this.sizeCapBytes = sizeCapBytes;
  }

  /** Returns the path to the managed media directory */
  get directory(): string {
    return this.mediaDir;
  }

  /**
   * Save a media buffer to disk with a generated unique filename.
   *
   * @param data      Raw media bytes
   * @param mimeType  MIME type (used to derive the file extension)
   * @param filename  Optional original filename; if provided, its extension is preferred
   * @returns         The absolute file path and size in bytes
   */
  async saveMedia(data: Buffer, mimeType: string, filename?: string): Promise<SaveMediaResult> {
    await fs.mkdir(this.mediaDir, { recursive: true });

    const ext = this.resolveExtension(mimeType, filename);
    const uniqueName = `${Date.now()}-${randomUUID()}${ext}`;
    const filePath = path.join(this.mediaDir, uniqueName);

    await fs.writeFile(filePath, data);

    const sizeBytes = data.length;
    logger.debug({ filePath, sizeBytes, mimeType }, 'Media file saved');

    return { filePath, sizeBytes };
  }

  /**
   * Remove expired files (older than TTL) and trim the directory if total size
   * exceeds the size cap (oldest files deleted first).
   */
  async cleanExpired(): Promise<void> {
    let entries: Array<{ filePath: string; mtime: Date; size: number }>;
    try {
      entries = await this.listEntries();
    } catch {
      // Directory doesn't exist yet — nothing to clean
      return;
    }

    const cutoff = Date.now() - this.ttlMs;
    let totalSize = 0;
    const keepers: Array<{ filePath: string; mtime: Date; size: number }> = [];

    for (const entry of entries) {
      if (entry.mtime.getTime() < cutoff) {
        await this.deleteFile(entry.filePath);
      } else {
        totalSize += entry.size;
        keepers.push(entry);
      }
    }

    // Enforce size cap — delete oldest keepers first
    if (totalSize > this.sizeCapBytes) {
      const sorted = [...keepers].sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
      for (const entry of sorted) {
        if (totalSize <= this.sizeCapBytes) break;
        await this.deleteFile(entry.filePath);
        totalSize -= entry.size;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Derive a file extension from the MIME type or the original filename */
  private resolveExtension(mimeType: string, filename?: string): string {
    if (filename) {
      const ext = path.extname(filename);
      if (ext) return ext.toLowerCase();
    }

    // Normalise MIME type (strip parameters like "; codecs=opus")
    const baseMime = mimeType.split(';')[0]?.trim() ?? mimeType;
    return MIME_TO_EXT[baseMime] ?? MIME_TO_EXT[mimeType] ?? '';
  }

  /** List all files in the media directory with their mtime and size */
  private async listEntries(): Promise<Array<{ filePath: string; mtime: Date; size: number }>> {
    const names = await fs.readdir(this.mediaDir);
    const results: Array<{ filePath: string; mtime: Date; size: number }> = [];

    for (const name of names) {
      const filePath = path.join(this.mediaDir, name);
      try {
        const stat = await fs.stat(filePath);
        if (stat.isFile()) {
          results.push({ filePath, mtime: stat.mtime, size: stat.size });
        }
      } catch {
        // File may have been removed concurrently — skip
      }
    }

    return results;
  }

  /** Delete a file silently (ignore missing-file errors) */
  private async deleteFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
      logger.debug({ filePath }, 'Media file deleted');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn({ filePath, err }, 'Failed to delete media file');
      }
    }
  }
}

/**
 * Factory function for creating a MediaManager with default settings.
 *
 * @param workspacePath  Absolute path to the target workspace
 */
export function createMediaManager(workspacePath: string): MediaManager {
  return new MediaManager(workspacePath);
}
