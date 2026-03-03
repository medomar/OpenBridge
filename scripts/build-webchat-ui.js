#!/usr/bin/env node
/**
 * Build script for WebChat UI.
 *
 * Bundles ui/js/app.js (and all imports including marked + highlight.js)
 * via esbuild, inlines bundled JS + CSS into index.html, and writes the
 * result as a TypeScript constant to src/connectors/webchat/ui-bundle.ts.
 *
 * Usage:  node scripts/build-webchat-ui.js
 *         npm run build:webchat
 */

import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const UI_DIR = path.join(root, 'src/connectors/webchat/ui');
const OUT_FILE = path.join(root, 'src/connectors/webchat/ui-bundle.ts');

async function main() {
  // 1. Bundle JS (app.js + all imports: websocket, markdown, dashboard, marked, hljs)
  const jsResult = await build({
    entryPoints: [path.join(UI_DIR, 'js/app.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    minify: true,
    write: false,
  });

  const bundledJs = jsResult.outputFiles[0].text;

  // 2. Read CSS
  const css = readFileSync(path.join(UI_DIR, 'css/styles.css'), 'utf8');

  // 3. Read HTML template
  let html = readFileSync(path.join(UI_DIR, 'index.html'), 'utf8');

  // 4. Replace <link rel="stylesheet" ...> with inline <style>
  html = html.replace(
    /<link\s+rel="stylesheet"\s+href="css\/styles\.css"\s*\/>/,
    `<style>\n${css}\n</style>`,
  );

  // 5. Replace <script src="js/app.js" type="module"> with inline bundled JS
  html = html.replace(
    /<script\s+src="js\/app\.js"\s+type="module"><\/script>/,
    `<script>\n${bundledJs}\n</script>`,
  );

  // 6. Escape backticks and template literal markers for embedding in TS template literal
  const escaped = html.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

  // 7. Write TypeScript constant
  const ts = `// AUTO-GENERATED — do not edit manually. Run: npm run build:webchat
// Generated: ${new Date().toISOString()}
export const WEBCHAT_HTML = \`${escaped}\`;
`;

  writeFileSync(OUT_FILE, ts, 'utf8');
  console.log(`WebChat UI bundle written to ${path.relative(root, OUT_FILE)}`);
}

main().catch((err) => {
  console.error('build-webchat-ui failed:', err);
  process.exit(1);
});
