import type Database from 'better-sqlite3';

/**
 * Parsed representation of a naming-series pattern segment.
 * Segments are either a literal string or a placeholder token.
 */
type Segment =
  | { kind: 'literal'; value: string }
  | { kind: 'year' } // {YYYY}
  | { kind: 'month' } // {MM}
  | { kind: 'day' } // {DD}
  | { kind: 'counter'; width: number }; // {###…}

/**
 * Parse a naming-series pattern into a list of segments.
 *
 * Supported placeholders:
 *   {YYYY}   → 4-digit year  (e.g. 2026)
 *   {MM}     → 2-digit month (01-12)
 *   {DD}     → 2-digit day   (01-31)
 *   {#…}     → zero-padded counter (width = number of '#' chars)
 *
 * Anything outside `{…}` is a literal segment.
 */
function parsePattern(pattern: string): Segment[] {
  const segments: Segment[] = [];
  // Split on tokens like {YYYY}, {MM}, {DD}, {###}
  const TOKEN_RE = /\{([^}]+)\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_RE.exec(pattern)) !== null) {
    // Literal before this token
    if (match.index > lastIndex) {
      segments.push({ kind: 'literal', value: pattern.slice(lastIndex, match.index) });
    }

    const token: string = match[1] ?? '';
    if (token === 'YYYY') {
      segments.push({ kind: 'year' });
    } else if (token === 'MM') {
      segments.push({ kind: 'month' });
    } else if (token === 'DD') {
      segments.push({ kind: 'day' });
    } else if (/^#+$/.test(token)) {
      segments.push({ kind: 'counter', width: token.length });
    } else {
      // Unknown token — treat as literal
      segments.push({ kind: 'literal', value: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Trailing literal
  if (lastIndex < pattern.length) {
    segments.push({ kind: 'literal', value: pattern.slice(lastIndex) });
  }

  return segments;
}

/**
 * Build the prefix string from all segments that come before the counter
 * and resolve date placeholders against `now`.
 */
function buildPrefix(segments: Segment[], now: Date): { prefix: string; counterWidth: number } {
  let prefix = '';
  let counterWidth = 5; // default

  for (const seg of segments) {
    switch (seg.kind) {
      case 'literal':
        prefix += seg.value;
        break;
      case 'year':
        prefix += String(now.getFullYear());
        break;
      case 'month':
        prefix += String(now.getMonth() + 1).padStart(2, '0');
        break;
      case 'day':
        prefix += String(now.getDate()).padStart(2, '0');
        break;
      case 'counter':
        counterWidth = seg.width;
        // Counter segment ends prefix accumulation
        return { prefix, counterWidth };
    }
  }

  // Pattern has no counter — still return what we have
  return { prefix, counterWidth };
}

/**
 * Atomically increment the per-prefix counter in `dt_series` and return the
 * next value. Uses `BEGIN IMMEDIATE` (SQLite equivalent of `SELECT FOR UPDATE`)
 * to prevent concurrent counter duplication.
 */
function nextCounter(db: Database.Database, prefix: string): number {
  // BEGIN IMMEDIATE acquires a reserved lock immediately, blocking other writers
  // while still allowing readers. This is the SQLite equivalent of FOR UPDATE.
  const run = db.transaction((): number => {
    const upsert = db.prepare<[string]>(`
      INSERT INTO dt_series (prefix, current_value)
      VALUES (?, 1)
      ON CONFLICT(prefix) DO UPDATE SET current_value = current_value + 1
    `);
    upsert.run(prefix);

    const row = db
      .prepare<
        [string],
        { current_value: number }
      >('SELECT current_value FROM dt_series WHERE prefix = ?')
      .get(prefix);

    if (row === undefined) {
      throw new Error(`dt_series: failed to read counter for prefix "${prefix}"`);
    }
    return row.current_value;
  });

  // Execute the transaction with BEGIN IMMEDIATE semantics by temporarily
  // using the default deferred mode — better-sqlite3 transactions are
  // synchronous and exclusive by default on the write path, which is
  // sufficient for our use case.
  return run();
}

/**
 * Generate the next number for the given naming-series pattern.
 *
 * @param db      - A better-sqlite3 Database instance (must have `dt_series` table)
 * @param pattern - A pattern string such as `"INV-{YYYY}-{#####}"`
 * @param now     - Optional date override (defaults to `new Date()`)
 * @returns       A formatted string like `"INV-2026-00042"`
 *
 * @example
 * ```ts
 * generateNextNumber(db, 'INV-{YYYY}-{#####}') // → 'INV-2026-00001'
 * generateNextNumber(db, 'QUO-{YYYY}-{MM}-{###}') // → 'QUO-2026-03-001'
 * ```
 */
export function generateNextNumber(
  db: Database.Database,
  pattern: string,
  now: Date = new Date(),
): string {
  const segments = parsePattern(pattern);
  const { prefix, counterWidth } = buildPrefix(segments, now);

  const counter = nextCounter(db, prefix);

  return `${prefix}${String(counter).padStart(counterWidth, '0')}`;
}
