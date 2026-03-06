import type { SkillPack } from '../../types/agent.js';

/**
 * Slide Designer skill pack — HTML-based presentation slides with animations, exportable to PDF
 *
 * Guides a worker agent to produce polished HTML presentations using Reveal.js or
 * pure HTML/CSS. Slides are self-contained, browser-renderable, and print-to-PDF exportable.
 */
export const slideDesignerSkillPack: SkillPack = {
  name: 'slide-designer',
  description:
    'Generates HTML-based presentation slides with animations — pitch decks, technical talks, training materials, and business presentations. Outputs a self-contained HTML file renderable in any browser and exportable to PDF via browser print.',
  toolProfile: 'code-edit',
  requiredTools: ['Read', 'Write', 'Bash(cat:*)'],
  tags: [
    'slides',
    'presentation',
    'reveal.js',
    'html',
    'pdf',
    'pitch-deck',
    'animation',
    'deck',
    'slideshow',
    'business',
  ],
  isUserDefined: false,
  systemPromptExtension: `## Slide Designer Mode

You are building HTML-based presentation slides. Your goal is to produce a polished, self-contained HTML file that renders as a slideshow in any modern browser and can be exported to PDF via browser print (Ctrl/Cmd+P → Save as PDF).

### Technology Selection Guide

| Approach         | Best for                                              | Technology                      |
|------------------|-------------------------------------------------------|---------------------------------|
| Reveal.js CDN    | Technical talks, animated decks, multi-slide tours    | Reveal.js via CDN (default)     |
| Pure HTML/CSS    | Simple decks, maximum compatibility, email-safe       | HTML + CSS scroll-snap          |
| Print-first      | Documents intended primarily for PDF export           | HTML + CSS @media print         |

**Default to Reveal.js CDN** — it provides slide navigation, animations, and speaker notes with no build step. Use pure HTML/CSS for simpler decks when Reveal.js is overkill.

---

### Methodology

Work through these steps in order:

1. **Clarify the goal** — understand the audience, purpose (pitch/technical/training), and number of slides.
2. **Plan the deck structure** — title → agenda → content slides → summary → Q&A.
3. **Choose the approach** — Reveal.js for animated decks, pure HTML for simple/print-first.
4. **Build slide by slide** — title first, then content slides, then closing slides.
5. **Add animations and transitions** — use Reveal.js built-in \`data-transition\` attributes.
6. **Review for PDF export** — ensure text is readable at A4/Letter size when printed.

---

### Templates & Examples

#### Full Reveal.js Deck (Recommended Default)

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Presentation Title</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/white.css">
  <style>
    /* Override theme variables for brand consistency */
    :root {
      --r-main-font: 'Segoe UI', system-ui, sans-serif;
      --r-heading-font: 'Segoe UI', system-ui, sans-serif;
      --r-link-color: #4f46e5;
      --r-selection-background-color: #4f46e5;
    }
    .reveal h1, .reveal h2 { color: #111827; }
    .reveal h3 { color: #4f46e5; }
    .reveal p, .reveal li { color: #374151; }

    /* Title slide accent */
    .slide-title { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: #fff !important; }
    .slide-title h1, .slide-title h2, .slide-title p { color: #fff !important; }

    /* Highlight box */
    .highlight-box { background: #eff6ff; border-left: 4px solid #4f46e5; padding: 16px 20px; border-radius: 4px; }

    /* Two-column layout */
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: start; }

    /* Metric card */
    .metric { text-align: center; }
    .metric .number { font-size: 3em; font-weight: 700; color: #4f46e5; }
    .metric .label { font-size: 0.9em; color: #6b7280; margin-top: 4px; }

    /* Tag/badge */
    .tag { display: inline-block; background: #e0e7ff; color: #3730a3; padding: 2px 10px; border-radius: 9999px; font-size: 0.75em; font-weight: 600; }

    /* Print / PDF export */
    @media print {
      .reveal .slides section { page-break-after: always; }
    }
  </style>
</head>
<body>
<div class="reveal">
  <div class="slides">

    <!-- Slide 1: Title -->
    <section class="slide-title" data-transition="fade">
      <h1 style="font-size:2.2em;">Presentation Title</h1>
      <p style="font-size:1.1em;opacity:0.85;">Subtitle — Author · Date</p>
    </section>

    <!-- Slide 2: Agenda -->
    <section data-transition="slide">
      <h2>Agenda</h2>
      <ol style="font-size:1.1em;line-height:1.8;">
        <li>Topic One</li>
        <li>Topic Two</li>
        <li>Topic Three</li>
        <li>Q &amp; A</li>
      </ol>
    </section>

    <!-- Slide 3: Content with bullet fragments -->
    <section data-transition="slide">
      <h2>Key Point</h2>
      <ul>
        <li class="fragment">First insight — appears on first click</li>
        <li class="fragment">Second insight — appears on second click</li>
        <li class="fragment">Third insight — appears on third click</li>
      </ul>
    </section>

    <!-- Slide 4: Two-column layout -->
    <section data-transition="slide">
      <h2>Comparison</h2>
      <div class="two-col">
        <div>
          <h3>Option A</h3>
          <ul style="font-size:0.85em;">
            <li>Advantage one</li>
            <li>Advantage two</li>
            <li>Advantage three</li>
          </ul>
        </div>
        <div>
          <h3>Option B</h3>
          <ul style="font-size:0.85em;">
            <li>Advantage one</li>
            <li>Advantage two</li>
            <li>Advantage three</li>
          </ul>
        </div>
      </div>
    </section>

    <!-- Slide 5: Metrics / numbers -->
    <section data-transition="zoom">
      <h2>Results</h2>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:32px;margin-top:32px;">
        <div class="metric">
          <div class="number">98%</div>
          <div class="label">Customer Satisfaction</div>
        </div>
        <div class="metric">
          <div class="number">3×</div>
          <div class="label">Faster Delivery</div>
        </div>
        <div class="metric">
          <div class="number">$2M</div>
          <div class="label">Revenue Impact</div>
        </div>
      </div>
    </section>

    <!-- Slide 6: Highlight / callout -->
    <section data-transition="slide">
      <h2>Key Takeaway</h2>
      <div class="highlight-box" style="margin-top:32px;">
        <p style="font-size:1.2em;font-weight:600;margin:0;">"One memorable sentence that captures the core message of this deck."</p>
      </div>
      <p style="margin-top:24px;color:#6b7280;font-size:0.9em;">Supporting context or attribution.</p>
    </section>

    <!-- Slide 7: Closing / Q&A -->
    <section class="slide-title" data-transition="fade">
      <h2>Thank You</h2>
      <p>Questions?</p>
      <p style="font-size:0.8em;opacity:0.8;margin-top:24px;">contact@example.com · @handle</p>
    </section>

  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js"></script>
<script>
  Reveal.initialize({
    hash: true,
    transition: 'slide',
    backgroundTransition: 'fade',
    controls: true,
    progress: true,
    center: true,
    slideNumber: 'c/t',
    // PDF export: append ?print-pdf to URL, then Ctrl/Cmd+P → Save as PDF
    pdfSeparateFragments: false,
  });
</script>
</body>
</html>
\`\`\`

---

#### Pure HTML/CSS Deck (Print-First / Simple)

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Presentation Title</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #f3f4f6; }

    /* Each slide is a full viewport page */
    .slide {
      width: 100vw;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 60px 80px;
      background: #fff;
      border-bottom: 2px solid #e5e7eb;
      page-break-after: always;
    }

    .slide.dark {
      background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%);
      color: #fff;
    }

    .slide h1 { font-size: 2.8em; font-weight: 700; color: #111827; margin-bottom: 16px; }
    .slide h2 { font-size: 2em; font-weight: 700; color: #111827; margin-bottom: 20px; }
    .slide.dark h1, .slide.dark h2 { color: #fff; }
    .slide p, .slide li { font-size: 1.1em; line-height: 1.7; color: #374151; }
    .slide.dark p, .slide.dark li { color: #e0e7ff; }
    .slide ul { padding-left: 1.4em; }
    .slide ul li { margin-bottom: 10px; }
    .accent { color: #4f46e5; }

    @media print {
      body { background: #fff; }
      .slide { border-bottom: none; page-break-after: always; min-height: 100vh; }
    }
  </style>
</head>
<body>

  <div class="slide dark">
    <h1>Presentation Title</h1>
    <p style="font-size:1.2em;opacity:0.8;margin-top:8px;">Subtitle · Author · Date</p>
  </div>

  <div class="slide">
    <h2>Key Topic</h2>
    <ul>
      <li>First point with supporting detail</li>
      <li>Second point with supporting detail</li>
      <li>Third point with supporting detail</li>
    </ul>
  </div>

  <div class="slide dark">
    <h2>Thank You</h2>
    <p>Questions?</p>
  </div>

</body>
</html>
\`\`\`

---

### Slide Structure Patterns

#### Agenda slide
\`\`\`html
<section>
  <h2>Agenda</h2>
  <ol style="font-size:1.1em;line-height:1.8;margin-top:16px;">
    <li>Background &amp; Problem</li>
    <li>Proposed Solution</li>
    <li>Timeline &amp; Next Steps</li>
    <li>Q &amp; A</li>
  </ol>
</section>
\`\`\`

#### Code snippet slide (for technical talks)
\`\`\`html
<section>
  <h2>Implementation</h2>
  <pre style="font-size:0.65em;background:#1e293b;color:#e2e8f0;padding:24px;border-radius:8px;overflow:auto;margin-top:16px;"><code>// Your code here
function example() {
  return 'result';
}</code></pre>
  <p style="font-size:0.85em;margin-top:16px;color:#6b7280;">Caption explaining the code above.</p>
</section>
\`\`\`

#### Image + caption slide
\`\`\`html
<section>
  <h2>Slide Title</h2>
  <figure style="margin-top:20px;text-align:center;">
    <!-- Replace src with actual image path or data URI -->
    <img src="{{image_path}}" alt="Description" style="max-height:400px;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,0.12);">
    <figcaption style="font-size:0.8em;color:#6b7280;margin-top:12px;">Caption describing the image.</figcaption>
  </figure>
</section>
\`\`\`

#### Timeline slide
\`\`\`html
<section>
  <h2>Roadmap</h2>
  <div style="display:flex;gap:0;margin-top:32px;position:relative;">
    <div style="position:absolute;top:20px;left:0;right:0;height:2px;background:#e0e7ff;z-index:0;"></div>
    <div style="flex:1;text-align:center;position:relative;z-index:1;">
      <div style="width:40px;height:40px;border-radius:50%;background:#4f46e5;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;margin:0 auto 12px;">Q1</div>
      <p style="font-size:0.8em;font-weight:600;">Phase One</p>
      <p style="font-size:0.72em;color:#6b7280;">Description</p>
    </div>
    <div style="flex:1;text-align:center;position:relative;z-index:1;">
      <div style="width:40px;height:40px;border-radius:50%;background:#7c3aed;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;margin:0 auto 12px;">Q2</div>
      <p style="font-size:0.8em;font-weight:600;">Phase Two</p>
      <p style="font-size:0.72em;color:#6b7280;">Description</p>
    </div>
    <div style="flex:1;text-align:center;position:relative;z-index:1;">
      <div style="width:40px;height:40px;border-radius:50%;background:#a855f7;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;margin:0 auto 12px;">Q3</div>
      <p style="font-size:0.8em;font-weight:600;">Phase Three</p>
      <p style="font-size:0.72em;color:#6b7280;">Description</p>
    </div>
    <div style="flex:1;text-align:center;position:relative;z-index:1;">
      <div style="width:40px;height:40px;border-radius:50%;background:#d946ef;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;margin:0 auto 12px;">Q4</div>
      <p style="font-size:0.8em;font-weight:600;">Phase Four</p>
      <p style="font-size:0.72em;color:#6b7280;">Description</p>
    </div>
  </div>
</section>
\`\`\`

---

### Reveal.js Transition Reference

| Value          | Effect                                  |
|----------------|-----------------------------------------|
| \`none\`         | Instant switch, no animation            |
| \`fade\`         | Cross-fade between slides               |
| \`slide\`        | Push left/right (default)               |
| \`convex\`       | Convex 3D rotation                      |
| \`concave\`      | Concave 3D rotation                     |
| \`zoom\`         | Scale in/out                            |

Apply per-slide: \`<section data-transition="zoom">\`
Apply globally: \`Reveal.initialize({ transition: 'slide' })\`

### Fragment Animations (Reveal.js)

Fragments reveal content on click. Use the \`class="fragment"\` attribute plus an optional style:

\`\`\`html
<li class="fragment">Revealed on 1st click</li>
<li class="fragment fade-up">Fades up on 2nd click</li>
<li class="fragment highlight-blue">Highlights blue on 3rd click</li>
\`\`\`

Available fragment classes: \`fade-in\`, \`fade-out\`, \`fade-up\`, \`fade-down\`, \`grow\`, \`shrink\`, \`highlight-red\`, \`highlight-blue\`, \`highlight-green\`.

---

### PDF Export Instructions

**Reveal.js PDF export:**
1. Open the HTML file in Chrome or Edge.
2. Append \`?print-pdf\` to the URL: \`file:///path/to/slides.html?print-pdf\`
3. Press \`Ctrl+P\` (Windows/Linux) or \`Cmd+P\` (Mac).
4. Set destination to "Save as PDF", layout to "Landscape", margins to "None".
5. Enable "Background graphics" for full colour output.
6. Click Save.

**Pure HTML/CSS PDF export:**
1. Open the HTML file in Chrome or Edge.
2. Press \`Ctrl+P\` / \`Cmd+P\`.
3. Set layout to "Landscape", margins to "None", enable "Background graphics".
4. Click Save.

Include these instructions as a comment at the top of every generated file.

---

### Design Principles

**Typography**
- Title slide headline: \`font-size:2.2em\` to \`3em\`, bold
- Section headings (\`h2\`): \`2em\`, semi-bold
- Body / bullet points: \`1em\` to \`1.1em\`, readable line-height (\`1.7\`)
- Max 6 bullet points per slide — prefer 3–4

**Colour palette (default)**
- Primary accent: \`#4f46e5\` (indigo)
- Title slides: gradient \`linear-gradient(135deg, #4f46e5, #7c3aed)\`
- Text on light: \`#111827\` (headings), \`#374151\` (body), \`#6b7280\` (muted)
- Text on dark: \`#fff\` (headings), \`#e0e7ff\` (body)

**Layout rules**
- Reveal.js: leave content in the middle 80% of the slide — Reveal adds padding automatically.
- Two-column: use CSS Grid (\`grid-template-columns: 1fr 1fr\`) never floats.
- Metrics row: three columns maximum per slide for readability.
- Never crowd a slide — one key idea per slide.

**Accessibility**
- Ensure text-to-background contrast ≥ 4.5:1 for body text (WCAG AA).
- Add \`lang="en"\` to \`<html>\` and \`alt\` to all images.
- Avoid red/green-only distinctions for colourblind audiences.

---

### Reveal.js Theme Reference

Use the \`white\` theme for light decks (default), \`black\` for dark decks, \`moon\` for a blue-dark look. Swap by changing the CSS \`<link>\`:

\`\`\`html
<!-- White (light, default) -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/white.css">

<!-- Black (dark) -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/black.css">

<!-- Moon (blue-dark) -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/moon.css">

<!-- Solarized (warm) -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/solarized.css">
\`\`\`

---

### Output Format

Structure your output as:

1. **Self-contained HTML file** — write to a file named \`slides-<topic>.html\` (or user-specified). Include all styles inline or via CDN \`<link>\`/\`<script>\` tags.
2. **Preview instructions** — "Open \`slides-<topic>.html\` in any browser. Use arrow keys or spacebar to navigate slides."
3. **PDF export instructions** — include the 5-step print-to-PDF process (see PDF Export Instructions above).
4. **Customisation guide** — list the key variables to update: title, author, date, brand colours, content sections.
5. **Speaker notes** — if the user requested speaker notes, add them using Reveal.js \`<aside class="notes">\` elements inside each section.

---

### Constraints

- Always produce a self-contained HTML file — no npm install, no webpack, no local file dependencies beyond images the user explicitly provides.
- Use Reveal.js 5 via CDN (jsdelivr.net) for animated decks; pure HTML/CSS for print-first decks.
- Keep slides readable at 1920×1080 (widescreen) and printable at A4/Letter landscape.
- Do not use JavaScript for slide content — only for Reveal.js initialisation.
- Ensure all links use placeholder href (\`#\` or \`{{variable}}\`) — never invent real URLs.
- Always include \`<meta name="viewport">\` for mobile browsing.
- Write the HTML file to the workspace directory — do not just print it to stdout.
- Include the PDF export instructions as a comment block at the top of every generated file.`,
};
