import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Categories of client activity patterns */
export type PatternType = 'repeat-customer' | 'seasonal' | 'churn-risk' | 'growth-trend';

/** A detected activity pattern for a DocType */
export interface ActivityPattern {
  /** Category of the pattern */
  type: PatternType;
  /** Entity identifier (e.g. customer name/ID) when the pattern is entity-scoped */
  entityId?: string;
  /** Human-readable description suitable for inclusion in a business report */
  description: string;
  /** Confidence score 0–1 (higher = stronger signal) */
  confidence: number;
  /** Supporting metrics for the pattern */
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ColumnInfo {
  name: string;
  type: string;
}

/** Return column names for a table via PRAGMA table_info. */
function getTableColumns(db: Database.Database, table: string): ColumnInfo[] {
  try {
    return db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all() as ColumnInfo[];
  } catch {
    return [];
  }
}

/**
 * Identify the most likely "customer / entity" column from available columns.
 * We prefer columns whose names contain common CRM identifiers.
 */
function findEntityColumn(columns: ColumnInfo[]): string | null {
  const names = columns.map((c) => c.name.toLowerCase());
  const candidates = [
    'customer',
    'client',
    'customer_id',
    'client_id',
    'contact',
    'buyer',
    'vendor',
    'supplier',
    'partner',
    'user',
    'account',
  ];
  for (const candidate of candidates) {
    if (names.includes(candidate)) {
      return columns[names.indexOf(candidate)]!.name;
    }
  }
  return null;
}

/** Check whether a column exists in the column list. */
function hasColumn(columns: ColumnInfo[], name: string): boolean {
  return columns.some((c) => c.name.toLowerCase() === name.toLowerCase());
}

// ---------------------------------------------------------------------------
// Pattern detectors
// ---------------------------------------------------------------------------

/**
 * Detect repeat customers — entities with more than one record.
 * Returns patterns for the top repeat entities (up to 5).
 */
function detectRepeatCustomers(
  db: Database.Database,
  table: string,
  entityCol: string,
): ActivityPattern[] {
  interface RepeatRow {
    entity: string | null;
    cnt: number;
  }

  let rows: RepeatRow[];
  try {
    rows = db
      .prepare(
        `SELECT "${entityCol.replace(/"/g, '""')}" AS entity,
                COUNT(*) AS cnt
         FROM   "${table.replace(/"/g, '""')}"
         WHERE  "${entityCol.replace(/"/g, '""')}" IS NOT NULL
           AND  "${entityCol.replace(/"/g, '""')}" != ''
         GROUP  BY "${entityCol.replace(/"/g, '""')}"
         HAVING COUNT(*) > 1
         ORDER  BY cnt DESC
         LIMIT  5`,
      )
      .all() as RepeatRow[];
  } catch {
    return [];
  }

  if (rows.length === 0) return [];

  return rows.map((r) => ({
    type: 'repeat-customer' as const,
    entityId: r.entity ?? undefined,
    description: `${r.entity ?? 'Unknown'} has placed ${r.cnt} orders — a repeat customer.`,
    confidence: Math.min(0.5 + r.cnt * 0.05, 1),
    metadata: { order_count: r.cnt, entity_column: entityCol },
  }));
}

/**
 * Detect seasonal patterns — days-of-week or months with above-average activity.
 * Requires a `created_at` column.
 */
function detectSeasonalPatterns(db: Database.Database, table: string): ActivityPattern[] {
  interface DowRow {
    dow: number;
    cnt: number;
  }

  const t = `"${table.replace(/"/g, '""')}"`;
  let dowRows: DowRow[];
  try {
    dowRows = db
      .prepare(
        `SELECT strftime('%w', created_at) AS dow, COUNT(*) AS cnt
         FROM   ${t}
         WHERE  created_at IS NOT NULL
         GROUP  BY dow
         ORDER  BY cnt DESC`,
      )
      .all() as DowRow[];
  } catch {
    return [];
  }

  if (dowRows.length === 0) return [];

  const total = dowRows.reduce((s, r) => s + r.cnt, 0);
  const avg = total / dowRows.length;
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const patterns: ActivityPattern[] = [];

  for (const row of dowRows) {
    if (row.cnt > avg * 1.5) {
      const dayName = dayNames[row.dow] ?? `Day ${row.dow}`;
      patterns.push({
        type: 'seasonal',
        description: `${dayName} is a peak activity day with ${row.cnt} records (${Math.round((row.cnt / avg - 1) * 100)}% above average).`,
        confidence: Math.min(0.4 + (row.cnt / avg - 1) * 0.3, 1),
        metadata: { day_of_week: dayName, record_count: row.cnt, average: Math.round(avg) },
      });
    }
  }

  return patterns.slice(0, 3);
}

/**
 * Detect churn risk — entities whose last activity is more than 2× their average interval ago.
 * Requires `created_at` column and an entity column.
 */
function detectChurnRisk(
  db: Database.Database,
  table: string,
  entityCol: string,
): ActivityPattern[] {
  interface EntityTimestampRow {
    entity: string | null;
    last_at: string;
    first_at: string;
    cnt: number;
  }

  const t = `"${table.replace(/"/g, '""')}"`;
  const col = `"${entityCol.replace(/"/g, '""')}"`;

  let rows: EntityTimestampRow[];
  try {
    rows = db
      .prepare(
        `SELECT ${col} AS entity,
                MAX(created_at) AS last_at,
                MIN(created_at) AS first_at,
                COUNT(*) AS cnt
         FROM   ${t}
         WHERE  ${col} IS NOT NULL AND ${col} != '' AND created_at IS NOT NULL
         GROUP  BY ${col}
         HAVING COUNT(*) >= 2`,
      )
      .all() as EntityTimestampRow[];
  } catch {
    return [];
  }

  const now = Date.now();
  const patterns: ActivityPattern[] = [];

  for (const row of rows) {
    const lastMs = new Date(row.last_at).getTime();
    const firstMs = new Date(row.first_at).getTime();
    if (isNaN(lastMs) || isNaN(firstMs)) continue;

    const spanMs = lastMs - firstMs;
    const avgIntervalMs = spanMs / (row.cnt - 1);
    if (avgIntervalMs <= 0) continue;

    const idleSince = now - lastMs;
    if (idleSince > 2 * avgIntervalMs) {
      const idleDays = Math.round(idleSince / 86_400_000);
      const avgIntervalDays = Math.round(avgIntervalMs / 86_400_000);
      patterns.push({
        type: 'churn-risk',
        entityId: row.entity ?? undefined,
        description:
          `${row.entity ?? 'Unknown'} has been inactive for ${idleDays} days ` +
          `(average interval: ${avgIntervalDays} days) — possible churn risk.`,
        confidence: Math.min(0.4 + idleSince / avgIntervalMs / 10, 0.95),
        metadata: {
          idle_days: idleDays,
          avg_interval_days: avgIntervalDays,
          order_count: row.cnt,
          last_activity: row.last_at,
        },
      });
    }
  }

  // Return top-5 highest confidence churn risks
  return patterns.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

/**
 * Detect growth trends — compare record counts in the last 30 days vs the prior 30 days.
 * Requires `created_at` column.
 */
function detectGrowthTrend(db: Database.Database, table: string): ActivityPattern[] {
  interface PeriodRow {
    cnt: number;
  }

  const t = `"${table.replace(/"/g, '""')}"`;
  const now = new Date();
  const p1Start = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const p2Start = new Date(now.getTime() - 60 * 86_400_000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  let current: PeriodRow | undefined;
  let previous: PeriodRow | undefined;
  try {
    current = db.prepare(`SELECT COUNT(*) AS cnt FROM ${t} WHERE created_at >= ?`).get(p1Start) as
      | PeriodRow
      | undefined;
    previous = db
      .prepare(`SELECT COUNT(*) AS cnt FROM ${t} WHERE created_at >= ? AND created_at < ?`)
      .get(p2Start, p1Start) as PeriodRow | undefined;
  } catch {
    return [];
  }

  const curr = current?.cnt ?? 0;
  const prev = previous?.cnt ?? 0;

  if (prev === 0 && curr === 0) return [];

  const changeRatio = prev > 0 ? (curr - prev) / prev : curr > 0 ? 1 : 0;
  const absChange = Math.abs(changeRatio);

  // Only report if change is >= 20%
  if (absChange < 0.2) return [];

  const direction = changeRatio > 0 ? 'growth' : 'decline';
  const pct = Math.round(absChange * 100);

  return [
    {
      type: 'growth-trend',
      description:
        `${direction === 'growth' ? 'Growth' : 'Decline'} detected: ` +
        `${curr} records in the last 30 days vs ${prev} in the prior 30 days (${pct}% ${direction}).`,
      confidence: Math.min(0.3 + absChange * 0.5, 0.95),
      metadata: {
        current_period_count: curr,
        previous_period_count: prev,
        change_percent: pct,
        direction,
        period_start: p1Start,
        today,
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect client activity patterns for the given DocType.
 *
 * Analyzes the DocType's records for:
 * - **Repeat customers** — entities with multiple records
 * - **Seasonal patterns** — days-of-week or months with above-average activity
 * - **Churn risk** — entities idle for more than 2× their average interaction interval
 * - **Growth trends** — 30-day growth/decline vs prior 30-day period
 *
 * Returns an empty array if the DocType table cannot be found or has fewer than
 * 3 records (not enough signal).
 *
 * @param db      - SQLite database instance
 * @param doctype - DocType name (e.g. "order", "customer")
 */
export function detectActivityPatterns(db: Database.Database, doctype: string): ActivityPattern[] {
  // Resolve the table name from the doctypes registry
  let tableName: string;
  try {
    const row = db.prepare('SELECT table_name FROM doctypes WHERE name = ?').get(doctype) as
      | { table_name: string }
      | undefined;
    if (!row) return [];
    tableName = row.table_name;
  } catch {
    return [];
  }

  // Need at least 3 records for meaningful analysis
  try {
    const countRow = db
      .prepare(`SELECT COUNT(*) AS c FROM "${tableName.replace(/"/g, '""')}"`)
      .get() as { c: number } | undefined;
    if (!countRow || countRow.c < 3) return [];
  } catch {
    return [];
  }

  const columns = getTableColumns(db, tableName);
  const entityCol = findEntityColumn(columns);
  const hasCreatedAt = hasColumn(columns, 'created_at');

  const patterns: ActivityPattern[] = [];

  if (entityCol) {
    patterns.push(...detectRepeatCustomers(db, tableName, entityCol));
    if (hasCreatedAt) {
      patterns.push(...detectChurnRisk(db, tableName, entityCol));
    }
  }

  if (hasCreatedAt) {
    patterns.push(...detectSeasonalPatterns(db, tableName));
    patterns.push(...detectGrowthTrend(db, tableName));
  }

  return patterns;
}

/**
 * Summarise activity patterns across multiple DocTypes into a plain-text block
 * suitable for injection into an AI prompt.
 *
 * @param db           - SQLite database instance
 * @param doctypeNames - List of DocType names to analyse
 */
export function summariseActivityPatterns(db: Database.Database, doctypeNames: string[]): string {
  const lines: string[] = [];

  for (const name of doctypeNames) {
    const patterns = detectActivityPatterns(db, name);
    if (patterns.length === 0) continue;

    lines.push(`**${name}**`);
    for (const p of patterns) {
      lines.push(`  [${p.type}] ${p.description}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : 'No notable activity patterns detected.';
}
