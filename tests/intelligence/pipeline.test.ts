/**
 * Integration test: full document intelligence pipeline
 *
 * Tests the complete flow: create a CSV file → processDocument() →
 * extractEntities() → storeDocument() → searchDocuments().
 * Verifies data flows correctly through each stage. AI worker calls are mocked.
 *
 * Resolves OB-1353 (OB-F184)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';

import type { ProcessedDocument, ProcessorResult } from '../../src/types/intelligence.js';

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing SUT modules
// ---------------------------------------------------------------------------

// Mock logger
vi.mock('../../src/core/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

// Mock file-type so processDocument() falls back to extension-based detection
vi.mock('file-type', () => ({
  fileTypeFromBuffer: vi.fn().mockResolvedValue(null),
}));

// Mock AgentRunner for entity extraction (avoid spawning real AI workers)
vi.mock('../../src/core/agent-runner.js', () => ({
  AgentRunner: class {
    async spawn() {
      return {
        stdout: JSON.stringify({
          documentType: 'spreadsheet',
          entities: [
            { type: 'company', name: 'Acme Corp', attributes: { industry: 'manufacturing' } },
            { type: 'company', name: 'Globex Inc', attributes: { industry: 'tech' } },
            { type: 'amount', name: '$1,250.00', attributes: { value: 1250, currency: 'USD' } },
            { type: 'amount', name: '$3,400.50', attributes: { value: 3400.5, currency: 'USD' } },
            { type: 'date', name: '2024-01-15', attributes: { iso: '2024-01-15' } },
            { type: 'date', name: '2024-02-20', attributes: { iso: '2024-02-20' } },
          ],
          relations: [
            { fromName: '$1,250.00', toName: 'Acme Corp', relation: 'paid_to' },
            { fromName: '$3,400.50', toName: 'Globex Inc', relation: 'paid_to' },
          ],
        }),
        exitCode: 0,
      };
    }
  },
}));

// ---------------------------------------------------------------------------
// Import SUT modules after mocks
// ---------------------------------------------------------------------------

import { processDocument } from '../../src/intelligence/document-processor.js';
import { extractEntities } from '../../src/intelligence/entity-extractor.js';
import {
  ensureDocumentStoreSchema,
  storeDocument,
  searchDocuments,
  getDocument,
} from '../../src/intelligence/document-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempFiles: string[] = [];
let db: Database.Database;

function createTempCsv(content: string, filename = 'test.csv'): string {
  const filePath = path.join(os.tmpdir(), `ob-pipeline-test-${Date.now()}-${filename}`);
  fs.writeFileSync(filePath, content, 'utf-8');
  tempFiles.push(filePath);
  return filePath;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  db = new Database(':memory:');
  ensureDocumentStoreSchema(db);
});

afterEach(() => {
  db.close();
  for (const f of tempFiles.splice(0)) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
});

// ---------------------------------------------------------------------------
// Integration Tests
// ---------------------------------------------------------------------------

describe('Document Intelligence Pipeline (integration)', () => {
  const CSV_CONTENT = [
    'Customer,Amount,Date,Description',
    'Acme Corp,1250.00,2024-01-15,Quarterly service payment',
    'Globex Inc,3400.50,2024-02-20,Annual license renewal',
    'Acme Corp,780.00,2024-03-10,Support contract extension',
  ].join('\n');

  it('processDocument() extracts CSV content with correct structure', async () => {
    const filePath = createTempCsv(CSV_CONTENT);

    const doc = await processDocument(filePath);

    expect(doc.id).toBeTruthy();
    expect(doc.filename).toContain('.csv');
    expect(doc.mimeType).toBe('text/csv');
    expect(doc.filePath).toBe(filePath);
    expect(doc.docType).toBe('unknown'); // processDocument doesn't classify
    expect(doc.rawText).toContain('Acme Corp');
    expect(doc.rawText).toContain('Globex Inc');
    expect(doc.tables).toHaveLength(1);
    expect(doc.tables[0]?.headers).toEqual(['Customer', 'Amount', 'Date', 'Description']);
    expect(doc.tables[0]?.rows).toHaveLength(3);
    expect(doc.entities).toEqual([]);
    expect(doc.relations).toEqual([]);
    expect(doc.processedAt).toBeTruthy();
  });

  it('extractEntities() enriches document with AI-extracted entities and relations', async () => {
    const filePath = createTempCsv(CSV_CONTENT);
    const doc = await processDocument(filePath);

    // Build ProcessorResult from ProcessedDocument for extractEntities
    const processorResult: ProcessorResult = {
      rawText: doc.rawText,
      tables: doc.tables,
      images: [],
      metadata: doc.metadata,
    };

    const extraction = await extractEntities(processorResult);

    expect(extraction.docType).toBe('spreadsheet');
    expect(extraction.entities).toHaveLength(6);

    // Verify entity types
    const companies = extraction.entities.filter((e) => e.type === 'company');
    const amounts = extraction.entities.filter((e) => e.type === 'amount');
    const dates = extraction.entities.filter((e) => e.type === 'date');
    expect(companies).toHaveLength(2);
    expect(amounts).toHaveLength(2);
    expect(dates).toHaveLength(2);

    // Verify entity IDs are UUIDs
    for (const entity of extraction.entities) {
      expect(entity.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }

    // Verify relations link to valid entity IDs
    expect(extraction.relations).toHaveLength(2);
    const entityIds = new Set(extraction.entities.map((e) => e.id));
    for (const rel of extraction.relations) {
      expect(entityIds.has(rel.fromId)).toBe(true);
      expect(entityIds.has(rel.toId)).toBe(true);
      expect(rel.relation).toBe('paid_to');
    }
  });

  it('storeDocument() persists and getDocument() retrieves correctly', async () => {
    const filePath = createTempCsv(CSV_CONTENT);
    const doc = await processDocument(filePath);

    // Enrich with entities
    const processorResult: ProcessorResult = {
      rawText: doc.rawText,
      tables: doc.tables,
      images: [],
      metadata: doc.metadata,
    };
    const extraction = await extractEntities(processorResult);

    const enrichedDoc: ProcessedDocument = {
      ...doc,
      docType: extraction.docType,
      entities: extraction.entities,
      relations: extraction.relations,
    };

    // Store
    const storedId = storeDocument(db, enrichedDoc);
    expect(storedId).toBe(enrichedDoc.id);

    // Retrieve
    const retrieved = getDocument(db, storedId);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(enrichedDoc.id);
    expect(retrieved!.filename).toBe(enrichedDoc.filename);
    expect(retrieved!.mimeType).toBe('text/csv');
    expect(retrieved!.docType).toBe('spreadsheet');
    expect(retrieved!.rawText).toContain('Acme Corp');
    expect(retrieved!.entities).toHaveLength(6);
    expect(retrieved!.relations).toHaveLength(2);
    expect(retrieved!.tables).toHaveLength(1);
    expect(retrieved!.tables[0]?.headers).toEqual(['Customer', 'Amount', 'Date', 'Description']);
  });

  it('searchDocuments() finds stored documents via FTS5', async () => {
    const filePath = createTempCsv(CSV_CONTENT);
    const doc = await processDocument(filePath);

    storeDocument(db, doc);

    // Search by content
    const results = searchDocuments(db, 'Acme Corp');
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(doc.id);
    expect(results[0]!.rawText).toContain('Acme Corp');

    // Search by another term
    const results2 = searchDocuments(db, 'Globex');
    expect(results2).toHaveLength(1);
    expect(results2[0]!.id).toBe(doc.id);

    // Search with no match
    const noResults = searchDocuments(db, 'nonexistenttermxyz');
    expect(noResults).toHaveLength(0);
  });

  it('full pipeline: CSV → process → extract → store → search', async () => {
    const filePath = createTempCsv(CSV_CONTENT);

    // Step 1: Process the document
    const doc = await processDocument(filePath);
    expect(doc.tables).toHaveLength(1);
    expect(doc.rawText.length).toBeGreaterThan(0);

    // Step 2: Extract entities
    const processorResult: ProcessorResult = {
      rawText: doc.rawText,
      tables: doc.tables,
      images: [],
      metadata: doc.metadata,
    };
    const extraction = await extractEntities(processorResult);
    expect(extraction.docType).toBe('spreadsheet');
    expect(extraction.entities.length).toBeGreaterThan(0);

    // Step 3: Enrich and store
    const enrichedDoc: ProcessedDocument = {
      ...doc,
      docType: extraction.docType,
      entities: extraction.entities,
      relations: extraction.relations,
    };
    const storedId = storeDocument(db, enrichedDoc);

    // Step 4: Search and verify round-trip
    const searchResults = searchDocuments(db, 'license renewal');
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]!.id).toBe(storedId);
    expect(searchResults[0]!.docType).toBe('spreadsheet');
    expect(searchResults[0]!.entities).toHaveLength(6);
    expect(searchResults[0]!.relations).toHaveLength(2);

    // Verify entity data survived the round-trip
    const companies = searchResults[0]!.entities.filter((e) => e.type === 'company');
    expect(companies.map((c) => c.name).sort()).toEqual(['Acme Corp', 'Globex Inc']);

    // Verify relation IDs match entities in the result
    const resultEntityIds = new Set(searchResults[0]!.entities.map((e) => e.id));
    for (const rel of searchResults[0]!.relations) {
      expect(resultEntityIds.has(rel.fromId)).toBe(true);
      expect(resultEntityIds.has(rel.toId)).toBe(true);
    }
  });

  it('searchDocuments() finds document by filename', async () => {
    const filePath = createTempCsv(CSV_CONTENT, 'invoices-2024.csv');
    const doc = await processDocument(filePath);
    storeDocument(db, doc);

    const results = searchDocuments(db, 'invoices');
    expect(results).toHaveLength(1);
    expect(results[0]!.filename).toContain('invoices-2024.csv');
  });

  it('storeDocument() replaces existing document on re-store', async () => {
    const filePath = createTempCsv(CSV_CONTENT);
    const doc = await processDocument(filePath);

    storeDocument(db, doc);

    // Modify and re-store
    const updatedDoc: ProcessedDocument = { ...doc, docType: 'invoice' };
    storeDocument(db, updatedDoc);

    const retrieved = getDocument(db, doc.id);
    expect(retrieved!.docType).toBe('invoice');

    // Only one document in search results
    const results = searchDocuments(db, 'Acme');
    expect(results).toHaveLength(1);
  });

  it('handles empty CSV gracefully through the pipeline', async () => {
    const filePath = createTempCsv('');
    const doc = await processDocument(filePath);

    // Empty CSV may still produce a table with empty header from SheetJS
    expect(doc.rawText).toBe('');
    expect(doc.tables.length).toBeLessThanOrEqual(1);

    // Store and verify retrieval works for empty docs
    storeDocument(db, doc);
    const retrieved = getDocument(db, doc.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.rawText).toBe('');
  });

  it('multiple documents are independently searchable', async () => {
    const csv1 = createTempCsv('Name,City\nAlice,Paris\nBob,London', 'people.csv');
    const csv2 = createTempCsv('Product,Price\nWidget,9.99\nGadget,19.99', 'products.csv');

    const doc1 = await processDocument(csv1);
    const doc2 = await processDocument(csv2);

    storeDocument(db, doc1);
    storeDocument(db, doc2);

    const parisResults = searchDocuments(db, 'Paris');
    expect(parisResults).toHaveLength(1);
    expect(parisResults[0]!.id).toBe(doc1.id);

    const widgetResults = searchDocuments(db, 'Widget');
    expect(widgetResults).toHaveLength(1);
    expect(widgetResults[0]!.id).toBe(doc2.id);
  });
});
