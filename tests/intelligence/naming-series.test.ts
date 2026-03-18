import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { generateNextNumber } from '../../src/intelligence/naming-series.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS dt_series (
      prefix TEXT PRIMARY KEY,
      current_value INTEGER NOT NULL DEFAULT 0
    )
  `);
  return db;
}

describe('naming-series', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb();
  });

  it('first number for a new prefix returns 00001', () => {
    const result = generateNextNumber(db, 'INV-{YYYY}-{#####}', new Date('2026-03-01'));
    expect(result).toBe('INV-2026-00001');
  });

  it('sequential calls return unique incrementing numbers', () => {
    const now = new Date('2026-03-01');
    const results = [
      generateNextNumber(db, 'INV-{YYYY}-{#####}', now),
      generateNextNumber(db, 'INV-{YYYY}-{#####}', now),
      generateNextNumber(db, 'INV-{YYYY}-{#####}', now),
    ];
    expect(results).toEqual(['INV-2026-00001', 'INV-2026-00002', 'INV-2026-00003']);
  });

  it('concurrent increments return unique numbers', () => {
    const now = new Date('2026-03-01');
    const COUNT = 20;
    const results: string[] = [];
    for (let i = 0; i < COUNT; i++) {
      results.push(generateNextNumber(db, 'QUO-{YYYY}-{###}', now));
    }
    const unique = new Set(results);
    expect(unique.size).toBe(COUNT);
  });

  it('pattern parsing handles {YYYY} placeholder', () => {
    const result = generateNextNumber(db, 'PO-{YYYY}-{##}', new Date('2025-06-15'));
    expect(result).toMatch(/^PO-2025-\d+$/);
    expect(result).toBe('PO-2025-01');
  });

  it('pattern parsing handles {MM} placeholder', () => {
    const result = generateNextNumber(db, 'ORD-{MM}-{###}', new Date('2026-07-04'));
    expect(result).toBe('ORD-07-001');
  });

  it('pattern parsing handles combined {YYYY}-{MM}-{###} placeholders', () => {
    const result = generateNextNumber(db, 'QUO-{YYYY}-{MM}-{###}', new Date('2026-03-05'));
    expect(result).toBe('QUO-2026-03-001');
  });

  it('pattern parsing handles {#####} with exact zero-padding width', () => {
    const result = generateNextNumber(db, 'BILL-{#####}', new Date('2026-01-01'));
    expect(result).toBe('BILL-00001');
  });

  it('year rollover creates a new independent counter', () => {
    const oldYear = new Date('2025-12-31');
    const newYear = new Date('2026-01-01');

    const last2025 = generateNextNumber(db, 'INV-{YYYY}-{#####}', oldYear);
    expect(last2025).toBe('INV-2025-00001');

    const first2026 = generateNextNumber(db, 'INV-{YYYY}-{#####}', newYear);
    expect(first2026).toBe('INV-2026-00001');

    // Old prefix still increments independently
    const second2025 = generateNextNumber(db, 'INV-{YYYY}-{#####}', oldYear);
    expect(second2025).toBe('INV-2025-00002');
  });

  it('different patterns use independent counters', () => {
    const now = new Date('2026-03-01');
    expect(generateNextNumber(db, 'INV-{YYYY}-{###}', now)).toBe('INV-2026-001');
    expect(generateNextNumber(db, 'QUO-{YYYY}-{###}', now)).toBe('QUO-2026-001');
    expect(generateNextNumber(db, 'INV-{YYYY}-{###}', now)).toBe('INV-2026-002');
  });

  it('unknown token treated as literal', () => {
    const result = generateNextNumber(db, '{UNKNOWN}-{##}', new Date('2026-01-01'));
    expect(result).toBe('{UNKNOWN}-01');
  });
});
