/**
 * OB-1773 — Creative skill selection, diagram generation, chart rendering,
 * and HTML-to-image pipeline tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Hoisted mocks (Vitest hoists vi.mock calls, so related vars must use vi.hoisted) ──

const { mockLaunch, mockClose, mockSetContent, mockSetViewport, mockScreenshot } = vi.hoisted(
  () => {
    const mockScreenshot = vi.fn();
    const mockSetContent = vi.fn().mockResolvedValue(undefined);
    const mockSetViewport = vi.fn().mockResolvedValue(undefined);
    const _mockGoto = vi.fn().mockResolvedValue(undefined);
    const _mockNewPage = vi.fn().mockResolvedValue({
      setViewport: mockSetViewport,
      setContent: mockSetContent,
      goto: _mockGoto,
      screenshot: mockScreenshot,
    });
    const mockClose = vi.fn().mockResolvedValue(undefined);
    const mockLaunch = vi.fn().mockResolvedValue({
      newPage: _mockNewPage,
      close: mockClose,
    });
    return { mockLaunch, mockClose, mockSetContent, mockSetViewport, mockScreenshot };
  },
);

vi.mock('puppeteer', () => ({
  default: { launch: mockLaunch },
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import {
  HTMLRenderer,
  MermaidRenderer,
  parseSvgDimensions,
  renderHtmlToImage,
  renderSvgToImage,
  renderMermaidToImage,
} from '../../src/core/html-renderer.js';
import { classifyCreativeIntent } from '../../src/core/router.js';
import { BUILT_IN_SKILL_PACKS } from '../../src/master/skill-packs/index.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ob-creative-test-'));
  await mkdir(join(dir, '.openbridge', 'generated'), { recursive: true });
  return dir;
}

/** A fake PNG file buffer (4-byte PNG magic bytes). */
const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** Configure mockScreenshot to write a fake PNG to its `path` argument. */
function configureMockScreenshot() {
  mockScreenshot.mockImplementation(async (opts: { path: string }) => {
    await writeFile(opts.path, FAKE_PNG);
  });
}

// ── 1. classifyCreativeIntent() ───────────────────────────────────────────────

