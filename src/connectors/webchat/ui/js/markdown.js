/**
 * Markdown → HTML renderer using the marked library with highlight.js
 * syntax highlighting. Bundled inline — no CDN dependency.
 *
 * Supports: GFM tables, task lists, strikethrough, fenced code blocks with
 * language classes + syntax highlighting, blockquotes, ordered/unordered
 * lists, links (open in new tab), and soft line-break conversion.
 *
 * Languages bundled: javascript, typescript, python, bash, json, html, css, sql
 *
 * @module markdown
 */
import { marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml'; // covers html
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';

// Register bundled languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('sql', sql);

// Custom renderer: syntax-highlighted code blocks + links open in new tab
const renderer = {
  link({ href, title, text }) {
    const titleAttr = title ? ` title="${title}"` : '';
    return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
  },

  code({ text, lang }) {
    const language = lang && hljs.getLanguage(lang) ? lang : null;
    const highlighted = language
      ? hljs.highlight(text, { language }).value
      : hljs.highlightAuto(text).value;
    const langClass = language ? ` language-${language}` : '';
    return `<pre><code class="hljs${langClass}">${highlighted}</code></pre>`;
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
 * Render a markdown string to HTML with syntax-highlighted code blocks.
 *
 * @param {string} raw - raw markdown text from AI
 * @returns {string} rendered HTML
 */
export function renderMarkdown(raw) {
  return /** @type {string} */ (marked.parse(raw));
}
