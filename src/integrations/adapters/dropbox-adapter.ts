import { Dropbox } from 'dropbox';
import { createLogger } from '../../core/logger.js';
import type {
  BusinessIntegration,
  HealthStatus,
  IntegrationCapability,
  IntegrationConfig,
} from '../../types/integration.js';

const logger = createLogger('dropbox-adapter');

/**
 * Dropbox integration adapter.
 *
 * Capabilities:
 * - upload_file: Upload a local file to Dropbox
 * - download_file: Download a file from Dropbox to a local path
 * - list_files: List files and folders in a Dropbox path
 * - create_shared_link: Create a public shared link for a file
 *
 * Credentials expected (from credential store via config.options):
 * - accessToken: Dropbox OAuth2 access token
 */
export class DropboxAdapter implements BusinessIntegration {
  readonly name = 'dropbox';
  readonly type = 'storage' as const;

  private dbx: Dropbox | null = null;

  async initialize(config: IntegrationConfig): Promise<void> {
    const opts = config.options;
    const accessToken = opts['accessToken'] as string | undefined;

    if (!accessToken || typeof accessToken !== 'string') {
      throw new Error('Dropbox adapter requires an accessToken in config.options');
    }

    this.dbx = new Dropbox({ accessToken });

    // Verify credentials work
    try {
      await this.dbx.usersGetCurrentAccount();
    } catch (err) {
      this.dbx = null;
      throw new Error(
        `Dropbox initialization failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    logger.info('Dropbox adapter initialized');
  }

  async healthCheck(): Promise<HealthStatus> {
    const checkedAt = new Date().toISOString();

    if (!this.dbx) {
      return { status: 'unhealthy', message: 'Not initialized', checkedAt, details: {} };
    }

    try {
      const res = await this.dbx.usersGetCurrentAccount();
      return {
        status: 'healthy',
        message: 'Dropbox API reachable',
        checkedAt,
        details: {
          accountId: res.result.account_id,
          displayName: res.result.name.display_name,
          email: res.result.email,
        },
      };
    } catch (err) {
      return {
        status: 'unhealthy',
        message: err instanceof Error ? err.message : String(err),
        checkedAt,
        details: {},
      };
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async shutdown(): Promise<void> {
    this.dbx = null;
    logger.info('Dropbox adapter shut down');
  }

  describeCapabilities(): IntegrationCapability[] {
    return [
      {
        name: 'upload_file',
        description:
          'Upload a local file to Dropbox. Params: filePath (string, local path), dropboxPath (string, destination path in Dropbox, e.g. "/folder/file.txt"), overwrite (boolean, default false).',
        category: 'write',
        requiresApproval: true,
      },
      {
        name: 'download_file',
        description:
          'Download a file from Dropbox to a local path. Params: dropboxPath (string, Dropbox file path), destPath (string, local destination path).',
        category: 'read',
        requiresApproval: false,
      },
      {
        name: 'list_files',
        description:
          'List files and folders in a Dropbox path. Params: path (string, Dropbox folder path — use "" for root), recursive (boolean, default false).',
        category: 'read',
        requiresApproval: false,
      },
      {
        name: 'create_shared_link',
        description:
          'Create a publicly accessible shared link for a file or folder. Params: dropboxPath (string, Dropbox file/folder path).',
        category: 'write',
        requiresApproval: true,
      },
    ];
  }

  async query(operation: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.dbx) {
      throw new Error('Dropbox adapter not initialized — call initialize() first');
    }

    switch (operation) {
      case 'list_files':
        return await this.listFiles(params);
      case 'download_file':
        return await this.downloadFile(params);
      default:
        throw new Error(`Unknown query operation: ${operation}`);
    }
  }

  async execute(operation: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.dbx) {
      throw new Error('Dropbox adapter not initialized — call initialize() first');
    }

    switch (operation) {
      case 'upload_file':
        return await this.uploadFile(params);
      case 'create_shared_link':
        return await this.createSharedLink(params);
      default:
        throw new Error(`Unknown execute operation: ${operation}`);
    }
  }

  // ── Private helpers ────────────────────────────────────────────

  private async uploadFile(
    params: Record<string, unknown>,
  ): Promise<{ id: string; name: string; path: string; size: number }> {
    const { readFile } = await import('node:fs/promises');
    const nodePath = await import('node:path');

    const filePath = params['filePath'] as string;
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('filePath is required');
    }

    const dropboxPath = params['dropboxPath'] as string | undefined;
    const resolvedDropboxPath = dropboxPath ?? `/${nodePath.basename(filePath)}`;
    const overwrite = (params['overwrite'] as boolean) ?? false;

    const contents = await readFile(filePath);

    const res = await this.dbx!.filesUpload({
      path: resolvedDropboxPath,
      contents,
      mode: overwrite ? { '.tag': 'overwrite' } : { '.tag': 'add' },
      autorename: !overwrite,
    });

    logger.info(
      { dropboxPath: res.result.path_display, size: res.result.size },
      'File uploaded to Dropbox',
    );
    return {
      id: res.result.id,
      name: res.result.name,
      path: res.result.path_display ?? resolvedDropboxPath,
      size: res.result.size,
    };
  }

  private async downloadFile(
    params: Record<string, unknown>,
  ): Promise<{ dropboxPath: string; destPath: string; size: number }> {
    const { writeFile } = await import('node:fs/promises');

    const dropboxPath = params['dropboxPath'] as string;
    const destPath = params['destPath'] as string;

    if (!dropboxPath || typeof dropboxPath !== 'string') {
      throw new Error('dropboxPath is required');
    }
    if (!destPath || typeof destPath !== 'string') {
      throw new Error('destPath is required');
    }

    const res = await this.dbx!.filesDownload({ path: dropboxPath });

    // The Dropbox SDK returns file content in `fileBinary` when running in Node.js
    const fileContent = (res.result as unknown as Record<string, unknown>)['fileBinary'] as Buffer;

    await writeFile(destPath, fileContent);

    logger.info(
      { dropboxPath, destPath, size: fileContent.length },
      'File downloaded from Dropbox',
    );
    return { dropboxPath, destPath, size: fileContent.length };
  }

  private async listFiles(
    params: Record<string, unknown>,
  ): Promise<{ entries: Array<Record<string, unknown>>; hasMore: boolean }> {
    const path = (params['path'] as string) ?? '';
    const recursive = (params['recursive'] as boolean) ?? false;

    const res = await this.dbx!.filesListFolder({ path, recursive });

    const entries = res.result.entries.map((entry) => ({
      tag: entry['.tag'],
      name: entry.name,
      path: entry.path_display ?? entry.path_lower,
      ...(entry['.tag'] === 'file'
        ? {
            size: (entry as { size?: number }).size,
            clientModified: (entry as { client_modified?: string }).client_modified,
            serverModified: (entry as { server_modified?: string }).server_modified,
          }
        : {}),
    }));

    return { entries, hasMore: res.result.has_more };
  }

  private async createSharedLink(
    params: Record<string, unknown>,
  ): Promise<{ url: string; dropboxPath: string }> {
    const dropboxPath = params['dropboxPath'] as string;
    if (!dropboxPath || typeof dropboxPath !== 'string') {
      throw new Error('dropboxPath is required');
    }

    try {
      const res = await this.dbx!.sharingCreateSharedLinkWithSettings({ path: dropboxPath });
      logger.info({ dropboxPath, url: res.result.url }, 'Shared link created for Dropbox file');
      return { url: res.result.url, dropboxPath };
    } catch (err) {
      // If a shared link already exists, retrieve it
      const errObj = err as Record<string, unknown>;
      if (
        errObj['error'] &&
        typeof errObj['error'] === 'object' &&
        (errObj['error'] as Record<string, unknown>)['.tag'] === 'shared_link_already_exists'
      ) {
        const existing = (errObj['error'] as Record<string, unknown>)[
          'shared_link_already_exists'
        ] as Record<string, unknown> | undefined;
        const existingUrl =
          existing &&
          typeof existing === 'object' &&
          (existing['metadata'] as Record<string, unknown> | undefined)?.['url'];
        if (typeof existingUrl === 'string') {
          logger.info({ dropboxPath, url: existingUrl }, 'Returning existing shared link');
          return { url: existingUrl, dropboxPath };
        }
      }
      throw err;
    }
  }
}
