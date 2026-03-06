import type { DocumentSkill } from '../../types/agent.js';

/**
 * Report Generator skill pack — PDF/HTML report generation
 *
 * Guides a worker agent to produce polished PDF or HTML reports using
 * Puppeteer (HTML-to-PDF). Covers prompts, data formatting rules, and
 * executive summary style for professional business reports.
 */
export const reportGeneratorSkill: DocumentSkill = {
  name: 'report-generator',
  description:
    'Generates professional PDF/HTML reports — executive summaries, analysis reports, dashboards, and data-driven business documents.',
  fileFormat: 'pdf',
  toolProfile: 'code-edit',
  npmDependency: 'puppeteer',
  prompts: {
    system: `You are an expert technical writer and Node.js developer specialising in PDF and HTML report generation using Puppeteer.

Your job is to write a Node.js script that generates a PDF (or HTML) report when executed. The script must:
- Import Puppeteer (ESM: \`import puppeteer from 'puppeteer'\` or CJS: \`const puppeteer = require('puppeteer')\`, match the project's module system).
- Build the report as an HTML string with embedded CSS, then use \`page.setContent()\` + \`page.pdf()\` to render the PDF.
- Structure the HTML with a clear \`<head>\` (charset, viewport, styles) and \`<body>\` (header, sections, footer).
- Apply print-safe CSS: avoid CSS Grid in complex layouts (use flexbox or tables), set \`@page\` margins, and use \`page-break-before: always\` for major sections.
- Format numbers, dates, and percentages consistently throughout the report.
- Write an executive summary section at the top: purpose, key findings (3–5 bullets), and recommendations.
- Never hard-code placeholder text like "Lorem ipsum" — populate every section with real content derived from the user's request.

When no explicit output path is provided, write the file to the current working directory with a descriptive kebab-case filename, e.g. \`quarterly-report-2026-03.pdf\`.`,

    structure: `## Report Structure Template

Use this hierarchy for most business reports:

### 1. Cover Page
- Report title (large, bold)
- Subtitle or report type (e.g., "Q1 2026 Performance Review")
- Organisation / prepared by
- Date (ISO 8601: YYYY-MM-DD)
- Optional: logo placeholder or accent colour band

### 2. Executive Summary
- One paragraph: purpose of the report
- Key findings: 3–5 bullet points (bold lead phrase + short explanation)
- Recommendations or next steps (2–3 bullets)

### 3. Body Sections (repeat as needed)
Each section:
- \`<h2>\` for top-level section heading
- \`<h3>\` for sub-sections
- Prose paragraphs (150–300 words each)
- Data tables (\`<table>\`) for comparative figures
- Simple charts as inline SVG or \`<canvas>\`-based images embedded as base64

### 4. Data & Metrics Section
- Key metrics in a summary grid (2–4 columns, KPI cards)
- Trend tables with change indicators (▲ / ▼ with colour coding)
- Period-over-period comparison where relevant

### 5. Conclusion
- Summary of key points (3–5 sentences)
- Clear action items with owners and due dates

### 6. Appendix (optional)
- Raw data tables, methodology notes, or references

## Puppeteer Quick Reference

\`\`\`ts
import puppeteer from 'puppeteer';

const html = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    @page { margin: 2cm; }
    body { font-family: Arial, sans-serif; font-size: 11pt; color: #222; }
    h1 { font-size: 24pt; color: #1a3c5e; }
    h2 { font-size: 16pt; color: #1a3c5e; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    h3 { font-size: 13pt; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th { background: #1a3c5e; color: #fff; padding: 6px 10px; text-align: left; }
    td { padding: 5px 10px; border-bottom: 1px solid #e0e0e0; }
    .page-break { page-break-before: always; }
  </style>
</head>
<body>
  <h1>Report Title</h1>
  <h2>Executive Summary</h2>
  <p>...</p>
</body>
</html>\`;

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle0' });
await page.pdf({ path: 'report.pdf', format: 'A4', printBackground: true });
await browser.close();
console.log('PDF written: report.pdf');
\`\`\``,

    formatting: `## Formatting Rules

### Typography
- Body text: Arial or Helvetica, 11pt, line-height 1.5
- Headings: same font family, bold; H1 24pt, H2 16pt, H3 13pt
- Margins: 2 cm on all sides via \`@page { margin: 2cm; }\`
- Avoid web fonts that require network access — stick to system fonts (Arial, Helvetica, Georgia, Times New Roman)

### Colour Palette
Use a restrained, professional palette:
| Role             | Hex value  |
|------------------|------------|
| Primary (dark)   | \`#1a3c5e\` |
| Primary (mid)    | \`#2e6da4\` |
| Accent           | \`#e8a020\` |
| Background       | \`#f5f7fa\` |
| Body text        | \`#222222\` |
| Subtle text      | \`#666666\` |
| Table header bg  | \`#1a3c5e\` |
| Table alt row    | \`#f0f4f8\` |
| Border / divider | \`#d0d7e0\` |

### Tables
- Always include a \`<thead>\` with a dark background and white text.
- Alternate row colours (\`#ffffff\` / \`#f0f4f8\`) for readability.
- Right-align numeric columns; left-align text columns.
- Add a totals row with bold text when summing financial or count data.

### KPI / Metric Cards
Use a flex grid for summary metrics:
\`\`\`html
<div style="display:flex; gap:16px; margin:16px 0;">
  <div style="flex:1; background:#f0f4f8; padding:16px; border-radius:6px; text-align:center;">
    <div style="font-size:28pt; font-weight:bold; color:#1a3c5e;">$1.2M</div>
    <div style="font-size:10pt; color:#666;">Total Revenue</div>
  </div>
  <!-- repeat for each KPI -->
</div>
\`\`\`

### Change Indicators
Use Unicode arrows with CSS colour to show period-over-period changes:
- Increase: \`<span style="color:#2a9d2a;">▲ 12.3%</span>\`
- Decrease: \`<span style="color:#c0392b;">▼ 4.1%</span>\`
- Neutral: \`<span style="color:#666;">— 0%</span>\`

### Page Breaks
- Add \`page-break-before: always\` on each major section \`<h2>\` via the class \`.page-break\`.
- Never break a table across pages — add \`page-break-inside: avoid\` on \`<table>\`.

### Executive Summary Style
- Lead with the most important finding or recommendation.
- Use bold for the first 2–4 words of each bullet ("**Revenue grew 18%** — driven by new enterprise contracts signed in Q1.").
- Keep the entire summary to one page.`,

    example: `## Example: Quarterly Performance Report

\`\`\`ts
import fs from 'fs';
import puppeteer from 'puppeteer';

const reportData = {
  title: 'Q1 2026 Performance Report',
  period: '1 January – 31 March 2026',
  preparedBy: 'Finance & Analytics',
  date: '2026-04-05',
  kpis: [
    { label: 'Total Revenue', value: '$2.4M', change: '+18%', up: true },
    { label: 'New Customers', value: '142', change: '+32%', up: true },
    { label: 'Churn Rate', value: '2.1%', change: '-0.4pp', up: false },
    { label: 'NPS Score', value: '67', change: '+5', up: true },
  ],
  findings: [
    '**Revenue grew 18% QoQ** — driven by 12 new enterprise contracts averaging $120K ARR.',
    '**Customer acquisition accelerated** — 142 new logos, exceeding the 120-logo target by 18%.',
    '**Churn improved** — monthly churn fell from 2.5% to 2.1% following the new onboarding programme.',
  ],
  recommendations: [
    'Increase enterprise sales headcount by 3 FTEs in Q2 to sustain deal velocity.',
    'Roll out the onboarding programme to all segments — current pilot limited to SMB.',
  ],
};

function kpiCard(kpi: { label: string; value: string; change: string; up: boolean }): string {
  const colour = kpi.up ? '#2a9d2a' : '#c0392b';
  const arrow = kpi.up ? '▲' : '▼';
  return \`
    <div style="flex:1;background:#f0f4f8;padding:16px;border-radius:6px;text-align:center;">
      <div style="font-size:26pt;font-weight:bold;color:#1a3c5e;">\${kpi.value}</div>
      <div style="font-size:10pt;color:#666;margin:4px 0;">\${kpi.label}</div>
      <div style="font-size:10pt;color:\${colour};">\${arrow} \${kpi.change}</div>
    </div>\`;
}

const html = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    @page { margin: 2cm; }
    body { font-family: Arial, sans-serif; font-size: 11pt; color: #222; line-height: 1.5; }
    h1 { font-size: 24pt; color: #1a3c5e; margin-bottom: 4px; }
    h2 { font-size: 16pt; color: #1a3c5e; border-bottom: 2px solid #1a3c5e; padding-bottom: 4px; margin-top: 24px; }
    .subtitle { font-size: 13pt; color: #666; }
    .meta { font-size: 10pt; color: #888; margin-top: 8px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    thead th { background: #1a3c5e; color: #fff; padding: 7px 10px; text-align: left; }
    tbody td { padding: 6px 10px; border-bottom: 1px solid #e0e0e0; }
    tbody tr:nth-child(even) td { background: #f0f4f8; }
    ul { padding-left: 20px; }
    li { margin-bottom: 6px; }
    .page-break { page-break-before: always; }
  </style>
</head>
<body>

  <!-- Cover -->
  <h1>\${reportData.title}</h1>
  <p class="subtitle">\${reportData.period}</p>
  <p class="meta">Prepared by: \${reportData.preparedBy} · \${reportData.date}</p>

  <!-- KPI Summary -->
  <h2>Key Metrics</h2>
  <div style="display:flex;gap:12px;margin:16px 0;">
    \${reportData.kpis.map(kpiCard).join('')}
  </div>

  <!-- Executive Summary -->
  <h2>Executive Summary</h2>
  <ul>
    \${reportData.findings.map(f => \`<li>\${f}</li>\`).join('')}
  </ul>

  <!-- Recommendations -->
  <h2>Recommendations</h2>
  <ul>
    \${reportData.recommendations.map(r => \`<li>\${r}</li>\`).join('')}
  </ul>

  <!-- Data Table (example) -->
  <h2 class="page-break">Revenue by Segment</h2>
  <table>
    <thead>
      <tr><th>Segment</th><th>Q4 2025</th><th>Q1 2026</th><th>Change</th></tr>
    </thead>
    <tbody>
      <tr><td>Enterprise</td><td>$1.2M</td><td>$1.5M</td><td style="color:#2a9d2a;">▲ 25%</td></tr>
      <tr><td>Mid-Market</td><td>$0.6M</td><td>$0.65M</td><td style="color:#2a9d2a;">▲ 8%</td></tr>
      <tr><td>SMB</td><td>$0.23M</td><td>$0.25M</td><td style="color:#2a9d2a;">▲ 9%</td></tr>
      <tr><td><strong>Total</strong></td><td><strong>$2.03M</strong></td><td><strong>$2.4M</strong></td><td style="color:#2a9d2a;"><strong>▲ 18%</strong></td></tr>
    </tbody>
  </table>

</body>
</html>\`;

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle0' });
await page.pdf({ path: 'q1-2026-performance-report.pdf', format: 'A4', printBackground: true });
await browser.close();
console.log('PDF written: q1-2026-performance-report.pdf');
\`\`\``,
  },
};
