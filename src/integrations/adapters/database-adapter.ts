import type { Pool, PoolConfig } from 'pg';
import { createLogger } from '../../core/logger.js';
import type {
  BusinessIntegration,
  HealthStatus,
  IntegrationCapability,
  IntegrationConfig,
} from '../../types/integration.js';

const logger = createLogger('database-adapter');

/**
 * PostgreSQL database integration adapter (read-only).
 *
 * Capabilities:
 * - query:          Execute a read-only SQL SELECT statement
 * - list_tables:    List all tables in the public schema
 * - describe_table: Describe columns of a table
 * - count_rows:     Count rows in a table
 *
 * Credentials expected (from config.options):
 * - connectionString: PostgreSQL connection URI
 *   e.g. "postgresql://user:pass@host:5432/dbname"
 * OR individual fields:
 * - host, port, database, user, password, ssl (boolean)
 *
 * IMPORTANT: execute() only allows read operations.
 * INSERT/UPDATE/DELETE/DDL require explicit human approval via the approval relay.
 */
export class DatabaseAdapter implements BusinessIntegration {
  readonly name = 'database';
  readonly type = 'database' as const;

  private pool: Pool | null = null;

  async initialize(config: IntegrationConfig): Promise<void> {
    const { Pool } = await import('pg');
    const opts = config.options;
    const connectionString = opts['connectionString'] as string | undefined;

    let poolConfig: PoolConfig;

    if (connectionString) {
      if (typeof connectionString !== 'string') {
        throw new Error('Database adapter: connectionString must be a string');
      }
      poolConfig = { connectionString, max: 5, idleTimeoutMillis: 30_000 };
    } else {
      const host = opts['host'] as string | undefined;
      const database = opts['database'] as string | undefined;
      const user = opts['user'] as string | undefined;
      const password = opts['password'] as string | undefined;

      if (!host) throw new Error('Database adapter: host is required in config.options');
      if (!database) throw new Error('Database adapter: database is required in config.options');
      if (!user) throw new Error('Database adapter: user is required in config.options');
      if (!password) throw new Error('Database adapter: password is required in config.options');

      poolConfig = {
        host,
        port: (opts['port'] as number | undefined) ?? 5432,
        database,
        user,
        password,
        ssl: (opts['ssl'] as boolean | undefined) ?? false,
        max: 5,
        idleTimeoutMillis: 30_000,
      };
    }

    this.pool = new Pool(poolConfig);

    // Verify connectivity
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }

