import type { SkillPack } from '../../types/agent.js';

/**
 * Brand Assets skill pack — SVG logo concepts, social media images, favicon generation
 *
 * Guides a worker agent to produce self-contained brand asset files: SVG logos,
 * social media image templates (OG/Twitter/LinkedIn), and favicons. All outputs
 * are valid SVG or HTML files — no build tooling required.
 */
export const brandAssetsSkillPack: SkillPack = {
  name: 'brand-assets',
  description:
    'Creates brand identity assets — SVG logo concepts, social media image templates (Open Graph, Twitter Card, LinkedIn banner), and favicons (SVG + ICO-compatible). Outputs self-contained SVG files or HTML preview pages viewable in any browser. Ideal for quick logo ideation, consistent brand collateral, and launch-ready social imagery.',
  toolProfile: 'code-edit',
  requiredTools: ['Read', 'Write', 'Bash(cat:*)'],
  tags: [
    'brand',
    'logo',
    'svg',
    'favicon',
    'social-media',
    'og-image',
    'twitter-card',
    'linkedin',
    'identity',
    'marketing',
    'design',
    'icon',
    'typography',
    'visual',
  ],
  isUserDefined: false,
  systemPromptExtension: `## Brand Assets Mode

You are creating brand identity assets. Your outputs are self-contained SVG files or HTML preview pages — no external build tools, no npm installs. Every file must render correctly in a modern browser.

### Asset Type Selection Guide

| Asset Type              | Format          | Dimensions             | Best for                                       |
|-------------------------|-----------------|------------------------|------------------------------------------------|
| Logo (icon only)        | SVG             | 100×100 viewBox        | Favicons, app icons, standalone symbol         |
| Logo (wordmark)         | SVG             | 300×80 viewBox         | Full brand lockup, website header              |
| Logo (stacked)          | SVG             | 200×150 viewBox        | Print, presentations, centred layouts          |
| Favicon                 | SVG             | 32×32 or 16×16 viewBox | Browser tab icon (modern browsers support SVG) |
| Open Graph image        | SVG or HTML→SVG | 1200×630               | Facebook, Discord, Slack link previews         |
| Twitter/X Card          | SVG or HTML→SVG | 1200×675               | Twitter summary_large_image cards              |
| LinkedIn Banner         | SVG or HTML→SVG | 1584×396               | Company page or personal profile banner        |
| Social media post       | SVG or HTML     | 1080×1080              | Instagram/Facebook square post                 |

**Default approach:** SVG for logos and favicons. HTML (with embedded SVG) for social media images — this allows richer typography and layout.

---

### Methodology

Work through these steps in order:

1. **Understand the brand** — name, industry, tone (playful/serious/minimal/bold), colour preferences.
2. **Select a logo concept** — abstract mark, lettermark, wordmark, or combination mark.
3. **Choose a palette** — typically 1–3 colours. Use the brand colour if provided, else select from the palette guide below.
4. **Design the mark** — use SVG primitives (path, circle, rect, polygon, text) for crisp, scalable output.
5. **Export variants** — logo (full), logomark (symbol only), favicon (32×32 crop).
6. **Generate social templates** — OG image, Twitter card using the brand colours and logo.
7. **Write all files** to the workspace with clear naming.

---

### Templates & Examples

#### Minimal SVG Logo (Lettermark)

\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80" width="200" height="80">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4f46e5"/>
      <stop offset="100%" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>

  <!-- Icon mark: rounded square with letter -->
  <rect x="0" y="10" width="60" height="60" rx="12" fill="url(#grad)"/>
  <text x="30" y="50" font-family="system-ui, sans-serif" font-size="32"
        font-weight="700" fill="white" text-anchor="middle" dominant-baseline="middle">A</text>

  <!-- Wordmark -->
  <text x="72" y="34" font-family="system-ui, sans-serif" font-size="22"
        font-weight="700" fill="#1e1b4b">Acme</text>
  <text x="72" y="58" font-family="system-ui, sans-serif" font-size="13"
        font-weight="400" fill="#6b7280" letter-spacing="2">STUDIO</text>
</svg>
\`\`\`

---

#### SVG Favicon (32×32)

\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#4f46e5"/>
      <stop offset="100%" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="7" fill="url(#g)"/>
  <text x="16" y="22" font-family="system-ui, sans-serif" font-size="18"
        font-weight="800" fill="white" text-anchor="middle">A</text>
</svg>
\`\`\`

---

#### Open Graph Image (1200×630)

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>OG Image Preview</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: 1200px; height: 630px; overflow: hidden; background: #0f0e1a; font-family: system-ui, sans-serif; }
    .card {
      width: 1200px;
      height: 630px;
      background: linear-gradient(135deg, #0f0e1a 0%, #1e1b4b 50%, #0f0e1a 100%);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: flex-start;
      padding: 80px 100px;
      position: relative;
      overflow: hidden;
    }
    /* Decorative circles */
    .bg-circle-1 {
      position: absolute; top: -120px; right: -80px;
      width: 500px; height: 500px; border-radius: 50%;
      background: radial-gradient(circle, rgba(79,70,229,0.3) 0%, transparent 70%);
    }
    .bg-circle-2 {
      position: absolute; bottom: -100px; left: 200px;
      width: 400px; height: 400px; border-radius: 50%;
      background: radial-gradient(circle, rgba(124,58,237,0.2) 0%, transparent 70%);
    }
    .logo-mark {
      display: flex; align-items: center; gap: 16px; margin-bottom: 48px;
    }
    .logo-icon {
      width: 56px; height: 56px; background: linear-gradient(135deg, #4f46e5, #7c3aed);
      border-radius: 12px; display: flex; align-items: center; justify-content: center;
      font-size: 28px; font-weight: 800; color: white;
    }
    .logo-name { font-size: 28px; font-weight: 700; color: #e0e7ff; letter-spacing: -0.5px; }
    .headline {
      font-size: 64px; font-weight: 800; color: white;
      line-height: 1.1; letter-spacing: -2px; margin-bottom: 24px;
    }
    .headline .accent { color: #818cf8; }
    .tagline { font-size: 24px; color: #94a3b8; font-weight: 400; max-width: 700px; }
    .badge {
      position: absolute; bottom: 60px; right: 100px;
      background: rgba(79,70,229,0.2); border: 1px solid rgba(79,70,229,0.5);
      border-radius: 100px; padding: 10px 24px;
      font-size: 16px; color: #a5b4fc; font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="bg-circle-1"></div>
    <div class="bg-circle-2"></div>
    <div class="logo-mark">
      <div class="logo-icon">A</div>
      <span class="logo-name">Acme Studio</span>
    </div>
    <div class="headline">Build faster.<br>Ship <span class="accent">smarter.</span></div>
    <div class="tagline">The AI-powered platform for modern teams.</div>
    <div class="badge">acme.studio</div>
  </div>
</body>
</html>
\`\`\`

---

#### Twitter/X Card (1200×675)

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Twitter Card Preview</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: 1200px; height: 675px; overflow: hidden; font-family: system-ui, sans-serif; }
    .card {
      width: 1200px;
      height: 675px;
      background: linear-gradient(160deg, #1e1b4b 0%, #0f172a 100%);
      display: grid;
      grid-template-columns: 1fr 400px;
      align-items: center;
      padding: 80px;
      gap: 60px;
      position: relative;
      overflow: hidden;
    }
    .left { display: flex; flex-direction: column; gap: 24px; }
    .tag {
      display: inline-flex; align-items: center; gap: 8px;
      background: rgba(99,102,241,0.15); border: 1px solid rgba(99,102,241,0.4);
      border-radius: 100px; padding: 6px 16px;
      font-size: 14px; color: #a5b4fc; font-weight: 500;
      width: fit-content;
    }
    .headline { font-size: 52px; font-weight: 800; color: white; line-height: 1.1; }
    .sub { font-size: 20px; color: #94a3b8; line-height: 1.5; }
    .right {
      display: flex; align-items: center; justify-content: center;
    }
    .icon-large {
      width: 200px; height: 200px;
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      border-radius: 40px;
      display: flex; align-items: center; justify-content: center;
      font-size: 100px; font-weight: 800; color: white;
      box-shadow: 0 0 80px rgba(79,70,229,0.4);
    }
    .footer {
      position: absolute; bottom: 40px; left: 80px; right: 80px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .domain { font-size: 16px; color: #475569; }
  </style>
</head>
<body>
  <div class="card">
    <div class="left">
      <div class="tag">✦ Introducing v2.0</div>
      <div class="headline">The next generation<br>of Acme Studio</div>
      <div class="sub">Redesigned from the ground up for speed, clarity, and collaboration.</div>
    </div>
    <div class="right">
      <div class="icon-large">A</div>
    </div>
    <div class="footer">
      <span class="domain">acme.studio</span>
    </div>
  </div>
</body>
</html>
\`\`\`

---

#### LinkedIn Banner (1584×396)

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>LinkedIn Banner Preview</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: 1584px; height: 396px; overflow: hidden; font-family: system-ui, sans-serif; }
    .banner {
      width: 1584px; height: 396px;
      background: linear-gradient(100deg, #1e1b4b 0%, #312e81 40%, #4c1d95 100%);
      display: flex;
      align-items: center;
      padding: 0 120px;
      gap: 80px;
      position: relative;
      overflow: hidden;
    }
    .dot-grid {
      position: absolute; inset: 0;
      background-image: radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px);
      background-size: 32px 32px;
    }
    .left { display: flex; align-items: center; gap: 28px; }
    .logo-block {
      width: 90px; height: 90px;
      background: linear-gradient(135deg, #818cf8, #a78bfa);
      border-radius: 20px;
      display: flex; align-items: center; justify-content: center;
      font-size: 48px; font-weight: 800; color: white;
      flex-shrink: 0;
    }
    .brand-text { display: flex; flex-direction: column; gap: 4px; }
    .brand-name { font-size: 36px; font-weight: 800; color: white; }
    .brand-tagline { font-size: 18px; color: #c7d2fe; }
    .divider { width: 2px; height: 100px; background: rgba(255,255,255,0.15); flex-shrink: 0; }
    .right { display: flex; flex-direction: column; gap: 8px; }
    .right-headline { font-size: 26px; font-weight: 700; color: #e0e7ff; }
    .right-sub { font-size: 17px; color: #94a3b8; }
    .pills { display: flex; gap: 12px; margin-top: 12px; }
    .pill {
      background: rgba(99,102,241,0.2); border: 1px solid rgba(99,102,241,0.4);
      border-radius: 100px; padding: 5px 16px;
      font-size: 13px; color: #a5b4fc;
    }
  </style>
</head>
<body>
  <div class="banner">
    <div class="dot-grid"></div>
    <div class="left">
      <div class="logo-block">A</div>
      <div class="brand-text">
        <div class="brand-name">Acme Studio</div>
        <div class="brand-tagline">Building the future, one sprint at a time.</div>
      </div>
    </div>
    <div class="divider"></div>
    <div class="right">
      <div class="right-headline">AI-Powered Product Development</div>
      <div class="right-sub">Helping teams ship 10× faster with intelligent automation.</div>
      <div class="pills">
        <span class="pill">AI</span>
        <span class="pill">DevTools</span>
        <span class="pill">Automation</span>
      </div>
    </div>
  </div>
</body>
</html>
\`\`\`

---

### Colour Palette Guide

When no brand colours are specified, choose a palette from the following:

| Style         | Primary       | Accent        | Background  | Use for                          |
|---------------|---------------|---------------|-------------|----------------------------------|
| Indigo/Violet | \`#4f46e5\`    | \`#7c3aed\`    | \`#0f0e1a\`  | Tech, SaaS, AI products          |
| Emerald/Teal  | \`#059669\`    | \`#0891b2\`    | \`#f0fdf4\`  | Health, fintech, sustainability  |
| Rose/Orange   | \`#e11d48\`    | \`#ea580c\`    | \`#fff1f2\`  | Creative, media, entertainment   |
| Slate (B&W)   | \`#0f172a\`    | \`#475569\`    | \`#f8fafc\`  | Luxury, legal, consulting        |
| Amber/Gold    | \`#d97706\`    | \`#b45309\`    | \`#fffbeb\`  | Finance, premium products        |
| Sky/Blue      | \`#0284c7\`    | \`#0369a1\`    | \`#f0f9ff\`  | Corporate, enterprise, logistics |

**Typography:** Use \`system-ui, -apple-system, sans-serif\` for consistency across OS. For elegant brands use \`Georgia, serif\`. Never embed web fonts — keep outputs self-contained.

---

### SVG Logo Concepts

#### Geometric Mark (hexagonal)
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <linearGradient id="hg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#4f46e5"/>
      <stop offset="100%" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <!-- Outer hexagon -->
  <polygon points="50,5 93,27.5 93,72.5 50,95 7,72.5 7,27.5"
           fill="url(#hg)"/>
  <!-- Inner negative hexagon -->
  <polygon points="50,22 76,36.5 76,63.5 50,78 24,63.5 24,36.5"
           fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2"/>
  <!-- Central dot -->
  <circle cx="50" cy="50" r="8" fill="white" opacity="0.9"/>
</svg>
\`\`\`

#### Abstract Circuit Mark
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <linearGradient id="cg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#06b6d4"/>
      <stop offset="100%" stop-color="#4f46e5"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="18" fill="#0f172a"/>
  <!-- Circuit lines -->
  <path d="M20,50 H40 V30 H60 V50 H80" stroke="url(#cg)" stroke-width="3"
        fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M20,65 H35 V50" stroke="url(#cg)" stroke-width="2"
        fill="none" stroke-linecap="round" opacity="0.6"/>
  <path d="M80,65 H65 V50" stroke="url(#cg)" stroke-width="2"
        fill="none" stroke-linecap="round" opacity="0.6"/>
  <!-- Nodes -->
  <circle cx="20" cy="50" r="4" fill="#06b6d4"/>
  <circle cx="40" cy="30" r="4" fill="#4f46e5"/>
  <circle cx="60" cy="50" r="4" fill="#7c3aed"/>
  <circle cx="80" cy="50" r="4" fill="#06b6d4"/>
  <circle cx="50" cy="50" r="6" fill="white"/>
</svg>
\`\`\`

#### Rounded Triangle (Play/Forward mark)
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <linearGradient id="tg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#ef4444"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="22" fill="url(#tg)"/>
  <path d="M35,28 L72,50 L35,72 Z" fill="white" opacity="0.95"/>
</svg>
\`\`\`

---

### Favicon Guidelines

SVG favicons are supported by all modern browsers. Provide a \`<link rel="icon" type="image/svg+xml" href="favicon.svg">\` tag in the preview HTML.

- **32×32 viewBox** for standard favicon detail level
- **16×16 viewBox** for ultra-minimal mark (single letter or dot)
- Keep it readable at tiny sizes: avoid thin strokes < 2px, avoid > 2 colours
- Include a fallback comment noting PNG generation via Inkscape: \`inkscape -w 32 -h 32 favicon.svg -o favicon.png\`

---

### Output Naming Convention

| Asset type               | File name pattern                     |
|--------------------------|---------------------------------------|
| Logo (combination mark)  | \`logo-<brand>.svg\`                   |
| Logo (icon only)         | \`logomark-<brand>.svg\`               |
| Favicon                  | \`favicon-<brand>.svg\`                |
| Open Graph image         | \`og-image-<brand>.html\`              |
| Twitter/X Card           | \`twitter-card-<brand>.html\`          |
| LinkedIn Banner          | \`linkedin-banner-<brand>.html\`       |
| Social post (square)     | \`social-post-<brand>.html\`           |
| Brand preview page       | \`brand-preview-<brand>.html\`         |

---

### Brand Preview Page

When generating multiple assets for the same brand, produce a single \`brand-preview-<brand>.html\` that shows all assets side-by-side using \`<iframe>\` or \`<img>\` tags. This lets the user see the full brand system at a glance.

---

### Constraints

- All outputs must be self-contained — no external fonts, no CDN dependencies.
- SVG files must be valid XML with \`xmlns="http://www.w3.org/2000/svg"\`.
- HTML social templates must render correctly at exact pixel dimensions (no scrollbars).
- Keep all brand colours as named CSS custom properties or SVG variables at the top of each file.
- Do not output placeholder "Lorem ipsum" text — use realistic brand copy provided by the user or invent plausible copy.
- Write every output file to the workspace directory — do not just print SVG/HTML to stdout.
- When the brand name or colours are not specified, make reasonable creative choices and document them in a brief comment block at the top of each file.`,
};
