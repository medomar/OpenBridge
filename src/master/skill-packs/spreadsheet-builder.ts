import type { DocumentSkill } from '../../types/agent.js';

/**
 * Spreadsheet Builder skill pack — Excel/XLSX generation
 *
 * Guides a worker agent to produce well-structured .xlsx files using the
 * `exceljs` npm package. Covers prompts, formula patterns, chart generation,
 * and rich formatting for professional Excel spreadsheets.
 */
export const spreadsheetBuilderSkill: DocumentSkill = {
  name: 'spreadsheet-builder',
  description:
    'Generates professional Excel spreadsheets (.xlsx) — data tables, financial models, dashboards, and reports with formulas and charts.',
  fileFormat: 'xlsx',
  toolProfile: 'code-edit',
  npmDependency: 'exceljs',
  prompts: {
    system: `You are an expert data analyst and Node.js developer specialising in Excel spreadsheet generation using the \`exceljs\` npm package.

Your job is to write a Node.js script that generates a .xlsx file when executed. The script must:
- Import ExcelJS (ESM: \`import ExcelJS from 'exceljs'\` or CJS: \`const ExcelJS = require('exceljs')\`, match the project's module system).
- Use \`await workbook.xlsx.writeFile('output.xlsx')\` to save the file.
- Define columns with \`sheet.columns = [...]\` to set headers and column widths in one step.
- Style the header row with bold font and a light grey fill.
- Use Excel formula strings (e.g., \`{ formula: 'SUM(B2:B10)' }\`) for computed values rather than pre-computing in JavaScript.
- Never hard-code placeholder data like "Sample Value" — populate every cell with real content derived from the user's request.

When no explicit output path is provided, write the file to the current working directory with a descriptive kebab-case filename, e.g. \`sales-report-2026-03.xlsx\`.`,

    structure: `## Spreadsheet Structure Template

Use this organisation for most business spreadsheets:

### Sheet 1 — Summary / Dashboard
- Key metrics in a compact table at the top (rows 1–10)
- Totals and aggregates derived from data sheets via cross-sheet formulas (e.g., \`{ formula: "SUM('Data'!B2:B100)" }\`)
- Conditional formatting to highlight values above/below thresholds

### Sheet 2+ — Data Sheets (one per data category)
Each data sheet:
- Row 1: Column headers (bold, frozen via \`sheet.views\`)
- Rows 2–N: Data rows
- Final row: Totals row using SUM / AVERAGE formulas
- Auto-filters on the header row (\`sheet.autoFilter = 'A1:D1'\`)

### Optional: Chart Sheet
- Add a chart referencing data from the Data sheet(s) using \`workbook.addChart()\`
- Bar charts for comparisons, line charts for trends

## ExcelJS Quick Reference

\`\`\`ts
import ExcelJS from 'exceljs';

const workbook = new ExcelJS.Workbook();
workbook.creator = 'OpenBridge';
workbook.created = new Date();

const sheet = workbook.addWorksheet('Sales Data');

// Define columns (sets headers + widths in one step)
sheet.columns = [
  { header: 'Name',     key: 'name',   width: 20 },
  { header: 'Q1 Sales', key: 'q1',     width: 14 },
  { header: 'Q2 Sales', key: 'q2',     width: 14 },
  { header: 'Total',    key: 'total',  width: 14 },
];

// Style header row (row 1)
sheet.getRow(1).font = { bold: true };
sheet.getRow(1).fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' },
};

// Freeze header row
sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

// Add data rows
sheet.addRow({ name: 'Alice', q1: 12000, q2: 15000, total: { formula: 'B2+C2' } });
sheet.addRow({ name: 'Bob',   q1: 9500,  q2: 11200, total: { formula: 'B3+C3' } });

// Totals row with formulas
sheet.addRow({ name: 'Total', q1: { formula: 'SUM(B2:B3)' }, q2: { formula: 'SUM(C2:C3)' }, total: { formula: 'SUM(D2:D3)' } });

// Apply currency number format to numeric columns
sheet.getColumn('q1').numFmt  = '"$"#,##0.00';
sheet.getColumn('q2').numFmt  = '"$"#,##0.00';
sheet.getColumn('total').numFmt = '"$"#,##0.00';

await workbook.xlsx.writeFile('sales-report-2026-03.xlsx');
\`\`\``,

    formatting: `## Formatting & Data Rules

### Column Definitions
- Always set columns via \`sheet.columns = [...]\` using \`header\`, \`key\`, and \`width\` properties.
- Minimum widths: text columns ≥ 15, numeric columns ≥ 12, date columns ≥ 14.
- Use character-count widths (the \`width\` property) for portability across Excel versions.

### Header Row Styling
- Set \`font: { bold: true }\` and a solid fill on row 1 for every sheet.
- Standard header fill: \`fgColor: { argb: 'FFD9D9D9' }\` (light grey).
- Freeze the header row: \`sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }]\`.

### Number Formats
Apply number formats to entire columns via \`sheet.getColumn(key).numFmt\`:
| Data type   | Format string          | Example output  |
|-------------|------------------------|-----------------|
| Currency    | \`'"$"#,##0.00'\`      | $1,234.56       |
| Percentage  | \`'0.00%'\`            | 12.34%          |
| Integer     | \`'#,##0'\`            | 1,234           |
| Date        | \`'yyyy-mm-dd'\`       | 2026-03-06      |
| Decimal     | \`'#,##0.00'\`         | 1,234.56        |

### Formulas
Use Excel formula strings in the \`formula\` property of cell values:
- Sum a range: \`{ formula: 'SUM(B2:B10)' }\`
- Average: \`{ formula: 'AVERAGE(B2:B10)' }\`
- Conditional: \`{ formula: 'IF(B2>1000,"High","Low")' }\`
- Cross-sheet: \`{ formula: "SUM('Data Sheet'!B2:B100)" }\`
- Lookup: \`{ formula: 'VLOOKUP(A2,Lookup!A:B,2,FALSE)' }\`
- Percentage of total: \`{ formula: 'B2/SUM($B$2:$B$10)' }\`

### Charts
Add charts using the \`addChart\` worksheet method. Charts reference ranges from the same sheet:
\`\`\`ts
const chart = sheet.addChart({
  type: 'bar',
  series: [{ name: 'Q1 Sales', xValues: 'A2:A4', yValues: 'B2:B4' }],
  title: { name: 'Sales by Person' },
  plotArea: { bar: { barDir: 'col' } },
  legend: { position: 'bottom' },
});
chart.tl = { col: 5.5, row: 0.5 };  // top-left anchor (column, row, 0-based)
chart.br = { col: 12.5, row: 14.5 }; // bottom-right anchor
\`\`\`
Prefer bar/column charts for comparisons and line charts for time-series data.

### Data Validation & Safety
- Validate input data types before writing (numbers must be numbers, not strings).
- Trim and sanitise string values to avoid formula injection (never write user strings starting with \`=\`, \`+\`, \`-\`, \`@\`).
- Use JavaScript's \`Number.isFinite()\` check before writing numeric cells.

### Sheet Naming
- Sheet names must be ≤ 31 characters.
- Avoid: \`\\ / ? * [ ]\` characters in sheet names.
- Use title case: "Sales Data", "Q1 Summary", "Lookup Tables".`,

    example: `## Example: Monthly Expense Tracker

\`\`\`ts
import path from 'path';
import ExcelJS from 'exceljs';

const outputPath = 'monthly-expenses-2026-03.xlsx';

const workbook = new ExcelJS.Workbook();
workbook.creator = 'OpenBridge';
workbook.created = new Date();

// ── Sheet 1: Expenses ─────────────────────────────────────────────────────────
const wsExp = workbook.addWorksheet('Expenses');

wsExp.columns = [
  { header: 'Date',        key: 'date',        width: 14 },
  { header: 'Category',    key: 'category',    width: 16 },
  { header: 'Description', key: 'description', width: 32 },
  { header: 'Amount',      key: 'amount',      width: 14 },
  { header: 'Notes',       key: 'notes',       width: 28 },
];

// Style header
wsExp.getRow(1).font = { bold: true };
wsExp.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
wsExp.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

// Data rows
const expenseRows = [
  { date: '2026-03-01', category: 'Travel',   description: 'Flight to London',    amount: 450.00, notes: 'Business trip'  },
  { date: '2026-03-02', category: 'Meals',    description: 'Team lunch',           amount: 87.50,  notes: 'Expense claim' },
  { date: '2026-03-03', category: 'Software', description: 'AWS monthly bill',     amount: 312.40, notes: 'Auto-renewed'  },
  { date: '2026-03-04', category: 'Office',   description: 'Printer cartridges',   amount: 45.99,  notes: ''             },
];
expenseRows.forEach(row => wsExp.addRow(row));

// Totals row
const totalRow = wsExp.rowCount + 1;
wsExp.addRow({ date: '', category: '', description: 'Total', amount: { formula: \`SUM(D2:D\${totalRow - 1})\` }, notes: '' });
wsExp.getRow(totalRow).font = { bold: true };

// Apply currency format to Amount column
wsExp.getColumn('amount').numFmt = '"$"#,##0.00';

// ── Sheet 2: Summary ──────────────────────────────────────────────────────────
const wsSummary = workbook.addWorksheet('Summary');

wsSummary.columns = [
  { header: 'Category',    key: 'category', width: 18 },
  { header: 'Total Spend', key: 'total',    width: 16 },
];
wsSummary.getRow(1).font = { bold: true };
wsSummary.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
wsSummary.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

const categories = ['Travel', 'Meals', 'Software', 'Office'];
categories.forEach(cat => {
  wsSummary.addRow({ category: cat, total: { formula: \`SUMIF(Expenses!B:B,"\${cat}",Expenses!D:D)\` } });
});
wsSummary.addRow({ category: 'Grand Total', total: { formula: \`SUM(B2:B\${categories.length + 1})\` } });
wsSummary.getRow(wsSummary.rowCount).font = { bold: true };
wsSummary.getColumn('total').numFmt = '"$"#,##0.00';

// ── Write file ────────────────────────────────────────────────────────────────
await workbook.xlsx.writeFile(outputPath);
console.log('Spreadsheet written:', path.resolve(outputPath));
\`\`\``,

    workerPrompt: `You are generating an Excel spreadsheet (.xlsx) using the \`exceljs\` npm package.

## Dependency Setup

Check whether \`exceljs\` is available before writing any generation script:
\`\`\`bash
node -e "require('exceljs')" 2>/dev/null || npm install exceljs
\`\`\`
Use \`exceljs@^4\` (the latest stable major). If the project already has a version pinned in package.json, use that version.

## Output Conventions

- Write the .xlsx file to the current working directory unless the user specified a path.
- Use a descriptive kebab-case filename derived from the spreadsheet purpose, e.g. \`sales-report-2026-03.xlsx\`.
- After writing, print the absolute output path: \`console.log('Spreadsheet written:', path.resolve(outputPath))\`.
- Emit \`[SHARE:FILE:<absolute-path>]\` on a separate line so OpenBridge can deliver the file.

## Key Formatting Constraints

- Define columns via \`sheet.columns = [{ header, key, width }]\` — sets headers and widths in one step.
- Style the header row: \`sheet.getRow(1).font = { bold: true }\` + solid grey fill \`fgColor: { argb: 'FFD9D9D9' }\`.
- Freeze header row: \`sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }]\`.
- Apply number formats to entire columns: \`sheet.getColumn(key).numFmt = '"$"#,##0.00'\`.
- Use formula objects for computed cells: \`{ formula: 'SUM(B2:B10)' }\`.
- Finish with \`await workbook.xlsx.writeFile(outputPath)\`.

## Common Pitfalls

- \`workbook.xlsx.writeFile()\` returns a Promise — always \`await\` it inside an \`async\` function.
- ARGB colour values include the alpha channel prefix: \`'FFD9D9D9'\` not \`'D9D9D9'\`.
- Column keys in \`sheet.columns\` must match the object keys passed to \`sheet.addRow()\`.
- Cross-sheet formula references use single quotes around sheet names with spaces: \`"SUM('Sheet Name'!B2:B10)"\`.`,
  },
};
