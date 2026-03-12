import type Database from 'better-sqlite3';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DocType, DocTypeField } from '../types/doctype.js';
import { getDocTypeByName, type FullDocType } from './doctype-store.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('doctype-api');

/** CORS headers for API responses */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** Default page size for list queries */
const DEFAULT_PAGE_SIZE = 20;

/** Maximum page size to prevent abuse */
const MAX_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Zod validator generation from DocType field schema
// ---------------------------------------------------------------------------

/** Maps a FieldType to a Zod schema for input validation */
function fieldTypeToZod(field: DocTypeField): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  switch (field.field_type) {
    case 'text':
    case 'longtext':
    case 'link':
    case 'image':
    case 'select':
    case 'multiselect':
      schema = z.string();
      break;
    case 'email':
      schema = z.string().email();
      break;
    case 'phone':
      schema = z.string();
      break;
    case 'url':
      schema = z.string().url();
      break;
    case 'date':
    case 'datetime':
      schema = z.string();
      break;
    case 'number':
    case 'currency':
      schema = z.number();
      break;
    case 'checkbox':
      schema = z.union([z.boolean(), z.literal(0), z.literal(1)]);
      break;
    case 'table':
      // Table fields hold child data — skip in validation (handled separately)
      schema = z.unknown();
      break;
    default:
      schema = z.unknown();
  }

  // Apply options constraint for select fields
  if (
    (field.field_type === 'select' || field.field_type === 'multiselect') &&
    field.options &&
    field.options.length > 0
  ) {
    schema = z.enum(field.options as [string, ...string[]]);
  }

  // Make optional if not required
  if (!field.required) {
    schema = schema.optional();
  }

  return schema;
}

/**
 * Build a Zod object schema from DocType field definitions.
 * Excludes GENERATED (formula) fields since they are computed by SQLite.
 */