    logger.info('Database adapter initialized');
  }

  async healthCheck(): Promise<HealthStatus> {
    const checkedAt = new Date().toISOString();

    if (!this.pool) {
      return { status: 'unhealthy', message: 'Not initialized', checkedAt, details: {} };
    }

    try {
      const result = await this.pool.query<{ now: string }>('SELECT NOW() AS now');
      return {
        status: 'healthy',
        message: 'Database connection OK',
        checkedAt,
        details: { serverTime: result.rows[0]?.now ?? '' },
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

  async shutdown(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    logger.info('Database adapter shut down');
  }

  describeCapabilities(): IntegrationCapability[] {
    return [
      {
        name: 'query',
        description:
          'Execute a read-only SQL SELECT statement. Params: sql (string — must be a SELECT query), params (array, optional — parameterized query values). Returns rows array and rowCount.',
        category: 'read',
        requiresApproval: false,
      },
      {
        name: 'list_tables',
        description:
          'List all tables in the connected database. Params: schema (string, optional — defaults to "public"). Returns array of { tableName, schema, rowEstimate }.',
        category: 'read',
        requiresApproval: false,
      },
      {
        name: 'describe_table',
        description:
          'Describe the columns and types of a table. Params: table (string — table name), schema (string, optional — defaults to "public"). Returns array of { columnName, dataType, isNullable, columnDefault }.',
        category: 'read',
        requiresApproval: false,
      },
      {
        name: 'count_rows',
        description:
          'Count the number of rows in a table. Params: table (string — table name), schema (string, optional — defaults to "public"), where (string, optional — WHERE clause without the WHERE keyword). Returns { count }.',
        category: 'read',
        requiresApproval: false,
      },
    ];
  }

  async query(operation: string, params: Record<string, unknown>): Promise<unknown> {
    this.assertInitialized();

    switch (operation) {
      case 'query':
        return await this.runQuery(params);
      case 'list_tables':
        return await this.listTables(params);
      case 'describe_table':
        return await this.describeTable(params);
      case 'count_rows':
        return await this.countRows(params);
      default:
        throw new Error(`Unknown query operation: ${operation}`);
    }
  }

  async execute(operation: string, params: Record<string, unknown>): Promise<unknown> {
    // Only read operations are allowed without explicit approval.
    // Write operations (INSERT/UPDATE/DELETE/DDL) must go through the approval relay.
    const readOnlyOps = new Set(['query', 'list_tables', 'describe_table', 'count_rows']);
    if (readOnlyOps.has(operation)) {
      return await this.query(operation, params);
    }
    throw new Error(
      `Operation "${operation}" requires human approval via the approval relay. ` +
        `Only read operations (query, list_tables, describe_table, count_rows) are permitted directly.`,
    );
  }

  // ── Private: operations ─────────────────────────────────────────

  private async runQuery(
    params: Record<string, unknown>,
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    const sql = params['sql'] as string | undefined;
    const queryParams = (params['params'] as unknown[] | undefined) ?? [];

    if (!sql || typeof sql !== 'string') {
      throw new Error('query: sql parameter is required');
    }

    // Enforce read-only: only allow SELECT statements
    const normalised = sql.trimStart().toUpperCase();
    if (!normalised.startsWith('SELECT') && !normalised.startsWith('WITH')) {
      throw new Error(
        'query: only SELECT (and WITH ... SELECT) statements are permitted. ' +
          'Use the approval relay for INSERT/UPDATE/DELETE/DDL.',
      );
    }

    const result = await this.pool!.query(sql, queryParams);
    return {
      rows: result.rows as Record<string, unknown>[],
      rowCount: result.rowCount ?? result.rows.length,
    };
  }

  private async listTables(
    params: Record<string, unknown>,
  ): Promise<{ tables: Array<{ tableName: string; schema: string; rowEstimate: number }> }> {
    const schema = (params['schema'] as string | undefined) ?? 'public';

    const result = await this.pool!.query<{
      table_name: string;
      table_schema: string;
      row_estimate: string;
    }>(
      `SELECT
        t.table_name,
        t.table_schema,
        COALESCE(s.n_live_tup, 0) AS row_estimate
      FROM information_schema.tables t
      LEFT JOIN pg_stat_user_tables s
        ON s.schemaname = t.table_schema AND s.relname = t.table_name
      WHERE t.table_type = 'BASE TABLE'
        AND t.table_schema = $1
      ORDER BY t.table_name`,
      [schema],
    );

    return {
      tables: result.rows.map((r) => ({
        tableName: r.table_name,
        schema: r.table_schema,
        rowEstimate: parseInt(r.row_estimate, 10),
      })),
    };
  }

  private async describeTable(params: Record<string, unknown>): Promise<{
    columns: Array<{
      columnName: string;
      dataType: string;
      isNullable: boolean;
      columnDefault: string | null;
    }>;
  }> {
    const table = params['table'] as string | undefined;
    const schema = (params['schema'] as string | undefined) ?? 'public';

    if (!table || typeof table !== 'string') {
      throw new Error('describe_table: table parameter is required');
    }

    const result = await this.pool!.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schema, table],
    );

    return {
      columns: result.rows.map((r) => ({
        columnName: r.column_name,
        dataType: r.data_type,
        isNullable: r.is_nullable === 'YES',
        columnDefault: r.column_default,
      })),
    };
  }

  private async countRows(params: Record<string, unknown>): Promise<{ count: number }> {
    const table = params['table'] as string | undefined;
    const schema = (params['schema'] as string | undefined) ?? 'public';
    const where = params['where'] as string | undefined;

    if (!table || typeof table !== 'string') {
      throw new Error('count_rows: table parameter is required');
    }

    // Validate table and schema identifiers to prevent SQL injection
    validateIdentifier(table);
    validateIdentifier(schema);

    const whereClause = where ? ` WHERE ${where}` : '';
    const sql = `SELECT COUNT(*) AS count FROM "${schema}"."${table}"${whereClause}`;

    const result = await this.pool!.query<{ count: string }>(sql);
    return { count: parseInt(result.rows[0]?.count ?? '0', 10) };
  }

  private assertInitialized(): void {
    if (!this.pool) {
      throw new Error('Database adapter not initialized — call initialize() first');
    }
  }
}

// ── Utility ──────────────────────────────────────────────────────

/**
 * Validates that an identifier (table/schema name) contains only safe characters.
 * Prevents SQL injection through identifier interpolation.
 */
function validateIdentifier(identifier: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(
      `Invalid identifier "${identifier}" — only alphanumeric characters and underscores are allowed`,
    );
  }
}
