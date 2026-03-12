import { google, type sheets_v4 } from 'googleapis';
import { createLogger } from '../../core/logger.js';
import type {
  BusinessIntegration,
  HealthStatus,
  IntegrationCapability,
  IntegrationConfig,
} from '../../types/integration.js';

const logger = createLogger('google-sheets-adapter');

/**
 * Google Sheets integration adapter.
 *
 * Capabilities:
 * - read_sheet:   Read rows from a sheet (tab) in a spreadsheet
 * - write_rows:   Append or overwrite rows in a sheet
 * - create_sheet: Add a new sheet (tab) to an existing spreadsheet
 * - list_sheets:  List all sheets (tabs) in a spreadsheet
 *
 * Credentials expected (from credential store):
 * - Auth type "apiKey":
 *     apiKey: Google API key (limited to public spreadsheets)
 * - Auth type "oauth2":
 *     clientId: OAuth2 client ID
 *     clientSecret: OAuth2 client secret
 *     refreshToken: OAuth2 refresh token (obtained via consent flow)
 */
export class GoogleSheetsAdapter implements BusinessIntegration {
  readonly name = 'google-sheets';
  readonly type = 'storage' as const;

  private sheets: sheets_v4.Sheets | null = null;

  // eslint-disable-next-line @typescript-eslint/require-await
  async initialize(config: IntegrationConfig): Promise<void> {
    const opts = config.options;
    const authType = (opts['authType'] as string) ?? 'oauth2';

    if (authType === 'apiKey') {
      const apiKey = opts['apiKey'] as string | undefined;
      if (!apiKey || typeof apiKey !== 'string') {
        throw new Error(
          'Google Sheets adapter requires an apiKey in config.options when authType is "apiKey"',
        );
      }
      this.sheets = google.sheets({ version: 'v4', auth: apiKey });
    } else {
      // OAuth2
      const clientId = opts['clientId'] as string | undefined;
      const clientSecret = opts['clientSecret'] as string | undefined;
      const refreshToken = opts['refreshToken'] as string | undefined;

      if (!clientId || typeof clientId !== 'string') {
        throw new Error('Google Sheets adapter requires clientId in config.options');
      }
      if (!clientSecret || typeof clientSecret !== 'string') {
        throw new Error('Google Sheets adapter requires clientSecret in config.options');
      }
      if (!refreshToken || typeof refreshToken !== 'string') {
        throw new Error('Google Sheets adapter requires refreshToken in config.options');
      }

      const auth = new google.auth.OAuth2(clientId, clientSecret);
      auth.setCredentials({ refresh_token: refreshToken });
      this.sheets = google.sheets({ version: 'v4', auth });
    }

    // Verify credentials work by fetching spreadsheet metadata for a minimal call
    // We just ensure the auth is usable; actual validation happens at query time.
    logger.info('Google Sheets adapter initialized');
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async healthCheck(): Promise<HealthStatus> {
    const checkedAt = new Date().toISOString();

    if (!this.sheets) {
      return { status: 'unhealthy', message: 'Not initialized', checkedAt, details: {} };
    }

    return {
      status: 'healthy',
      message: 'Google Sheets adapter ready',
      checkedAt,
      details: {},
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async shutdown(): Promise<void> {
    this.sheets = null;
    logger.info('Google Sheets adapter shut down');
  }

  describeCapabilities(): IntegrationCapability[] {
    return [
      {
        name: 'read_sheet',
        description:
          'Read rows from a Google Sheets tab. Params: spreadsheetId (string), sheetName (string, optional — defaults to first sheet), range (string, optional A1 notation e.g. "A1:Z100"), includeHeaders (boolean, default true).',
        category: 'read',
        requiresApproval: false,
      },
      {
        name: 'write_rows',
        description:
          'Write rows to a Google Sheets tab. Params: spreadsheetId (string), sheetName (string), rows (array of arrays — each inner array is one row of cell values), startCell (string, optional A1 cell to start writing, default "A1"), valueInputOption (string, "RAW"|"USER_ENTERED", default "USER_ENTERED").',
        category: 'write',
        requiresApproval: true,
      },
      {
        name: 'create_sheet',
        description:
          'Add a new sheet (tab) to an existing Google Spreadsheet. Params: spreadsheetId (string), title (string — name for the new sheet), index (number, optional — position among tabs, 0-based).',
        category: 'write',
        requiresApproval: true,
      },
      {
        name: 'list_sheets',
        description:
          'List all sheets (tabs) in a Google Spreadsheet. Params: spreadsheetId (string). Returns array of { sheetId, title, index, rowCount, columnCount }.',
        category: 'read',
        requiresApproval: false,
      },
    ];
  }

  async query(operation: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.sheets) {
      throw new Error('Google Sheets adapter not initialized — call initialize() first');
    }

    switch (operation) {
      case 'read_sheet':
        return await this.readSheet(params);
      case 'list_sheets':
        return await this.listSheets(params);
      default:
        throw new Error(`Unknown query operation: ${operation}`);
    }
  }

  async execute(operation: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.sheets) {
      throw new Error('Google Sheets adapter not initialized — call initialize() first');
    }

    switch (operation) {
      case 'write_rows':
        return await this.writeRows(params);
      case 'create_sheet':
        return await this.createSheet(params);
      default:
        throw new Error(`Unknown execute operation: ${operation}`);
    }
  }

  // ── Private helpers ────────────────────────────────────────────

  private async readSheet(params: Record<string, unknown>): Promise<{
    headers: string[] | null;
    rows: unknown[][];
    totalRows: number;
    sheetName: string;
    range: string;
  }> {
    const spreadsheetId = params['spreadsheetId'] as string;
    if (!spreadsheetId || typeof spreadsheetId !== 'string') {
      throw new Error('spreadsheetId is required');
    }

    const sheetName = params['sheetName'] as string | undefined;
    const rangeParam = params['range'] as string | undefined;
    const includeHeaders = params['includeHeaders'] !== false;

    // Build range notation: "SheetName!A1:Z" or just "A1:Z" for default sheet
    const rangeNotation = sheetName
      ? `${sheetName}${rangeParam ? `!${rangeParam}` : ''}`
      : (rangeParam ?? '');

    const res = await this.sheets!.spreadsheets.values.get({
      spreadsheetId,
      range: rangeNotation || undefined,
      majorDimension: 'ROWS',
    });

    const values = res.data.values ?? [];
    const actualRange = res.data.range ?? rangeNotation;
    const actualSheet = sheetName ?? actualRange.split('!')[0] ?? 'Sheet1';

    if (values.length === 0) {
      return { headers: null, rows: [], totalRows: 0, sheetName: actualSheet, range: actualRange };
    }

    if (includeHeaders) {
      const headers = (values[0] as string[]).map((h) => String(h ?? ''));
      const rows = values.slice(1);
      logger.info(
        { spreadsheetId, sheetName: actualSheet, rowCount: rows.length },
        'Sheet data read',
      );
      return { headers, rows, totalRows: rows.length, sheetName: actualSheet, range: actualRange };
    }

    logger.info(
      { spreadsheetId, sheetName: actualSheet, rowCount: values.length },
      'Sheet data read',
    );
    return {
      headers: null,
      rows: values,
      totalRows: values.length,
      sheetName: actualSheet,
      range: actualRange,
    };
  }

  private async writeRows(params: Record<string, unknown>): Promise<{
    spreadsheetId: string;
    updatedRange: string;
    updatedRows: number;
    updatedCells: number;
  }> {
    const spreadsheetId = params['spreadsheetId'] as string;
    if (!spreadsheetId || typeof spreadsheetId !== 'string') {
      throw new Error('spreadsheetId is required');
    }

    const sheetName = params['sheetName'] as string | undefined;
    const rows = params['rows'] as unknown[][];
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('rows must be a non-empty array');
    }

    const startCell = (params['startCell'] as string) ?? 'A1';
    const valueInputOption = (params['valueInputOption'] as string) ?? 'USER_ENTERED';

    const range = sheetName ? `${sheetName}!${startCell}` : startCell;

    const res = await this.sheets!.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption,
      requestBody: { values: rows },
    });

    logger.info(
      {
        spreadsheetId,
        updatedRange: res.data.updatedRange,
        updatedRows: res.data.updatedRows,
      },
      'Rows written to sheet',
    );

    return {
      spreadsheetId,
      updatedRange: res.data.updatedRange ?? range,
      updatedRows: res.data.updatedRows ?? rows.length,
      updatedCells: res.data.updatedCells ?? 0,
    };
  }

  private async createSheet(params: Record<string, unknown>): Promise<{
    spreadsheetId: string;
    sheetId: number;
    title: string;
    index: number;
  }> {
    const spreadsheetId = params['spreadsheetId'] as string;
    if (!spreadsheetId || typeof spreadsheetId !== 'string') {
      throw new Error('spreadsheetId is required');
    }

    const title = params['title'] as string;
    if (!title || typeof title !== 'string') {
      throw new Error('title is required');
    }

    const index = params['index'] as number | undefined;

    const addSheetRequest: sheets_v4.Schema$AddSheetRequest = {
      properties: { title, ...(typeof index === 'number' ? { index } : {}) },
    };

    const res = await this.sheets!.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: addSheetRequest }] },
    });

    const addedProps = res.data.replies?.[0]?.addSheet?.properties;
    logger.info(
      { spreadsheetId, title, sheetId: addedProps?.sheetId },
      'New sheet created in spreadsheet',
    );

    return {
      spreadsheetId,
      sheetId: addedProps?.sheetId ?? 0,
      title: addedProps?.title ?? title,
      index: addedProps?.index ?? 0,
    };
  }

  private async listSheets(params: Record<string, unknown>): Promise<{
    spreadsheetId: string;
    sheets: Array<{
      sheetId: number;
      title: string;
      index: number;
      rowCount: number;
      columnCount: number;
    }>;
  }> {
    const spreadsheetId = params['spreadsheetId'] as string;
    if (!spreadsheetId || typeof spreadsheetId !== 'string') {
      throw new Error('spreadsheetId is required');
    }

    const res = await this.sheets!.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties',
    });

    const sheets = (res.data.sheets ?? []).map((s) => {
      const p = s.properties ?? {};
      const grid = p.gridProperties ?? {};
      return {
        sheetId: p.sheetId ?? 0,
        title: p.title ?? '',
        index: p.index ?? 0,
        rowCount: grid.rowCount ?? 0,
        columnCount: grid.columnCount ?? 0,
      };
    });

    logger.info({ spreadsheetId, sheetCount: sheets.length }, 'Sheets listed');
    return { spreadsheetId, sheets };
  }
}