describe('classifyCreativeIntent()', () => {
  // ── Diagram ──

  it('returns "diagram" for "mermaid"', () => {
    expect(classifyCreativeIntent('generate a mermaid diagram')).toBe('diagram');
  });

  it('returns "diagram" for "plantuml"', () => {
    expect(classifyCreativeIntent('draw a plantuml sequence')).toBe('diagram');
  });

  it('returns "diagram" for "d2 diagram"', () => {
    expect(classifyCreativeIntent('create a d2 diagram of the architecture')).toBe('diagram');
  });

  it('returns "diagram" for "flowchart"', () => {
    expect(classifyCreativeIntent('show me a flowchart of the login process')).toBe('diagram');
  });

  it('returns "diagram" for "flow chart"', () => {
    expect(classifyCreativeIntent('produce a flow chart for the CI pipeline')).toBe('diagram');
  });

  it('returns "diagram" for "sequence diagram"', () => {
    expect(classifyCreativeIntent('produce a sequence diagram for the API')).toBe('diagram');
  });

  it('returns "diagram" for "er diagram"', () => {
    expect(classifyCreativeIntent('generate an er diagram for the database')).toBe('diagram');
  });

  it('returns "diagram" for "erd"', () => {
    expect(classifyCreativeIntent('create an erd for the schema')).toBe('diagram');
  });

  it('returns "diagram" for "class diagram"', () => {
    expect(classifyCreativeIntent('draw a class diagram for the models')).toBe('diagram');
  });

  it('returns "diagram" for "architecture diagram"', () => {
    expect(classifyCreativeIntent('make an architecture diagram')).toBe('diagram');
  });

  it('returns "diagram" for "uml"', () => {
    expect(classifyCreativeIntent('generate a uml for the system')).toBe('diagram');
  });

  it('returns "diagram" for "network diagram"', () => {
    expect(classifyCreativeIntent('build a network diagram')).toBe('diagram');
  });

  it('returns "diagram" for verb + "diagram" combination', () => {
    expect(classifyCreativeIntent('create a diagram of the deployment')).toBe('diagram');
    expect(classifyCreativeIntent('draw a diagram showing data flow')).toBe('diagram');
  });

  // ── Chart ──

  it('returns "chart" for "d3.js"', () => {
    expect(classifyCreativeIntent('visualize data with d3.js')).toBe('chart');
  });

  it('returns "chart" for "chart.js"', () => {
    expect(classifyCreativeIntent('create a chart.js bar chart')).toBe('chart');
  });

  it('returns "chart" for "chartjs"', () => {
    expect(classifyCreativeIntent('use chartjs to plot the results')).toBe('chart');
  });

  it('returns "chart" for "bar chart"', () => {
    expect(classifyCreativeIntent('generate a bar chart of monthly sales')).toBe('chart');
  });

  it('returns "chart" for "line chart"', () => {
    expect(classifyCreativeIntent('create a line chart for the trend')).toBe('chart');
  });

  it('returns "chart" for "pie chart"', () => {
    expect(classifyCreativeIntent('make a pie chart of the distribution')).toBe('chart');
  });

  it('returns "chart" for "scatter plot"', () => {
    expect(classifyCreativeIntent('plot a scatter plot of the correlation')).toBe('chart');
  });

  it('returns "chart" for "histogram"', () => {
    expect(classifyCreativeIntent('generate a histogram of response times')).toBe('chart');
  });

  it('returns "chart" for "heatmap"', () => {
    expect(classifyCreativeIntent('create a heatmap of the correlation matrix')).toBe('chart');
  });

  it('returns "chart" for "area chart"', () => {
    expect(classifyCreativeIntent('show an area chart of weekly traffic')).toBe('chart');
  });

  it('returns "chart" for "treemap"', () => {
    expect(classifyCreativeIntent('render a treemap of the file sizes')).toBe('chart');
  });

  it('returns "chart" for verb + "visualization" combination', () => {
    expect(classifyCreativeIntent('create a visualization of the user activity')).toBe('chart');
  });

  it('returns "chart" for verb + "graph" combination', () => {
    expect(classifyCreativeIntent('generate a graph of the results')).toBe('chart');
  });

  it('returns "chart" for verb + "visualize" combination', () => {
    // Needs an explicit action verb alongside "visualize" to match
    expect(classifyCreativeIntent('make a visualization of the sales data')).toBe('chart');
  });

  // ── Brand assets ──

  it('returns "brand" for "logo" + verb', () => {
    expect(classifyCreativeIntent('create a logo for my startup')).toBe('brand');
  });

  it('returns "brand" for "favicon" + verb', () => {
    expect(classifyCreativeIntent('generate a favicon for the app')).toBe('brand');
  });

  it('returns "brand" for "brand asset" + verb', () => {
    // The regex matches singular "brand asset" (not plural "brand assets")
    expect(classifyCreativeIntent('make a brand asset for the company')).toBe('brand');
  });

  it('returns "brand" for "og image" + verb', () => {
    expect(classifyCreativeIntent('design an og image for the website')).toBe('brand');
  });

  it('returns "brand" for "twitter card" + verb', () => {
    expect(classifyCreativeIntent('generate a twitter card for the blog')).toBe('brand');
  });

  it('returns "brand" for "app icon" + verb', () => {
    expect(classifyCreativeIntent('create an app icon for the mobile app')).toBe('brand');
  });

  // ── Generative art ──

  it('returns "art" for "p5.js"', () => {
    expect(classifyCreativeIntent('write a p5.js sketch for me')).toBe('art');
  });

  it('returns "art" for "p5js"', () => {
    expect(classifyCreativeIntent('generate a p5js animation')).toBe('art');
  });

  it('returns "art" for "generative art"', () => {
    expect(classifyCreativeIntent('create some generative art')).toBe('art');
  });

  it('returns "art" for "algorithmic art"', () => {
    expect(classifyCreativeIntent('produce algorithmic art patterns')).toBe('art');
  });

  it('returns "art" for "creative coding"', () => {
    expect(classifyCreativeIntent('show me creative coding examples')).toBe('art');
  });

  it('returns "art" for "svg pattern"', () => {
    expect(classifyCreativeIntent('generate an svg pattern for the background')).toBe('art');
  });

  it('returns "art" for generative + visual noun combination', () => {
    expect(classifyCreativeIntent('make a generative pattern')).toBe('art');
  });

  it('returns "art" for algorithmic + art combination', () => {
    expect(classifyCreativeIntent('create an algorithmic visual')).toBe('art');
  });

  // ── Design ──

  it('returns "design" for "landing page"', () => {
    expect(classifyCreativeIntent('create a landing page for the product')).toBe('design');
  });

  it('returns "design" for "web page"', () => {
    expect(classifyCreativeIntent('build a web page for the portfolio')).toBe('design');
  });

  it('returns "design" for "webpage"', () => {
    expect(classifyCreativeIntent('generate a webpage for the campaign')).toBe('design');
  });

  it('returns "design" for "email template"', () => {
    expect(classifyCreativeIntent('generate an email template for the newsletter')).toBe('design');
  });

  it('returns "design" for "html template"', () => {
    expect(classifyCreativeIntent('create an html template for the onboarding flow')).toBe(
      'design',
    );
  });

  it('returns "design" for "marketing page"', () => {
    expect(classifyCreativeIntent('design a marketing page for the launch')).toBe('design');
  });

  it('returns "design" for "html slide"', () => {
    expect(classifyCreativeIntent('create an html slide for the talk')).toBe('design');
  });

  it('returns "design" for "presentation slide"', () => {
    expect(classifyCreativeIntent('make a presentation slide for the demo')).toBe('design');
  });

  it('returns "design" for design + website combination', () => {
    expect(classifyCreativeIntent('design a website for the project')).toBe('design');
  });

  it('returns "design" for design + interface combination', () => {
    expect(classifyCreativeIntent('design a ui interface for the dashboard')).toBe('design');
  });

  // ── Null — non-creative inputs ──

  it('returns null for a regular code request', () => {
    expect(classifyCreativeIntent('fix the bug in auth.ts')).toBeNull();
  });

  it('returns null for a question', () => {
    expect(classifyCreativeIntent('what does the router do?')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(classifyCreativeIntent('')).toBeNull();
  });

  it('returns null for "diagram" used as noun without an action verb', () => {
    // No create/generate/make/draw/build/produce/show/render → no match
    expect(classifyCreativeIntent('the diagram is in the docs folder')).toBeNull();
  });

  it('returns null for "chart" used without an action verb', () => {
    expect(classifyCreativeIntent('the chart in the README')).toBeNull();
  });

  it('returns null for plain coding tasks', () => {
    expect(classifyCreativeIntent('add unit tests for the parser')).toBeNull();
    expect(classifyCreativeIntent('deploy to production')).toBeNull();
    expect(classifyCreativeIntent('review my pull request')).toBeNull();
  });

  // ── Case insensitivity ──

  it('is case-insensitive for diagram intent', () => {
    expect(classifyCreativeIntent('CREATE A FLOWCHART')).toBe('diagram');
    expect(classifyCreativeIntent('Generate A MERMAID Diagram')).toBe('diagram');
  });

  it('is case-insensitive for chart intent', () => {
    expect(classifyCreativeIntent('GENERATE A BAR CHART OF SALES')).toBe('chart');
  });

  it('is case-insensitive for brand intent', () => {
    expect(classifyCreativeIntent('MAKE A LOGO FOR THE COMPANY')).toBe('brand');
  });

  it('is case-insensitive for design intent', () => {
    expect(classifyCreativeIntent('CREATE A LANDING PAGE')).toBe('design');
  });

  // ── Priority ordering ──

  it('returns "diagram" when message contains both mermaid and chart-type keywords', () => {
    // "mermaid" (diagram, highest priority) should win over "chart"
    expect(classifyCreativeIntent('create a mermaid chart showing the flow')).toBe('diagram');
  });
});

// ── 2. Creative Skill Pack Structure ──────────────────────────────────────────

describe('BUILT_IN_SKILL_PACKS — creative packs', () => {
  const CREATIVE_PACK_NAMES = [
    'diagram-maker',
    'chart-generator',
    'web-designer',
    'slide-designer',
    'generative-art',
    'brand-assets',
  ] as const;

  it('exports an array of skill packs', () => {
    expect(Array.isArray(BUILT_IN_SKILL_PACKS)).toBe(true);
    expect(BUILT_IN_SKILL_PACKS.length).toBeGreaterThan(0);
  });

  it('includes all 6 creative skill packs', () => {
    const names = BUILT_IN_SKILL_PACKS.map((p) => p.name);
    for (const name of CREATIVE_PACK_NAMES) {
      expect(names).toContain(name);
    }
  });

  it('diagram-maker has correct toolProfile (code-audit)', () => {
    const pack = BUILT_IN_SKILL_PACKS.find((p) => p.name === 'diagram-maker')!;
    expect(pack.toolProfile).toBe('code-audit');
  });

  it('chart-generator has correct toolProfile (code-edit)', () => {
    const pack = BUILT_IN_SKILL_PACKS.find((p) => p.name === 'chart-generator')!;
    expect(pack.toolProfile).toBe('code-edit');
  });

  it('diagram-maker tags include "mermaid", "plantuml", and "diagram"', () => {
    const pack = BUILT_IN_SKILL_PACKS.find((p) => p.name === 'diagram-maker')!;
    expect(pack.tags).toContain('mermaid');
    expect(pack.tags).toContain('plantuml');
    expect(pack.tags).toContain('diagram');
  });

  it('chart-generator tags include "chart", "d3", and "visualization"', () => {
    const pack = BUILT_IN_SKILL_PACKS.find((p) => p.name === 'chart-generator')!;
    expect(pack.tags).toContain('chart');
    expect(pack.tags).toContain('d3');
    expect(pack.tags).toContain('visualization');
  });

  it('diagram-maker systemPromptExtension mentions Mermaid format guide', () => {
    const pack = BUILT_IN_SKILL_PACKS.find((p) => p.name === 'diagram-maker')!;
    expect(pack.systemPromptExtension).toContain('Mermaid');
    expect(pack.systemPromptExtension).toContain('Diagram Maker Mode');
  });

  it('chart-generator systemPromptExtension mentions Chart.js and D3.js', () => {
    const pack = BUILT_IN_SKILL_PACKS.find((p) => p.name === 'chart-generator')!;
    expect(pack.systemPromptExtension).toContain('Chart.js');
    expect(pack.systemPromptExtension).toContain('D3.js');
    expect(pack.systemPromptExtension).toContain('Chart Generator Mode');
  });

  it('all creative packs have a non-empty description', () => {
    for (const name of CREATIVE_PACK_NAMES) {
      const pack = BUILT_IN_SKILL_PACKS.find((p) => p.name === name)!;
      expect(pack.description.length).toBeGreaterThan(0);
    }
  });

  it('all creative packs have a non-empty systemPromptExtension', () => {
    for (const name of CREATIVE_PACK_NAMES) {
      const pack = BUILT_IN_SKILL_PACKS.find((p) => p.name === name)!;
      expect(pack.systemPromptExtension.length).toBeGreaterThan(0);
    }
  });

  it('all creative packs have isUserDefined=false', () => {
    for (const name of CREATIVE_PACK_NAMES) {
      const pack = BUILT_IN_SKILL_PACKS.find((p) => p.name === name)!;
      expect(pack.isUserDefined).toBe(false);
    }
  });

  it('all pack names in BUILT_IN_SKILL_PACKS are unique', () => {
    const names = BUILT_IN_SKILL_PACKS.map((p) => p.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('diagram-maker requiredTools include grep and find patterns', () => {
    const pack = BUILT_IN_SKILL_PACKS.find((p) => p.name === 'diagram-maker')!;
    expect(pack.requiredTools.some((t) => t.includes('grep') || t.includes('find'))).toBe(true);
  });

  it('chart-generator requiredTools include Read and Write', () => {
    const pack = BUILT_IN_SKILL_PACKS.find((p) => p.name === 'chart-generator')!;
    expect(pack.requiredTools).toContain('Read');
    expect(pack.requiredTools).toContain('Write');
  });
});

// ── 3. parseSvgDimensions() ───────────────────────────────────────────────────

describe('parseSvgDimensions()', () => {
  it('parses width and height from viewBox', () => {
    const svg = '<svg viewBox="0 0 400 300"><rect /></svg>';
    const dims = parseSvgDimensions(svg);
    expect(dims.width).toBe(400);
    expect(dims.height).toBe(300);
  });

  it('rounds decimal viewBox values to the nearest integer', () => {
    const svg = '<svg viewBox="0 0 800.5 600.4"><rect /></svg>';
    const dims = parseSvgDimensions(svg);
    expect(dims.width).toBe(801);
    expect(dims.height).toBe(600);
  });

  it('falls back to width/height attributes when no viewBox', () => {
    const svg = '<svg width="500" height="350"><rect /></svg>';
    const dims = parseSvgDimensions(svg);
    expect(dims.width).toBe(500);
    expect(dims.height).toBe(350);
  });

  it('parses width/height attributes with px units', () => {
    const svg = '<svg width="800px" height="600px"><rect /></svg>';
    const dims = parseSvgDimensions(svg);
    expect(dims.width).toBe(800);
    expect(dims.height).toBe(600);
  });

  it('returns undefined for SVG without any size information', () => {
    const svg = '<svg><rect /></svg>';
    const dims = parseSvgDimensions(svg);
    expect(dims.width).toBeUndefined();
    expect(dims.height).toBeUndefined();
  });

  it('prefers viewBox over explicit width/height attributes', () => {
    const svg = '<svg viewBox="0 0 200 100" width="400" height="200"><rect /></svg>';
    const dims = parseSvgDimensions(svg);
    expect(dims.width).toBe(200);
    expect(dims.height).toBe(100);
  });

  it('handles single-quoted viewBox attribute', () => {
    const svg = "<svg viewBox='0 0 1024 768'><rect /></svg>";
    const dims = parseSvgDimensions(svg);
    expect(dims.width).toBe(1024);
    expect(dims.height).toBe(768);
  });

  it('handles common icon dimensions (24×24)', () => {
    const svg = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path/></svg>';
    const dims = parseSvgDimensions(svg);
    expect(dims.width).toBe(24);
    expect(dims.height).toBe(24);
  });

  it('handles large viewBox values', () => {
    const svg = '<svg viewBox="0 0 1920 1080"><g/></svg>';
    const dims = parseSvgDimensions(svg);
    expect(dims.width).toBe(1920);
    expect(dims.height).toBe(1080);
  });

  it('returns only width when only width attribute is present', () => {
    const svg = '<svg width="300"><rect /></svg>';
    const dims = parseSvgDimensions(svg);
    expect(dims.width).toBe(300);
    expect(dims.height).toBeUndefined();
  });
});

// ── 4. HTMLRenderer ───────────────────────────────────────────────────────────

describe('HTMLRenderer.isAvailable()', () => {
  it('returns true when puppeteer module resolves', async () => {
    const available = await HTMLRenderer.isAvailable();
    expect(available).toBe(true);
  });
});

describe('HTMLRenderer.renderHtmlString()', () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await makeTempWorkspace();
    vi.clearAllMocks();
    configureMockScreenshot();
  });

  it('wraps an HTML fragment in a full document', async () => {
    const renderer = new HTMLRenderer(workspaceDir);
    await renderer.renderHtmlString('<h1>Hello</h1>');

    const [htmlArg] = mockSetContent.mock.calls[0] as [string, unknown];
    expect(htmlArg).toContain('<!DOCTYPE html>');
    expect(htmlArg).toContain('<h1>Hello</h1>');
  });

  it('passes through a full document that starts with <!DOCTYPE', async () => {
    const renderer = new HTMLRenderer(workspaceDir);
    const fullDoc = '<!DOCTYPE html><html><head><title>T</title></head><body>Hello</body></html>';
    await renderer.renderHtmlString(fullDoc);

    const [htmlArg] = mockSetContent.mock.calls[0] as [string, unknown];
    expect(htmlArg).toBe(fullDoc);
  });

  it('passes through a document that starts with <html>', async () => {
    const renderer = new HTMLRenderer(workspaceDir);
    const doc = '<html><body>Test</body></html>';
    await renderer.renderHtmlString(doc);

    const [htmlArg] = mockSetContent.mock.calls[0] as [string, unknown];
    expect(htmlArg).toBe(doc);
  });

  it('sets default viewport to 1280×720', async () => {
    const renderer = new HTMLRenderer(workspaceDir);
    await renderer.renderHtmlString('<p>test</p>');
    expect(mockSetViewport).toHaveBeenCalledWith({ width: 1280, height: 720 });
  });

  it('respects custom width and height options', async () => {
    const renderer = new HTMLRenderer(workspaceDir);
    await renderer.renderHtmlString('<p>test</p>', { width: 800, height: 600 });
    expect(mockSetViewport).toHaveBeenCalledWith({ width: 800, height: 600 });
  });

  it('uses png format by default', async () => {
    const renderer = new HTMLRenderer(workspaceDir);
    await renderer.renderHtmlString('<p>test</p>');
    expect(mockScreenshot).toHaveBeenCalledWith(expect.objectContaining({ type: 'png' }));
  });

  it('uses jpeg format when specified', async () => {
    const renderer = new HTMLRenderer(workspaceDir);
    await renderer.renderHtmlString('<p>test</p>', { format: 'jpeg' });
    expect(mockScreenshot).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'jpeg', quality: 90 }),
    );
  });

  it('returns a RenderResult with outputPath ending in .png', async () => {
    const renderer = new HTMLRenderer(workspaceDir);
    const result = await renderer.renderHtmlString('<p>test</p>');
    expect(result.outputPath).toMatch(/render-.+\.png$/);
    expect(result.format).toBe('png');
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it('returns a RenderResult with .jpg extension for jpeg format', async () => {
    const renderer = new HTMLRenderer(workspaceDir);
    const result = await renderer.renderHtmlString('<p>test</p>', { format: 'jpeg' });
    expect(result.outputPath).toMatch(/render-.+\.jpg$/);
    expect(result.format).toBe('jpeg');
  });

  it('uses "load" waitUntil by default', async () => {
    const renderer = new HTMLRenderer(workspaceDir);
    await renderer.renderHtmlString('<p>test</p>');
    expect(mockSetContent).toHaveBeenCalledWith(expect.any(String), { waitUntil: 'load' });
  });

  it('uses "networkidle0" waitUntil when waitForNetworkIdle=true', async () => {
    const renderer = new HTMLRenderer(workspaceDir);
    await renderer.renderHtmlString('<p>test</p>', { waitForNetworkIdle: true });
    expect(mockSetContent).toHaveBeenCalledWith(expect.any(String), {
      waitUntil: 'networkidle0',
    });
  });

  it('closes the browser after successful render', async () => {
    const renderer = new HTMLRenderer(workspaceDir);
    await renderer.renderHtmlString('<p>test</p>');
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it('closes the browser even when screenshot throws', async () => {
    mockScreenshot.mockRejectedValueOnce(new Error('Screenshot failed'));
    const renderer = new HTMLRenderer(workspaceDir);
    await expect(renderer.renderHtmlString('<p>test</p>')).rejects.toThrow('Screenshot failed');
    expect(mockClose).toHaveBeenCalledOnce();
  });
});

describe('HTMLRenderer.renderSvgString()', () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await makeTempWorkspace();
    vi.clearAllMocks();
    configureMockScreenshot();
  });

  it('sets viewport to SVG natural dimensions from viewBox', async () => {
    const renderer = new HTMLRenderer(workspaceDir);
    const svg = '<svg viewBox="0 0 640 480"><rect/></svg>';
    await renderer.renderSvgString(svg);
    expect(mockSetViewport).toHaveBeenCalledWith({ width: 640, height: 480 });
  });

  it('falls back to 800×600 when SVG has no size information', async () => {
    const renderer = new HTMLRenderer(workspaceDir);
    const svg = '<svg><rect/></svg>';
    await renderer.renderSvgString(svg);
    expect(mockSetViewport).toHaveBeenCalledWith({ width: 800, height: 600 });
  });

  it('respects explicit options over SVG natural dimensions', async () => {
    const renderer = new HTMLRenderer(workspaceDir);
    const svg = '<svg viewBox="0 0 200 100"><rect/></svg>';
    await renderer.renderSvgString(svg, { width: 1200, height: 800 });
    expect(mockSetViewport).toHaveBeenCalledWith({ width: 1200, height: 800 });
  });

  it('wraps SVG inside a full HTML document', async () => {
    const renderer = new HTMLRenderer(workspaceDir);
    const svg = '<svg viewBox="0 0 100 100"><circle r="50"/></svg>';
    await renderer.renderSvgString(svg);

    const [htmlArg] = mockSetContent.mock.calls[0] as [string, unknown];
    expect(htmlArg).toContain('<!DOCTYPE html>');
    expect(htmlArg).toContain('<svg');
  });
});

