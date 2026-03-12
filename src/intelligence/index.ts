/**
 * Intelligence Module — Document processing and entity extraction
 *
 * Provides the document intelligence layer for OpenBridge:
 * - Process business files (PDF, Excel, DOCX, images)
 * - Extract structured entities (people, companies, amounts, dates)
 * - Store processed documents with FTS5 search
 * - Support AI-powered document understanding
 *
 * Part of the Document Intelligence Layer (OB-F184)
 */

export * from './document-processor.js';
export * from './entity-extractor.js';
export * from './document-store.js';
export * from './processors/index.js';
export * from './doctype-store.js';
export * from './naming-series.js';
export * from './doctype-api.js';
export * from './form-generator.js';
export * from './list-generator.js';
