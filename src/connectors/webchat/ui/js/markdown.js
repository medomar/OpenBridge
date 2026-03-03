/**
 * Markdown → HTML renderer using the marked library.
 * Bundled inline — no CDN dependency.
 *
 * Supports: GFM tables, task lists, strikethrough, fenced code blocks with
 * language classes, blockquotes, ordered/unordered lists, links (open in new
 * tab), and soft line-break conversion.
 *
 * @module markdown
 */
import { marked } from 'marked';

// Custom renderer: open all links in a new tab
const renderer = {
  link({ href, title, text }) {
    const titleAttr = title ? ` title="${title}"` : '';
    return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
  },
};

// Configure marked: GFM (tables, task lists, strikethrough, fenced code) +
// soft line-break conversion (single newline → <br>)
marked.use({
  gfm: true,
  breaks: true,
  renderer,
});

/**
 * Render a markdown string to HTML.
 *
 * @param {string} raw - raw markdown text from AI
 * @returns {string} rendered HTML
 */
export function renderMarkdown(raw) {
  return /** @type {string} */ (marked.parse(raw));
}