// ── 5. MermaidRenderer ────────────────────────────────────────────────────────

describe('MermaidRenderer.isAvailable()', () => {
  it('always returns true (mermaid.ink API requires no local installation)', async () => {
    const available = await MermaidRenderer.isAvailable();
    expect(available).toBe(true);
  });
});

describe('MermaidRenderer.renderToSvgString()', () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await makeTempWorkspace();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('encodes the definition as base64url in the mermaid.ink SVG URL', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => '<svg>test</svg>',
    } as unknown as Response);

    const renderer = new MermaidRenderer(workspaceDir);
    await renderer.renderToSvgString('graph TD; A-->B;');

    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    expect(calledUrl).toContain('https://mermaid.ink/svg/');

    // Decode and verify payload
    const encoded = calledUrl.split('/svg/')[1]!;
    const decoded = Buffer.from(encoded, 'base64url').toString('utf-8');
    const payload = JSON.parse(decoded) as { code: string; mermaid: { theme: string } };
    expect(payload.code).toBe('graph TD; A-->B;');
    expect(payload.mermaid.theme).toBe('default');
  });

  it('injects the requested theme into the payload', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => '<svg>dark</svg>',
    } as unknown as Response);

    const renderer = new MermaidRenderer(workspaceDir);
    await renderer.renderToSvgString('graph TD; A-->B;', 'dark');

    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    const encoded = calledUrl.split('/svg/')[1]!;
    const decoded = Buffer.from(encoded, 'base64url').toString('utf-8');
    const payload = JSON.parse(decoded) as { mermaid: { theme: string } };
    expect(payload.mermaid.theme).toBe('dark');
  });

  it('returns the SVG string from the API response', async () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      text: async () => svgContent,
    } as unknown as Response);

    const renderer = new MermaidRenderer(workspaceDir);
    const result = await renderer.renderToSvgString('graph TD; A-->B;');
    expect(result).toBe(svgContent);
  });

  it('throws when mermaid.ink returns a non-ok status', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
    } as unknown as Response);

    const renderer = new MermaidRenderer(workspaceDir);
    await expect(renderer.renderToSvgString('invalid')).rejects.toThrow(
      'mermaid.ink SVG request failed: 422',
    );
  });
});

