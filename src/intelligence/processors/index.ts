/**
 * Processors — Format-specific document processors
 *
 * Each processor handles a specific file format:
 * - pdf-processor.ts — PDF with OCR fallback (OB-1336/OB-1337)
 * - excel-processor.ts — XLSX and spreadsheets (OB-1338)
 * - csv-processor.ts — CSV files (OB-1339)
 * - word-processor.ts — DOCX documents (OB-1340)
 * - image-processor.ts — Images with vision AI (OB-1341)
 * - email-processor.ts — MIME email messages (OB-1342)
 * - structured-processor.ts — JSON and XML documents (OB-1343)
 */

export { processPdf } from './pdf-processor.js';
export { processExcel } from './excel-processor.js';
export { processCsv } from './csv-processor.js';
export { processWord } from './word-processor.js';
export { processImage } from './image-processor.js';
export { processEmail } from './email-processor.js';
export { processStructured } from './structured-processor.js';
