import type Database from 'better-sqlite3';
import type { ProcessedDocument } from '../types/intelligence.js';

// ---------------------------------------------------------------------------
// FTS5 query sanitization (same approach as chunk-store.ts)
// ---------------------------------------------------------------------------

function sanitizeFts5Query(raw: string): string {
  const cleaned = raw.replace(/["*(){}[\]:^~?@#$%&\\|<>=!+,;]/g, ' ');
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"`).join(' ');
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface ProcessedDocumentRow {
  id: string;
  filename: string;
  mime_type: string;
  file_path: string;
  doc_type: string;
  raw_text: string;
  entities: string;
  relations: string;
  tables: string;
  metadata: string;
  processed_at: string;
  source: string | null;
}

function rowToDocument(row: ProcessedDocumentRow): ProcessedDocument {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    filePath: row.file_path,
    docType: row.doc_type as ProcessedDocument['docType'],
    rawText: row.raw_text,
    entities: JSON.parse(row.entities) as ProcessedDocument['entities'],
    relations: JSON.parse(row.relations) as ProcessedDocument['relations'],
    tables: JSON.parse(row.tables) as ProcessedDocument['tables'],
    images: [],
    metadata: JSON.parse(row.metadata) as ProcessedDocument['metadata'],
    processedAt: row.processed_at,
    source: row.source ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Schema creation
// ---------------------------------------------------------------------------

/**
 * Ensure the `processed_documents` and `processed_documents_fts` tables exist.
 * Safe to call multiple times (uses CREATE TABLE IF NOT EXISTS).
 */
export function ensureDocumentStoreSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS processed_documents (
      id           TEXT PRIMARY KEY,
      filename     TEXT NOT NULL,
      mime_type    TEXT NOT NULL,
      file_path    TEXT NOT NULL,
      doc_type     TEXT NOT NULL DEFAULT 'unknown',
      raw_text     TEXT NOT NULL DEFAULT '',
      entities     TEXT NOT NULL DEFAULT '[]',
      relations    TEXT NOT NULL DEFAULT '[]',
      tables       TEXT NOT NULL DEFAULT '[]',
      metadata     TEXT NOT NULL DEFAULT '{}',
      processed_at TEXT NOT NULL,
      source       TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS processed_documents_fts
      USING fts5(raw_text, filename, content='processed_documents', content_rowid='rowid');
  `);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Persist a fully processed document to SQLite and index it in FTS5.
 * If a document with the same `id` already exists it is replaced.
 *
 * @param db  - Open better-sqlite3 database instance
 * @param doc - The processed document to store
 * @returns   The document ID
 */
export function storeDocument(db: Database.Database, doc: ProcessedDocument): string {
  ensureDocumentStoreSchema(db);

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO processed_documents
      (id, filename, mime_type, file_path, doc_type, raw_text, entities, relations, tables, metadata, processed_at, source)
    VALUES
      (@id, @filename, @mime_type, @file_path, @doc_type, @raw_text, @entities, @relations, @tables, @metadata, @processed_at, @source)
  `);

  const rebuildFts = db.prepare(`
    INSERT OR REPLACE INTO processed_documents_fts (rowid, raw_text, filename)
    SELECT rowid, raw_text, filename FROM processed_documents WHERE id = ?
  `);

  db.transaction(() => {
    upsert.run({
      id: doc.id,
      filename: doc.filename,
      mime_type: doc.mimeType,
      file_path: doc.filePath,
      doc_type: doc.docType ?? 'unknown',
      raw_text: doc.rawText,
      entities: JSON.stringify(doc.entities ?? []),
      relations: JSON.stringify(doc.relations ?? []),
      tables: JSON.stringify(doc.tables ?? []),
      metadata: JSON.stringify(doc.metadata ?? {}),
      processed_at: doc.processedAt,
      source: doc.source ?? null,
    });

    rebuildFts.run(doc.id);
  })();

  return doc.id;
}

/**
 * Retrieve a stored document by its ID.
 *
 * @param db         - Open better-sqlite3 database instance
 * @param documentId - UUID of the document
 * @returns The document record, or `null` if not found
 */
export function getDocument(db: Database.Database, documentId: string): ProcessedDocument | null {
  ensureDocumentStoreSchema(db);

  const row = db.prepare(`SELECT * FROM processed_documents WHERE id = ?`).get(documentId) as
    | ProcessedDocumentRow
    | undefined;

  return row ? rowToDocument(row) : null;
}

/**
 * Full-text search over processed documents using the FTS5 index.
 * Searches both `raw_text` and `filename` columns.
 *
 * @param db    - Open better-sqlite3 database instance
 * @param query - Search query string
 * @param limit - Maximum number of results (default 10)
 * @returns Array of matching documents ordered by relevance
 */
export function searchDocuments(
  db: Database.Database,
  query: string,
  limit = 10,
): ProcessedDocument[] {
  ensureDocumentStoreSchema(db);

  if (!query.trim()) return [];

  const sanitized = sanitizeFts5Query(query);
  if (!sanitized) return [];

  try {
    const rows = db
      .prepare(
        `SELECT d.*
         FROM processed_documents d
         JOIN (
           SELECT rowid
           FROM processed_documents_fts
           WHERE processed_documents_fts MATCH ?
           ORDER BY rank
           LIMIT ?
         ) AS ranked ON d.rowid = ranked.rowid`,
      )
      .all(sanitized, limit) as ProcessedDocumentRow[];

    return rows.map(rowToDocument);
  } catch {
    return [];
  }
}