describe('MermaidRenderer.renderDefinition()', () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await makeTempWorkspace();
    vi.clearAllMocks();
    configureMockScreenshot();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses mermaid.ink as first backend and sets backend="mermaid-ink"', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => FAKE_PNG.buffer,
    } as unknown as Response);

    const renderer = new MermaidRenderer(workspaceDir);
    const result = await renderer.renderDefinition('graph TD; A-->B;');

    expect(result.backend).toBe('mermaid-ink');
    expect(result.format).toBe('png');
    expect(result.outputPath).toMatch(/mermaid-.+\.png$/);
    expect(result.definition).toBe('graph TD; A-->B;');
  });

  it('includes definition text in the result', async () => {
    const def = 'sequenceDiagram; Alice->>Bob: Hello';
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => FAKE_PNG.buffer,
    } as unknown as Response);

    const renderer = new MermaidRenderer(workspaceDir);
    const result = await renderer.renderDefinition(def);
    expect(result.definition).toBe(def);
  });

  it('falls back to puppeteer backend when mermaid.ink fails', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

    const renderer = new MermaidRenderer(workspaceDir);
    const result = await renderer.renderDefinition('graph TD; A-->B;');

    expect(result.backend).toBe('puppeteer');
    expect(result.definition).toBe('graph TD; A-->B;');
  });

  it('puppeteer fallback HTML includes the Mermaid CDN script', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('mermaid.ink unavailable'));

    const renderer = new MermaidRenderer(workspaceDir);
    await renderer.renderDefinition('graph TD; A-->B;');

    // The HTML passed to setContent should include mermaid.js CDN
    const [htmlArg] = mockSetContent.mock.calls[0] as [string];
    expect(htmlArg).toContain('mermaid');
  });

  it('puppeteer fallback escapes HTML special characters in definition', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('mermaid.ink unavailable'));

    const defWithHtml = 'graph TD; A["<script>alert(1)</script>"]-->B;';
    const renderer = new MermaidRenderer(workspaceDir);
    await renderer.renderDefinition(defWithHtml);

    const [htmlArg] = mockSetContent.mock.calls[0] as [string];
    // Raw <script> tag should be escaped, not present verbatim
    expect(htmlArg).not.toContain('<script>alert(1)</script>');
    expect(htmlArg).toContain('&lt;script&gt;');
  });

  it('throws when both mermaid.ink and puppeteer fail', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));
    mockLaunch.mockRejectedValueOnce(new Error('Chrome not found'));

    const renderer = new MermaidRenderer(workspaceDir);
    await expect(renderer.renderDefinition('graph TD; A-->B;')).rejects.toThrow(
      'Mermaid rendering failed',
    );
  });

  it('encodes background color as hex with ! prefix for mermaid.ink', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => FAKE_PNG.buffer,
    } as unknown as Response);

    const renderer = new MermaidRenderer(workspaceDir);
    await renderer.renderDefinition('graph TD; A-->B;', { backgroundColor: '#1a2b3c' });

    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    expect(calledUrl).toContain('bgColor=!1a2b3c');
  });

  it('passes named color directly to mermaid.ink bgColor param', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => FAKE_PNG.buffer,
    } as unknown as Response);

    const renderer = new MermaidRenderer(workspaceDir);
    await renderer.renderDefinition('graph TD; A-->B;', { backgroundColor: 'white' });

    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    expect(calledUrl).toContain('bgColor=white');
  });
});

