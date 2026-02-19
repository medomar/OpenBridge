/**
 * Convert markdown formatting to WhatsApp-compatible formatting.
 *
 * WhatsApp supports: *bold*, _italic_, ~strikethrough~, and ```code blocks```
 * Standard markdown uses: **bold**, *italic*, ~~strikethrough~~, # headings,
 * [links](url), - lists, etc.
 *
 * This function converts common markdown patterns to their WhatsApp equivalents.
 */
export function formatMarkdownForWhatsApp(markdown: string): string {
  if (!markdown) return markdown;

  // Split content into code-block and non-code-block segments.
  // Code blocks (``` ... ```) should be preserved as-is since WhatsApp
  // supports them natively.
  const segments = splitByCodeBlocks(markdown);

  return segments
    .map((segment) => {
      if (segment.isCode) {
        return segment.content;
      }
      return formatNonCodeSegment(segment.content);
    })
    .join('');
}

interface Segment {
  content: string;
  isCode: boolean;
}

/**
 * Split text into alternating code-block / non-code-block segments.
 * Fenced code blocks use triple backticks on their own lines.
 */
function splitByCodeBlocks(text: string): Segment[] {
  const segments: Segment[] = [];
  // Match fenced code blocks: ``` optionally followed by a language tag
  const codeBlockRegex = /```[\s\S]*?```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Text before the code block
    if (match.index > lastIndex) {
      segments.push({ content: text.slice(lastIndex, match.index), isCode: false });
    }
    // The code block itself
    segments.push({ content: match[0], isCode: true });
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last code block
  if (lastIndex < text.length) {
    segments.push({ content: text.slice(lastIndex), isCode: false });
  }

  return segments;
}

/**
 * Apply markdown-to-WhatsApp formatting to a non-code segment.
 */
function formatNonCodeSegment(text: string): string {
  let result = text;

  // Convert headings: "# Title" → "*Title*" (bold in WhatsApp)
  // Supports h1-h6
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Convert horizontal rules: "---" or "***" or "___" → "───" (box drawing char)
  result = result.replace(/^(?:[-*_]){3,}\s*$/gm, '───');

  // Convert bold+italic: ***text*** or ___text___ → *_text_*
  result = result.replace(/\*{3}(.+?)\*{3}/g, '*_$1_*');
  result = result.replace(/_{3}(.+?)_{3}/g, '*_$1_*');

  // Convert bold: **text** → *text* (WhatsApp bold)
  result = result.replace(/\*{2}(.+?)\*{2}/g, '*$1*');

  // Convert strikethrough: ~~text~~ → ~text~ (WhatsApp strikethrough)
  result = result.replace(/~{2}(.+?)~{2}/g, '~$1~');

  // Convert inline code: `code` — WhatsApp doesn't support inline code formatting,
  // so we leave backtick-wrapped text as-is (single backticks render as plain text
  // with the backticks visible, which is acceptable for code references)

  // Convert images: ![alt](url) → [alt] (must run before link conversion)
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '[$1]');

  // Convert links: [text](url) → text (url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // Convert unordered list markers: "- item" or "* item" → "• item"
  // Only match at line start with optional leading whitespace
  result = result.replace(/^(\s*)[-*]\s+/gm, '$1• ');

  // Convert ordered list markers: "1. item" → "1. item" (keep as-is, already readable)
  // No conversion needed — numbered lists are fine in WhatsApp

  // Convert blockquotes: "> text" → "▎ text"
  result = result.replace(/^>\s?(.*)$/gm, '▎ $1');

  return result;
}
