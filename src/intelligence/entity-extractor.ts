/**
 * Entity Extractor — AI-powered entity extraction from document content
 *
 * Spawns a worker agent to analyze document text and extract:
 * - Document type (invoice, receipt, contract, catalog, report, etc.)
 * - Key entities (people, companies, products, amounts, dates)
 * - Relationships between entities
 * - Structured business data from tables and free text
 *
 * TODO: Implement worker spawning for AI entity extraction
 * TODO: Implement structured JSON output parsing
 * TODO: Wire into master-manager for worker coordination
 */

export interface Entity {
  type: string;
  name: string;
  attributes?: Record<string, unknown>;
}

export interface Relation {
  from: string;
  to: string;
  type: string;
}

export interface ExtractedEntities {
  documentType?: string;
  entities?: Entity[];
  relations?: Relation[];
  amounts?: Record<string, number>;
  dates?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Extract structured entities from document content
 *
 * @param _rawText - Raw text content from document processor
 * @param _metadata - Optional metadata about the document
 * @returns Structured entities and relationships
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function extractEntities(
  _rawText: string,
  _metadata?: Record<string, unknown>,
): Promise<ExtractedEntities> {
  // TODO: Implement entity extraction pipeline
  // 1. Build extraction prompt with raw text and metadata
  // 2. Spawn worker agent with extraction-focused skill pack
  // 3. Parse worker response as JSON
  // 4. Validate extracted entities
  // 5. Return structured result
  throw new Error('extractEntities not yet implemented');
}
