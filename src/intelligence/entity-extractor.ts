/**
 * Entity Extractor — AI-powered entity extraction from document content
 *
 * Spawns a read-only worker via AgentRunner to analyze document text and extract:
 * - Document type classification (invoice, receipt, contract, etc.)
 * - Key entities (people, companies, products, amounts, dates)
 * - Relationships between entities
 *
 * Uses result-parser.ts for robust JSON extraction from AI output.
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../core/logger.js';
import type {
  ProcessorResult,
  ExtractedEntity,
  EntityRelation,
  DocumentType,
} from '../types/intelligence.js';
import { DocumentTypeSchema } from '../types/intelligence.js';
import { parseAIResult } from '../master/result-parser.js';

const logger = createLogger('entity-extractor');

/** Maximum raw text length sent to the AI worker (chars) */
const MAX_TEXT_LENGTH = 16_000;

/** Maximum number of table rows included in the prompt */
const MAX_TABLE_ROWS = 50;

/** Minimal AgentRunner typings to avoid circular import */
interface AgentRunnerResult {
  stdout: string;
  exitCode: number;
}

interface AgentRunnerLike {
  spawn(opts: {
    prompt: string;
    workspacePath: string;
    model?: string;
    allowedTools?: string[];
    maxTurns?: number;
    timeout?: number;
    retries?: number;
  }): Promise<AgentRunnerResult>;
}

/** Shape of the JSON we ask the AI to produce */
interface AIExtractionResponse {
  documentType?: string;
  entities?: Array<{
    type: string;
    name: string;
    attributes?: Record<string, unknown>;
  }>;
  relations?: Array<{
    fromName: string;
    toName: string;
    relation: string;
    attributes?: Record<string, unknown>;
  }>;
}

/** Result returned by extractEntities */
export interface EntityExtractionResult {
  docType: DocumentType;
  entities: ExtractedEntity[];
  relations: EntityRelation[];
}

/**
 * Truncate text to a maximum character length, appending a note if truncated.
 */
function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n\n[...text truncated...]';
}

/**
 * Format tables into a readable text representation for the AI prompt.
 */
function formatTables(tables: ProcessorResult['tables']): string {
  if (tables.length === 0) return '';

  const parts: string[] = ['\n## Tables\n'];
  for (const table of tables) {
    if (table.sheetName) {
      parts.push(`### ${table.sheetName}\n`);
    }
    if (table.headers.length > 0) {
      parts.push(`| ${table.headers.join(' | ')} |`);
      parts.push(`| ${table.headers.map(() => '---').join(' | ')} |`);
    }
    const rows = table.rows.slice(0, MAX_TABLE_ROWS);
    for (const row of rows) {
      parts.push(
        `| ${row.map((cell) => (cell == null ? '' : typeof cell === 'object' ? JSON.stringify(cell) : String(cell as string | number | boolean))).join(' | ')} |`,
      );
    }
    if (table.rows.length > MAX_TABLE_ROWS) {
      parts.push(`\n_...${table.rows.length - MAX_TABLE_ROWS} more rows omitted..._\n`);
    }
    parts.push('');
  }
  return parts.join('\n');
}

/**
 * Build the extraction prompt for the AI worker.
 */
function buildExtractionPrompt(processed: ProcessorResult, context?: string): string {
  const sections: string[] = [
    'Analyze the following document content and extract structured information.',
    'Return ONLY a JSON object (no markdown fences, no explanation) with this exact structure:',
    '',
    '{',
    '  "documentType": "invoice" | "receipt" | "contract" | "catalog" | "report" | "spreadsheet" | "email" | "image" | "unknown",',
    '  "entities": [',
    '    { "type": "person|company|product|amount|date|address|phone|email|reference", "name": "<value>", "attributes": { ... } }',
    '  ],',
    '  "relations": [',
    '    { "fromName": "<entity name>", "toName": "<entity name>", "relation": "issued_by|belongs_to|paid_to|references|contains|sent_by|received_by" }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- For amounts, set "name" to the formatted value (e.g. "$1,234.56") and add numeric "value" and "currency" in attributes.',
    '- For dates, set "name" to the date string and add "iso" in attributes (e.g. "2024-01-15").',
    '- Include ALL entities you can identify — people, companies, products, monetary amounts, dates, addresses, reference numbers.',
    '- Relations should link entities by their "name" field.',
    '- If you cannot determine the document type, use "unknown".',
    '',
  ];

  if (context) {
    sections.push(`## Context\n${context}\n`);
  }

  const rawText = truncateText(processed.rawText, MAX_TEXT_LENGTH);
  if (rawText.length > 0) {
    sections.push(`## Document Text\n${rawText}\n`);
  }

  const tableText = formatTables(processed.tables);
  if (tableText.length > 0) {
    sections.push(tableText);
  }

  if (Object.keys(processed.metadata).length > 0) {
    sections.push(`## Metadata\n${JSON.stringify(processed.metadata, null, 2)}\n`);
  }

  return sections.join('\n');
}

