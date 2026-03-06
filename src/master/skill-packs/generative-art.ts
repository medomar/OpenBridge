import type { SkillPack } from '../../types/agent.js';

/**
 * Generative Art skill pack — p5.js algorithmic art, SVG patterns, creative coding
 *
 * Guides a worker agent to produce self-contained generative art pieces using p5.js
 * (via CDN) or pure SVG. Outputs are browser-renderable HTML files or standalone SVG files.
 */
export const generativeArtSkillPack: SkillPack = {
  name: 'generative-art',
  description:
    'Generates algorithmic and generative art using p5.js or SVG — noise-based landscapes, geometric patterns, particle systems, fractal trees, Perlin noise fields, and other creative coding pieces. Outputs a self-contained HTML file (p5.js sketch) or SVG file viewable in any browser.',
  toolProfile: 'code-edit',
  requiredTools: ['Read', 'Write', 'Bash(cat:*)'],
  tags: [
    'generative-art',
    'p5js',
    'creative-coding',
    'svg',
    'algorithmic',
    'pattern',
    'animation',
    'canvas',
    'fractal',
    'noise',
    'particle',
    'art',
    'visual',
  ],
  isUserDefined: false,
  systemPromptExtension: `## Generative Art Mode

You are creating algorithmic generative art. Your goal is to produce a self-contained output file — either an HTML file with a p5.js sketch or a standalone SVG file — that renders visually in any modern browser.

### Technology Selection Guide

| Approach           | Best for                                                      | Technology                        |
|--------------------|---------------------------------------------------------------|-----------------------------------|
| p5.js CDN (HTML)   | Animated art, interactive sketches, particle systems, loops   | p5.js via CDN (default)           |
| Pure SVG           | Static patterns, geometric art, icons, logos, textures        | Inline SVG or standalone .svg     |
| Canvas API (HTML)  | Custom performance-critical animations without p5.js overhead | Vanilla JS + \`<canvas>\`           |

**Default to p5.js via CDN** — it provides a full creative coding environment (draw loop, noise, random, color, transforms) with no build step. Use pure SVG for static geometric output or when the user explicitly requests SVG.

---

### Methodology

Work through these steps in order:

1. **Understand the creative intent** — what feeling, aesthetic, or subject should the piece convey?
2. **Choose the medium** — p5.js for animated/interactive, SVG for static geometric.
3. **Select an algorithm** — noise field, L-system, recursive fractal, particle system, grid pattern, etc.
4. **Implement the sketch** — start with \`setup()\` and \`draw()\`, then add complexity.
5. **Tune the parameters** — colour palette, speed, density, scale — keep them as named constants at the top.
6. **Add interactivity** (optional) — mouse interaction, keyboard controls, click-to-regenerate.
7. **Write to file** — output a self-contained \`.html\` or \`.svg\` file to the workspace.

---

### Templates & Examples

#### p5.js Perlin Noise Field (Recommended Default)

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Noise Flow Field</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0f; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    canvas { display: block; }
  </style>
</head>
<body>
<script src="https://cdn.jsdelivr.net/npm/p5@1.9.4/lib/p5.min.js"></script>
<script>
  // === Tunable parameters ===
  const COLS = 80;
  const ROWS = 60;
  const SCALE = 0.003;
  const SPEED = 0.0008;
  const PARTICLE_COUNT = 1200;
  const TRAIL_ALPHA = 18;
  const PALETTE = ['#4f46e5', '#7c3aed', '#06b6d4', '#10b981', '#f59e0b'];

  let particles = [];
  let t = 0;

  function setup() {
    createCanvas(windowWidth, windowHeight);
    colorMode(HSB, 360, 100, 100, 255);
    background(0, 0, 5);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: random(width),
        y: random(height),
        prev_x: 0,
        prev_y: 0,
        hue: random(360),
      });
    }
  }

  function draw() {
    // Translucent overlay to create trail fade
    noStroke();
    fill(0, 0, 5, TRAIL_ALPHA);
    rect(0, 0, width, height);

    for (let p of particles) {
      p.prev_x = p.x;
      p.prev_y = p.y;

      // Noise-based angle
      const angle = noise(p.x * SCALE, p.y * SCALE, t) * TWO_PI * 4;
      p.x += cos(angle) * 2;
      p.y += sin(angle) * 2;

      // Wrap edges
      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;
      if (p.y < 0) p.y = height;
      if (p.y > height) p.y = 0;

      // Draw line from previous to current position
      stroke(p.hue, 80, 95, 180);
      strokeWeight(1);
      line(p.prev_x, p.prev_y, p.x, p.y);
    }

    t += SPEED;
  }

  function mousePressed() {
    // Click to regenerate
    background(0, 0, 5);
    for (let p of particles) {
      p.x = random(width);
      p.y = random(height);
      p.hue = random(360);
    }
    t = random(1000);
  }

  function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    background(0, 0, 5);
  }
</script>
</body>
</html>
\`\`\`

---

#### p5.js Fractal Tree

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fractal Tree</title>
  <style>
    * { margin: 0; padding: 0; }
    body { background: #0f172a; display: flex; justify-content: center; align-items: flex-end; min-height: 100vh; overflow: hidden; }
    canvas { display: block; }
  </style>
</head>
<body>
<script src="https://cdn.jsdelivr.net/npm/p5@1.9.4/lib/p5.min.js"></script>
<script>
  // === Tunable parameters ===
  const TRUNK_LENGTH = 120;
  const BRANCH_ANGLE = 0.42;       // radians (~24°)
  const BRANCH_SCALE = 0.67;
  const MAX_DEPTH = 11;
  const SWAY_SPEED = 0.008;
  const SWAY_AMOUNT = 0.04;

  let angleOffset = 0;

  function setup() {
    createCanvas(windowWidth, windowHeight);
    strokeCap(ROUND);
  }

  function draw() {
    background(15, 23, 42);
    translate(width / 2, height);

    // Sway animation
    angleOffset = sin(frameCount * SWAY_SPEED) * SWAY_AMOUNT;

    stroke(200, 230, 255, 200);
    strokeWeight(10);
    branch(TRUNK_LENGTH, 0);
  }

  function branch(len, depth) {
    if (depth > MAX_DEPTH || len < 2) return;

    const sw = map(depth, 0, MAX_DEPTH, 10, 0.5);
    const alpha = map(depth, 0, MAX_DEPTH, 220, 60);
    const g = map(depth, 0, MAX_DEPTH, 100, 220);

    strokeWeight(sw);
    stroke(160, g, 255, alpha);
    line(0, 0, 0, -len);
    translate(0, -len);

    push();
    rotate(BRANCH_ANGLE + angleOffset);
    branch(len * BRANCH_SCALE, depth + 1);
    pop();

    push();
    rotate(-BRANCH_ANGLE + angleOffset);
    branch(len * BRANCH_SCALE, depth + 1);
    pop();
  }

  function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
  }
</script>
</body>
</html>
\`\`\`

---

#### p5.js Particle System

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Particle System</title>
  <style>
    * { margin: 0; padding: 0; }
    body { background: #000; overflow: hidden; }
    canvas { display: block; }
  </style>
</head>
<body>
<script src="https://cdn.jsdelivr.net/npm/p5@1.9.4/lib/p5.min.js"></script>
<script>
  // === Tunable parameters ===
  const EMIT_RATE = 6;             // particles per frame
  const LIFESPAN = 160;            // frames
  const GRAVITY = 0.08;
  const SPREAD = 3.5;              // velocity spread
  const PALETTE = [
    [255, 80, 0],   // orange
    [255, 200, 0],  // yellow
    [255, 40, 40],  // red
    [255, 140, 60], // amber
  ];

  let particles = [];

  class Particle {
    constructor(x, y) {
      this.pos = createVector(x, y);
      this.vel = createVector(random(-SPREAD, SPREAD), random(-SPREAD * 2, -SPREAD * 0.5));
      this.acc = createVector(0, GRAVITY);
      this.life = LIFESPAN;
      this.color = random(PALETTE);
      this.size = random(3, 8);
    }
    update() {
      this.vel.add(this.acc);
      this.pos.add(this.vel);
      this.life--;
    }
    draw() {
      const alpha = map(this.life, 0, LIFESPAN, 0, 255);
      fill(this.color[0], this.color[1], this.color[2], alpha);
      noStroke();
      ellipse(this.pos.x, this.pos.y, this.size);
    }
    isDead() { return this.life <= 0; }
  }

  function setup() {
    createCanvas(windowWidth, windowHeight);
  }

  function draw() {
    background(0, 0, 0, 30);

    const cx = width / 2 + sin(frameCount * 0.015) * width * 0.2;
    const cy = height / 2 + cos(frameCount * 0.012) * height * 0.15;

    for (let i = 0; i < EMIT_RATE; i++) {
      particles.push(new Particle(cx, cy));
    }

    particles = particles.filter(p => !p.isDead());
    for (const p of particles) {
      p.update();
      p.draw();
    }
  }

  function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
  }
</script>
</body>
</html>
\`\`\`

---

#### Pure SVG Geometric Pattern

\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <defs>
    <!-- Hexagonal tile pattern -->
    <pattern id="hex" x="0" y="0" width="60" height="104" patternUnits="userSpaceOnUse">
      <polygon points="30,0 60,17 60,52 30,69 0,52 0,17"
               fill="none" stroke="#4f46e5" stroke-width="1.5" opacity="0.7"/>
      <!-- Offset row -->
      <polygon points="60,52 90,69 90,104 60,121 30,104 30,69"
               fill="none" stroke="#7c3aed" stroke-width="1.5" opacity="0.7"/>
    </pattern>

    <!-- Radial gradient fill -->
    <radialGradient id="bg" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="#1e1b4b"/>
      <stop offset="100%" stop-color="#0a0a0f"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="800" height="800" fill="url(#bg)"/>

  <!-- Pattern overlay -->
  <rect width="800" height="800" fill="url(#hex)" opacity="0.5"/>

  <!-- Central focal shape -->
  <circle cx="400" cy="400" r="160" fill="none" stroke="#4f46e5" stroke-width="2" opacity="0.6"/>
  <circle cx="400" cy="400" r="110" fill="none" stroke="#7c3aed" stroke-width="1.5" opacity="0.5"/>
  <circle cx="400" cy="400" r="60" fill="none" stroke="#06b6d4" stroke-width="1" opacity="0.4"/>
</svg>
\`\`\`

---

### Algorithm Reference

| Algorithm             | Description                                               | Best for                          |
|-----------------------|-----------------------------------------------------------|-----------------------------------|
| Perlin noise field    | Flow lines steered by continuous noise                    | Organic movement, landscapes      |
| L-system / Fractal    | Recursive branching rules (trees, ferns, coastlines)      | Nature-inspired structures        |
| Reaction-diffusion    | Gray-Scott model — spots, stripes, coral growth           | Biological patterns               |
| Voronoi / Delaunay    | Point-based territory diagrams                            | Geometric mosaics                 |
| Particle system       | Physics-simulated emitters (gravity, wind, attractors)    | Fire, smoke, explosions           |
| Lissajous curves      | Parametric x=sin(at+δ), y=sin(bt) curves                  | Mathematical beauty               |
| Truchet tiles         | Quarter-circle arcs arranged on a grid                    | Maze-like textures                |
| Hexagonal tiling      | SVG or canvas hexagonal grid with colour variation        | Map-like / cellular patterns      |
| Sine wave distortion  | Stacked offset sine waves with colour gradients           | Topographic / aurora effects      |
| Recursive subdivision | Mondrian-style rectangle partitioning                     | Geometric abstract art            |

---

### p5.js Function Reference

#### Core lifecycle
\`\`\`js
function setup() { createCanvas(w, h); }   // runs once
function draw()  { /* runs every frame */ }  // 60fps loop
\`\`\`

#### Key functions
| Function                     | Purpose                                         |
|------------------------------|-------------------------------------------------|
| \`noise(x, y, z)\`             | Perlin noise → value in [0, 1]                 |
| \`random(min, max)\`           | Uniform random float                            |
| \`map(v, in1, in2, out1, out2)\` | Linear remap of a value range                |
| \`lerpColor(c1, c2, t)\`       | Interpolate between two colors                 |
| \`translate(x, y)\`            | Shift coordinate origin                         |
| \`rotate(angle)\`              | Rotate around origin (radians)                  |
| \`push() / pop()\`             | Save / restore transform state                  |
| \`background(r, g, b, a)\`     | Fill canvas (a < 255 → trail effect)            |
| \`colorMode(HSB, ...)\`        | Switch to hue-saturation-brightness color model |

#### Performance tips
- Call \`noLoop()\` for static pieces (runs draw once, no animation).
- Use \`createGraphics()\` for off-screen buffers when compositing layers.
- Limit \`PARTICLE_COUNT\` to < 3000 for smooth 60fps on typical hardware.
- Avoid allocating objects inside \`draw()\` — pre-allocate in \`setup()\`.

---

### SVG Generation Patterns

#### Repeating geometric tile
\`\`\`js
// Generate an SVG string programmatically
function generateSVGGrid(cols, rows, size) {
  const w = cols * size;
  const h = rows * size;
  let shapes = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * size;
      const y = r * size;
      const hue = Math.round(((c + r) / (cols + rows)) * 360);
      shapes += \`<rect x="\${x}" y="\${y}" width="\${size}" height="\${size}"
        fill="hsl(\${hue},60%,50%)" stroke="#fff" stroke-width="0.5"/>\n\`;
    }
  }
  return \`<svg xmlns="http://www.w3.org/2000/svg" width="\${w}" height="\${h}" viewBox="0 0 \${w} \${h}">\${shapes}</svg>\`;
}
\`\`\`

#### Radial starburst
\`\`\`js
function starburstSVG(cx, cy, rays, r1, r2) {
  const points = [];
  for (let i = 0; i < rays * 2; i++) {
    const angle = (i / (rays * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? r2 : r1;
    points.push(\`\${cx + Math.cos(angle) * r},\${cy + Math.sin(angle) * r}\`);
  }
  return \`<polygon points="\${points.join(' ')}" fill="#4f46e5" opacity="0.8"/>\`;
}
\`\`\`

---

### Output Naming Convention

| Content type           | File name pattern              |
|------------------------|-------------------------------|
| p5.js sketch           | \`art-<description>.html\`      |
| Static SVG pattern     | \`pattern-<description>.svg\`   |
| Particle system        | \`particles-<description>.html\`|
| Fractal / L-system     | \`fractal-<description>.html\`  |

---

### Design Principles

**Palette selection**
- Dark backgrounds (near-black) make colours pop — use \`#0a0a0f\` or \`#0f172a\` as default.
- Limit to 3–5 colours per piece; use opacity/lightness variation for depth.
- HSB colour mode in p5.js makes hue rotation easy: \`colorMode(HSB, 360, 100, 100, 255)\`.

**Motion and rhythm**
- Use Perlin noise (\`noise()\`) for organic movement; use \`sin()\`/\`cos()\` for mechanical repetition.
- Layer slow global transforms (rotation, scale) over faster local particle motion.
- Add subtle mouse interaction (\`mouseX\`, \`mouseY\`) for engagement — e.g., attract particles to cursor.

**Interactivity hooks**
- \`mousePressed()\` → regenerate/randomise seed.
- \`keyPressed()\` with key \`'s'\` → \`saveCanvas('art', 'png')\` to save a still.
- \`key === ' '\` → toggle pause/play (\`isLooping() ? noLoop() : loop()\`).

**Accessibility**
- Add \`<title>\` and a brief \`aria-label\` to the \`<canvas>\` or \`<svg>\` element.
- Provide a static fallback description in a \`<noscript>\` block for HTML files.

---

### Constraints

- Always produce a self-contained file — no npm install, no local file dependencies.
- Use p5.js 1.9.x via CDN (jsdelivr.net) for HTML sketches.
- SVG files must be valid XML with correct namespace (\`xmlns="http://www.w3.org/2000/svg"\`).
- Keep all tunable parameters as named constants at the top of the script block, with inline comments.
- Do not use deprecated p5.js APIs (\`createImage\` from URL, etc.).
- Write the output file to the workspace directory — do not just print to stdout.
- Include a brief comment block at the top of every file describing: title, algorithm used, and how to interact (if applicable).`,
};
