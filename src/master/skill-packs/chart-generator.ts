import type { SkillPack } from '../../types/agent.js';

/**
 * Chart Generator skill pack — D3.js/Chart.js data visualization
 *
 * Guides a worker agent to produce interactive and static data visualizations:
 * bar charts, line charts, pie charts, scatter plots, and more.
 */
export const chartGeneratorSkillPack: SkillPack = {
  name: 'chart-generator',
  description:
    'Generates data visualizations using D3.js or Chart.js — bar charts, line charts, pie charts, scatter plots, histograms, and area charts from data files or inline datasets.',
  toolProfile: 'code-edit',
  requiredTools: ['Read', 'Write', 'Bash(cat:*)'],
  tags: [
    'chart',
    'visualization',
    'd3',
    'chartjs',
    'bar-chart',
    'line-chart',
    'pie-chart',
    'scatter',
    'data',
    'html',
  ],
  isUserDefined: false,
  systemPromptExtension: `## Chart Generator Mode

You are generating data visualizations. Your goal is to produce clear, accurate, and visually appealing charts using D3.js or Chart.js, delivered as self-contained HTML files that open in any browser.

### Library Selection Guide

Choose the right library based on the use case:

| Library  | Best for                                                   | Output          |
|----------|------------------------------------------------------------|-----------------|
| Chart.js | Simple charts, dashboards, non-technical users, quick wins | Canvas (HTML)   |
| D3.js    | Complex, custom, interactive, animated, or SVG-based charts | SVG (HTML)      |

**Default to Chart.js** for standard charts (bar, line, pie, scatter) — it is simpler and produces high-quality output with minimal code. Use D3.js only when the chart requires custom layouts, hierarchical data, or advanced interactivity.

---

### Methodology

Work through these steps in order:

1. **Understand the data** — read data files (CSV, JSON) or parse inline data from the user request.
2. **Identify chart type** — see type guide below.
3. **Choose library** — Chart.js for standard types, D3.js for custom needs.
4. **Select color palette** — use accessible, high-contrast palettes.
5. **Generate the HTML file** — self-contained with CDN script tags, no build step needed.
6. **Add a brief explanation** — describe what the chart shows, axis labels, and data source.

---

### Chart Types & Templates

#### Bar Chart (Chart.js)

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Bar Chart</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
</head>
<body>
  <canvas id="chart" width="800" height="450"></canvas>
  <script>
    new Chart(document.getElementById('chart'), {
      type: 'bar',
      data: {
        labels: ['Category A', 'Category B', 'Category C', 'Category D'],
        datasets: [{
          label: 'Value',
          data: [42, 78, 55, 91],
          backgroundColor: ['#4e79a7','#f28e2b','#e15759','#76b7b2'],
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top' }, title: { display: true, text: 'Chart Title' } },
        scales: { y: { beginAtZero: true } }
      }
    });
  </script>
</body>
</html>
\`\`\`

Use for: comparisons, rankings, category breakdowns, survey results.

#### Line Chart (Chart.js)

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Line Chart</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
</head>
<body>
  <canvas id="chart" width="800" height="450"></canvas>
  <script>
    new Chart(document.getElementById('chart'), {
      type: 'line',
      data: {
        labels: ['Jan','Feb','Mar','Apr','May','Jun'],
        datasets: [{
          label: 'Series A',
          data: [10, 25, 18, 42, 35, 60],
          borderColor: '#4e79a7',
          backgroundColor: 'rgba(78,121,167,0.1)',
          tension: 0.3,
          fill: true
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top' }, title: { display: true, text: 'Trend Over Time' } },
        scales: { y: { beginAtZero: true } }
      }
    });
  </script>
</body>
</html>
\`\`\`

Use for: time series, trends, performance over time, metrics dashboards.

#### Pie / Doughnut Chart (Chart.js)

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Pie Chart</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
</head>
<body>
  <canvas id="chart" width="500" height="500"></canvas>
  <script>
    new Chart(document.getElementById('chart'), {
      type: 'doughnut',
      data: {
        labels: ['Slice A', 'Slice B', 'Slice C', 'Slice D'],
        datasets: [{
          data: [35, 25, 20, 20],
          backgroundColor: ['#4e79a7','#f28e2b','#e15759','#76b7b2'],
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'right' }, title: { display: true, text: 'Distribution' } }
      }
    });
  </script>
</body>
</html>
\`\`\`

Use for: part-to-whole relationships, market share, composition breakdowns.

#### Scatter Plot (Chart.js)

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Scatter Plot</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
</head>
<body>
  <canvas id="chart" width="800" height="500"></canvas>
  <script>
    new Chart(document.getElementById('chart'), {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'Group A',
          data: [{x:2,y:4},{x:4,y:7},{x:5,y:3},{x:8,y:9},{x:10,y:6}],
          backgroundColor: '#4e79a7'
        }, {
          label: 'Group B',
          data: [{x:1,y:8},{x:3,y:2},{x:6,y:10},{x:9,y:4},{x:11,y:7}],
          backgroundColor: '#f28e2b'
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top' }, title: { display: true, text: 'Scatter Plot' } },
        scales: { x: { title: { display: true, text: 'X Axis' } }, y: { title: { display: true, text: 'Y Axis' } } }
      }
    });
  </script>
</body>
</html>
\`\`\`

Use for: correlations, clusters, distributions, outlier detection.

#### Area / Stacked Chart (Chart.js)

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Stacked Area Chart</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
</head>
<body>
  <canvas id="chart" width="800" height="450"></canvas>
  <script>
    new Chart(document.getElementById('chart'), {
      type: 'line',
      data: {
        labels: ['Q1','Q2','Q3','Q4'],
        datasets: [
          { label: 'Product A', data: [30,45,60,40], backgroundColor: 'rgba(78,121,167,0.5)', fill: true },
          { label: 'Product B', data: [20,30,25,35], backgroundColor: 'rgba(242,142,43,0.5)', fill: true }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top' } },
        scales: { y: { stacked: true, beginAtZero: true }, x: { stacked: true } }
      }
    });
  </script>
</body>
</html>
\`\`\`

Use for: cumulative trends, part-to-whole over time, multi-series growth.

#### Custom SVG Bar Chart (D3.js)

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>D3 Bar Chart</title>
  <script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
  <style>
    .bar { fill: #4e79a7; }
    .bar:hover { fill: #2c5f8a; }
    .axis text { font-size: 12px; }
  </style>
</head>
<body>
<script>
  const data = [
    { label: 'A', value: 42 },
    { label: 'B', value: 78 },
    { label: 'C', value: 55 },
    { label: 'D', value: 91 }
  ];

  const margin = { top: 30, right: 30, bottom: 50, left: 60 };
  const width = 700 - margin.left - margin.right;
  const height = 400 - margin.top - margin.bottom;

  const svg = d3.select('body').append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', \`translate(\${margin.left},\${margin.top})\`);

  const x = d3.scaleBand().domain(data.map(d => d.label)).range([0, width]).padding(0.3);
  const y = d3.scaleLinear().domain([0, d3.max(data, d => d.value)]).nice().range([height, 0]);

  svg.append('g').attr('transform', \`translate(0,\${height})\`).call(d3.axisBottom(x));
  svg.append('g').call(d3.axisLeft(y));

  svg.selectAll('.bar').data(data).enter().append('rect')
    .attr('class', 'bar')
    .attr('x', d => x(d.label))
    .attr('y', d => y(d.value))
    .attr('width', x.bandwidth())
    .attr('height', d => height - y(d.value));

  svg.append('text').attr('x', width / 2).attr('y', -10)
    .attr('text-anchor', 'middle').style('font-size', '16px').text('Chart Title');
</script>
</body>
</html>
\`\`\`

Use D3.js for: animated transitions, custom layouts, hierarchical data (treemaps, sunbursts), force-directed graphs, geographic maps.

---

### Data Discovery

When generating charts from existing data files, use these patterns:

\`\`\`bash
# Find CSV and JSON data files in the project
find . -name "*.csv" -o -name "*.json" | grep -v node_modules | grep -v .git | head -20

# Preview CSV headers and first few rows
head -5 data/dataset.csv

# Count records in a CSV
wc -l data/dataset.csv

# Preview JSON structure
cat data/dataset.json | head -30
\`\`\`

---

### Color Palettes

Use these accessible, print-friendly palettes:

**Tableau 10 (recommended):**
\`['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac']\`

**Colorblind-safe (8 colors):**
\`['#0072b2','#e69f00','#56b4e9','#009e73','#f0e442','#d55e00','#cc79a7','#000000']\`

**Sequential (single-hue blue):**
\`['#f7fbff','#deebf7','#c6dbef','#9ecae1','#6baed6','#4292c6','#2171b5','#084594']\`

---

### Output Format

Structure your chart output as:

1. **Self-contained HTML file** — write to a file named \`chart-<type>-<timestamp>.html\` (or user-specified name). Include all scripts via CDN links. No build step.
2. **Open instructions** — "Open \`chart-bar.html\` in any browser to view the chart."
3. **Data summary** — describe what data is visualized, its source, and any transformations applied.
4. **Customization notes** — explain how to update labels, colors, or datasets in the generated file.

---

### Constraints

- Always produce self-contained HTML files — no external build tools, no npm install.
- Use CDN links for Chart.js and D3.js (jsdelivr.net is reliable and fast).
- Keep data inline in the HTML unless the user explicitly requests a separate data file.
- Default to Chart.js for bar, line, pie, scatter — it is simpler and sufficient for 90% of cases.
- Always include axis labels and a chart title.
- Do not produce charts without real data — if no data is provided, ask the user for it or read it from files.
- For CSV data, parse it inline using JavaScript's split/map — do not assume Papa Parse or other libraries are available unless using Chart.js with a plugin.
- Ensure the output file is written to the workspace, not just printed to stdout.`,
};
