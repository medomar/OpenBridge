import { describe, it, expect } from 'vitest';
import { formatMarkdownForWhatsApp } from '../../../src/connectors/whatsapp/whatsapp-formatter.js';

describe('formatMarkdownForWhatsApp', () => {
  it('returns empty string for empty input', () => {
    expect(formatMarkdownForWhatsApp('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(formatMarkdownForWhatsApp('Hello world')).toBe('Hello world');
  });

  // --- Bold ---
  it('converts **bold** to *bold*', () => {
    expect(formatMarkdownForWhatsApp('This is **bold** text')).toBe('This is *bold* text');
  });

  it('converts multiple **bold** segments', () => {
    expect(formatMarkdownForWhatsApp('**one** and **two**')).toBe('*one* and *two*');
  });

  // --- Italic ---
  it('preserves _italic_ as _italic_', () => {
    expect(formatMarkdownForWhatsApp('This is _italic_ text')).toBe('This is _italic_ text');
  });

  // --- Bold + Italic ---
  it('converts ***bold italic*** to *_bold italic_*', () => {
    expect(formatMarkdownForWhatsApp('This is ***important*** text')).toBe(
      'This is *_important_* text',
    );
  });

  // --- Strikethrough ---
  it('converts ~~strikethrough~~ to ~strikethrough~', () => {
    expect(formatMarkdownForWhatsApp('This is ~~deleted~~ text')).toBe('This is ~deleted~ text');
  });

  // --- Headings ---
  it('converts # heading to *heading*', () => {
    expect(formatMarkdownForWhatsApp('# Main Title')).toBe('*Main Title*');
  });

  it('converts ## heading to *heading*', () => {
    expect(formatMarkdownForWhatsApp('## Section')).toBe('*Section*');
  });

  it('converts ### heading to *heading*', () => {
    expect(formatMarkdownForWhatsApp('### Subsection')).toBe('*Subsection*');
  });

  it('converts multiple headings in multi-line text', () => {
    const input = '# Title\n\nSome text\n\n## Section';
    const expected = '*Title*\n\nSome text\n\n*Section*';
    expect(formatMarkdownForWhatsApp(input)).toBe(expected);
  });

  // --- Links ---
  it('converts [text](url) to text (url)', () => {
    expect(formatMarkdownForWhatsApp('Visit [Google](https://google.com) now')).toBe(
      'Visit Google (https://google.com) now',
    );
  });

  // --- Images ---
  it('converts ![alt](url) to [alt]', () => {
    expect(formatMarkdownForWhatsApp('![screenshot](https://img.png)')).toBe('[screenshot]');
  });

  // --- Unordered lists ---
  it('converts - list items to bullet points', () => {
    const input = '- Item one\n- Item two\n- Item three';
    const expected = '• Item one\n• Item two\n• Item three';
    expect(formatMarkdownForWhatsApp(input)).toBe(expected);
  });

  it('converts * list items to bullet points', () => {
    const input = '* First\n* Second';
    const expected = '• First\n• Second';
    expect(formatMarkdownForWhatsApp(input)).toBe(expected);
  });

  it('preserves indented list items', () => {
    const input = '- Parent\n  - Child';
    const expected = '• Parent\n  • Child';
    expect(formatMarkdownForWhatsApp(input)).toBe(expected);
  });

  // --- Blockquotes ---
  it('converts > blockquote to ▎ blockquote', () => {
    expect(formatMarkdownForWhatsApp('> This is a quote')).toBe('▎ This is a quote');
  });

  // --- Horizontal rules ---
  it('converts --- to ───', () => {
    expect(formatMarkdownForWhatsApp('---')).toBe('───');
  });

  it('converts *** to ───', () => {
    expect(formatMarkdownForWhatsApp('***')).toBe('───');
  });

  // --- Code blocks ---
  it('preserves fenced code blocks without formatting inner content', () => {
    const input = '```\n**not bold** and # not heading\n```';
    expect(formatMarkdownForWhatsApp(input)).toBe('```\n**not bold** and # not heading\n```');
  });

  it('preserves code blocks with language tag', () => {
    const input = '```typescript\nconst x = 1;\n```';
    expect(formatMarkdownForWhatsApp(input)).toBe('```typescript\nconst x = 1;\n```');
  });

  it('formats text before and after code blocks', () => {
    const input = '**bold** text\n```\ncode\n```\n**more bold**';
    const expected = '*bold* text\n```\ncode\n```\n*more bold*';
    expect(formatMarkdownForWhatsApp(input)).toBe(expected);
  });

  // --- Inline code ---
  it('preserves inline `code` backticks', () => {
    expect(formatMarkdownForWhatsApp('Use `npm install` to install')).toBe(
      'Use `npm install` to install',
    );
  });

  // --- Ordered lists ---
  it('keeps ordered lists as-is', () => {
    const input = '1. First\n2. Second\n3. Third';
    expect(formatMarkdownForWhatsApp(input)).toBe(input);
  });

  // --- Combined formatting ---
  it('handles a realistic Claude Code response', () => {
    const input = [
      '# Project Structure',
      '',
      'Here are the main files:',
      '',
      '- **src/index.ts** — Entry point',
      '- **src/core/bridge.ts** — Orchestrator',
      '',
      '## How to run',
      '',
      '```bash',
      'npm run dev',
      '```',
      '',
      'Visit the [docs](https://docs.example.com) for more info.',
    ].join('\n');

    const expected = [
      '*Project Structure*',
      '',
      'Here are the main files:',
      '',
      '• *src/index.ts* — Entry point',
      '• *src/core/bridge.ts* — Orchestrator',
      '',
      '*How to run*',
      '',
      '```bash',
      'npm run dev',
      '```',
      '',
      'Visit the docs (https://docs.example.com) for more info.',
    ].join('\n');

    expect(formatMarkdownForWhatsApp(input)).toBe(expected);
  });

  // --- Edge cases ---
  it('handles multiple code blocks in the same message', () => {
    const input = 'Before\n```\nblock1\n```\nMiddle **bold**\n```\nblock2\n```\nAfter';
    const expected = 'Before\n```\nblock1\n```\nMiddle *bold*\n```\nblock2\n```\nAfter';
    expect(formatMarkdownForWhatsApp(input)).toBe(expected);
  });

  it('handles null-ish content gracefully', () => {
    expect(formatMarkdownForWhatsApp('')).toBe('');
  });
});
