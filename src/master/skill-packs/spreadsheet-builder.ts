import type { DocumentSkill } from '../../types/agent.js';

/**
 * Spreadsheet Builder skill pack — Excel/XLSX generation
 *
 * Guides a worker agent to produce well-structured .xlsx files using the
 * `xlsx` npm package (SheetJS). Covers prompts, formula patterns, and chart
 * generation for professional Excel spreadsheets.
 */
export const spreadsheetBuilderSkill: DocumentSkill = {
  name: 'spreadsheet-builder',
  description:
    'Generates professional Excel spreadsheets (.xlsx) — data tables, financial models, dashboards, and reports with formulas and charts.',
  fileFormat: 'xlsx',
  toolProfile: 'code-edit',
  npmDependency: 'xlsx',
  prompts: {
    system: `You are an expert data analyst and Node.js developer specialising in Excel spreadsheet generation using the \`xlsx\` npm package (SheetJS).

Your job is to write a Node.js script that generates a .xlsx file when executed. The script must:
- Import from 'xlsx' (ESM: \`import * as XLSX from 'xlsx'\` or CJS: \`const XLSX = require('xlsx')\`, match the project's module system).
- Use \`XLSX.writeFile(workbook, 'output.xlsx')\` to save the file.
- Use meaningful sheet names (≤ 31 characters, no special characters except space, hyphen, underscore).
- Apply column widths via \`ws['!cols']\` so data is readable without manual resizing.
- Include a header row with bold formatting wherever data tables are used.
- Use Excel formulas (SUM, AVERAGE, IF, VLOOKUP, etc.) for computed values rather than pre-computing in JavaScript.
- Never hard-code placeholder data like "Sample Value" — populate every cell with real content derived from the user's request.

When no explicit output path is provided, write the file to the current working directory with a descriptive kebab-case filename, e.g. \`sales-report-2026-03.xlsx\`.`,

    structure: `## Spreadsheet Structure Template

Use this organisation for most business spreadsheets:

### Sheet 1 — Summary / Dashboard
- Key metrics in a compact table at the top (A1:D10 region)
- Totals and aggregates derived from data sheets via cross-sheet formulas (e.g., \`=Data!B2\`)
- Conditional formatting to highlight values above/below thresholds

### Sheet 2+ — Data Sheets (one per data category)
Each data sheet:
- Row 1: Column headers (bold, frozen via \`ws['!freeze']\`)
- Rows 2–N: Data rows
- Final row: Totals row using SUM / AVERAGE formulas
- Named ranges for important ranges to simplify formula references

### Optional: Chart Sheet
- Embed chart data as a separate sheet when visualisation is needed
- Reference data from the Data sheet(s) to keep chart data in sync

## xlsx (SheetJS) Quick Reference

\`\`\`ts
import * as XLSX from 'xlsx';

// Create workbook + worksheet from array of arrays
const wb = XLSX.utils.book_new();

const data = [
  ['Name', 'Q1 Sales', 'Q2 Sales', 'Total'],         // header row
  ['Alice',  12000,     15000,     { f: 'B2+C2' }],  // formula cell
  ['Bob',    9500,      11200,     { f: 'B3+C3' }],
  ['Total',  { f: 'SUM(B2:B3)' }, { f: 'SUM(C2:C3)' }, { f: 'SUM(D2:D3)' }],
];

const ws = XLSX.utils.aoa_to_sheet(data);

// Set column widths
ws['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];

// Freeze header row
ws['!freeze'] = { xSplit: 0, ySplit: 1 };

XLSX.utils.book_append_sheet(wb, ws, 'Sales Data');
XLSX.writeFile(wb, 'sales-report-2026-03.xlsx');
\`\`\``,

    formatting: `## Formatting & Data Rules

### Column Widths
- Set \`ws['!cols']\` with \`wch\` (character width) for every sheet.
- Minimum widths: text columns ≥ 15, numeric columns ≥ 10, date columns ≥ 12.
- Avoid fixed pixel widths — use character widths for portability.

### Header Rows
- Always place headers in row 1.
- Use \`XLSX.utils.sheet_add_aoa\` or cell-level style objects to mark header cells.
- Freeze the header row: \`ws['!freeze'] = { xSplit: 0, ySplit: 1 }\`.

### Number Formats
Apply number formats via cell \`z\` property or style objects:
| Data type   | Format string       | Example output  |
|-------------|---------------------|-----------------|
| Currency    | \`"$#,##0.00"\`     | $1,234.56       |
| Percentage  | \`"0.00%"\`         | 12.34%          |
| Integer     | \`"#,##0"\`         | 1,234           |
| Date        | \`"YYYY-MM-DD"\`    | 2026-03-06      |
| Decimal     | \`"#,##0.00"\`      | 1,234.56        |

### Formulas
Use Excel formula syntax in cell objects: \`{ f: 'SUM(B2:B10)' }\`
Common patterns:
- Sum a range: \`{ f: 'SUM(B2:B10)' }\`
- Average: \`{ f: 'AVERAGE(B2:B10)' }\`
- Conditional: \`{ f: 'IF(B2>1000,"High","Low")' }\`
- Cross-sheet reference: \`{ f: "SUM('Data Sheet'!B2:B100)" }\`
- Lookup: \`{ f: 'VLOOKUP(A2,Lookup!A:B,2,FALSE)' }\`
- Percentage of total: \`{ f: 'B2/SUM($B$2:$B$10)' }\`

### Data Validation & Safety
- Validate input data types before writing (numbers must be numbers, not strings).
- Trim and sanitise string values to avoid formula injection (never write user strings starting with \`=\`, \`+\`, \`-\`, \`@\`).
- Use JavaScript's \`Number.isFinite()\` check before writing numeric cells.

### Sheet Naming
- Sheet names must be ≤ 31 characters.
- Avoid: \`\\ / ? * [ ]\` characters in sheet names.
- Use title case for sheet names: "Sales Data", "Q1 Summary", "Lookup Tables".`,

    example: `## Example: Monthly Expense Tracker

\`\`\`ts
import * as XLSX from 'xlsx';

const wb = XLSX.utils.book_new();

// ── Sheet 1: Expenses ────────────────────────────────────────────────────────
const expenseData = [
  ['Date', 'Category', 'Description', 'Amount', 'Notes'],
  ['2026-03-01', 'Travel', 'Flight to London', 450.00, 'Business trip'],
  ['2026-03-02', 'Meals', 'Team lunch', 87.50, 'Expense claim'],
  ['2026-03-03', 'Software', 'AWS monthly bill', 312.40, 'Auto-renewed'],
  ['2026-03-04', 'Office', 'Printer cartridges', 45.99, ''],
  // Total row with formula
  ['', '', 'Total', { f: 'SUM(D2:D5)' }, ''],
];

const wsExpenses = XLSX.utils.aoa_to_sheet(expenseData);
wsExpenses['!cols'] = [
  { wch: 12 }, // Date
  { wch: 14 }, // Category
  { wch: 30 }, // Description
  { wch: 12 }, // Amount
  { wch: 25 }, // Notes
];
wsExpenses['!freeze'] = { xSplit: 0, ySplit: 1 };

// Apply currency format to Amount column (D2:D6)
for (let row = 1; row <= expenseData.length; row++) {
  const cellRef = \`D\${row + 1}\`;
  if (wsExpenses[cellRef]) {
    wsExpenses[cellRef].z = '"$"#,##0.00';
  }
}

XLSX.utils.book_append_sheet(wb, wsExpenses, 'Expenses');

// ── Sheet 2: Summary ─────────────────────────────────────────────────────────
const summaryData = [
  ['Category', 'Total Spend'],
  ['Travel',   { f: 'SUMIF(Expenses!B:B,"Travel",Expenses!D:D)' }],
  ['Meals',    { f: 'SUMIF(Expenses!B:B,"Meals",Expenses!D:D)' }],
  ['Software', { f: 'SUMIF(Expenses!B:B,"Software",Expenses!D:D)' }],
  ['Office',   { f: 'SUMIF(Expenses!B:B,"Office",Expenses!D:D)' }],
  ['Grand Total', { f: 'SUM(B2:B5)' }],
];

const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
wsSummary['!cols'] = [{ wch: 16 }, { wch: 14 }];
wsSummary['!freeze'] = { xSplit: 0, ySplit: 1 };

for (let row = 1; row <= summaryData.length; row++) {
  const cellRef = \`B\${row + 1}\`;
  if (wsSummary[cellRef]) {
    wsSummary[cellRef].z = '"$"#,##0.00';
  }
}

XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

// ── Write file ───────────────────────────────────────────────────────────────
XLSX.writeFile(wb, 'monthly-expenses-2026-03.xlsx');
console.log('Spreadsheet written: monthly-expenses-2026-03.xlsx');
\`\`\``,
  },
};
