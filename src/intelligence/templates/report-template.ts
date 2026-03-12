import type { TDocumentDefinitions, Content } from '../pdf-generator.js';
import type { Branding } from './invoice-template.js';

export type { Branding };

/** A single cell in a report table */
export type TableCell = string | number | boolean | null | undefined;

/** A table block within a report section */
export interface ReportTable {
  type: 'table';
  headers: string[];
  rows: TableCell[][];
}

/** A text block within a report section */
export interface ReportText {
  type: 'text';
  content: string;
}

/** A chart block within a report section (rendered as a base64 image) */
export interface ReportChart {
  type: 'chart';
  /** Base64 PNG data URI (e.g. "data:image/png;base64,...") */
  imageDataUri: string;
  caption?: string;
  width?: number;
}

/** Union of all supported section block types */
export type ReportBlock = ReportText | ReportTable | ReportChart;

/** A single section in the report */
export interface ReportSection {
  title: string;
  blocks: ReportBlock[];
}

/**
 * Build a pdfmake document definition for a professional report.
 *
 * Features:
 * - Title page with report title, company name, and date
 * - Auto-generated table of contents (section headings list)
 * - Sections with text paragraphs, data tables, and chart images
 * - Page numbers in the footer
 */
export function buildReportDefinition(
  title: string,
  sections: ReportSection[],
  branding: Branding,
): TDocumentDefinitions {
  const primaryColor = branding.primaryColor ?? '#1a73e8';
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Collect images from chart blocks
  const images: Record<string, string> = {};
  if (branding.logoDataUri) {
    images['reportLogo'] = branding.logoDataUri;
  }

  sections.forEach((section, sIdx) => {
    section.blocks.forEach((block, bIdx) => {
      if (block.type === 'chart') {
        images[`chart_${sIdx}_${bIdx}`] = block.imageDataUri;
      }
    });
  });

  // ── Title page ─────────────────────────────────────────────────────────

  const titlePageContent: Content[] = [];

  if (branding.logoDataUri) {
    titlePageContent.push({
      image: 'reportLogo',
      width: 140,
      alignment: 'center' as const,
      marginBottom: 40,
    });
  }

  titlePageContent.push(
    {
      text: title,
      style: 'reportTitle',
      alignment: 'center' as const,
      color: primaryColor,
      marginBottom: 16,
    },
    {
      text: branding.companyName,
      style: 'reportCompany',
      alignment: 'center' as const,
      marginBottom: 8,
    },
    {
      text: today,
      style: 'reportDate',
      alignment: 'center' as const,
      marginBottom: 40,
    },
    // Page break after title page
    { text: '', pageBreak: 'after' as const },
  );

  // ── Table of contents ──────────────────────────────────────────────────

  const tocRows: Content[] = [
    {
      text: 'Table of Contents',
      style: 'tocTitle',
      color: primaryColor,
      marginBottom: 12,
    },
  ];

  sections.forEach((section, idx) => {
    tocRows.push({
      columns: [
        { text: `${idx + 1}.  ${section.title}`, style: 'tocEntry', width: '*' },
        { text: String(idx + 2), style: 'tocPage', width: 'auto', alignment: 'right' as const },
      ],
      marginBottom: 6,
    });
  });

  tocRows.push({ text: '', pageBreak: 'after' as const });

  // ── Sections ───────────────────────────────────────────────────────────

  const sectionContent: Content[] = [];

  sections.forEach((section, sIdx) => {
    sectionContent.push({
      text: `${sIdx + 1}.  ${section.title}`,
      style: 'sectionTitle',
      color: primaryColor,
      marginBottom: 10,
    });

    section.blocks.forEach((block, bIdx) => {
      if (block.type === 'text') {
        sectionContent.push({
          text: block.content,
          style: 'bodyText',
          marginBottom: 10,
        });
      } else if (block.type === 'table') {
        const headerRow: Content[] = block.headers.map((h) => ({
          text: h,
          style: 'tableHeader',
          color: 'white',
          fillColor: primaryColor,
        }));

        const dataRows: Content[][] = block.rows.map((row, rowIdx) => {
          const bg = rowIdx % 2 === 0 ? '#f8f9fa' : 'white';
          return block.headers.map((_h, colIdx) => ({
            text: String(row[colIdx] ?? ''),
            fillColor: bg,
          }));
        });

        const colWidths: string[] = block.headers.map(() => '*');

        sectionContent.push({
          table: {
            headerRows: 1,
            widths: colWidths,
            body: [headerRow, ...dataRows],
          },
          layout: 'lightHorizontalLines',
          marginBottom: 14,
        });
      } else if (block.type === 'chart') {
        const imageKey = `chart_${sIdx}_${bIdx}`;
        sectionContent.push({
          image: imageKey,
          width: block.width ?? 460,
          alignment: 'center' as const,
          marginBottom: block.caption ? 4 : 14,
        });
        if (block.caption) {
          sectionContent.push({
            text: block.caption,
            style: 'chartCaption',
            alignment: 'center' as const,
            marginBottom: 14,
          });
        }
      }
    });

    // Page break between sections (not after the last one)
    if (sIdx < sections.length - 1) {
      sectionContent.push({ text: '', pageBreak: 'after' as const });
    }
  });

  // ── Assemble document ──────────────────────────────────────────────────

  const content: Content[] = [...titlePageContent, ...tocRows, ...sectionContent];

  return {
    pageSize: 'A4',
    pageMargins: [50, 60, 50, 60] as [number, number, number, number],
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.4 },
    ...(Object.keys(images).length > 0 ? { images } : {}),
    footer: (currentPage: number, pageCount: number): Content => ({
      columns: [
        { text: branding.companyName, style: 'footerText', width: '*' },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          style: 'footerText',
          alignment: 'right' as const,
          width: 'auto',
        },
      ],
      margin: [50, 10, 50, 0] as [number, number, number, number],
    }),
    styles: {
      reportTitle: { fontSize: 28, bold: true, marginBottom: 8 },
      reportCompany: { fontSize: 14, color: '#444444', marginBottom: 4 },
      reportDate: { fontSize: 11, color: '#888888' },
      tocTitle: { fontSize: 16, bold: true },
      tocEntry: { fontSize: 10 },
      tocPage: { fontSize: 10, color: '#888888' },
      sectionTitle: { fontSize: 16, bold: true },
      bodyText: { fontSize: 10, color: '#333333', lineHeight: 1.5 },
      tableHeader: { fontSize: 10, bold: true },
      chartCaption: { fontSize: 9, color: '#666666', italics: true },
      footerText: { fontSize: 8, color: '#aaaaaa' },
    },
    content,
  };
}