export function buildZodValidator(fields: DocTypeField[]): z.ZodObject<z.ZodRawShape> {
  const shape: z.ZodRawShape = {};

  for (const field of fields) {
    // Skip GENERATED columns — these are computed by SQLite, not user-provided
    if (field.formula != null) continue;
    // Skip table-type fields — child table data is handled separately
    if (field.field_type === 'table') continue;

    shape[field.name] = fieldTypeToZod(field);
  }

  return z.object(shape).passthrough();
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * Registered DocType route set — stored so we can match incoming requests
 * against registered doctypes.
 */
interface DocTypeRouteConfig {
  doctype: DocType;
  fields: DocTypeField[];
  validator: z.ZodObject<z.ZodRawShape>;
  childTables: Array<{ fieldName: string; childDoctype: string }>;
}

/** Registry of registered DocType routes, keyed by lowercase doctype name */
const routeRegistry = new Map<string, DocTypeRouteConfig>();

/**
 * Register REST API routes for a DocType on the file-server's HTTP server.
 *
 * Routes:
 *   GET    /api/dt/:doctype           — list with pagination/filters
 *   GET    /api/dt/:doctype/:id       — get with child tables
 *   POST   /api/dt/:doctype           — create (runs hooks)
 *   PUT    /api/dt/:doctype/:id       — update
 *   DELETE /api/dt/:doctype/:id       — soft-delete
 *
 * @param db      — SQLite database instance
 * @param doctype — full DocType definition (from getDocTypeByName)
 */
export function registerDocTypeRoutes(db: Database.Database, doctype: FullDocType): void {
  const nonFormulaFields = doctype.fields.filter((f) => f.formula == null);
  const validator = buildZodValidator(doctype.fields);

  const childTables: Array<{ fieldName: string; childDoctype: string }> = [];
  for (const field of doctype.fields) {
    if (field.field_type === 'table' && field.child_doctype) {
      childTables.push({ fieldName: field.name, childDoctype: field.child_doctype });
    }
  }

  routeRegistry.set(doctype.doctype.name.toLowerCase(), {
    doctype: doctype.doctype,
    fields: nonFormulaFields,
    validator,
    childTables,
  });

  logger.info({ doctype: doctype.doctype.name, routes: 5 }, 'Registered DocType REST API routes');
}

/**
 * Unregister all DocType routes. Useful for cleanup in tests.
 */
export function clearDocTypeRoutes(): void {
  routeRegistry.clear();
}

/**
 * Handle an incoming HTTP request for DocType API routes.
 * Returns true if the request was handled, false if it doesn't match any DocType route.
 *
 * Integrate this into the file-server's handleRequest method:
 *   if (await handleDocTypeRequest(db, req, res)) return;
 */
export async function handleDocTypeRequest(
  db: Database.Database,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  // Handle CORS preflight for /api/dt/ routes
  if (method === 'OPTIONS' && url.startsWith('/api/dt/')) {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return true;
  }

  // Match /api/dt/:doctype/:id
  const itemMatch = url.match(/^\/api\/dt\/([^/?]+)\/([^/?]+)(?:\?.*)?$/);
  if (itemMatch) {
    const doctypeName = decodeURIComponent(itemMatch[1]!);
    const recordId = decodeURIComponent(itemMatch[2]!);
    const config = routeRegistry.get(doctypeName.toLowerCase());
    if (!config) return false;

    switch (method) {
      case 'GET':
        handleGetRecord(db, config, recordId, res);
        return true;
      case 'PUT':
        await handleUpdateRecord(db, config, recordId, req, res);
        return true;
      case 'DELETE':
        handleDeleteRecord(db, config, recordId, res);
        return true;
      default:
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
    }
  }

  // Match /api/dt/:doctype
  const listMatch = url.match(/^\/api\/dt\/([^/?]+)(?:\?(.*))?$/);
  if (listMatch) {
    const doctypeName = decodeURIComponent(listMatch[1]!);
    const config = routeRegistry.get(doctypeName.toLowerCase());
    if (!config) return false;

    switch (method) {
      case 'GET':
        handleListRecords(db, config, url, res);
        return true;
      case 'POST':
        await handleCreateRecord(db, config, req, res);
        return true;
      default:
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/** GET /api/dt/:doctype — list with pagination and filters */
function handleListRecords(
  db: Database.Database,
  config: DocTypeRouteConfig,
  rawUrl: string,
  res: ServerResponse,
): void {
  try {
    const urlObj = new URL(rawUrl, 'http://localhost');
    const page = Math.max(1, parseInt(urlObj.searchParams.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(
        1,
        parseInt(urlObj.searchParams.get('page_size') ?? String(DEFAULT_PAGE_SIZE), 10) ||
          DEFAULT_PAGE_SIZE,
      ),
    );
    const orderBy = urlObj.searchParams.get('order_by') ?? 'created_at';
    const orderDir = urlObj.searchParams.get('order_dir')?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Build WHERE clause from query params that match field names
    const fieldNames = new Set(config.fields.map((f) => f.name));
    const whereClauses: string[] = [];
    const whereParams: unknown[] = [];

    for (const [key, value] of urlObj.searchParams.entries()) {
      if (fieldNames.has(key)) {
        whereClauses.push(`"${key.replace(/"/g, '""')}" = ?`);
        whereParams.push(value);
      }
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Validate orderBy is a known column
    const validOrderColumns = new Set([
      'id',
      'created_at',
      'updated_at',
      'created_by',
      ...fieldNames,
    ]);
    const safeOrderBy = validOrderColumns.has(orderBy)
      ? `"${orderBy.replace(/"/g, '""')}"`
      : '"created_at"';

    const tableName = quoteIdentifier(config.doctype.table_name);

    // Count total
    const countSQL = `SELECT COUNT(*) as total FROM ${tableName} ${whereSQL}`;
    const countRow = db.prepare(countSQL).get(...whereParams) as { total: number } | undefined;
    const total = countRow?.total ?? 0;

    // Fetch page
    const offset = (page - 1) * pageSize;
    const dataSQL = `SELECT * FROM ${tableName} ${whereSQL} ORDER BY ${safeOrderBy} ${orderDir} LIMIT ? OFFSET ?`;
    const rows = db.prepare(dataSQL).all(...whereParams, pageSize, offset) as Record<
      string,
      unknown
    >[];

    sendJson(res, 200, {
      data: rows,
      meta: {
        total,
        page,
        page_size: pageSize,
        total_pages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    logger.error({ err, doctype: config.doctype.name }, 'Error listing records');
    sendJson(res, 500, { error: 'Internal server error' });
  }
}

/** GET /api/dt/:doctype/:id — get single record with child tables */
function handleGetRecord(
  db: Database.Database,
  config: DocTypeRouteConfig,
  recordId: string,
  res: ServerResponse,
): void {
  try {
    const tableName = quoteIdentifier(config.doctype.table_name);
    const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(recordId) as
      | Record<string, unknown>
      | undefined;

    if (!row) {
      sendJson(res, 404, { error: 'Record not found' });
      return;
    }

    // Fetch child table records
    const children: Record<string, unknown[]> = {};
    for (const child of config.childTables) {
      const childTableName = `dt_${config.doctype.name.toLowerCase()}__${child.childDoctype}`;
      try {
        const childRows = db
          .prepare(
            `SELECT * FROM ${quoteIdentifier(childTableName)} WHERE parent_id = ? ORDER BY idx`,
          )
          .all(recordId) as Record<string, unknown>[];
        children[child.fieldName] = childRows;
      } catch {
        // Child table may not exist yet — return empty array
        children[child.fieldName] = [];
      }
    }

    sendJson(res, 200, {
      data: { ...row, ...children },
    });
  } catch (err) {
    logger.error({ err, doctype: config.doctype.name, recordId }, 'Error getting record');
    sendJson(res, 500, { error: 'Internal server error' });
  }
}

/** POST /api/dt/:doctype — create a new record */
async function handleCreateRecord(
  db: Database.Database,
  config: DocTypeRouteConfig,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const body = await readJsonBody(req);
    if (body === null) {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    // Validate against auto-generated Zod schema
    const result = config.validator.safeParse(body);
    if (!result.success) {
      sendJson(res, 422, {
        error: 'Validation failed',
        details: result.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const validated = result.data;
    const id = randomUUID();
    const now = new Date().toISOString();

    // Build INSERT statement from non-formula, non-table fields
    const insertableFields = config.fields.filter(
      (f) => f.formula == null && f.field_type !== 'table',
    );

    const columns = ['id', 'created_at', 'updated_at', 'created_by'];
    const placeholders = ['?', '?', '?', '?'];
    const createdBy = typeof body['created_by'] === 'string' ? body['created_by'] : 'api';
    const values: unknown[] = [id, now, now, createdBy];

    for (const field of insertableFields) {
      const value: unknown = validated[field.name];
      if (value !== undefined) {
        columns.push(`"${field.name.replace(/"/g, '""')}"`);
        placeholders.push('?');
        values.push(field.field_type === 'checkbox' ? (value ? 1 : 0) : value);
      }
    }

    const tableName = quoteIdentifier(config.doctype.table_name);
    const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;

    db.prepare(sql).run(...values);

    // Return the created record
    const created = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;

    // Run lifecycle hooks for 'after_insert' event
    runHooks(db, config.doctype.name, 'after_insert', id);

    sendJson(res, 201, { data: created });
  } catch (err) {
    logger.error({ err, doctype: config.doctype.name }, 'Error creating record');
    sendJson(res, 500, { error: 'Internal server error' });
  }
}

/** PUT /api/dt/:doctype/:id — update a record */
async function handleUpdateRecord(
  db: Database.Database,
  config: DocTypeRouteConfig,
  recordId: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const tableName = quoteIdentifier(config.doctype.table_name);

    // Check record exists
    const existing = db.prepare(`SELECT id FROM ${tableName} WHERE id = ?`).get(recordId);
    if (!existing) {
      sendJson(res, 404, { error: 'Record not found' });
      return;
    }

    const body = await readJsonBody(req);
    if (body === null) {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    // Validate with partial schema (all fields optional for update)
    const partialValidator = config.validator.partial();
    const result = partialValidator.safeParse(body);
    if (!result.success) {
      sendJson(res, 422, {
        error: 'Validation failed',
        details: result.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const validated = result.data;
    const now = new Date().toISOString();

    const setClauses: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];

    const insertableFields = config.fields.filter(
      (f) => f.formula == null && f.field_type !== 'table',
    );

    for (const field of insertableFields) {
      const value: unknown = validated[field.name];
      if (value !== undefined) {
        setClauses.push(`"${field.name.replace(/"/g, '""')}" = ?`);
        values.push(field.field_type === 'checkbox' ? (value ? 1 : 0) : value);
      }
    }

    values.push(recordId);
    const sql = `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...values);

    const updated = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(recordId) as
      | Record<string, unknown>
      | undefined;

    // Run lifecycle hooks for 'after_update' event
    runHooks(db, config.doctype.name, 'after_update', recordId);

    sendJson(res, 200, { data: updated });
  } catch (err) {
    logger.error({ err, doctype: config.doctype.name, recordId }, 'Error updating record');
    sendJson(res, 500, { error: 'Internal server error' });
  }
}

/** DELETE /api/dt/:doctype/:id — soft-delete by setting _deleted = 1, or hard-delete if no _deleted column */
function handleDeleteRecord(
  db: Database.Database,
  config: DocTypeRouteConfig,
  recordId: string,
  res: ServerResponse,
): void {
  try {
    const tableName = quoteIdentifier(config.doctype.table_name);

    // Check record exists
    const existing = db.prepare(`SELECT id FROM ${tableName} WHERE id = ?`).get(recordId);
    if (!existing) {
      sendJson(res, 404, { error: 'Record not found' });
      return;
    }

    // Attempt soft-delete: update updated_at and mark as deleted
    // Since DocType tables may not have a _deleted column, we add a pragmatic approach:
    // check if the table has a _deleted column, otherwise hard-delete
    const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
      name: string;
    }>;
    const hasDeletedColumn = tableInfo.some((col) => col.name === '_deleted');

    if (hasDeletedColumn) {
      const now = new Date().toISOString();
      db.prepare(`UPDATE ${tableName} SET "_deleted" = 1, "updated_at" = ? WHERE id = ?`).run(
        now,
        recordId,
      );
    } else {
      db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(recordId);
    }

    // Run lifecycle hooks for 'after_delete' event
    runHooks(db, config.doctype.name, 'after_delete', recordId);

    sendJson(res, 200, { data: { id: recordId, deleted: true } });
  } catch (err) {
    logger.error({ err, doctype: config.doctype.name, recordId }, 'Error deleting record');
    sendJson(res, 500, { error: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// Hooks (lightweight — logs hook events; full hook execution is a future task)
// ---------------------------------------------------------------------------

/** Fire lifecycle hooks for a DocType event. Currently logs the event for future hook executor integration. */
function runHooks(
  db: Database.Database,
  doctypeName: string,
  event: string,
  recordId: string,
): void {
  try {
    const fullDocType = getDocTypeByName(db, doctypeName);
    if (!fullDocType) return;

    const hooks = fullDocType.hooks.filter((h) => h.event === event && h.enabled);
    for (const hook of hooks) {
      logger.info(
        { doctype: doctypeName, event, recordId, actionType: hook.action_type },
        'DocType lifecycle hook fired',
      );
    }
  } catch {
    // Non-critical — don't fail the request if hook lookup fails
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Send a JSON response with proper headers */
function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...CORS_HEADERS,
  });
  res.end(body);
}

/** Read the request body as JSON */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          resolve(parsed as Record<string, unknown>);
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

/** Wraps a SQLite identifier in double-quotes, escaping any embedded double-quotes. */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
