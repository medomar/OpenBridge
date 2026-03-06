# Creative Output Guide

OpenBridge supports generating visual and creative content through its skill pack system. Workers can produce diagrams, charts, web pages, presentations, generative art, and brand assets — and deliver them via messaging channels.

---

## Supported Output Types

| Skill Pack        | What it produces                                              | Output format                        |
| ----------------- | ------------------------------------------------------------- | ------------------------------------ |
| `diagram-maker`   | Architecture diagrams, flowcharts, sequence, ER, class, Gantt | Mermaid / PlantUML / D2 text + PNG   |
| `chart-generator` | Bar, line, pie, scatter, area charts from data                | Self-contained HTML                  |
| `web-designer`    | Landing pages, marketing sites, HTML email templates          | Self-contained HTML                  |
| `slide-designer`  | Presentation slides, pitch decks, training materials          | Self-contained HTML (PDF-exportable) |
| `generative-art`  | Algorithmic art, SVG patterns, p5.js sketches                 | HTML or SVG                          |
| `brand-assets`    | Logo concepts, social media images, favicons                  | SVG / HTML                           |

---

## Triggering Creative Output

The Master AI automatically selects the right skill pack based on your request. Phrases that trigger creative mode:

```
/ai draw an architecture diagram of the project
/ai create a bar chart from sales.csv
/ai build a landing page for my product
/ai make a pitch deck with 5 slides
/ai generate a logo concept for "Acme Corp"
/ai create a flowchart of the authentication flow
```

No configuration required — the router classifies intent and selects the appropriate skill pack.

---

## Rendering Pipeline

Creative output follows this pipeline:

```
Worker generates content (Mermaid / SVG / HTML)
        │
        ▼
File Server serves the file at a local URL
        │
        ▼
HTML Renderer converts to PNG (optional, requires Puppeteer)
        │
        ▼
Channel delivers as image (WhatsApp / Telegram) or link (WebChat)
```

### When images are delivered directly

For WhatsApp and Telegram, OpenBridge renders the output to PNG and sends it as a media message if the renderer is available. Otherwise it sends a preview URL.

For WebChat, outputs are served as interactive HTML previews via the built-in file server.

---

## Mermaid Rendering

Mermaid diagrams are rendered using two backends, tried in order:

1. **mermaid.ink API** — no installation required; needs network access.
2. **Puppeteer fallback** — renders locally in a headless browser; requires `puppeteer` installed.

If both backends fail, the diagram definition is returned as text so you can paste it into [mermaid.live](https://mermaid.live) or any Markdown preview.

**Supported Mermaid diagram types:**

- Flowchart (`flowchart TD / LR`)
- Sequence diagram (`sequenceDiagram`)
- Entity-relationship (`erDiagram`)
- Class diagram (`classDiagram`)
- State diagram (`stateDiagram-v2`)
- Gantt chart (`gantt`)
- Pie chart (`pie`)

---

## HTML-to-Image Rendering

HTML and SVG outputs are converted to PNG/JPEG using `HTMLRenderer` (Puppeteer-based).

**Default settings:**

| Setting      | Default  |
| ------------ | -------- |
| Format       | PNG      |
| Viewport     | 1280×720 |
| JPEG quality | 90       |
| Full page    | false    |

SVG files are automatically sized to their natural `viewBox` or `width`/`height` dimensions.

Rendered images are saved to `.openbridge/generated/` inside the workspace.

---

## Prerequisites

### No extras needed

- **Diagrams via mermaid.ink** — works out of the box (requires internet access).
- **SVG output** — no dependencies; served directly by the file server.
- **HTML output as links** — no dependencies; served via the built-in HTTP server.

### Optional: Puppeteer (for local PNG rendering)

Install Puppeteer to enable local HTML-to-image and Mermaid fallback rendering:

```bash
npm install puppeteer
```

Puppeteer downloads Chromium on first install (~300 MB). After installation, all rendering is local — no network access required.

Check if Puppeteer is available:

```typescript
import { HTMLRenderer } from './src/core/html-renderer.js';
const available = await HTMLRenderer.isAvailable(); // true/false
```

### Diagram tools (optional, for text-based rendering only)

These tools are NOT required — they are used by workers to generate diagram syntax, not to render it.

| Tool        | Install                                  | Used for               |
| ----------- | ---------------------------------------- | ---------------------- |
| Mermaid CLI | `npm install -g @mermaid-js/mermaid-cli` | Local `mmdc` rendering |
| PlantUML    | `brew install plantuml` (macOS)          | PlantUML rendering     |
| D2          | `brew install d2` (macOS)                | D2 diagram rendering   |

Workers produce diagram syntax; rendering is handled by OpenBridge's rendering pipeline.

---

## Format Selection Guide

Workers default to Mermaid for maximum portability. Use these guidelines:

| Use case                                      | Recommended format |
| --------------------------------------------- | ------------------ |
| Flowcharts, decision trees, process flows     | Mermaid flowchart  |
| API call sequences, service communication     | Mermaid sequence   |
| Database schemas, table relationships         | Mermaid ER         |
| Class hierarchies, interface implementations  | Mermaid class      |
| State machines, lifecycle diagrams            | Mermaid state      |
| Project timelines, sprint plans               | Mermaid Gantt      |
| System architecture, infrastructure maps      | D2                 |
| UML (formal notation, component diagrams)     | PlantUML           |
| Data visualizations (bar, line, pie, scatter) | Chart.js / D3.js   |
| Web UI, landing pages, email                  | HTML/CSS           |
| Presentations, pitch decks                    | Reveal.js HTML     |
| Algorithmic art, patterns                     | p5.js / SVG        |
| Logos, social media images, favicons          | SVG                |

---

## Output Locations

All generated files are written to:

```
<workspace>/.openbridge/generated/
├── render-<uuid>.png       ← HTML/SVG renders
├── mermaid-<uuid>.png      ← Mermaid renders
└── <worker-output>.html    ← HTML outputs from workers
```

The file server exposes these files at:

```
http://localhost:<port>/files/<filename>
```

Workers write HTML and SVG files directly to the workspace or to `.openbridge/generated/`. The Master AI coordinates delivery to the channel.

---

## Troubleshooting

### "Puppeteer is not installed"

Install it: `npm install puppeteer`

If you don't want to install Puppeteer, mermaid.ink (for Mermaid diagrams) and direct SVG serving still work without it.

### "mermaid.ink API unavailable"

The mermaid.ink public API may be rate-limited or unreachable. Install Puppeteer for offline fallback rendering.

### "Mermaid rendering failed"

Both backends failed. Check:

1. Network access for mermaid.ink
2. Puppeteer installation: `npm list puppeteer`

If both are unavailable, the worker returns the diagram as a Mermaid code block — paste it into [mermaid.live](https://mermaid.live) to render manually.

### SVG not rendering in WhatsApp

WhatsApp does not support SVG. OpenBridge automatically converts SVG to PNG via `HTMLRenderer` before sending. This requires Puppeteer. If Puppeteer is not installed, a download link is sent instead.

### HTML preview not accessible

The file server must be running and reachable from your device. In development, ensure the configured port is accessible on your network.
