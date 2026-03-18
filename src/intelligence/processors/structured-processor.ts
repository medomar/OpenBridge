/**
 * Structured Processor — Parse JSON and XML into structured tables
 *
 * For JSON: JSON.parse() + detect schema (array of objects → table format).
 * For XML: uses xml2js to parse to JS object, detects repeated elements as tables.
 */

import { readFile } from 'fs/promises';
import { createLogger } from '../../core/logger.js';
import type { ExtractedTable, ProcessorResult } from '../../types/intelligence.js';

const logger = createLogger('structured-processor');

/**
 * Detect if a value is a plain object (not null, not array, not primitive).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Convert an array of objects into an ExtractedTable.
 * Collects all keys across all rows as headers.
 */
function arrayOfObjectsToTable(arr: Record<string, unknown>[], name?: string): ExtractedTable {
  // Collect union of all keys
  const keySet = new Set<string>();
  for (const item of arr) {
    for (const key of Object.keys(item)) {
      keySet.add(key);
    }
  }
  const headers = Array.from(keySet);
  const rows = arr.map((item) =>
    headers.map((h) => {
      const val = item[h];
      if (val === undefined || val === null) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return val;
    }),
  );
  const table: ExtractedTable = { headers, rows };
  if (name) table.sheetName = name;
  return table;
}

/**
 * Recursively walk a parsed JS object and extract tables from repeated elements.
 *
 * xml2js parses `<items><item>...</item><item>...</item></items>` as
 * `{ items: { item: [{...}, {...}] } }` — each key whose value is an array
 * of objects (or arrays) is treated as a table.
 */
function extractTablesFromObject(
  obj: Record<string, unknown>,
  parentKey = '',
  tables: ExtractedTable[] = [],
): ExtractedTable[] {
  for (const [key, value] of Object.entries(obj)) {
    const label = parentKey ? `${parentKey}.${key}` : key;

    if (Array.isArray(value) && value.length > 0) {
      // Array of plain objects → table
      const objectItems = value.filter(isPlainObject);
      if (objectItems.length > 0) {
        tables.push(arrayOfObjectsToTable(objectItems, label));
        // Also recurse into sub-objects
        for (const item of objectItems) {
          extractTablesFromObject(item, label, tables);
        }
        continue;
      }

      // Array of primitives → single-column table
      if (value.every((v) => typeof v !== 'object' || v === null)) {
        tables.push({
          sheetName: label,
          headers: [key],
          rows: value.map((v) => [v === null ? '' : String(v)]),
        });
        continue;
      }
    }

    // Nested object → recurse
    if (isPlainObject(value)) {
      extractTablesFromObject(value, label, tables);
    }
  }
  return tables;
}

/**
 * Build a plain-text representation of an object recursively.
 */
function objectToText(value: unknown, indent = 0): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object')
    return value == null ? '' : String(value as string | number | boolean | bigint | symbol);
  if (Array.isArray(value)) {
    return value.map((v) => objectToText(v, indent)).join('\n');
  }
  const obj = value as Record<string, unknown>;
  return Object.entries(obj)
    .map(([k, v]) => {
      const prefix = '  '.repeat(indent);
      if (typeof v === 'object' && v !== null) {
        return `${prefix}${k}:\n${objectToText(v, indent + 1)}`;
      }
      return `${prefix}${k}: ${v == null ? '' : String(v as string | number | boolean | bigint | symbol)}`;
    })
    .join('\n');
}

/**
 * Process a JSON file.
 * If the top-level value is an array of objects, convert to a table.
 * Otherwise, recursively extract any nested arrays of objects as tables.
 */
async function processJson(filePath: string): Promise<ProcessorResult> {
  const content = await readFile(filePath, 'utf-8');
  let parsed: unknown;

  try {
    parsed = JSON.parse(content) as unknown;
  } catch (err) {
    logger.warn({ filePath, err }, 'Failed to parse JSON file');
    return {
      rawText: content,
      tables: [],
      images: [],
      metadata: { parseError: String(err) },
    };
  }

  const tables: ExtractedTable[] = [];
  let rawText = '';

  if (Array.isArray(parsed)) {
    const objectItems = parsed.filter(isPlainObject);
    if (objectItems.length > 0) {
      // Top-level array of objects → primary table
      tables.push(arrayOfObjectsToTable(objectItems, 'root'));
      // Recurse into each item for nested tables
      for (const item of objectItems) {
        extractTablesFromObject(item, 'root', tables);
      }
    }
    rawText = objectToText(parsed);
  } else if (isPlainObject(parsed)) {
    extractTablesFromObject(parsed, '', tables);
    rawText = objectToText(parsed);
  } else {
    // Primitive at top level (string, number, boolean, null)
    rawText = parsed == null ? '' : String(parsed as string | number | boolean | bigint | symbol);
  }

  logger.info(
    { filePath, tableCount: tables.length, textLength: rawText.length },
    'JSON processing complete',
  );

  return {
    rawText,
    tables,
    images: [],
    metadata: {
      format: 'json',
      topLevelType: Array.isArray(parsed) ? 'array' : typeof parsed,
    },
  };
}

/**
 * Process an XML file using xml2js.
 * Detects repeated elements as tables.
 */
async function processXml(filePath: string): Promise<ProcessorResult> {
  const content = await readFile(filePath, 'utf-8');

  // Dynamic import for ESM compatibility
  const xml2jsMod = (await import('xml2js')) as {
    parseStringPromise: (xml: string, opts?: Record<string, unknown>) => Promise<unknown>;
  };
  const { parseStringPromise } = xml2jsMod;

  let parsed: unknown;
  try {
    parsed = await parseStringPromise(content, {
      explicitArray: true, // Always wrap in arrays for consistency
      explicitCharkey: false,
      mergeAttrs: true,
    });
  } catch (err) {
    logger.warn({ filePath, err }, 'Failed to parse XML file');
    return {
      rawText: content,
      tables: [],
      images: [],
      metadata: { parseError: String(err) },
    };
  }

  const tables: ExtractedTable[] = [];
  if (isPlainObject(parsed)) {
    extractTablesFromObject(parsed, '', tables);
  }

  const rawText = objectToText(parsed);

  logger.info(
    { filePath, tableCount: tables.length, textLength: rawText.length },
    'XML processing complete',
  );

  return {
    rawText,
    tables,
    images: [],
    metadata: { format: 'xml' },
  };
}

/**
 * Process a JSON or XML file and return structured data.
 *
 * @param filePath - Absolute path to the JSON or XML file
 * @param mime - MIME type of the file (e.g. 'application/json', 'application/xml', 'text/xml')
 * @returns ProcessorResult with extracted tables and raw text
 */
export async function processStructured(filePath: string, mime: string): Promise<ProcessorResult> {
  const isXml = mime.includes('xml') || filePath.endsWith('.xml') || filePath.endsWith('.svg');

  if (isXml) {
    return processXml(filePath);
  }

  return processJson(filePath);
}
