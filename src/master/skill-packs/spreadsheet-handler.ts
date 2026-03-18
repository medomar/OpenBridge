import type { SkillPack } from '../../types/agent.js';

/**
 * Spreadsheet Handler skill pack — read, write, and transform Excel/CSV files
 *
 * Extends the spreadsheet-builder skill with read/modify capabilities.
 * Teaches the Master AI how to read existing .xlsx/.xls/.csv files,
 * extract data, modify cells, and write back using exceljs or SheetJS
 * via full-access workers. Supports Google Sheets via MCP if configured.
 */
export const spreadsheetHandlerSkillPack: SkillPack = {
  name: 'spreadsheet-handler',
  description:
    'Reads, writes, and transforms spreadsheets (.xlsx, .xls, .csv) — extract data, modify cells, apply formulas, filter/sort/aggregate, and handle Google Sheets via MCP.',
  toolProfile: 'full-access',
  requiredTools: ['Bash(node:*)', 'Bash(npm:*)', 'Bash(npx:*)'],
  tags: [
    'spreadsheet',
    'excel',
    'xlsx',
    'csv',
    'xls',
    'exceljs',
    'sheetjs',
    'google-sheets',
    'data',
    'tabular',
  ],
  isUserDefined: false,
  systemPromptExtension: `## Spreadsheet Handler Mode

You are handling a spreadsheet read/write request. You can read existing files, modify them, create new ones, and perform data operations on .xlsx, .xls, and .csv files.

### Step 1 — Install dependencies

Check whether \`exceljs\` is available, install if needed:
\`\`\`bash
node -e "require('exceljs')" 2>/dev/null || npm install exceljs
\`\`\`

For .xls (legacy Excel) or advanced parsing, use \`xlsx\` (SheetJS) as fallback:
\`\`\`bash
node -e "require('xlsx')" 2>/dev/null || npm install xlsx
\`\`\`

For CSV-only tasks, Node.js built-in \`fs\` + simple parsing may suffice — no extra dependency needed.

### Step 2 — Determine the operation type

Identify which operation the user needs:

| Operation | Description |
|-----------|-------------|
| **Read / Extract** | Open a file, list sheets, read cell data, summarize contents |
| **Modify** | Change specific cells, add/remove rows or columns, update formulas |
| **Create** | Generate a new spreadsheet from scratch (see spreadsheet-builder patterns) |
| **Transform** | Filter, sort, pivot, aggregate, merge sheets, convert formats |
| **Google Sheets** | Read/write via Google Sheets MCP server if configured |

### Step 3 — Reading existing spreadsheets

#### Reading .xlsx files with ExcelJS
\`\`\`ts
import ExcelJS from 'exceljs';

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile('input.xlsx');

// List all sheet names
const sheetNames = workbook.worksheets.map(ws => ws.name);
console.log('Sheets:', sheetNames);

// Read a specific sheet
const sheet = workbook.getWorksheet('Sheet1');

// Iterate rows (1-based indexing)
sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
  const values = row.values; // values[0] is undefined (1-based)
  console.log(\`Row \${rowNumber}:\`, values.slice(1));
});

// Read a specific cell
const cell = sheet.getCell('B3');
console.log('Cell B3:', cell.value, 'Formula:', cell.formula);
\`\`\`

#### Reading .xls (legacy) files with SheetJS
\`\`\`ts
import * as XLSX from 'xlsx';

const workbook = XLSX.readFile('input.xls');
const sheetNames = workbook.SheetNames;

// Convert sheet to JSON array
const sheet = workbook.Sheets[sheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet);
console.log(JSON.stringify(data, null, 2));

// Get sheet range
const range = sheet['!ref']; // e.g., 'A1:D10'
\`\`\`

#### Reading .csv files
\`\`\`ts
import ExcelJS from 'exceljs';

const workbook = new ExcelJS.Workbook();
await workbook.csv.readFile('input.csv');
const sheet = workbook.getWorksheet(1);

// Or with plain Node.js for simple CSVs:
import { readFileSync } from 'fs';
const csv = readFileSync('input.csv', 'utf-8');
const rows = csv.split('\\n').map(line => line.split(','));
\`\`\`

### Step 4 — Modifying existing spreadsheets

\`\`\`ts
import ExcelJS from 'exceljs';

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile('input.xlsx');
const sheet = workbook.getWorksheet('Sales');

// Update a specific cell
sheet.getCell('B3').value = 15000;

// Add a new row at the end
sheet.addRow({ name: 'New Entry', q1: 5000, q2: 7000, total: { formula: 'B6+C6' } });

// Insert a new column
sheet.spliceColumns(3, 0, ['Q1.5 Sales', 8000, 9000, { formula: 'SUM(C2:C3)' }]);

// Delete a row (row number is 1-based)
sheet.spliceRows(4, 1); // remove row 4

// Update formulas
sheet.getCell('D2').value = { formula: 'SUM(B2:C2)' };

// Write back to the same file or a new file
await workbook.xlsx.writeFile('input.xlsx'); // overwrite
// or: await workbook.xlsx.writeFile('output-modified.xlsx'); // new file
\`\`\`

### Step 5 — Data operations (filter, sort, pivot, aggregate)

Write a Node.js script that reads the spreadsheet, processes data in JavaScript, and writes the result:

#### Filter rows
\`\`\`ts
const rows: Record<string, any>[] = [];
sheet.eachRow({ includeEmpty: false }, (row, num) => {
  if (num === 1) return; // skip header
  rows.push({ name: row.getCell(1).value, amount: row.getCell(2).value });
});
const filtered = rows.filter(r => (r.amount as number) > 1000);
\`\`\`

#### Sort rows
\`\`\`ts
const sorted = rows.sort((a, b) => (b.amount as number) - (a.amount as number));
\`\`\`

#### Aggregate / Pivot
\`\`\`ts
const totals = new Map<string, number>();
rows.forEach(r => {
  const key = r.category as string;
  totals.set(key, (totals.get(key) ?? 0) + (r.amount as number));
});
\`\`\`

#### Write results to a new sheet
\`\`\`ts
const resultSheet = workbook.addWorksheet('Results');
resultSheet.columns = [
  { header: 'Category', key: 'category', width: 20 },
  { header: 'Total', key: 'total', width: 14 },
];
resultSheet.getRow(1).font = { bold: true };
resultSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
for (const [category, total] of totals) {
  resultSheet.addRow({ category, total });
}
await workbook.xlsx.writeFile('output.xlsx');
\`\`\`

### Step 6 — Google Sheets via MCP (if configured)

Check your "Available MCP Servers" section for a \`google-sheets\` server. If available, spawn a worker with \`--mcp-config\` pointing to that server to read/write Google Sheets directly via the API.

If no MCP server is available, suggest:
- "Install the Google Sheets MCP server: \`npx @anthropic-ai/mcp-server-google-sheets\`"
- Or export the Google Sheet as .xlsx and process locally.

### Output Conventions

- Write the output file to the current working directory unless the user specified a path.
- Use a descriptive kebab-case filename, e.g. \`sales-report-filtered.xlsx\`.
- After writing, print the absolute output path: \`console.log('Spreadsheet written:', path.resolve(outputPath))\`
- Emit \`[SHARE:FILE:<absolute-path>]\` on a separate line so OpenBridge can deliver the file.
- When reading/summarizing, format the output as a clear text summary with key metrics highlighted.

### Error Handling

- **File not found**: Check the path, list files in the directory, suggest alternatives.
- **Corrupt file**: Try SheetJS (\`xlsx\` package) as a fallback — it handles more edge cases than ExcelJS for reading.
- **Password-protected files**: Inform the user that password-protected spreadsheets require the password to be provided.
- **Large files**: For files > 50MB, use streaming mode: \`workbook.xlsx.read(createReadStream('large.xlsx'))\`.
- **Encoding issues in CSV**: Try different encodings: \`readFileSync(path, 'latin1')\` or \`'utf-16le'\`.

### Data Safety

- Never overwrite the original file without confirming with the user — default to writing a new output file.
- Validate data types before writing (numbers must be numbers, not strings containing digits).
- Sanitize string values to avoid formula injection — never write user strings starting with \`=\`, \`+\`, \`-\`, \`@\` without prefixing with a single quote.`,
};
