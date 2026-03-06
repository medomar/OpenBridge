/**
 * OB-1743 — Document skill pack selection, file generation mocks,
 * output delivery ([SHARE:FILE]), and attachment sending tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../src/core/agent-runner.js', () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    spawn: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 }),
    spawnWithHandle: vi.fn(),
  })),
  TOOLS_READ_ONLY: ['Read', 'Glob', 'Grep'],
  estimateCost: vi.fn().mockReturnValue({
    estimatedTurns: 5,
    costString: '~$0.10',
    timeString: '~1 min',
  }),
  DEFAULT_MAX_TURNS_TASK: 15,
}));

vi.mock('../../src/core/github-publisher.js', () => ({
  publishToGitHubPages: vi.fn().mockResolvedValue('https://example.github.io/page.html'),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  loadSkillPacks,
  getBuiltInSkillPacks,
  findSkillByFormat,
} from '../../src/master/skill-pack-loader.js';
import { classifyDocumentIntent, Router } from '../../src/core/router.js';
import { MockConnector } from '../helpers/mock-connector.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { FileServer } from '../../src/core/file-server.js';
import type { InboundMessage } from '../../src/types/message.js';
import type { DocumentSkill } from '../../src/types/agent.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMessage(content = 'hello'): InboundMessage {
  return {
    id: 'msg-1',
    source: 'mock',
    sender: '+1234567890',
    rawContent: `/ai ${content}`,
    content,
    timestamp: new Date(),
  };
}

/** Minimal FileServer stub that records calls and returns a fixed URL. */
function createMockFileServer(url = 'http://localhost:3001/shared/abc123/doc.docx'): FileServer {
  return {
    createShareableLink: vi.fn().mockResolvedValue(url),
    setPublicUrl: vi.fn(),
    getFileUrl: vi.fn().mockReturnValue('http://localhost:3001'),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as FileServer;
}

/** MockConnector that also declares supportsFileAttachments. */
class FileCapableConnector extends MockConnector {
  readonly supportsFileAttachments = true as const;
}

// ── 1. Skill Pack Selection ───────────────────────────────────────────────────

describe('getBuiltInSkillPacks()', () => {
  it('returns exactly 4 built-in skill packs', () => {
    const packs = getBuiltInSkillPacks();
    expect(packs).toHaveLength(4);
  });

  it('includes document-writer (docx)', () => {
    const packs = getBuiltInSkillPacks();
    const skill = packs.find((s) => s.name === 'document-writer');
    expect(skill).toBeDefined();
    expect(skill?.fileFormat).toBe('docx');
    expect(skill?.npmDependency).toBe('docx');
  });

  it('includes presentation-maker (pptx)', () => {
    const packs = getBuiltInSkillPacks();
    const skill = packs.find((s) => s.name === 'presentation-maker');
    expect(skill).toBeDefined();
    expect(skill?.fileFormat).toBe('pptx');
  });

  it('includes spreadsheet-builder (xlsx)', () => {
    const packs = getBuiltInSkillPacks();
    const skill = packs.find((s) => s.name === 'spreadsheet-builder');
    expect(skill).toBeDefined();
    expect(skill?.fileFormat).toBe('xlsx');
  });

  it('includes report-generator (pdf)', () => {
    const packs = getBuiltInSkillPacks();
    const skill = packs.find((s) => s.name === 'report-generator');
    expect(skill).toBeDefined();
    expect(skill?.fileFormat).toBe('pdf');
  });

  it('every skill has a non-empty workerPrompt', () => {
    const packs = getBuiltInSkillPacks();
    for (const skill of packs) {
      expect(skill.prompts.workerPrompt).toBeTruthy();
    }
  });

  it('every skill has a valid toolProfile', () => {
    const packs = getBuiltInSkillPacks();
    for (const skill of packs) {
      expect(typeof skill.toolProfile).toBe('string');
      expect(skill.toolProfile.length).toBeGreaterThan(0);
    }
  });
});

describe('findSkillByFormat()', () => {
  let skills: Map<string, DocumentSkill>;

  beforeEach(() => {
    skills = new Map(getBuiltInSkillPacks().map((s) => [s.name, s]));
  });

  it('finds document-writer for docx format', () => {
    const skill = findSkillByFormat(skills, 'docx');
    expect(skill?.name).toBe('document-writer');
  });

  it('finds presentation-maker for pptx format', () => {
    const skill = findSkillByFormat(skills, 'pptx');
    expect(skill?.name).toBe('presentation-maker');
  });

  it('finds spreadsheet-builder for xlsx format', () => {
    const skill = findSkillByFormat(skills, 'xlsx');
    expect(skill?.name).toBe('spreadsheet-builder');
  });

  it('finds report-generator for pdf format', () => {
    const skill = findSkillByFormat(skills, 'pdf');
    expect(skill?.name).toBe('report-generator');
  });

  it('returns undefined for unknown format', () => {
    const skill = findSkillByFormat(skills, 'mp3');
    expect(skill).toBeUndefined();
  });

  it('returns undefined for empty format string', () => {
    const skill = findSkillByFormat(skills, '');
    expect(skill).toBeUndefined();
  });
});

describe('loadSkillPacks()', () => {
  it('loads all 4 built-in packs when no custom dir exists', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ob-skill-test-'));
    const result = await loadSkillPacks(tmpDir);

    expect(result.skills.size).toBe(4);
    expect(result.customCount).toBe(0);
    expect(result.skills.has('document-writer')).toBe(true);
    expect(result.skills.has('presentation-maker')).toBe(true);
    expect(result.skills.has('spreadsheet-builder')).toBe(true);
    expect(result.skills.has('report-generator')).toBe(true);
  });

  it('loads custom skill pack from .openbridge/skill-packs/', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ob-skill-custom-'));
    const skillPackDir = join(tmpDir, '.openbridge', 'skill-packs');
    await mkdir(skillPackDir, { recursive: true });

    // Write a minimal valid custom skill pack
    const customSkill = `
module.exports = {
  name: 'custom-renderer',
  description: 'Custom HTML renderer',
  fileFormat: 'html',
  toolProfile: 'read-only',
  prompts: {
    system: 'You render HTML.',
    structure: 'Use semantic HTML5 elements.',
  },
};
`;
    await writeFile(join(skillPackDir, 'custom-renderer.js'), customSkill);

    const result = await loadSkillPacks(tmpDir);

    expect(result.customCount).toBe(1);
    expect(result.skills.has('custom-renderer')).toBe(true);
    expect(result.skills.get('custom-renderer')?.fileFormat).toBe('html');
  });

  it('custom pack overrides built-in pack with the same name', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ob-skill-override-'));
    const skillPackDir = join(tmpDir, '.openbridge', 'skill-packs');
    await mkdir(skillPackDir, { recursive: true });

    // Override document-writer with a custom version
    const override = `
module.exports = {
  name: 'document-writer',
  description: 'Custom Word generator',
  fileFormat: 'docx',
  toolProfile: 'code-edit',
  npmDependency: 'docx',
  prompts: {
    system: 'Custom system prompt.',
    structure: 'Custom structure.',
    workerPrompt: 'Custom worker prompt.',
  },
};
`;
    await writeFile(join(skillPackDir, 'document-writer.js'), override);

    const result = await loadSkillPacks(tmpDir);

    // Still 4 total (override replaces built-in), plus 1 custom counted
    expect(result.skills.size).toBe(4);
    expect(result.customCount).toBe(1);
    expect(result.skills.get('document-writer')?.description).toBe('Custom Word generator');
  });

  it('ignores non-JS files in the skill-packs dir', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ob-skill-nonjsf-'));
    const skillPackDir = join(tmpDir, '.openbridge', 'skill-packs');
    await mkdir(skillPackDir, { recursive: true });

    await writeFile(join(skillPackDir, 'README.md'), '# Skills');
    await writeFile(join(skillPackDir, 'config.json'), '{}');
    await writeFile(join(skillPackDir, 'skill.ts'), 'export const s = {};');

    const result = await loadSkillPacks(tmpDir);

    // Only built-ins — no custom packs loaded
    expect(result.customCount).toBe(0);
    expect(result.skills.size).toBe(4);
  });

  it('skips a JS file that has no valid DocumentSkill export', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ob-skill-invalid-'));
    const skillPackDir = join(tmpDir, '.openbridge', 'skill-packs');
    await mkdir(skillPackDir, { recursive: true });

    await writeFile(join(skillPackDir, 'broken.js'), 'module.exports = { notASkill: true };');

    const result = await loadSkillPacks(tmpDir);

    expect(result.customCount).toBe(0);
    expect(result.skills.size).toBe(4);
  });
});

