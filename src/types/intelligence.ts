import { z } from 'zod/v3';

// ── DocumentType Enum ─────────────────────────────────────────────

/** Classification of a business document by its purpose */
export const DocumentTypeSchema = z.enum([
  'invoice',
  'receipt',
  'contract',
  'catalog',
  'report',
  'spreadsheet',
  'email',
  'image',
  'unknown',
]);

export type DocumentType = z.infer<typeof DocumentTypeSchema>;

// ── Table Data ────────────────────────────────────────────────────

/** A structured table extracted from a document */
export const ExtractedTableSchema = z.object({
  /** Sheet or table name (e.g. "Sheet1", "Items") */
  sheetName: z.string().optional(),
  /** Column headers */
  headers: z.array(z.string()),
  /** Data rows — each row is an array of cell values */
  rows: z.array(z.array(z.unknown())),
});

export type ExtractedTable = z.infer<typeof ExtractedTableSchema>;

// ── ProcessorResult ───────────────────────────────────────────────

/** Raw output from a format-specific processor before entity extraction */
export const ProcessorResultSchema = z.object({
  /** Full plain-text content extracted from the document */
  rawText: z.string(),
  /** Structured tables found in the document */
  tables: z.array(ExtractedTableSchema).default([]),
  /** Image references or base64 data extracted from the document */
  images: z.array(z.unknown()).default([]),
  /** Format-specific metadata (page count, author, MIME type, etc.) */
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type ProcessorResult = z.infer<typeof ProcessorResultSchema>;

// ── ExtractedEntity ───────────────────────────────────────────────

/** A single named entity extracted by the AI from document content */
export const ExtractedEntitySchema = z
  .object({
    /** Unique identifier for this entity within the document */
    id: z.string(),
    /** Semantic entity type (e.g. "person", "company", "product", "amount", "date") */
    type: z.string(),
    /** Canonical display name / value */
    name: z.string(),
    /** Optional additional attributes produced by the AI */
    attributes: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;

// ── EntityRelation ────────────────────────────────────────────────

/** A directed relationship between two extracted entities */
export const EntityRelationSchema = z
  .object({
    /** ID of the source entity */
    fromId: z.string(),
    /** ID of the target entity */
    toId: z.string(),
    /** Relationship label (e.g. "issued_by", "belongs_to", "references") */
    relation: z.string(),
    /** Optional metadata about this relationship */
    attributes: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type EntityRelation = z.infer<typeof EntityRelationSchema>;

// ── ProcessedDocument ─────────────────────────────────────────────

/** Fully processed document with extracted content and entities */
export const ProcessedDocumentSchema = z
  .object({
    /** Unique document ID (UUID) */
    id: z.string(),
    /** Original file name */
    filename: z.string(),
    /** Detected MIME type */
    mimeType: z.string(),
    /** Absolute path to the source file */
    filePath: z.string(),
    /** Classified document type */
    docType: DocumentTypeSchema.default('unknown'),
    /** Full plain-text content */
    rawText: z.string(),
    /** Structured tables extracted from the document */
    tables: z.array(ExtractedTableSchema).default([]),
    /** Image references extracted from the document */
    images: z.array(z.unknown()).default([]),
    /** Named entities extracted by AI */
    entities: z.array(ExtractedEntitySchema).default([]),
    /** Relationships between entities */
    relations: z.array(EntityRelationSchema).default([]),
    /** Format-specific metadata */
    metadata: z.record(z.string(), z.unknown()).default({}),
    /** ISO-8601 timestamp of when this document was processed */
    processedAt: z.string().datetime(),
    /** Source connector that provided the file (e.g. "whatsapp", "telegram", "cli") */
    source: z.string().optional(),
  })
  .passthrough();

export type ProcessedDocument = z.infer<typeof ProcessedDocumentSchema>;
