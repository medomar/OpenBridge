/**
 * Minimal Markdown → HTML renderer.
 * Supports: fenced code blocks, inline code, bold+italic, bold, line breaks.
 *
 * @param {string} raw - raw markdown text
 * @returns {string} HTML string
 */
export function renderMarkdown(raw) {
  // Escape HTML entities first
  let h = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Fenced code blocks: ```lang\ncode```
  const T3 = '```';
  const cp = h.split(T3);
  let cr = '';
  for (let ci = 0; ci < cp.length; ci++) {
    if (ci % 2 === 1) {
      const lines = cp[ci].split('\n');
      const firstLine = lines[0] ? lines[0].trim() : '';
      const code = firstLine ? lines.slice(1).join('\n').trim() : cp[ci].trim();
      cr += '<pre><code>' + code + '</code></pre>';
    } else {
      cr += cp[ci];
    }
  }
  h = cr;

  // Inline code: `...`
  const T1 = '`';
  const ip = h.split(T1);
  let ir = '';
  for (let ii = 0; ii < ip.length; ii++) {
    ir += ii % 2 === 1 ? '<code>' + ip[ii] + '</code>' : ip[ii];
  }
  h = ir;

  // Bold + italic: ***text***
  const bi3 = h.split('***');
  let r3 = '';
  for (let ti = 0; ti < bi3.length; ti++) {
    r3 += ti % 2 === 1 ? '<strong><em>' + bi3[ti] + '</em></strong>' : bi3[ti];
  }
  h = r3;

  // Bold: **text**
  const bi2 = h.split('**');
  let r2 = '';
  for (let bi = 0; bi < bi2.length; bi++) {
    r2 += bi % 2 === 1 ? '<strong>' + bi2[bi] + '</strong>' : bi2[bi];
  }
  h = r2;

  // Newlines → <br>
  return h.split('\n').join('<br>');
}
