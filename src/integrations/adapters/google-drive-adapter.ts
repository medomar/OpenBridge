import { google, type drive_v3 } from 'googleapis';
import { createLogger } from '../../core/logger.js';
import type {
  BusinessIntegration,
  HealthStatus,
  IntegrationCapability,
  IntegrationConfig,
} from '../../types/integration.js';

const logger = createLogger('google-drive-adapter');

/**
 * Google Drive integration adapter.
 *
 * Capabilities:
 * - upload_file: Upload a file to Google Drive
 * - list_files: List files in a folder or root
 * - download_file: Download a file by ID
 * - create_folder: Create a folder
 * - share_file: Share a file with a user or make it public
 *
 * Credentials expected (from credential store):
 * - Auth type "apiKey":
 *     apiKey: Google API key (limited to public files)
 * - Auth type "oauth2":
 *     clientId: OAuth2 client ID
 *     clientSecret: OAuth2 client secret
 *     refreshToken: OAuth2 refresh token (obtained via consent flow)
 */
export class GoogleDriveAdapter implements BusinessIntegration {
  readonly name = 'google-drive';
  readonly type = 'storage' as const;

  private drive: drive_v3.Drive | null = null;

  async initialize(config: IntegrationConfig): Promise<void> {
    const opts = config.options;
    const authType = (opts['authType'] as string) ?? 'oauth2';

    if (authType === 'apiKey') {
      const apiKey = opts['apiKey'] as string | undefined;
      if (!apiKey || typeof apiKey !== 'string') {
        throw new Error(
          'Google Drive adapter requires an apiKey in config.options when authType is "apiKey"',
        );
      }
      this.drive = google.drive({ version: 'v3', auth: apiKey });
    } else {
      // OAuth2
      const clientId = opts['clientId'] as string | undefined;
      const clientSecret = opts['clientSecret'] as string | undefined;
      const refreshToken = opts['refreshToken'] as string | undefined;

      if (!clientId || typeof clientId !== 'string') {
        throw new Error('Google Drive adapter requires clientId in config.options');
      }
      if (!clientSecret || typeof clientSecret !== 'string') {
        throw new Error('Google Drive adapter requires clientSecret in config.options');
      }
      if (!refreshToken || typeof refreshToken !== 'string') {
        throw new Error('Google Drive adapter requires refreshToken in config.options');
      }

      const auth = new google.auth.OAuth2(clientId, clientSecret);
      auth.setCredentials({ refresh_token: refreshToken });
      this.drive = google.drive({ version: 'v3', auth });
    }

    // Verify credentials work
    try {
      await this.drive.about.get({ fields: 'user' });
    } catch (err) {
      this.drive = null;
      throw new Error(
        `Google Drive initialization failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    logger.info('Google Drive adapter initialized');
  }

  async healthCheck(): Promise<HealthStatus> {
    const checkedAt = new Date().toISOString();

    if (!this.drive) {
      return { status: 'unhealthy', message: 'Not initialized', checkedAt, details: {} };
    }

    try {
      const res = await this.drive.about.get({ fields: 'user,storageQuota' });
      const user = res.data.user;
      const quota = res.data.storageQuota;
      return {
        status: 'healthy',
        message: 'Google Drive API reachable',
        checkedAt,
        details: {
          userEmail: user?.emailAddress ?? 'unknown',
          ...(quota
            ? {
                storageUsed: quota.usage ?? '0',
                storageLimit: quota.limit ?? 'unlimited',
              }
            : {}),
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
    this.drive = null;
    logger.info('Google Drive adapter shut down');
  }

  describeCapabilities(): IntegrationCapability[] {
    return [
      {
        name: 'upload_file',
        description:
          'Upload a file to Google Drive. Params: filePath (string, local path), name (string, optional filename), folderId (string, optional parent folder ID), mimeType (string, optional).',
        category: 'write',
        requiresApproval: true,
      },
      {
        name: 'list_files',
        description:
          'List files in Google Drive. Params: folderId (string, optional — defaults to root), query (string, optional Drive search query), pageSize (number, default 20).',
        category: 'read',
        requiresApproval: false,
      },
      {
        name: 'download_file',
        description:
          'Download a file from Google Drive by ID. Params: fileId (string), destPath (string, local destination path).',
        category: 'read',
        requiresApproval: false,
      },
      {
        name: 'create_folder',
        description:
          'Create a folder in Google Drive. Params: name (string), parentId (string, optional parent folder ID).',
        category: 'write',
        requiresApproval: true,
      },
      {
        name: 'share_file',
        description:
          'Share a file or folder. Params: fileId (string), email (string, optional — share with specific user), role (string, "reader"|"writer"|"commenter", default "reader"), type (string, "user"|"anyone", default "user"). If type is "anyone", creates a public link.',
        category: 'write',
        requiresApproval: true,
      },
    ];
  }

  async query(operation: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.drive) {
      throw new Error('Google Drive adapter not initialized — call initialize() first');
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
    if (!this.drive) {
      throw new Error('Google Drive adapter not initialized — call initialize() first');
    }

    switch (operation) {
      case 'upload_file':
        return await this.uploadFile(params);
      case 'create_folder':
        return await this.createFolder(params);
      case 'share_file':
        return await this.shareFile(params);
      default:
        throw new Error(`Unknown execute operation: ${operation}`);
    }
  }

  // ── Private helpers ────────────────────────────────────────────

  private async uploadFile(
    params: Record<string, unknown>,
  ): Promise<{ fileId: string; name: string; webViewLink: string | null }> {
    const { createReadStream } = await import('node:fs');
    const path = await import('node:path');

    const filePath = params['filePath'] as string;
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('filePath is required');
    }

    const name = (params['name'] as string) ?? path.basename(filePath);
    const folderId = params['folderId'] as string | undefined;
    const mimeType = params['mimeType'] as string | undefined;

    const fileMetadata: drive_v3.Schema$File = { name };
    if (folderId) {
      fileMetadata.parents = [folderId];
    }

    const res = await this.drive!.files.create({
      requestBody: fileMetadata,
      media: {
        mimeType: mimeType ?? 'application/octet-stream',
        body: createReadStream(filePath),
      },
      fields: 'id,name,webViewLink',
    });

    logger.info({ fileId: res.data.id, name: res.data.name }, 'File uploaded to Google Drive');
    return {
      fileId: res.data.id ?? '',
      name: res.data.name ?? name,
      webViewLink: res.data.webViewLink ?? null,
    };
  }

  private async listFiles(
    params: Record<string, unknown>,
  ): Promise<{ files: Array<Record<string, unknown>>; nextPageToken: string | null }> {
    const folderId = params['folderId'] as string | undefined;
    const userQuery = params['query'] as string | undefined;
    const pageSize = Math.min((params['pageSize'] as number) ?? 20, 100);

    const queryParts: string[] = [];
    if (folderId) {
      queryParts.push(`'${folderId}' in parents`);
    }
    if (userQuery) {
      queryParts.push(userQuery);
    }
    queryParts.push('trashed = false');

    const res = await this.drive!.files.list({
      q: queryParts.join(' and '),
      pageSize,
      fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)',
    });

    return {
      files: (res.data.files ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
        modifiedTime: f.modifiedTime,
        webViewLink: f.webViewLink,
      })),
      nextPageToken: res.data.nextPageToken ?? null,
    };
  }

  private async downloadFile(
    params: Record<string, unknown>,
  ): Promise<{ fileId: string; destPath: string; size: number }> {
    const { createWriteStream } = await import('node:fs');
    const { pipeline } = await import('node:stream/promises');
    const { stat } = await import('node:fs/promises');
    const { Readable } = await import('node:stream');

    const fileId = params['fileId'] as string;
    const destPath = params['destPath'] as string;

    if (!fileId || typeof fileId !== 'string') {
      throw new Error('fileId is required');
    }
    if (!destPath || typeof destPath !== 'string') {
      throw new Error('destPath is required');
    }

    const res = await this.drive!.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });

    const stream = res.data as unknown as NodeJS.ReadableStream;
    await pipeline(Readable.from(stream as AsyncIterable<Buffer>), createWriteStream(destPath));

    const fileStat = await stat(destPath);
    logger.info({ fileId, destPath, size: fileStat.size }, 'File downloaded from Google Drive');
    return { fileId, destPath, size: fileStat.size };
  }

  private async createFolder(
    params: Record<string, unknown>,
  ): Promise<{ folderId: string; name: string; webViewLink: string | null }> {
    const name = params['name'] as string;
    if (!name || typeof name !== 'string') {
      throw new Error('name is required');
    }

    const parentId = params['parentId'] as string | undefined;

    const fileMetadata: drive_v3.Schema$File = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) {
      fileMetadata.parents = [parentId];
    }

    const res = await this.drive!.files.create({
      requestBody: fileMetadata,
      fields: 'id,name,webViewLink',
    });

    logger.info({ folderId: res.data.id, name: res.data.name }, 'Folder created in Google Drive');
    return {
      folderId: res.data.id ?? '',
      name: res.data.name ?? name,
      webViewLink: res.data.webViewLink ?? null,
    };
  }

  private async shareFile(
    params: Record<string, unknown>,
  ): Promise<{ permissionId: string; webViewLink: string | null }> {
    const fileId = params['fileId'] as string;
    if (!fileId || typeof fileId !== 'string') {
      throw new Error('fileId is required');
    }

    const shareType = (params['type'] as string) ?? 'user';
    const role = (params['role'] as string) ?? 'reader';
    const email = params['email'] as string | undefined;

    if (shareType === 'user' && (!email || typeof email !== 'string')) {
      throw new Error('email is required when type is "user"');
    }

    const permission: drive_v3.Schema$Permission = {
      role,
      type: shareType,
    };
    if (shareType === 'user' && email) {
      permission.emailAddress = email;
    }

    const res = await this.drive!.permissions.create({
      fileId,
      requestBody: permission,
      fields: 'id',
    });

    // Fetch updated file to get the web view link
    const fileRes = await this.drive!.files.get({
      fileId,
      fields: 'webViewLink',
    });

    logger.info(
      { fileId, permissionId: res.data.id, shareType, role },
      'File shared on Google Drive',
    );
    return {
      permissionId: res.data.id ?? '',
      webViewLink: fileRes.data.webViewLink ?? null,
    };
  }
}