/**
 * Parse the AI response into structured entities and relations.
 */
function parseExtractionResponse(stdout: string): EntityExtractionResult {
  const parsed = parseAIResult<AIExtractionResponse>(stdout, 'entity-extraction');

  if (!parsed.success) {
    logger.warn({ error: parsed.error }, 'Failed to parse AI extraction response');
    return { docType: 'unknown', entities: [], relations: [] };
  }

  const data = parsed.data;

  // Validate document type
  const docTypeResult = DocumentTypeSchema.safeParse(data.documentType);
  const docType: DocumentType = docTypeResult.success ? docTypeResult.data : 'unknown';

  // Build entity map (name → id) for relation linking
  const entityMap = new Map<string, string>();
  const entities: ExtractedEntity[] = (data.entities ?? []).map((e) => {
    const id = randomUUID();
    entityMap.set(e.name, id);
    return {
      id,
      type: e.type,
      name: e.name,
      attributes: e.attributes,
    };
  });

  // Build relations using entity name → id mapping
  const relations: EntityRelation[] = [];
  for (const r of data.relations ?? []) {
    const fromId = entityMap.get(r.fromName);
    const toId = entityMap.get(r.toName);
    if (!fromId || !toId) {
      logger.debug(
        { fromName: r.fromName, toName: r.toName },
        'Skipping relation with unknown entity reference',
      );
      continue;
    }
    const rel: EntityRelation = {
      fromId,
      toId,
      relation: r.relation,
    };
    if (r.attributes) {
      rel.attributes = r.attributes;
    }
    relations.push(rel);
  }

  return { docType, entities, relations };
}

/**
 * Extract structured entities from processed document content.
 *
 * Spawns a read-only worker via AgentRunner with a prompt containing
 * the raw text and tables. Parses the worker's JSON output via result-parser.
 *
 * @param processed - ProcessorResult from a format-specific processor
 * @param context - Optional context hint (e.g. "this was sent via WhatsApp")
 * @returns Extracted entities, relations, and document type classification
 */
export async function extractEntities(
  processed: ProcessorResult,
  context?: string,
): Promise<EntityExtractionResult> {
  // Skip extraction if there's no meaningful content
  if (processed.rawText.trim().length === 0 && processed.tables.length === 0) {
    logger.debug('No text or tables to extract entities from');
    return { docType: 'unknown', entities: [], relations: [] };
  }

  const prompt = buildExtractionPrompt(processed, context);

  // Dynamically import AgentRunner to avoid circular dependencies
  let AgentRunner: new () => AgentRunnerLike;
  try {
    const mod = (await import('../core/agent-runner.js')) as {
      AgentRunner: new () => AgentRunnerLike;
    };
    AgentRunner = mod.AgentRunner;
  } catch {
    logger.warn('AgentRunner not available, returning empty extraction');
    return { docType: 'unknown', entities: [], relations: [] };
  }

  const runner = new AgentRunner();
  try {
    const result = await runner.spawn({
      prompt,
      workspacePath: '.',
      allowedTools: ['Read', 'Glob', 'Grep'],
      maxTurns: 3,
      // Sonnet-class models need 90-130s for image analysis (OB-F206)
      timeout: 180_000,
      retries: 0,
    });

    if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
      logger.warn(
        { exitCode: result.exitCode, outputLen: result.stdout.length },
        'Entity extraction worker returned no useful output',
      );
      return { docType: 'unknown', entities: [], relations: [] };
    }

    const extraction = parseExtractionResponse(result.stdout);

    logger.info(
      {
        docType: extraction.docType,
        entityCount: extraction.entities.length,
        relationCount: extraction.relations.length,
      },
      'Entity extraction complete',
    );

    return extraction;
  } catch (err) {
    logger.error({ err }, 'Entity extraction worker failed');
    return { docType: 'unknown', entities: [], relations: [] };
  }
}