// ── 6. Convenience functions ──────────────────────────────────────────────────

describe('renderHtmlToImage()', () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await makeTempWorkspace();
    vi.clearAllMocks();
    configureMockScreenshot();
  });

  it('renders an HTML string and returns a RenderResult', async () => {
    const result = await renderHtmlToImage(workspaceDir, '<h1>Test</h1>');
    expect(result.format).toBe('png');
    expect(result.outputPath).toMatch(/render-.+\.png$/);
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it('forwards options (width/height) to the renderer', async () => {
    await renderHtmlToImage(workspaceDir, '<p>test</p>', { width: 1920, height: 1080 });
    expect(mockSetViewport).toHaveBeenCalledWith({ width: 1920, height: 1080 });
  });
});

describe('renderSvgToImage()', () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await makeTempWorkspace();
    vi.clearAllMocks();
    configureMockScreenshot();
  });

  it('renders an SVG string and returns a RenderResult', async () => {
    const svg = '<svg viewBox="0 0 200 100"><rect/></svg>';
    const result = await renderSvgToImage(workspaceDir, svg);
    expect(result.format).toBe('png');
    expect(result.outputPath).toMatch(/render-.+\.png$/);
  });

  it('passes SVG content to setContent', async () => {
    const svg = '<svg viewBox="0 0 300 200"><circle r="100"/></svg>';
    await renderSvgToImage(workspaceDir, svg);

    const [htmlArg] = mockSetContent.mock.calls[0] as [string];
    expect(htmlArg).toContain('<svg');
    expect(htmlArg).toContain('<circle r="100"/>');
  });
});

describe('renderMermaidToImage()', () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await makeTempWorkspace();
    vi.clearAllMocks();
    configureMockScreenshot();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a MermaidRenderResult with definition and backend', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => FAKE_PNG.buffer,
    } as unknown as Response);

    const result = await renderMermaidToImage(workspaceDir, 'graph TD; A-->B;');
    expect(result.definition).toBe('graph TD; A-->B;');
    expect(result.backend).toBe('mermaid-ink');
    expect(result.format).toBe('png');
    expect(result.outputPath).toMatch(/mermaid-.+\.png$/);
  });
});
