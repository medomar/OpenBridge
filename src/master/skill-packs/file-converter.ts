import type { SkillPack } from '../../types/agent.js';

/**
 * File Converter skill pack — document format conversions
 *
 * Teaches the Master AI how to convert between document formats using
 * pandoc, libreoffice --headless, Node.js packages (pdf-parse, mammoth, docx),
 * and tesseract OCR. Detects available conversion tools and picks the best one.
 */
export const fileConverterSkillPack: SkillPack = {
  name: 'file-converter',
  description:
    'Converts files between formats (MD→DOCX, DOCX→PDF, HTML→PDF, etc.) using pandoc, LibreOffice, Node.js packages, or tesseract OCR — auto-detects available tools.',
  toolProfile: 'full-access',
  requiredTools: [
    'Bash(pandoc:*)',
    'Bash(libreoffice:*)',
    'Bash(tesseract:*)',
    'Bash(node:*)',
    'Bash(npm:*)',
  ],
  tags: [
    'file-converter',
    'convert',
    'pandoc',
    'libreoffice',
    'pdf',
    'docx',
    'markdown',
    'html',
    'ocr',
    'tesseract',
    'mammoth',
    'pdf-parse',
    'format',
  ],
  isUserDefined: false,
  systemPromptExtension: `## File Converter Mode

You are handling a file conversion request. Your goal is to convert file(s) between formats using the best available tool on this machine.

### Step 1 — Detect available conversion tools

Run these checks to determine what's available:

\`\`\`bash
# Pandoc — universal document converter (preferred)
which pandoc 2>/dev/null && pandoc --version | head -1

# LibreOffice — office document conversions (headless mode)
which libreoffice 2>/dev/null && libreoffice --version

# Tesseract — OCR for images and scanned PDFs
which tesseract 2>/dev/null && tesseract --version 2>&1 | head -1

# Node.js — for programmatic conversions
which node 2>/dev/null && node --version
\`\`\`

### Step 2 — Choose the best tool for the conversion

Use this decision matrix:

| Conversion | Best Tool | Fallback |
|---|---|---|
| **MD → DOCX** | pandoc | mammoth (reverse) or manual |
| **MD → PDF** | pandoc (with wkhtmltopdf or LaTeX engine) | MD → HTML → PDF via puppeteer |
| **MD → HTML** | pandoc | marked / markdown-it (Node.js) |
| **DOCX → PDF** | libreoffice --headless | pandoc (if LaTeX installed) |
| **DOCX → MD** | pandoc | mammoth (Node.js) |
| **DOCX → HTML** | pandoc | mammoth (Node.js) |
| **DOCX → TXT** | pandoc | mammoth + strip tags |
| **HTML → PDF** | pandoc (with wkhtmltopdf) | puppeteer (Node.js) |
| **HTML → DOCX** | pandoc | libreoffice --headless |
| **PDF → TXT** | pdf-parse (Node.js) | pdftotext CLI |
| **PDF → MD** | pdf-parse + formatting | pdftotext + manual cleanup |
| **Image → TXT (OCR)** | tesseract | tesseract.js (Node.js) |
| **Scanned PDF → TXT** | pdf → images + tesseract | tesseract.js |
| **ODT/ODS/ODP → PDF** | libreoffice --headless | pandoc (limited) |
| **RTF → DOCX/PDF** | libreoffice --headless | pandoc |
| **EPUB → PDF** | pandoc | calibre (if installed) |

### Step 3 — Perform the conversion

#### A. Using Pandoc (preferred for text-based formats)

\`\`\`bash
# Markdown to DOCX
pandoc input.md -o output.docx

# Markdown to PDF (requires LaTeX or wkhtmltopdf)
pandoc input.md -o output.pdf
# If LaTeX is missing, use HTML intermediate:
pandoc input.md -o output.html && echo "Use puppeteer or wkhtmltopdf for HTML→PDF"

# DOCX to Markdown
pandoc input.docx -o output.md

# DOCX to HTML
pandoc input.docx -o output.html --standalone

# HTML to DOCX
pandoc input.html -o output.docx

# HTML to PDF (needs wkhtmltopdf or LaTeX)
pandoc input.html -o output.pdf

# EPUB to PDF
pandoc input.epub -o output.pdf

# With custom styling
pandoc input.md -o output.docx --reference-doc=template.docx
pandoc input.md -o output.pdf --pdf-engine=xelatex -V geometry:margin=1in
\`\`\`

#### B. Using LibreOffice headless (office documents)

\`\`\`bash
# DOCX to PDF
libreoffice --headless --convert-to pdf input.docx

# DOCX to PDF in a specific output directory
libreoffice --headless --convert-to pdf --outdir ./output input.docx

# ODT to PDF
libreoffice --headless --convert-to pdf input.odt

# XLSX to PDF
libreoffice --headless --convert-to pdf input.xlsx

# PPTX to PDF
libreoffice --headless --convert-to pdf input.pptx

# RTF to DOCX
libreoffice --headless --convert-to docx input.rtf

# Batch conversion (all docx files in a directory)
libreoffice --headless --convert-to pdf *.docx
\`\`\`

#### C. Using Node.js packages (programmatic conversion)

##### Extract text from PDF (pdf-parse)
\`\`\`ts
// Install: npm install pdf-parse
import fs from 'fs';
import pdfParse from 'pdf-parse';

const buffer = fs.readFileSync('input.pdf');
const data = await pdfParse(buffer);
console.log('Text:', data.text);
console.log('Pages:', data.numpages);
fs.writeFileSync('output.txt', data.text);
\`\`\`

##### Convert DOCX to HTML/text (mammoth)
\`\`\`ts
// Install: npm install mammoth
import mammoth from 'mammoth';

// DOCX → HTML
const result = await mammoth.convertToHtml({ path: 'input.docx' });
fs.writeFileSync('output.html', result.value);
console.log('Warnings:', result.messages);

// DOCX → plain text
const textResult = await mammoth.extractRawText({ path: 'input.docx' });
fs.writeFileSync('output.txt', textResult.value);

// DOCX → Markdown
const mdResult = await mammoth.convertToMarkdown({ path: 'input.docx' });
fs.writeFileSync('output.md', mdResult.value);
\`\`\`

##### Generate DOCX from scratch (docx package)
\`\`\`ts
// Install: npm install docx
import { Document, Paragraph, TextRun, Packer } from 'docx';
import fs from 'fs';

const doc = new Document({
  sections: [{
    properties: {},
    children: [
      new Paragraph({
        children: [new TextRun({ text: 'Hello World', bold: true, size: 28 })],
      }),
      new Paragraph({ children: [new TextRun('Converted content goes here.')] }),
    ],
  }],
});

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync('output.docx', buffer);
\`\`\`

##### HTML to PDF (puppeteer)
\`\`\`ts
// Install: npm install puppeteer
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.goto(\`file://\${path.resolve('input.html')}\`, { waitUntil: 'networkidle0' });
await page.pdf({ path: 'output.pdf', format: 'A4', margin: { top: '1cm', bottom: '1cm' } });
await browser.close();
\`\`\`

#### D. Using Tesseract OCR (images and scanned PDFs)

\`\`\`bash
# Image to text
tesseract input.png output -l eng
# Output: output.txt

# Image to text with specific output format
tesseract input.jpg output -l eng --oem 3 --psm 6

# Multiple languages
tesseract input.png output -l eng+fra+deu

# Scanned PDF: convert pages to images first, then OCR
# Using pdftoppm (from poppler-utils):
pdftoppm input.pdf page -png
for f in page-*.png; do tesseract "$f" "\${f%.png}" -l eng; done
cat page-*.txt > output.txt
\`\`\`

If tesseract is not installed but Node.js is available:
\`\`\`ts
// Install: npm install tesseract.js
import Tesseract from 'tesseract.js';

const { data: { text } } = await Tesseract.recognize('input.png', 'eng');
fs.writeFileSync('output.txt', text);
\`\`\`

### Step 4 — Verify and deliver

After conversion:
1. Verify the output file exists and has a non-zero size.
2. For text-based outputs, show a preview (first 20 lines).
3. For binary outputs (PDF, DOCX), confirm the file size.

\`\`\`bash
ls -lh output.*
# For text outputs: head -20 output.txt
# For PDFs: file output.pdf (verify it's a valid PDF)
\`\`\`

Emit the output file for delivery:
\`\`\`
[SHARE:FILE:<absolute-path-to-output>]
\`\`\`

### Output Conventions

- Write the output file to the same directory as the input file unless the user specified a path.
- Preserve the input filename stem: \`report.docx\` → \`report.pdf\`.
- If converting multiple files, create an output directory: \`converted/\`.
- Use descriptive names when the format changes meaning: \`scan.png\` → \`scan-ocr.txt\`.

### Error Handling

- **Tool not installed**: Report which tool is missing and suggest installation:
  - pandoc: \`brew install pandoc\` / \`apt install pandoc\`
  - libreoffice: \`brew install --cask libreoffice\` / \`apt install libreoffice\`
  - tesseract: \`brew install tesseract\` / \`apt install tesseract-ocr\`
  - wkhtmltopdf: \`brew install wkhtmltopdf\` / \`apt install wkhtmltopdf\`
- **Missing LaTeX for PDF**: Suggest \`pandoc input.md -t html | wkhtmltopdf - output.pdf\` as alternative.
- **Corrupt input file**: Try alternative tools (e.g., LibreOffice can often open slightly corrupt DOCX files).
- **Large files**: For files > 100MB, warn the user about processing time.
- **Password-protected files**: Inform the user that decryption requires the password.
- **OCR quality**: Suggest preprocessing (contrast, deskew) for poor quality scans.

### Constraints

- Never delete or overwrite the original input file.
- Always verify the output is valid before reporting success.
- If multiple tools can handle the conversion, prefer the one that produces the highest fidelity output (pandoc > libreoffice > Node.js packages for text formats).
- For batch conversions, process files sequentially to avoid overwhelming system resources.`,
};
