import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Business branding configuration stored in .openbridge/context/branding.json */
export interface Branding {
  /** Company / business name */
  companyName: string;
  /** Street address, city, state, zip */
  companyAddress?: string;
  /** Business phone number */
  companyPhone?: string;
  /** Business email address */
  companyEmail?: string;
  /** Tax / VAT / GST registration number */
  taxId?: string;
  /** Absolute or workspace-relative path to the company logo file */
  logoPath?: string;
  /** Primary brand colour (CSS hex, e.g. "#1a73e8") */
  primaryColor?: string;
  /** Secondary brand colour (CSS hex, e.g. "#f8f9fa") */
  secondaryColor?: string;
}

const BRANDING_PATH = path.join('.openbridge', 'context', 'branding.json');

const DEFAULT_BRANDING: Branding = {
  companyName: 'My Company',
  primaryColor: '#1a73e8',
  secondaryColor: '#f8f9fa',
};

/**
 * Load branding config from `<workspacePath>/.openbridge/context/branding.json`.
 * Returns sensible defaults when the file is missing or cannot be parsed.
 */
export async function loadBranding(workspacePath: string): Promise<Branding> {
  const filePath = path.join(workspacePath, BRANDING_PATH);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Branding>;
    return { ...DEFAULT_BRANDING, ...parsed };
  } catch {
    return { ...DEFAULT_BRANDING };
  }
}

/**
 * Persist branding config to `<workspacePath>/.openbridge/context/branding.json`.
 * Creates intermediate directories if they do not exist.
 */
export async function saveBranding(workspacePath: string, branding: Branding): Promise<void> {
  const filePath = path.join(workspacePath, BRANDING_PATH);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(branding, null, 2), 'utf8');
}
