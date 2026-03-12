/**
 * Email Processor — Extract content and attachments from .eml files
 *
 * TODO (OB-1342): Implement using mailparser package
 */

import type { ProcessorResult } from '../../types/intelligence.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function processEmail(_filePath: string): Promise<ProcessorResult> {
  // TODO (OB-1342): Implement email processing with mailparser package
  throw new Error('processEmail not yet implemented — see OB-1342');
}
