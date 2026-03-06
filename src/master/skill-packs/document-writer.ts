import type { DocumentSkill } from '../../types/agent.js';

/**
 * Document Writer skill pack — Word/DOCX generation
 *
 * Guides a worker agent to produce well-structured .docx files using the
 * `docx` npm package. Covers prompts, structure templates, and formatting
 * rules for professional Word documents.
 */
export const documentWriterSkill: DocumentSkill = {
  name: 'document-writer',
  description:
    'Generates professional Word documents (.docx) — reports, proposals, memos, and structured business documents.',
  fileFormat: 'docx',
  toolProfile: 'code-edit',
  npmDependency: 'docx',
  prompts: {
    system: `You are an expert technical writer and Node.js developer specialising in Word document generation using the \`docx\` npm package.

Your job is to write a Node.js script that generates a .docx file when executed. The script must:
- Import from 'docx' (ESM or CJS, match the project's module system).
- Use \`Packer.toBuffer()\` or \`Packer.toFile()\` to write the final file.
- Apply consistent heading hierarchy: Heading1 → Heading2 → Heading3 → body paragraphs.
- Keep prose concise, professional, and free of filler phrases.
- Include a title page section (document title, subtitle if applicable, date) when the document is longer than two sections.
- Never hard-code placeholder text like "Lorem ipsum" in final output — populate every section with real content derived from the user's request.

When no explicit output path is provided, write the file to the current working directory with a descriptive kebab-case filename, e.g. \`project-proposal-2026-03.docx\`.`,

    structure: `## Document Structure Template

Use this hierarchy for most business documents:

### 1. Title Page (optional — use for documents > 2 sections)
- Document title (bold, 28pt)
- Subtitle or document type (14pt)
- Author / organisation (12pt)
- Date (ISO 8601: YYYY-MM-DD)

### 2. Executive Summary (1–2 paragraphs)
- Purpose of the document
- Key findings or recommendations (3–5 bullet points)

### 3. Body Sections (repeat as needed)
Each section:
- Heading1 for top-level section
- Heading2 for sub-sections
- Bullet lists for enumerable items (use \`UnorderedList\` style)
- Numbered lists for sequential steps (use \`ListParagraph\` with numbering)
- Tables for comparative or structured data (\`Table\` with header row in bold)

### 4. Conclusion / Next Steps
- Summary of key points
- Action items with owners and due dates (if applicable)

### 5. Appendices (optional)
- Supporting data, references, or supplemental tables

## docx Package Quick Reference

\`\`\`ts
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, Table, TableRow, TableCell, WidthType,
} from 'docx';

const doc = new Document({
  sections: [{
    children: [
      new Paragraph({
        text: 'Section Title',
        heading: HeadingLevel.HEADING_1,
      }),
      new Paragraph({
        children: [new TextRun({ text: 'Body text here.', size: 24 })],
      }),
    ],
  }],
});

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync('output.docx', buffer);
\`\`\``,

    formatting: `## Formatting Rules

### Typography
- Body text: Calibri 11pt (or Times New Roman 12pt for formal documents)
- Line spacing: 1.15 for body, 1.0 for table cells
- Paragraph spacing: 6pt after each paragraph (spacingAfter: 120)
- Margins: 2.54 cm (1 inch) on all sides (default docx margins)

### Headings
| Level      | Style          | Size | Bold |
|------------|----------------|------|------|
| Heading 1  | HeadingLevel.HEADING_1 | 16pt | Yes |
| Heading 2  | HeadingLevel.HEADING_2 | 13pt | Yes |
| Heading 3  | HeadingLevel.HEADING_3 | 11pt | Yes (italic) |

### Tables
- Always include a header row with bold text and a light grey fill (#D9D9D9).
- Use \`WidthType.PERCENTAGE\` to distribute columns evenly.
- Add 1–2pt cell margins for readability.

### Lists
- Use bullet lists (\`•\`) for unordered items; indent nested lists by one level.
- Use numbered lists for procedural steps (1., a., i. hierarchy).
- Keep list items parallel in grammatical structure.

### Emphasis
- **Bold** for key terms, action items, and important values.
- *Italic* for titles of referenced works, technical terms on first use.
- Avoid underlining (reserved for hyperlinks in Word).

### Hyperlinks
- Use \`ExternalHyperlink\` from the docx package for URLs.
- Display text should be descriptive, not the raw URL.`,

    example: `## Example: Short Technical Report

\`\`\`ts
import fs from 'fs';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
} from 'docx';

const doc = new Document({
  creator: 'OpenBridge',
  title: 'API Integration Report',
  sections: [
    {
      children: [
        // Title
        new Paragraph({
          text: 'API Integration Report',
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          children: [new TextRun({ text: '2026-03-06', color: '666666' })],
          alignment: AlignmentType.CENTER,
        }),

        // Executive Summary
        new Paragraph({ text: 'Executive Summary', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({
          children: [
            new TextRun('This report summarises the integration findings for the Payments API. '),
            new TextRun({ text: 'Three critical issues', bold: true }),
            new TextRun(' were identified and resolved during the sprint.'),
          ],
        }),

        // Body
        new Paragraph({ text: 'Findings', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: 'Authentication', heading: HeadingLevel.HEADING_2 }),
        new Paragraph({
          children: [new TextRun('OAuth 2.0 token refresh was failing after 3 600 seconds due to a missing refresh_token scope.')],
        }),
      ],
    },
  ],
});

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync('api-integration-report.docx', buffer);
console.log('Document written: api-integration-report.docx');
\`\`\``,
  },
};
