import type { DocumentSkill } from '../../types/agent.js';

/**
 * Presentation Maker skill pack — PowerPoint/PPTX generation
 *
 * Guides a worker agent to produce well-structured .pptx files using the
 * `pptxgenjs` npm package. Covers prompts, slide layout templates, and design
 * principles for professional PowerPoint presentations.
 */
export const presentationMakerSkill: DocumentSkill = {
  name: 'presentation-maker',
  description:
    'Generates professional PowerPoint presentations (.pptx) — pitch decks, status updates, technical overviews, and business slide decks.',
  fileFormat: 'pptx',
  toolProfile: 'code-edit',
  npmDependency: 'pptxgenjs',
  prompts: {
    system: `You are an expert presentation designer and Node.js developer specialising in PowerPoint generation using the \`pptxgenjs\` npm package.

Your job is to write a Node.js script that generates a .pptx file when executed. The script must:
- Import PptxGenJS from 'pptxgenjs' (ESM: \`import PptxGenJS from 'pptxgenjs'\` or CJS: \`const PptxGenJS = require('pptxgenjs')\`, match the project's module system).
- Use \`pptx.writeFile({ fileName: 'output.pptx' })\` to save the file.
- Apply consistent slide layouts: title slide → agenda → content slides → summary.
- Keep text concise — each slide should convey one key idea; aim for ≤ 6 bullet points per slide.
- Use the built-in layout \`LAYOUT_WIDE\` (13.33 × 7.5 inches) for modern widescreen presentations.
- Never hard-code placeholder text like "Lorem ipsum" — populate every slide with real content derived from the user's request.

When no explicit output path is provided, write the file to the current working directory with a descriptive kebab-case filename, e.g. \`q1-business-review-2026-03.pptx\`.`,

    structure: `## Slide Structure Template

Use this sequence for most business presentations:

### Slide 1 — Title Slide
- Presentation title (large, bold)
- Subtitle or document type (e.g., "Q1 Business Review")
- Presenter / organisation name
- Date (ISO 8601: YYYY-MM-DD)

### Slide 2 — Agenda / Overview (optional — use for presentations > 5 slides)
- Bullet list of top-level sections (3–6 items)

### Slides 3–N — Content Slides (repeat per section)
Each content slide:
- Section heading in the title placeholder
- Body placeholder: 3–6 bullet points (≤ 10 words per bullet)
- Use sub-bullets (indent level 2) for supporting details
- Add a data table or chart placeholder for quantitative data

### Second-to-last Slide — Key Takeaways / Summary
- 3–5 high-impact bullet points summarising the presentation

### Last Slide — Next Steps / Call to Action
- Action items with owners and target dates
- Contact information or Q&A prompt

## pptxgenjs Quick Reference

\`\`\`ts
import PptxGenJS from 'pptxgenjs';

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 in

// Title slide
const titleSlide = pptx.addSlide();
titleSlide.addText('Presentation Title', {
  x: 1, y: 2.5, w: '80%', h: 1.2,
  fontSize: 36, bold: true, align: 'center', color: '363636',
});
titleSlide.addText('Subtitle · 2026-03-06', {
  x: 1, y: 3.8, w: '80%', h: 0.6,
  fontSize: 18, align: 'center', color: '666666',
});

// Content slide
const contentSlide = pptx.addSlide();
contentSlide.addText('Section Title', {
  x: 0.5, y: 0.3, w: '90%', h: 0.7,
  fontSize: 24, bold: true, color: '363636',
});
contentSlide.addText(
  [
    { text: 'First key point', options: { bullet: true } },
    { text: 'Second key point', options: { bullet: true } },
    { text: 'Supporting detail', options: { bullet: { indent: 15 } } },
  ],
  { x: 0.5, y: 1.2, w: '90%', h: 5.5, fontSize: 18, color: '444444' },
);

await pptx.writeFile({ fileName: 'output.pptx' });
\`\`\``,

    formatting: `## Formatting & Design Rules

### Layout & Dimensions
- Use \`LAYOUT_WIDE\` (13.33 × 7.5 in) for all modern presentations.
- Leave at least 0.5 in margin on all edges.
- Title placeholder: x=0.5, y=0.3, w=12.33, h=0.8.
- Body placeholder: x=0.5, y=1.2, w=12.33, h=5.8.

### Typography
- Slide title: 24–28pt, bold, dark grey (#363636)
- Body text (level 1): 18–20pt, regular, near-black (#444444)
- Body text (level 2 sub-bullet): 14–16pt, regular, grey (#666666)
- Footer / metadata: 10pt, light grey (#999999)
- Font family: Calibri or Arial (widely available, no install required)

### Colour Palette
| Role        | Hex     | Usage                        |
|-------------|---------|------------------------------|
| Primary     | #1A56DB | Headings, accents, CTAs       |
| Secondary   | #E8F0FE | Slide backgrounds, highlights |
| Dark text   | #363636 | Titles and key labels         |
| Body text   | #444444 | Regular paragraph text        |
| Muted text  | #666666 | Sub-bullets, captions         |
| White       | #FFFFFF | Text on dark backgrounds      |

### Slide Background
- Default: white (#FFFFFF) — clean and printable.
- Title slide: optionally use primary colour (#1A56DB) with white text.
- Never use a background image that reduces text legibility.

### Bullet Points
- Maximum 6 top-level bullets per slide.
- Maximum 2 indent levels (level 1 + level 2 sub-bullet).
- Keep each bullet ≤ 10 words; move details to speaker notes if needed.
- Use sentence case (not ALL CAPS) for bullet text.

### Tables
- Header row: bold white text on primary colour (#1A56DB) background.
- Alternating row fill: #F5F8FF and #FFFFFF for readability.
- Border: 0.5pt solid #CCCCCC on all cells.
- Font size: 14pt for headers, 13pt for data rows.

### Charts (addChart)
- Prefer bar charts (\`pptx.ChartType.bar\`) for comparisons.
- Prefer line charts (\`pptx.ChartType.line\`) for trends over time.
- Always include a chart title and axis labels.
- Use the primary palette colours for data series.`,

    example: `## Example: 3-Slide Status Update Deck

\`\`\`ts
import PptxGenJS from 'pptxgenjs';

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE';

// ── Slide 1: Title ──────────────────────────────────────────────────────────
const s1 = pptx.addSlide();
s1.background = { color: '1A56DB' };
s1.addText('Q1 Engineering Status Update', {
  x: 1, y: 2.2, w: 11.33, h: 1.4,
  fontSize: 36, bold: true, align: 'center', color: 'FFFFFF',
});
s1.addText('OpenBridge Team · 2026-03-06', {
  x: 1, y: 3.7, w: 11.33, h: 0.7,
  fontSize: 18, align: 'center', color: 'E8F0FE',
});

// ── Slide 2: Progress ───────────────────────────────────────────────────────
const s2 = pptx.addSlide();
s2.addText('Sprint Progress', {
  x: 0.5, y: 0.3, w: 12.33, h: 0.8,
  fontSize: 26, bold: true, color: '363636',
});
s2.addText(
  [
    { text: '12 of 15 tasks completed (80%)', options: { bullet: true } },
    { text: 'Phase 93 observations pipeline shipped', options: { bullet: true } },
    { text: 'Phase 96d role management fixes merged', options: { bullet: true } },
    { text: 'Document skill packs: 1 of 4 complete', options: { bullet: true } },
    { text: 'Remaining: presentation-maker, spreadsheet-builder, report-generator', options: { bullet: { indent: 15 } } },
  ],
  { x: 0.5, y: 1.2, w: 12.33, h: 5.5, fontSize: 18, color: '444444' },
);

// ── Slide 3: Next Steps ─────────────────────────────────────────────────────
const s3 = pptx.addSlide();
s3.addText('Next Steps', {
  x: 0.5, y: 0.3, w: 12.33, h: 0.8,
  fontSize: 26, bold: true, color: '363636',
});
s3.addText(
  [
    { text: 'Complete remaining skill packs (OB-1729, OB-1730)', options: { bullet: true } },
    { text: 'Wire skill-pack-loader into master-manager', options: { bullet: true } },
    { text: 'Add document intent classification to router', options: { bullet: true } },
  ],
  { x: 0.5, y: 1.2, w: 12.33, h: 5.5, fontSize: 18, color: '444444' },
);

await pptx.writeFile({ fileName: 'q1-engineering-status-2026-03.pptx' });
console.log('Presentation written: q1-engineering-status-2026-03.pptx');
\`\`\``,

    workerPrompt: `You are generating a PowerPoint presentation (.pptx) using the \`pptxgenjs\` npm package.

## Dependency Setup

Check whether \`pptxgenjs\` is available before writing any generation script:
\`\`\`bash
node -e "require('pptxgenjs')" 2>/dev/null || npm install pptxgenjs
\`\`\`
Use \`pptxgenjs@^3\` (the latest stable major). If the project already has a version pinned in package.json, use that version.

## Output Conventions

- Write the .pptx file to the current working directory unless the user specified a path.
- Use a descriptive kebab-case filename derived from the presentation title, e.g. \`q1-business-review-2026-03.pptx\`.
- After writing, print the absolute output path: \`console.log('Presentation written:', path.resolve(outputPath))\`.
- Emit \`[SHARE:FILE:<absolute-path>]\` on a separate line so OpenBridge can deliver the file.

## Key Formatting Constraints

- Always set \`pptx.layout = 'LAYOUT_WIDE'\` (13.33 × 7.5 in) for widescreen output.
- Title placeholder dimensions: \`x: 0.5, y: 0.3, w: 12.33, h: 0.8\`.
- Body placeholder dimensions: \`x: 0.5, y: 1.2, w: 12.33, h: 5.8\`.
- Slide title: fontSize 24–28, bold: true, color: '363636'.
- Body text level 1: fontSize 18–20, color: '444444'.
- Body text level 2 sub-bullet: fontSize 14–16, color: '666666'.
- Maximum 6 top-level bullets per slide; maximum 2 indent levels.
- Slide sequence: title slide → agenda (if > 5 slides) → content slides → summary → next steps.

## Common Pitfalls

- \`pptx.writeFile()\` returns a Promise — always \`await\` it inside an \`async\` function.
- Color values are hex strings WITHOUT the \`#\` prefix (e.g., \`'1A56DB'\` not \`'#1A56DB'\`).
- Bullet indent is specified in points as \`{ bullet: { indent: 15 } }\`, not as a boolean.
- Use \`align: 'center'\` (string), not \`AlignmentType\` — pptxgenjs uses string alignment values.`,
  },
};