// ── 2. Document Intent Classification ────────────────────────────────────────

describe('classifyDocumentIntent()', () => {
  // Explicit format keywords
  it('returns docx for .docx extension', () => {
    expect(classifyDocumentIntent('Create a report.docx for the team')).toBe('docx');
  });

  it('returns docx for bare "docx" acronym', () => {
    expect(classifyDocumentIntent('Generate a docx file')).toBe('docx');
  });

  it('returns pptx for .pptx extension', () => {
    expect(classifyDocumentIntent('Make me a slides.pptx')).toBe('pptx');
  });

  it('returns pptx for bare "pptx" acronym', () => {
    expect(classifyDocumentIntent('Export as pptx')).toBe('pptx');
  });

  it('returns xlsx for .xlsx extension', () => {
    expect(classifyDocumentIntent('Build a budget.xlsx')).toBe('xlsx');
  });

  it('returns xlsx for bare "xlsx" acronym', () => {
    expect(classifyDocumentIntent('Create an xlsx with the data')).toBe('xlsx');
  });

  it('returns pdf for .pdf extension', () => {
    expect(classifyDocumentIntent('Export as invoice.pdf')).toBe('pdf');
  });

  it('returns pdf for bare "pdf" acronym', () => {
    expect(classifyDocumentIntent('Generate a pdf')).toBe('pdf');
  });

  // Presentation keywords
  it('returns pptx for "presentation"', () => {
    expect(classifyDocumentIntent('Create a presentation for the board')).toBe('pptx');
  });

  it('returns pptx for "slide deck"', () => {
    expect(classifyDocumentIntent('Build me a slide deck for tomorrow')).toBe('pptx');
  });

  it('returns pptx for "slideshow"', () => {
    expect(classifyDocumentIntent('Make a slideshow of our Q4 results')).toBe('pptx');
  });

  it('returns pptx for "powerpoint"', () => {
    expect(classifyDocumentIntent('I need a PowerPoint about the product')).toBe('pptx');
  });

  it('returns pptx for "slides"', () => {
    expect(classifyDocumentIntent('Create slides for the training')).toBe('pptx');
  });

  // Spreadsheet keywords
  it('returns xlsx for "spreadsheet"', () => {
    expect(classifyDocumentIntent('Build a spreadsheet for the budget')).toBe('xlsx');
  });

  it('returns xlsx for "excel"', () => {
    expect(classifyDocumentIntent('Make an Excel sheet with all the data')).toBe('xlsx');
  });

  it('returns xlsx for "workbook"', () => {
    expect(classifyDocumentIntent('Create a workbook for the financials')).toBe('xlsx');
  });

  // Report → PDF
  it('returns pdf for "generate report"', () => {
    expect(classifyDocumentIntent('Generate a report on monthly sales')).toBe('pdf');
  });

  it('returns pdf for "create report"', () => {
    expect(classifyDocumentIntent('Create a report for the stakeholders')).toBe('pdf');
  });

  it('returns pdf for "write report"', () => {
    expect(classifyDocumentIntent('Write a report summarising the sprint')).toBe('pdf');
  });

  // Word document keywords
  it('returns docx for "proposal"', () => {
    expect(classifyDocumentIntent('Draft a proposal for the client')).toBe('docx');
  });

  it('returns docx for "memo"', () => {
    expect(classifyDocumentIntent('Write a memo about the policy change')).toBe('docx');
  });

  it('returns docx for "cover letter"', () => {
    expect(classifyDocumentIntent('Generate a cover letter for the job')).toBe('docx');
  });

  it('returns docx for "word document"', () => {
    expect(classifyDocumentIntent('Create a word document with the notes')).toBe('docx');
  });

  // Generic create + document → docx
  it('returns docx for "create a document"', () => {
    expect(classifyDocumentIntent('Create a document with the meeting notes')).toBe('docx');
  });

  it('returns docx for "write a document"', () => {
    expect(classifyDocumentIntent('Write a document summarizing the project')).toBe('docx');
  });

  it('returns docx for "draft a document"', () => {
    expect(classifyDocumentIntent('Draft a document outlining the strategy')).toBe('docx');
  });

  // Non-document messages → null
  it('returns null for a regular coding request', () => {
    expect(classifyDocumentIntent('Fix the bug in auth.ts')).toBeNull();
  });

  it('returns null for a question', () => {
    expect(classifyDocumentIntent('What does the router do?')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(classifyDocumentIntent('')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(classifyDocumentIntent('CREATE A PRESENTATION FOR THE BOARD')).toBe('pptx');
    expect(classifyDocumentIntent('GENERATE A REPORT ON SALES')).toBe('pdf');
  });

  // Priority: explicit format beats keyword
  it('explicit pptx beats generic "presentation" keyword if both present', () => {
    // Both .pptx and "presentation" present — should return pptx (first match)
    expect(classifyDocumentIntent('Make a presentation.pptx for the slides')).toBe('pptx');
  });
});

// ── 3. SHARE:FILE Output Delivery ────────────────────────────────────────────

describe('SHARE:FILE output delivery', () => {
  let workspaceDir: string;
  let generatedDir: string;

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'ob-share-file-'));
    generatedDir = join(workspaceDir, '.openbridge', 'generated');
    await mkdir(generatedDir, { recursive: true });
  });

  it('creates a shareable link via FileServer and replaces the marker', async () => {
    const router = new Router('mock');
    const connector = new MockConnector();
    const provider = new MockProvider();
    const fileServer = createMockFileServer('http://localhost:3001/shared/abc/report.pdf');

    await writeFile(join(generatedDir, 'report.pdf'), '%PDF-1.4');
    provider.setResponse({
      content: '[SHARE:FILE]report.pdf[/SHARE] Here is your report.',
    });
    provider.streamMessage = undefined;

    router.setWorkspacePath(workspaceDir);
    router.setFileServer(fileServer);
    router.addConnector(connector);
    router.addProvider(provider);
    await connector.initialize();

    await router.route(createMessage());

    expect(fileServer.createShareableLink).toHaveBeenCalledWith('report.pdf');
    const textMsgs = connector.sentMessages.filter((m) => m.media === undefined);
    const reply = textMsgs[textMsgs.length - 1];
    expect(reply?.content).toContain('http://localhost:3001/shared/abc/report.pdf');
    expect(reply?.content).not.toContain('[SHARE:FILE]');
  });

  it('strips SHARE:FILE marker when FileServer is not configured', async () => {
    const router = new Router('mock');
    const connector = new MockConnector();
    const provider = new MockProvider();

    await writeFile(join(generatedDir, 'report.docx'), 'content');
    provider.setResponse({
      content: 'Download: [SHARE:FILE]report.docx[/SHARE]',
    });
    provider.streamMessage = undefined;

    // No fileServer set
    router.setWorkspacePath(workspaceDir);
    router.addConnector(connector);
    router.addProvider(provider);
    await connector.initialize();

    await router.route(createMessage());

    const textMsgs = connector.sentMessages.filter((m) => m.media === undefined);
    const reply = textMsgs[textMsgs.length - 1];
    expect(reply?.content).not.toContain('[SHARE:FILE]');
    expect(reply?.content).not.toContain('[/SHARE]');
  });

  it('sends native attachment when connector supports file attachments (docx)', async () => {
    const router = new Router('mock');
    const connector = new FileCapableConnector();
    const provider = new MockProvider();
    const fileServer = createMockFileServer('http://localhost:3001/shared/abc/proposal.docx');

    const docxContent = Buffer.from('PK fake docx bytes');
    await writeFile(join(generatedDir, 'proposal.docx'), docxContent);
    provider.setResponse({
      content: '[SHARE:FILE]proposal.docx[/SHARE]',
    });
    provider.streamMessage = undefined;

    router.setWorkspacePath(workspaceDir);
    router.setFileServer(fileServer);
    router.addConnector(connector);
    router.addProvider(provider);
    await connector.initialize();

    await router.route(createMessage());

    const mediaMsgs = connector.sentMessages.filter((m) => m.media !== undefined);
    expect(mediaMsgs).toHaveLength(1);
    expect(mediaMsgs[0]?.media?.filename).toBe('proposal.docx');
    expect(mediaMsgs[0]?.media?.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(mediaMsgs[0]?.media?.type).toBe('document');
    expect(mediaMsgs[0]?.media?.data).toEqual(docxContent);
  });

  it('sends native attachment for pptx files', async () => {
    const router = new Router('mock');
    const connector = new FileCapableConnector();
    const provider = new MockProvider();
    const fileServer = createMockFileServer('http://localhost:3001/shared/xyz/deck.pptx');

    const pptxContent = Buffer.from('PK fake pptx bytes');
    await writeFile(join(generatedDir, 'deck.pptx'), pptxContent);
    provider.setResponse({
      content: '[SHARE:FILE]deck.pptx[/SHARE]',
    });
    provider.streamMessage = undefined;

    router.setWorkspacePath(workspaceDir);
    router.setFileServer(fileServer);
    router.addConnector(connector);
    router.addProvider(provider);
    await connector.initialize();

    await router.route(createMessage());

    const mediaMsgs = connector.sentMessages.filter((m) => m.media !== undefined);
    expect(mediaMsgs).toHaveLength(1);
    expect(mediaMsgs[0]?.media?.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(mediaMsgs[0]?.media?.filename).toBe('deck.pptx');
  });

  it('sends native attachment for xlsx files', async () => {
    const router = new Router('mock');
    const connector = new FileCapableConnector();
    const provider = new MockProvider();
    const fileServer = createMockFileServer('http://localhost:3001/shared/xyz/budget.xlsx');

    const xlsxContent = Buffer.from('PK fake xlsx bytes');
    await writeFile(join(generatedDir, 'budget.xlsx'), xlsxContent);
    provider.setResponse({
      content: '[SHARE:FILE]budget.xlsx[/SHARE]',
    });
    provider.streamMessage = undefined;

    router.setWorkspacePath(workspaceDir);
    router.setFileServer(fileServer);
    router.addConnector(connector);
    router.addProvider(provider);
    await connector.initialize();

    await router.route(createMessage());

    const mediaMsgs = connector.sentMessages.filter((m) => m.media !== undefined);
    expect(mediaMsgs).toHaveLength(1);
    expect(mediaMsgs[0]?.media?.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(mediaMsgs[0]?.media?.filename).toBe('budget.xlsx');
  });

  it('sends native attachment for pdf files', async () => {
    const router = new Router('mock');
    const connector = new FileCapableConnector();
    const provider = new MockProvider();
    const fileServer = createMockFileServer('http://localhost:3001/shared/xyz/report.pdf');

    const pdfContent = Buffer.from('%PDF-1.4 content');
    await writeFile(join(generatedDir, 'report.pdf'), pdfContent);
    provider.setResponse({
      content: '[SHARE:FILE]report.pdf[/SHARE]',
    });
    provider.streamMessage = undefined;

    router.setWorkspacePath(workspaceDir);
    router.setFileServer(fileServer);
    router.addConnector(connector);
    router.addProvider(provider);
    await connector.initialize();

    await router.route(createMessage());

    const mediaMsgs = connector.sentMessages.filter((m) => m.media !== undefined);
    expect(mediaMsgs).toHaveLength(1);
    expect(mediaMsgs[0]?.media?.mimeType).toBe('application/pdf');
    expect(mediaMsgs[0]?.media?.type).toBe('document');
  });

  it('does NOT send native attachment when connector lacks supportsFileAttachments', async () => {
    const router = new Router('mock');
    // Plain MockConnector — no supportsFileAttachments
    const connector = new MockConnector();
    const provider = new MockProvider();
    const fileServer = createMockFileServer('http://localhost:3001/shared/abc/report.pdf');

    await writeFile(join(generatedDir, 'report.pdf'), '%PDF-1.4');
    provider.setResponse({
      content: '[SHARE:FILE]report.pdf[/SHARE]',
    });
    provider.streamMessage = undefined;

    router.setWorkspacePath(workspaceDir);
    router.setFileServer(fileServer);
    router.addConnector(connector);
    router.addProvider(provider);
    await connector.initialize();

    await router.route(createMessage());

    // FileServer link IS created, but no media message sent
    expect(fileServer.createShareableLink).toHaveBeenCalled();
    const mediaMsgs = connector.sentMessages.filter((m) => m.media !== undefined);
    expect(mediaMsgs).toHaveLength(0);
  });

  it('blocks path traversal in SHARE:FILE marker', async () => {
    const router = new Router('mock');
    const connector = new FileCapableConnector();
    const provider = new MockProvider();
    const fileServer = createMockFileServer();

    provider.setResponse({
      content: '[SHARE:FILE]../../etc/passwd[/SHARE]',
    });
    provider.streamMessage = undefined;

    router.setWorkspacePath(workspaceDir);
    router.setFileServer(fileServer);
    router.addConnector(connector);
    router.addProvider(provider);
    await connector.initialize();

    await router.route(createMessage());

    // Security: no media, no FileServer call for traversal path
    const mediaMsgs = connector.sentMessages.filter((m) => m.media !== undefined);
    expect(mediaMsgs).toHaveLength(0);
    expect(fileServer.createShareableLink).not.toHaveBeenCalled();
  });

  it('handles multiple SHARE:FILE markers in a single response', async () => {
    const router = new Router('mock');
    const connector = new FileCapableConnector();
    const provider = new MockProvider();
    const fileServer = createMockFileServer();

    await writeFile(join(generatedDir, 'doc1.docx'), 'doc1 content');
    await writeFile(join(generatedDir, 'doc2.pdf'), '%PDF doc2');
    provider.setResponse({
      content: 'File 1: [SHARE:FILE]doc1.docx[/SHARE]\nFile 2: [SHARE:FILE]doc2.pdf[/SHARE]',
    });
    provider.streamMessage = undefined;

    router.setWorkspacePath(workspaceDir);
    router.setFileServer(fileServer);
    router.addConnector(connector);
    router.addProvider(provider);
    await connector.initialize();

    await router.route(createMessage());

    const mediaMsgs = connector.sentMessages.filter((m) => m.media !== undefined);
    expect(mediaMsgs).toHaveLength(2);
    const filenames = mediaMsgs.map((m) => m.media?.filename).sort();
    expect(filenames).toEqual(['doc1.docx', 'doc2.pdf']);
  });
});

// ── 4. Skill Pack Schema Integrity ────────────────────────────────────────────

describe('DocumentSkill schema integrity', () => {
  it('all built-in skills have required fields', () => {
    const packs = getBuiltInSkillPacks();
    for (const skill of packs) {
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.fileFormat).toBeTruthy();
      expect(skill.toolProfile).toBeTruthy();
      expect(skill.prompts.system).toBeTruthy();
      expect(skill.prompts.structure).toBeTruthy();
    }
  });

  it('each built-in skill targets a distinct file format', () => {
    const packs = getBuiltInSkillPacks();
    const formats = packs.map((s) => s.fileFormat);
    const unique = new Set(formats);
    expect(unique.size).toBe(packs.length);
  });

  it('document-writer workerPrompt contains SHARE:FILE convention', () => {
    const packs = getBuiltInSkillPacks();
    const writer = packs.find((s) => s.name === 'document-writer');
    expect(writer?.prompts.workerPrompt).toContain('[SHARE:FILE');
  });

  it('report-generator workerPrompt contains SHARE:FILE convention', () => {
    const packs = getBuiltInSkillPacks();
    const reporter = packs.find((s) => s.name === 'report-generator');
    expect(reporter?.prompts.workerPrompt).toContain('[SHARE:FILE');
  });

  it('presentation-maker workerPrompt contains SHARE:FILE convention', () => {
    const packs = getBuiltInSkillPacks();
    const presenter = packs.find((s) => s.name === 'presentation-maker');
    expect(presenter?.prompts.workerPrompt).toContain('[SHARE:FILE');
  });

  it('spreadsheet-builder workerPrompt contains SHARE:FILE convention', () => {
    const packs = getBuiltInSkillPacks();
    const builder = packs.find((s) => s.name === 'spreadsheet-builder');
    expect(builder?.prompts.workerPrompt).toContain('[SHARE:FILE');
  });
});
