// AUTO-GENERATED — do not edit manually. Run: npm run build:webchat
// Generated: 2026-03-03T22:00:10.769Z
export const WEBCHAT_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>OpenBridge WebChat</title>
  <link rel="manifest" href="/manifest.json" />
  <style>
/* OpenBridge WebChat — Light theme (default) */
:root {
  --bg-primary: #f0f2f5;
  --bg-surface: #ffffff;
  --bg-muted: #f8f9fa;
  --bg-hover: #f1f3f4;

  --text-primary: #202124;
  --text-secondary: #5f6368;
  --text-muted: #9aa0a6;

  --accent: #1a73e8;
  --accent-hover: #1557b0;

  --border: #e8eaed;
  --border-input: #dadce0;

  --header-bg: #1a73e8;
  --header-text: #ffffff;

  --shadow: rgba(0, 0, 0, 0.12);

  --avatar-user-bg: var(--accent);
  --avatar-user-text: #ffffff;
  --avatar-ai-bg: #34a853;
  --avatar-ai-text: #ffffff;

  --bubble-user-bg: var(--accent);
  --bubble-user-text: #ffffff;
  --bubble-ai-bg: var(--bg-hover);
  --bubble-ai-text: var(--text-primary);
  --bubble-sys-text: var(--text-muted);

  --conn-dot-offline: #ff5252;
  --conn-dot-online: #69f0ae;

  --stop-bg: #ff5252;
  --stop-hover: #d32f2f;
  --stop-disabled: #e57373;

  --badge-starting-bg: #fef3c7;
  --badge-starting-text: #92400e;
  --badge-running-bg: #d1fae5;
  --badge-running-text: #065f46;
  --badge-completing-bg: #dbeafe;
  --badge-completing-text: #1e40af;
}

/* Dark theme */
[data-theme='dark'] {
  --bg-primary: #0d0d0d;
  --bg-surface: #1e1e1e;
  --bg-muted: #262626;
  --bg-hover: #2c2c2c;

  --text-primary: #e0e0e0;
  --text-secondary: #9e9e9e;
  --text-muted: #616161;

  --accent: #4da3f7;
  --accent-hover: #2196f3;

  --border: #333333;
  --border-input: #424242;

  --header-bg: #1a1a2e;
  --header-text: #e0e0e0;

  --shadow: rgba(0, 0, 0, 0.5);

  --avatar-ai-bg: #1a6b36;

  --bubble-user-bg: var(--accent);
  --bubble-user-text: #ffffff;
  --bubble-ai-bg: var(--bg-hover);
  --bubble-ai-text: var(--text-primary);
  --bubble-sys-text: var(--text-muted);

  --conn-dot-offline: #ff5252;
  --conn-dot-online: #69f0ae;

  --stop-bg: #c62828;
  --stop-hover: #b71c1c;
  --stop-disabled: #ef9a9a;

  --badge-starting-bg: #3d2c00;
  --badge-starting-text: #ffd54f;
  --badge-running-bg: #003300;
  --badge-running-text: #69f0ae;
  --badge-completing-bg: #0d1f3c;
  --badge-completing-text: #90caf9;
}

/* Reset */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* Prevent text selection on all interactive buttons */
button {
  user-select: none;
}

/* Layout */
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg-primary);
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-wrap {
  width: 100%;
  max-width: 720px;
  height: 92vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border-radius: 12px;
  box-shadow: 0 4px 24px var(--shadow);
  overflow: hidden;
}

/* Header */
.header {
  padding: 14px 20px;
  background: var(--header-bg);
  color: var(--header-text);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.header h1 {
  font-size: 17px;
  font-weight: 600;
}

/* Connection status */
.conn-status {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  opacity: 0.92;
}

.conn-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--conn-dot-offline);
  transition: background 0.4s;
  flex-shrink: 0;
}

.conn-dot.online {
  background: var(--conn-dot-online);
}

/* Messages */
#msgs {
  flex: 1;
  overflow-y: auto;
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  scroll-behavior: smooth;
}

.bubble {
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.55;
  word-wrap: break-word;
  min-width: 0;
}

.bubble.user {
  background: var(--bubble-user-bg);
  color: var(--bubble-user-text);
  border-bottom-right-radius: 4px;
}

.bubble.ai {
  background: var(--bubble-ai-bg);
  color: var(--bubble-ai-text);
  border-bottom-left-radius: 4px;
}

.bubble.sys {
  align-self: center;
  background: transparent;
  color: var(--bubble-sys-text);
  font-size: 12px;
  font-style: italic;
  padding: 2px 0;
  animation: msgEnter 0.22s ease;
}

/* Message entrance animation */
@keyframes msgEnter {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Message rows with avatars */
.msg-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  max-width: 84%;
  animation: msgEnter 0.22s ease;
}

.msg-row.user {
  flex-direction: row-reverse;
  align-self: flex-end;
}

.msg-row.ai {
  align-self: flex-start;
}

/* Avatar icons (CSS-only, no images) */
.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  user-select: none;
  letter-spacing: 0.3px;
}

.avatar-user {
  background: var(--avatar-user-bg);
  color: var(--avatar-user-text);
}

.avatar-ai {
  background: var(--avatar-ai-bg);
  color: var(--avatar-ai-text);
}

/* Message timestamps */
.bubble-ts {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
  cursor: default;
  font-style: normal;
}

.bubble.user .bubble-ts {
  text-align: right;
}

[data-ts='hide'] .bubble-ts {
  display: none;
}

/* Typing dots animation */
.dot-anim span {
  display: inline-block;
  animation: pulse 1.3s infinite;
}

.dot-anim span:nth-child(2) {
  animation-delay: 0.22s;
}

.dot-anim span:nth-child(3) {
  animation-delay: 0.44s;
}

@keyframes pulse {
  0%,
  80%,
  100% {
    opacity: 0.2;
  }
  40% {
    opacity: 1;
  }
}

/* AI bubble inline code & pre */
.bubble.ai code {
  font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
  font-size: 13px;
  background: rgba(0, 0, 0, 0.07);
  padding: 1px 5px;
  border-radius: 3px;
}

.bubble.ai pre {
  background: rgba(0, 0, 0, 0.06);
  border-radius: 6px;
  padding: 10px 12px;
  margin: 6px 0;
  overflow-x: auto;
}

.bubble.ai pre code {
  background: transparent;
  padding: 0;
}

.bubble.ai strong {
  font-weight: 600;
}

.bubble.ai em {
  font-style: italic;
}

/* Status bar */
#status-bar {
  padding: 6px 16px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  min-height: 34px;
  background: var(--bg-muted);
}

#status-bar.hidden {
  display: none;
}

#status-text {
  flex: 1;
  font-size: 13px;
  color: var(--text-secondary);
}

#status-timer {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.status-dot-anim span {
  display: inline-block;
  animation: pulse 1.3s infinite;
}

.status-dot-anim span:nth-child(2) {
  animation-delay: 0.22s;
}

.status-dot-anim span:nth-child(3) {
  animation-delay: 0.44s;
}

/* Input row */
.input-row {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

#form {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.inp-wrap {
  flex: 1;
  min-width: 0;
}

#inp {
  width: 100%;
  padding: 10px 16px;
  border: 1.5px solid var(--border-input);
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.55;
  font-family: inherit;
  outline: none;
  transition: border-color 0.2s;
  background: var(--bg-surface);
  resize: none;
  min-height: 42px;
  max-height: calc(6 * 1.55em + 22px);
  overflow-y: auto;
  display: block;
}

#inp:focus {
  border-color: var(--accent);
}

#inp:disabled {
  background: var(--bg-muted);
}

.char-count {
  font-size: 11px;
  color: var(--text-secondary);
  text-align: right;
  padding: 2px 4px 0;
}

.char-count.hidden {
  display: none;
}

/* Slash command autocomplete dropdown */
.inp-wrap {
  position: relative;
}

.autocomplete-dropdown {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--bg-surface);
  border: 1.5px solid var(--border-input);
  border-radius: 10px;
  box-shadow: 0 4px 16px var(--shadow);
  list-style: none;
  max-height: 220px;
  overflow-y: auto;
  z-index: 100;
  display: none;
}

.autocomplete-dropdown.visible {
  display: block;
}

.autocomplete-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 9px 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.autocomplete-item:first-child {
  border-radius: 8px 8px 0 0;
}

.autocomplete-item:last-child {
  border-radius: 0 0 8px 8px;
}

.autocomplete-item:only-child {
  border-radius: 8px;
}

.autocomplete-item:hover,
.autocomplete-item.active {
  background: var(--bg-hover);
}

.autocomplete-cmd {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  font-family: monospace;
  white-space: nowrap;
}

.autocomplete-desc {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#send {
  padding: 10px 22px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 24px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}

#send:hover:not(:disabled) {
  background: var(--accent-hover);
}

#send:disabled {
  background: #bdc1c6;
  cursor: not-allowed;
}

/* File upload button */
.file-input-hidden {
  display: none;
}

.upload-btn {
  padding: 10px 12px;
  background: none;
  border: 1px solid var(--border-input);
  border-radius: 24px;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
  white-space: nowrap;
  flex-shrink: 0;
  min-height: 42px;
  min-width: 42px;
}

.upload-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.upload-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Voice input button */
.mic-btn {
  padding: 10px 12px;
  background: none;
  border: 1px solid var(--border-input);
  border-radius: 24px;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  white-space: nowrap;
  flex-shrink: 0;
  min-height: 42px;
  min-width: 42px;
  position: relative;
}

.mic-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.mic-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mic-btn.recording {
  background: #ff5252;
  border-color: #ff5252;
  color: #ffffff;
}

.mic-btn.recording:hover:not(:disabled) {
  background: #d32f2f;
  border-color: #d32f2f;
}

/* Pulsing recording dot shown in the input area */
.recording-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #ff5252;
  font-weight: 500;
}

.recording-dot {
  width: 8px;
  height: 8px;
  background: #ff5252;
  border-radius: 50%;
  flex-shrink: 0;
  animation: rec-pulse 1s ease-in-out infinite;
}

@keyframes rec-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.75); }
}

/* File preview chips */
.file-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 0 4px;
}

.file-preview.hidden {
  display: none;
}

.file-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--bg-muted);
  border: 1px solid var(--border);
  border-radius: 6px;
  max-width: 240px;
  font-size: 12px;
}

.file-chip-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.file-chip-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.file-chip-name {
  color: var(--text-primary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}

.file-chip-meta {
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-chip-remove {
  background: none;
  border: none;
  padding: 0 2px;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1;
  flex-shrink: 0;
  border-radius: 3px;
}

.file-chip-remove:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

/* Drag-over highlight */
.chat-wrap.drag-over {
  outline: 2px dashed var(--accent);
  outline-offset: -4px;
}

/* Code block copy button */
.bubble.ai .code-block {
  position: relative;
  margin: 6px 0;
}

.bubble.ai .code-block pre {
  margin: 0;
}

.copy-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  background: rgba(0, 0, 0, 0.12);
  border: 1px solid rgba(0, 0, 0, 0.18);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 11px;
  font-family: inherit;
  padding: 2px 8px;
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.2s,
    background 0.2s;
  z-index: 1;
  line-height: 1.5;
}

.code-block:hover .copy-btn {
  opacity: 1;
}

.copy-btn:hover {
  background: rgba(0, 0, 0, 0.22);
}

.copy-btn.copied {
  color: #2e7d32;
}

[data-theme='dark'] .copy-btn {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.18);
}

[data-theme='dark'] .copy-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

[data-theme='dark'] .copy-btn.copied {
  color: #69f0ae;
}

/* Collapsible response sections */
.collapsible-wrap {
  position: relative;
}

.collapsible-inner {
  overflow: hidden;
  transition: max-height 0.35s ease;
}

.collapsible-fade {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 40px;
  background: linear-gradient(to bottom, transparent, var(--bubble-ai-bg));
  pointer-events: none;
}

.show-more-btn {
  display: block;
  margin: 6px auto 0;
  background: transparent;
  border: 1px solid var(--border-input);
  border-radius: 12px;
  color: var(--accent);
  font-size: 12px;
  font-family: inherit;
  padding: 3px 14px;
  cursor: pointer;
  transition: background 0.2s;
}

.show-more-btn:hover {
  background: var(--bg-hover);
}

/* Download link */
.download-link {
  display: inline-block;
  margin-top: 6px;
  padding: 6px 14px;
  background: var(--accent);
  color: #fff;
  border-radius: 16px;
  text-decoration: none;
  font-size: 13px;
}

.download-link:hover {
  background: var(--accent-hover);
}

/* Agent dashboard */
#dash {
  border-bottom: 1px solid var(--border);
  background: var(--bg-muted);
  flex-shrink: 0;
  max-height: 220px;
  overflow-y: auto;
}

#dash.hidden {
  display: none;
}

.dash-hdr {
  padding: 6px 16px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  user-select: none;
}

.dash-hdr:hover {
  background: var(--bg-hover);
}

#dash-body {
  padding: 2px 16px 8px;
  font-size: 12px;
}

.agent-row {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 2px 0;
}

.prog-wrap {
  width: 72px;
  height: 7px;
  background: var(--border);
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
}

.prog-bar {
  height: 100%;
  background: var(--accent);
  border-radius: 4px;
  transition: width 0.4s;
}

.abadge {
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
  flex-shrink: 0;
}

.s-starting {
  background: var(--badge-starting-bg);
  color: var(--badge-starting-text);
}

.s-running {
  background: var(--badge-running-bg);
  color: var(--badge-running-text);
}

.s-completing {
  background: var(--badge-completing-bg);
  color: var(--badge-completing-text);
}

.dash-cost {
  padding: 4px 0 0;
  color: var(--text-secondary);
  border-top: 1px solid var(--border);
  margin-top: 4px;
}

/* Stop buttons */
.stop-btn {
  background: var(--stop-bg);
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 1px 7px;
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
  line-height: 1.6;
}

.stop-btn:hover {
  background: var(--stop-hover);
}

.stop-all-btn {
  background: var(--stop-bg);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.stop-all-btn:hover {
  background: var(--stop-hover);
}

.stop-all-btn:disabled {
  background: var(--stop-disabled);
  cursor: not-allowed;
}

/* Public URL bar in header */
#public-url-bar {
  display: none;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  opacity: 0.9;
  max-width: 260px;
  overflow: hidden;
}

#public-url-bar.visible {
  display: flex;
}

#public-url-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--header-text);
}

.url-copy-btn {
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  color: var(--header-text);
  font-size: 11px;
  font-family: inherit;
  padding: 2px 7px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s;
  flex-shrink: 0;
}

.url-copy-btn:hover {
  background: rgba(255, 255, 255, 0.25);
}

.url-copy-btn.copied {
  color: #69f0ae;
}

/* Theme toggle button */
.theme-toggle {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  color: var(--header-text);
  padding: 4px 10px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}

.theme-toggle:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* Dark mode overrides for code blocks */
[data-theme='dark'] #inp {
  color: var(--text-primary);
}

[data-theme='dark'] .bubble.ai code {
  background: rgba(255, 255, 255, 0.1);
}

[data-theme='dark'] .bubble.ai pre {
  background: rgba(255, 255, 255, 0.08);
}

/* ------------------------------------------------------------------ */
/* Syntax highlighting — highlight.js theme (light + dark compatible)  */
/* ------------------------------------------------------------------ */

/* Light theme tokens */
:root {
  --hljs-bg: #f6f8fa;
  --hljs-fg: #24292f;
  --hljs-keyword: #cf222e;
  --hljs-string: #0a3069;
  --hljs-comment: #6e7781;
  --hljs-number: #0550ae;
  --hljs-title: #953800;
  --hljs-attr: #116329;
  --hljs-type: #953800;
  --hljs-built-in: #0550ae;
  --hljs-meta: #6e7781;
  --hljs-literal: #0550ae;
  --hljs-deletion: #82071e;
  --hljs-addition: #116329;
}

/* Dark theme token overrides */
[data-theme='dark'] {
  --hljs-bg: #161b22;
  --hljs-fg: #e6edf3;
  --hljs-keyword: #ff7b72;
  --hljs-string: #a5d6ff;
  --hljs-comment: #8b949e;
  --hljs-number: #79c0ff;
  --hljs-title: #d2a8ff;
  --hljs-attr: #7ee787;
  --hljs-type: #ffa657;
  --hljs-built-in: #79c0ff;
  --hljs-meta: #8b949e;
  --hljs-literal: #79c0ff;
  --hljs-deletion: #ffdcd7;
  --hljs-addition: #aff5b4;
}

.bubble.ai pre code.hljs {
  display: block;
  overflow-x: auto;
  padding: 0;
  background: transparent;
  color: var(--hljs-fg);
}

.bubble.ai .hljs-keyword,
.bubble.ai .hljs-selector-tag,
.bubble.ai .hljs-tag {
  color: var(--hljs-keyword);
  font-weight: 600;
}

.bubble.ai .hljs-string,
.bubble.ai .hljs-selector-attr,
.bubble.ai .hljs-selector-pseudo {
  color: var(--hljs-string);
}

.bubble.ai .hljs-comment,
.bubble.ai .hljs-quote {
  color: var(--hljs-comment);
  font-style: italic;
}

.bubble.ai .hljs-number,
.bubble.ai .hljs-regexp,
.bubble.ai .hljs-variable,
.bubble.ai .hljs-template-variable {
  color: var(--hljs-number);
}

.bubble.ai .hljs-title,
.bubble.ai .hljs-section,
.bubble.ai .hljs-name {
  color: var(--hljs-title);
  font-weight: 600;
}

.bubble.ai .hljs-attr,
.bubble.ai .hljs-attribute {
  color: var(--hljs-attr);
}

.bubble.ai .hljs-type,
.bubble.ai .hljs-class .hljs-title {
  color: var(--hljs-type);
}

.bubble.ai .hljs-built_in,
.bubble.ai .hljs-builtin-name {
  color: var(--hljs-built-in);
}

.bubble.ai .hljs-meta,
.bubble.ai .hljs-meta .hljs-keyword {
  color: var(--hljs-meta);
}

.bubble.ai .hljs-literal,
.bubble.ai .hljs-symbol,
.bubble.ai .hljs-bullet {
  color: var(--hljs-literal);
}

.bubble.ai .hljs-deletion {
  color: var(--hljs-deletion);
  background: rgba(255, 0, 0, 0.08);
}

.bubble.ai .hljs-addition {
  color: var(--hljs-addition);
  background: rgba(0, 200, 0, 0.08);
}

/* Share toast notification */
.share-toast {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%) translateY(-8px);
  background: #323232;
  color: #ffffff;
  padding: 8px 18px;
  border-radius: 6px;
  font-size: 13px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  pointer-events: none;
  opacity: 0;
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
  z-index: 9999;
  white-space: nowrap;
}

.share-toast.visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

/* ------------------------------------------------------------------ */
/* Responsive layout                                                    */
/* ------------------------------------------------------------------ */

/* Desktop: add padding so the card floats above the background */
@media (min-width: 768px) {
  body {
    padding: 16px;
  }
}

/* Mobile: full-width, edge-to-edge, no rounded corners */
@media (max-width: 767px) {
  body {
    align-items: stretch;
    padding: 0;
  }

  .chat-wrap {
    max-width: 100%;
    height: 100vh;
    /* Dynamic viewport height: accounts for browser chrome (address bar) */
    height: 100dvh;
    border-radius: 0;
    box-shadow: none;
  }

  .header {
    padding: 10px 14px;
  }

  #msgs {
    padding: 12px 10px;
  }

  /* Wider bubbles on narrow screens */
  .msg-row {
    max-width: 92%;
  }

  .input-row {
    padding: 10px 10px;
    gap: 8px;
  }

  /* font-size 16px prevents iOS Safari from auto-zooming on focus */
  #inp {
    font-size: 16px;
    padding: 11px 14px;
    min-height: 44px;
    border-radius: 14px;
  }

  /* Larger send button with 44px tap target */
  #send {
    padding: 11px 24px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  /* Larger upload button with 44px tap target */
  .upload-btn {
    min-height: 44px;
    min-width: 44px;
  }

  /* 44px minimum tap targets for all interactive buttons */
  .stop-all-btn,
  .theme-toggle,
  .url-copy-btn,
  .show-more-btn {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  /* Stop button: square 44px tap target */
  .stop-btn {
    min-height: 44px;
    min-width: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  /* Dashboard header toggle: 44px tap target */
  .dash-hdr {
    min-height: 44px;
  }

  /* 8px minimum gap between tappable elements in agent rows */
  .agent-row {
    gap: 8px;
  }
}

/* Landscape mobile: reduce vertical padding to preserve message area */
@media (max-width: 767px) and (orientation: landscape) {
  .chat-wrap {
    height: 100vh;
    height: 100dvh;
  }

  .header {
    padding: 7px 14px;
  }

  .header h1 {
    font-size: 15px;
  }

  #msgs {
    padding: 7px 10px;
    gap: 6px;
  }

  .input-row {
    padding: 6px 10px;
  }

  #dash {
    max-height: 120px;
  }
}

/* ------------------------------------------------------------------ */
/* iOS safe area insets — notch / Dynamic Island + home indicator       */
/* Requires viewport-fit=cover on the meta viewport tag                 */
/* ------------------------------------------------------------------ */

/* Container: left/right safe area (primarily for landscape notch) */
.chat-wrap {
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
}

/* Header: top safe area for notch / Dynamic Island (desktop base) */
.header {
  padding-top: calc(14px + env(safe-area-inset-top, 0px));
}

/* Input area: bottom safe area for home indicator (desktop base) */
.input-row {
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
}

/* Mobile overrides: correct base padding + safe area */
@media (max-width: 767px) {
  .header {
    padding-top: calc(10px + env(safe-area-inset-top, 0px));
  }

  .input-row {
    padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
  }
}

/* Landscape mobile overrides */
@media (max-width: 767px) and (orientation: landscape) {
  .header {
    padding-top: calc(7px + env(safe-area-inset-top, 0px));
  }

  .input-row {
    padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px));
  }
}

/* ------------------------------------------------------------------ */
/* PWA "Add to Home Screen" install banner                              */
/* ------------------------------------------------------------------ */

.pwa-banner {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  background: var(--bg-surface);
  border-top: 1px solid var(--border);
  padding: 12px 16px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.12);
}

.pwa-banner.hidden {
  display: none;
}

.pwa-banner-content {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 720px;
  margin: 0 auto;
}

.pwa-banner-icon {
  font-size: 24px;
  flex-shrink: 0;
}

.pwa-banner-text {
  flex: 1;
  min-width: 0;
}

.pwa-banner-text strong {
  display: block;
  font-size: 14px;
  color: var(--text-primary);
}

.pwa-banner-text span {
  font-size: 12px;
  color: var(--text-secondary);
}

.pwa-install-btn {
  flex-shrink: 0;
  padding: 8px 16px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  min-height: 44px;
  min-width: 60px;
}

.pwa-install-btn:hover {
  background: var(--accent-hover);
}

.pwa-dismiss-btn {
  flex-shrink: 0;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
  min-height: 44px;
  min-width: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
}

.pwa-dismiss-btn:hover {
  background: var(--bg-hover);
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                              */
/* ------------------------------------------------------------------ */

.sidebar {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 300px;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  z-index: 200;
  display: flex;
  flex-direction: column;
  transform: translateX(-100%);
  transition: transform 0.25s ease;
  overflow: hidden;
}

.sidebar.open {
  transform: translateX(0);
}

.sidebar-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 199;
}

.sidebar-overlay.visible {
  display: block;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.sidebar-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.new-conv-btn {
  background: transparent;
  border: 1.5px solid var(--border-input);
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 2px 8px 4px;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  flex-shrink: 0;
}

.new-conv-btn:hover {
  background: var(--bg-hover);
  border-color: var(--accent);
  color: var(--accent);
}

.new-conv-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.sidebar-search-wrap {
  padding: 10px 12px 6px;
  flex-shrink: 0;
}

.sidebar-search-input {
  width: 100%;
  padding: 8px 12px;
  border: 1.5px solid var(--border-input);
  border-radius: 20px;
  font-size: 13px;
  background: var(--bg-muted);
  color: var(--text-primary);
  outline: none;
  font-family: inherit;
  transition: border-color 0.2s, background 0.2s;
}

.sidebar-search-input:focus {
  border-color: var(--accent);
  background: var(--bg-surface);
}

.sidebar-sessions {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
}

.sidebar-session-item {
  padding: 9px 10px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 2px;
  transition: background 0.15s;
}

.sidebar-session-item:hover,
.sidebar-session-item:focus {
  background: var(--bg-hover);
  outline: none;
}

.sidebar-session-item.active {
  background: rgba(26, 115, 232, 0.1);
}

[data-theme='dark'] .sidebar-session-item.active {
  background: rgba(138, 180, 248, 0.15);
}

.sidebar-session-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 3px;
}

.sidebar-session-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
}

.sidebar-empty {
  padding: 16px 12px;
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
}

.sidebar-search-snippet {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 3px;
  line-height: 1.4;
}

.sidebar-match {
  background: rgba(26, 115, 232, 0.2);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
  font-style: normal;
}

[data-theme='dark'] .sidebar-match {
  background: rgba(138, 180, 248, 0.25);
}

/* Hamburger toggle button in header */
.sidebar-toggle-btn {
  background: transparent;
  border: none;
  color: var(--header-text);
  padding: 4px 8px;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  line-height: 1;
  flex-shrink: 0;
}

.sidebar-toggle-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

@media (max-width: 767px) {
  .sidebar-toggle-btn {
    min-height: 44px;
    min-width: 44px;
  }
}

/* --- Feedback buttons --- */

.feedback-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
}

.feedback-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  padding: 2px 6px;
  color: var(--text-muted);
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
  line-height: 1.4;
}

.feedback-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-input);
  color: var(--text-secondary);
}

.feedback-btn.active-up {
  border-color: #34a853;
  color: #34a853;
  background: #e8f5e9;
}

.feedback-btn.active-down {
  border-color: #ea4335;
  color: #ea4335;
  background: #fce8e6;
}

.feedback-btn[disabled] {
  cursor: default;
  pointer-events: none;
}

/* --- Feedback toast --- */

.feedback-toast {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%) translateY(8px);
  background: #202124;
  color: #fff;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.2s,
    transform 0.2s;
  z-index: 1000;
}

.feedback-toast.visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

/* ------------------------------------------------------------------ */
/* Settings panel (slide-out, right)                                   */
/* ------------------------------------------------------------------ */

/* Gear button in header */
.settings-gear-btn {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  color: var(--header-text);
  padding: 4px 8px;
  font-size: 15px;
  cursor: pointer;
  line-height: 1;
  transition: background 0.2s;
  white-space: nowrap;
}

.settings-gear-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* Overlay backdrop */
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 200;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s;
}

.settings-overlay.visible {
  opacity: 1;
  pointer-events: auto;
}

/* Panel */
.settings-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 320px;
  max-width: 100vw;
  background: var(--bg-surface);
  box-shadow: -4px 0 24px var(--shadow);
  z-index: 201;
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  transition: transform 0.25s ease;
  overflow: hidden;
}

.settings-panel.open {
  transform: translateX(0);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.settings-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.settings-close-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1;
}

.settings-close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 0;
}

.settings-section {
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
}

.settings-section:last-child {
  border-bottom: none;
}

.settings-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.settings-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 5px;
  line-height: 1.4;
}

.settings-select {
  width: 100%;
  padding: 8px 10px;
  border: 1.5px solid var(--border-input);
  border-radius: 8px;
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  cursor: pointer;
  transition: border-color 0.2s;
}

.settings-select:focus {
  border-color: var(--accent);
}

/* Radio group */
.settings-radio-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.settings-radio-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}

.settings-radio-item:hover {
  background: var(--bg-hover);
}

.settings-radio-item input[type='radio'] {
  margin-top: 2px;
  flex-shrink: 0;
  accent-color: var(--accent);
  cursor: pointer;
}

.settings-radio-item:has(input:checked) {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-surface));
}

.settings-radio-content {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.settings-radio-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.settings-radio-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

/* Checkbox items */
.settings-checkbox-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.settings-checkbox-item:hover {
  background: var(--bg-hover);
}

.settings-checkbox-item input[type='checkbox'] {
  margin-top: 2px;
  flex-shrink: 0;
  accent-color: var(--accent);
  cursor: pointer;
}

.settings-checkbox-content {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.settings-checkbox-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.settings-checkbox-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

/* Deep Mode stepper bar */

.deep-mode-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 8px 16px;
  background: var(--bg-muted);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.deep-mode-bar.hidden {
  display: none;
}

.dm-track {
  display: flex;
  align-items: center;
  width: 100%;
  max-width: 480px;
}

.dm-phase-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.dm-connector {
  flex: 1 1 auto;
  height: 2px;
  background: var(--border);
  margin-bottom: 18px;
  min-width: 8px;
}

.dm-phase-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, color 0.2s;
  cursor: default;
  user-select: none;
}

.dm-phase-icon {
  font-size: 12px;
  line-height: 1;
}

.dm-phase-label {
  font-size: 10px;
  color: var(--text-secondary);
  white-space: nowrap;
  text-align: center;
}

.dm-phase-pending {
  background: var(--bg-hover);
  color: var(--text-muted);
  border: 2px solid var(--border);
}

.dm-phase-current {
  background: var(--accent);
  color: #fff;
  border: 2px solid var(--accent);
}

.dm-phase-done {
  background: #34a853;
  color: #fff;
  border: 2px solid #34a853;
}

/* Deep Mode action buttons */

.dm-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0 0;
  flex-wrap: wrap;
  justify-content: center;
}

.dm-proceed-btn {
  padding: 5px 14px;
  border: none;
  border-radius: 6px;
  background: #34a853;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, opacity 0.15s;
}

.dm-proceed-btn:hover:not(:disabled) {
  background: #2e8e47;
}

.dm-proceed-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dm-action-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dm-num-select {
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  width: 52px;
}

.dm-num-select:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dm-action-btn {
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, opacity 0.15s;
}

.dm-action-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.dm-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Deep Mode phase transition cards */

.dm-phase-card {
  display: flex;
  flex-direction: column;
  margin: 6px 16px;
  border-radius: 10px;
  border-left: 4px solid var(--dm-card-color, var(--accent));
  background: var(--bg-surface);
  box-shadow: 0 1px 4px var(--shadow);
  overflow: hidden;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.dm-phase-card--enter {
  opacity: 1;
  transform: translateY(0);
}

/* Per-phase colors */
.dm-phase-card--blue  { --dm-card-color: #1a73e8; --dm-card-bg: #e8f0fe; --dm-card-text: #1a3a6b; }
.dm-phase-card--purple { --dm-card-color: #7b1fa2; --dm-card-bg: #f3e5f5; --dm-card-text: #4a0e6b; }
.dm-phase-card--orange { --dm-card-color: #ef6c00; --dm-card-bg: #fff3e0; --dm-card-text: #7c3800; }
.dm-phase-card--green  { --dm-card-color: #2e7d32; --dm-card-bg: #e8f5e9; --dm-card-text: #1b4a1d; }
.dm-phase-card--teal   { --dm-card-color: #00695c; --dm-card-bg: #e0f2f1; --dm-card-text: #00352e; }

[data-theme='dark'] .dm-phase-card--blue  { --dm-card-bg: #1a2c4a; --dm-card-text: #90b8f8; }
[data-theme='dark'] .dm-phase-card--purple { --dm-card-bg: #2a1a3a; --dm-card-text: #ce93d8; }
[data-theme='dark'] .dm-phase-card--orange { --dm-card-bg: #3a2500; --dm-card-text: #ffb74d; }
[data-theme='dark'] .dm-phase-card--green  { --dm-card-bg: #1a2e1a; --dm-card-text: #81c784; }
[data-theme='dark'] .dm-phase-card--teal   { --dm-card-bg: #0a2622; --dm-card-text: #80cbc4; }

.dm-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--dm-card-bg, var(--bg-muted));
}

.dm-card-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.dm-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--dm-card-text, var(--text-primary));
  flex: 1;
}

.dm-card-status {
  font-size: 11px;
  color: var(--dm-card-color, var(--accent));
  font-weight: 500;
  white-space: nowrap;
}

.dm-phase-card--completed .dm-card-status { color: #2e7d32; }
[data-theme='dark'] .dm-phase-card--completed .dm-card-status { color: #81c784; }
.dm-phase-card--skipped .dm-card-status { color: var(--text-secondary); }
.dm-phase-card--aborted .dm-card-status { color: #c62828; }
[data-theme='dark'] .dm-phase-card--aborted .dm-card-status { color: #ef9a9a; }

/* Spinner for in-progress phase */
.dm-card-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--dm-card-color, var(--accent));
  border-top-color: transparent;
  border-radius: 50%;
  animation: dm-spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes dm-spin {
  to { transform: rotate(360deg); }
}

.dm-card-body {
  padding: 8px 14px 10px;
  border-top: 1px solid var(--border);
}

.dm-card-summary {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.dm-card-summary--collapsed {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dm-card-toggle {
  margin-top: 6px;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
}

</style>
  <script>
    (function () {
      var t = localStorage.getItem('ob-theme');
      if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    })();
  </script>
  <script>window.__OB_PUBLIC_URL__ = null;</script>
</head>
<body>
  <!-- Sidebar overlay (mobile backdrop) -->
  <div id="sidebar-overlay" class="sidebar-overlay" aria-hidden="true"></div>

  <!-- Sidebar panel -->
  <nav id="sidebar" class="sidebar" aria-label="Conversations" aria-hidden="true">
    <div class="sidebar-header">
      <span class="sidebar-title">Conversations</span>
      <button id="new-conversation-btn" class="new-conv-btn" aria-label="Start new conversation" title="New conversation">&#43;</button>
    </div>
    <div class="sidebar-search-wrap">
      <input
        id="sidebar-search-input"
        type="search"
        class="sidebar-search-input"
        placeholder="Search..."
        aria-label="Search conversations"
      />
    </div>
    <div id="sidebar-sessions" class="sidebar-sessions" role="list" aria-label="Conversation list">
      <!-- Populated by OB-1520 -->
    </div>
  </nav>

  <div class="chat-wrap">
    <header class="header">
      <button
        id="sidebar-toggle"
        class="sidebar-toggle-btn"
        aria-label="Open sidebar"
        aria-expanded="false"
        aria-controls="sidebar"
      >&#9776;</button>
      <h1>OpenBridge WebChat</h1>
      <div id="public-url-bar" class="hidden" role="note" aria-label="Public URL">
        <span id="public-url-text"></span>
        <button class="url-copy-btn" id="url-copy-btn" aria-label="Copy public URL">Copy</button>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <button class="theme-toggle" id="ts-toggle" aria-label="Toggle message timestamps">Hide times</button>
        <button class="theme-toggle sound-toggle" id="sound-toggle" aria-label="Mute notifications" aria-pressed="false">&#x1F50A;</button>
        <button class="theme-toggle" id="theme-toggle" aria-label="Toggle dark mode">Dark</button>
        <button class="theme-toggle" id="share-btn" aria-label="Share this link">Share</button>
        <button class="stop-all-btn" id="stop-all-btn" disabled aria-label="Stop all workers">Stop All</button>
        <button class="settings-gear-btn" id="settings-btn" aria-label="Open settings" aria-controls="settings-panel" aria-expanded="false" title="Settings">&#x2699;&#xFE0F;</button>
        <div class="conn-status" role="status" aria-live="polite" aria-label="Connection status">
          <div class="conn-dot" id="dot" aria-hidden="true"></div>
          <span id="connLabel">Connecting...</span>
        </div>
      </div>
    </header>
    <section id="dash" class="hidden" aria-label="Agent Status">
      <div
        class="dash-hdr"
        id="dash-hdr"
        role="button"
        tabindex="0"
        aria-expanded="true"
        aria-controls="dash-body"
      >
        <span id="dash-lbl">Agent Status</span>
        <span id="dash-icon" aria-hidden="true">&#9650;</span>
      </div>
      <div id="dash-body">
        <div id="dash-master"></div>
        <div id="dash-workers"></div>
        <div id="dash-cost"></div>
      </div>
    </section>
    <main id="msgs" role="log" aria-live="polite" aria-label="Chat messages"></main>
    <div id="status-bar" class="hidden" role="status" aria-live="polite">
      <span id="status-text"></span>
      <span id="status-timer"></span>
    </div>
    <div id="deep-mode-bar" class="deep-mode-bar hidden" role="status" aria-live="polite" aria-label="Deep Mode progress">
      <div class="dm-track"></div>
    </div>
    <footer class="input-row">
      <div id="file-preview" class="file-preview hidden" role="status" aria-live="polite" aria-label="Selected files"></div>
      <form id="form">
        <div class="inp-wrap">
          <textarea
            id="inp"
            placeholder="Type a message..."
            autocomplete="off"
            disabled
            rows="1"
            aria-label="Message input"
          ></textarea>
          <div id="char-count" class="char-count hidden" aria-live="polite"></div>
        </div>
        <input type="file" id="file-input" class="file-input-hidden" aria-label="Attach file" multiple />
        <button type="button" id="upload-btn" class="upload-btn" aria-label="Attach file" title="Attach file" disabled>&#128206;</button>
        <button type="button" id="mic-btn" class="mic-btn" aria-label="Record voice message" title="Record voice message" disabled>&#127908;</button>
        <button type="submit" id="send" disabled aria-label="Send message">Send</button>
      </form>
    </footer>
  </div>
  <div id="share-toast" class="share-toast" role="status" aria-live="polite" aria-atomic="true">Link copied!</div>
  <div id="pwa-banner" class="pwa-banner hidden" role="complementary" aria-label="Install app">
    <div class="pwa-banner-content">
      <span class="pwa-banner-icon" aria-hidden="true">&#x1F4F2;</span>
      <div class="pwa-banner-text">
        <strong>Add to Home Screen</strong>
        <span id="pwa-banner-hint">Tap "Add" to install OpenBridge as an app</span>
      </div>
      <button id="pwa-install-btn" class="pwa-install-btn">Add</button>
      <button id="pwa-dismiss-btn" class="pwa-dismiss-btn" aria-label="Dismiss install prompt">&#x2715;</button>
    </div>
  </div>
  <!-- Settings overlay (backdrop) -->
  <div id="settings-overlay" class="settings-overlay" aria-hidden="true"></div>

  <!-- Settings panel (slide-out, right) -->
  <aside
    id="settings-panel"
    class="settings-panel"
    role="dialog"
    aria-modal="true"
    aria-label="Settings"
    aria-hidden="true"
  >
    <div class="settings-header">
      <span class="settings-title">Settings</span>
      <button class="settings-close-btn" aria-label="Close settings">&#x2715;</button>
    </div>
    <div class="settings-body">
      <!-- AI Tool Selector -->
      <section class="settings-section" aria-labelledby="settings-tool-label">
        <label id="settings-tool-label" class="settings-label" for="settings-tool-select">AI Tool</label>
        <select id="settings-tool-select" class="settings-select" aria-label="Preferred AI tool">
          <option value="">Auto (discovered)</option>
        </select>
        <p class="settings-hint">Preferred AI tool for this session. Auto uses the best available.</p>
      </section>

      <!-- Execution Profile -->
      <section class="settings-section" aria-labelledby="settings-profile-label">
        <span id="settings-profile-label" class="settings-label">Execution Profile</span>
        <div class="settings-radio-group" role="radiogroup" aria-labelledby="settings-profile-label">
          <label class="settings-radio-item">
            <input type="radio" name="settings-profile" value="fast" />
            <span class="settings-radio-content">
              <span class="settings-radio-title">Fast</span>
              <span class="settings-radio-desc">Quick responses, fewer subtasks</span>
            </span>
          </label>
          <label class="settings-radio-item">
            <input type="radio" name="settings-profile" value="thorough" />
            <span class="settings-radio-content">
              <span class="settings-radio-title">Thorough</span>
              <span class="settings-radio-desc">More analysis, multiple subtasks</span>
            </span>
          </label>
          <label class="settings-radio-item">
            <input type="radio" name="settings-profile" value="manual" />
            <span class="settings-radio-content">
              <span class="settings-radio-title">Manual</span>
              <span class="settings-radio-desc">Confirm before each worker runs</span>
            </span>
          </label>
        </div>
      </section>

      <!-- Notifications -->
      <section class="settings-section" aria-labelledby="settings-notif-label">
        <span id="settings-notif-label" class="settings-label">Notifications</span>
        <label class="settings-checkbox-item">
          <input type="checkbox" id="settings-sound-check" />
          <span class="settings-checkbox-content">
            <span class="settings-checkbox-title">Sound</span>
            <span class="settings-checkbox-desc">Play a tone when AI responds</span>
          </span>
        </label>
        <label class="settings-checkbox-item">
          <input type="checkbox" id="settings-browser-notify-check" />
          <span class="settings-checkbox-content">
            <span class="settings-checkbox-title">Browser notifications</span>
            <span class="settings-checkbox-desc">Show a notification when the tab is in background</span>
          </span>
        </label>
      </section>

      <!-- Theme -->
      <section class="settings-section" aria-labelledby="settings-theme-label">
        <label id="settings-theme-label" class="settings-label" for="settings-theme-select">Theme</label>
        <select id="settings-theme-select" class="settings-select" aria-label="Color theme">
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </section>
    </div>
  </aside>

  <script>
"use strict";(()=>{var li=Object.create;var Cn=Object.defineProperty;var ci=Object.getOwnPropertyDescriptor;var ui=Object.getOwnPropertyNames;var di=Object.getPrototypeOf,pi=Object.prototype.hasOwnProperty;var gi=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports);var hi=(e,t,n,i)=>{if(t&&typeof t=="object"||typeof t=="function")for(let s of ui(t))!pi.call(e,s)&&s!==n&&Cn(e,s,{get:()=>t[s],enumerable:!(i=ci(t,s))||i.enumerable});return e};var fi=(e,t,n)=>(n=e!=null?li(di(e)):{},hi(t||!e||!e.__esModule?Cn(n,"default",{value:e,enumerable:!0}):n,e));var hs=gi((co,gs)=>{function ts(e){return e instanceof Map?e.clear=e.delete=e.set=function(){throw new Error("map is read-only")}:e instanceof Set&&(e.add=e.clear=e.delete=function(){throw new Error("set is read-only")}),Object.freeze(e),Object.getOwnPropertyNames(e).forEach(t=>{let n=e[t],i=typeof n;(i==="object"||i==="function")&&!Object.isFrozen(n)&&ts(n)}),e}var dt=class{constructor(t){t.data===void 0&&(t.data={}),this.data=t.data,this.isMatchIgnored=!1}ignoreMatch(){this.isMatchIgnored=!0}};function ns(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;")}function pe(e,...t){let n=Object.create(null);for(let i in e)n[i]=e[i];return t.forEach(function(i){for(let s in i)n[s]=i[s]}),n}var rr="</span>",Xn=e=>!!e.scope,ar=(e,{prefix:t})=>{if(e.startsWith("language:"))return e.replace("language:","language-");if(e.includes(".")){let n=e.split(".");return[\`\${t}\${n.shift()}\`,...n.map((i,s)=>\`\${i}\${"_".repeat(s+1)}\`)].join(" ")}return\`\${t}\${e}\`},zt=class{constructor(t,n){this.buffer="",this.classPrefix=n.classPrefix,t.walk(this)}addText(t){this.buffer+=ns(t)}openNode(t){if(!Xn(t))return;let n=ar(t.scope,{prefix:this.classPrefix});this.span(n)}closeNode(t){Xn(t)&&(this.buffer+=rr)}value(){return this.buffer}span(t){this.buffer+=\`<span class="\${t}">\`}},Yn=(e={})=>{let t={children:[]};return Object.assign(t,e),t},Ut=class e{constructor(){this.rootNode=Yn(),this.stack=[this.rootNode]}get top(){return this.stack[this.stack.length-1]}get root(){return this.rootNode}add(t){this.top.children.push(t)}openNode(t){let n=Yn({scope:t});this.add(n),this.stack.push(n)}closeNode(){if(this.stack.length>1)return this.stack.pop()}closeAllNodes(){for(;this.closeNode(););}toJSON(){return JSON.stringify(this.rootNode,null,4)}walk(t){return this.constructor._walk(t,this.rootNode)}static _walk(t,n){return typeof n=="string"?t.addText(n):n.children&&(t.openNode(n),n.children.forEach(i=>this._walk(t,i)),t.closeNode(n)),t}static _collapse(t){typeof t!="string"&&t.children&&(t.children.every(n=>typeof n=="string")?t.children=[t.children.join("")]:t.children.forEach(n=>{e._collapse(n)}))}},Ht=class extends Ut{constructor(t){super(),this.options=t}addText(t){t!==""&&this.add(t)}startScope(t){this.openNode(t)}endScope(){this.closeNode()}__addSublanguage(t,n){let i=t.root;n&&(i.scope=\`language:\${n}\`),this.add(i)}toHTML(){return new zt(this,this.options).value()}finalize(){return this.closeAllNodes(),!0}};function qe(e){return e?typeof e=="string"?e:e.source:null}function ss(e){return ve("(?=",e,")")}function or(e){return ve("(?:",e,")*")}function lr(e){return ve("(?:",e,")?")}function ve(...e){return e.map(n=>qe(n)).join("")}function cr(e){let t=e[e.length-1];return typeof t=="object"&&t.constructor===Object?(e.splice(e.length-1,1),t):{}}function Gt(...e){return"("+(cr(e).capture?"":"?:")+e.map(i=>qe(i)).join("|")+")"}function is(e){return new RegExp(e.toString()+"|").exec("").length-1}function ur(e,t){let n=e&&e.exec(t);return n&&n.index===0}var dr=/\\[(?:[^\\\\\\]]|\\\\.)*\\]|\\(\\??|\\\\([1-9][0-9]*)|\\\\./;function qt(e,{joinWith:t}){let n=0;return e.map(i=>{n+=1;let s=n,a=qe(i),r="";for(;a.length>0;){let l=dr.exec(a);if(!l){r+=a;break}r+=a.substring(0,l.index),a=a.substring(l.index+l[0].length),l[0][0]==="\\\\"&&l[1]?r+="\\\\"+String(Number(l[1])+s):(r+=l[0],l[0]==="("&&n++)}return r}).map(i=>\`(\${i})\`).join(t)}var pr=/\\b\\B/,rs="[a-zA-Z]\\\\w*",Zt="[a-zA-Z_]\\\\w*",as="\\\\b\\\\d+(\\\\.\\\\d+)?",os="(-?)(\\\\b0[xX][a-fA-F0-9]+|(\\\\b\\\\d+(\\\\.\\\\d*)?|\\\\.\\\\d+)([eE][-+]?\\\\d+)?)",ls="\\\\b(0b[01]+)",gr="!|!=|!==|%|%=|&|&&|&=|\\\\*|\\\\*=|\\\\+|\\\\+=|,|-|-=|/=|/|:|;|<<|<<=|<=|<|===|==|=|>>>=|>>=|>=|>>>|>>|>|\\\\?|\\\\[|\\\\{|\\\\(|\\\\^|\\\\^=|\\\\||\\\\|=|\\\\|\\\\||~",hr=(e={})=>{let t=/^#![ ]*\\//;return e.binary&&(e.begin=ve(t,/.*\\b/,e.binary,/\\b.*/)),pe({scope:"meta",begin:t,end:/$/,relevance:0,"on:begin":(n,i)=>{n.index!==0&&i.ignoreMatch()}},e)},Ze={begin:"\\\\\\\\[\\\\s\\\\S]",relevance:0},fr={scope:"string",begin:"'",end:"'",illegal:"\\\\n",contains:[Ze]},mr={scope:"string",begin:'"',end:'"',illegal:"\\\\n",contains:[Ze]},br={begin:/\\b(a|an|the|are|I'm|isn't|don't|doesn't|won't|but|just|should|pretty|simply|enough|gonna|going|wtf|so|such|will|you|your|they|like|more)\\b/},gt=function(e,t,n={}){let i=pe({scope:"comment",begin:e,end:t,contains:[]},n);i.contains.push({scope:"doctag",begin:"[ ]*(?=(TODO|FIXME|NOTE|BUG|OPTIMIZE|HACK|XXX):)",end:/(TODO|FIXME|NOTE|BUG|OPTIMIZE|HACK|XXX):/,excludeBegin:!0,relevance:0});let s=Gt("I","a","is","so","us","to","at","if","in","it","on",/[A-Za-z]+['](d|ve|re|ll|t|s|n)/,/[A-Za-z]+[-][a-z]+/,/[A-Za-z][a-z]{2,}/);return i.contains.push({begin:ve(/[ ]+/,"(",s,/[.]?[:]?([.][ ]|[ ])/,"){3}")}),i},kr=gt("//","$"),Er=gt("/\\\\*","\\\\*/"),yr=gt("#","$"),xr={scope:"number",begin:as,relevance:0},wr={scope:"number",begin:os,relevance:0},_r={scope:"number",begin:ls,relevance:0},vr={scope:"regexp",begin:/\\/(?=[^/\\n]*\\/)/,end:/\\/[gimuy]*/,contains:[Ze,{begin:/\\[/,end:/\\]/,relevance:0,contains:[Ze]}]},Sr={scope:"title",begin:rs,relevance:0},Ar={scope:"title",begin:Zt,relevance:0},Tr={begin:"\\\\.\\\\s*"+Zt,relevance:0},Cr=function(e){return Object.assign(e,{"on:begin":(t,n)=>{n.data._beginMatch=t[1]},"on:end":(t,n)=>{n.data._beginMatch!==t[1]&&n.ignoreMatch()}})},ut=Object.freeze({__proto__:null,APOS_STRING_MODE:fr,BACKSLASH_ESCAPE:Ze,BINARY_NUMBER_MODE:_r,BINARY_NUMBER_RE:ls,COMMENT:gt,C_BLOCK_COMMENT_MODE:Er,C_LINE_COMMENT_MODE:kr,C_NUMBER_MODE:wr,C_NUMBER_RE:os,END_SAME_AS_BEGIN:Cr,HASH_COMMENT_MODE:yr,IDENT_RE:rs,MATCH_NOTHING_RE:pr,METHOD_GUARD:Tr,NUMBER_MODE:xr,NUMBER_RE:as,PHRASAL_WORDS_MODE:br,QUOTE_STRING_MODE:mr,REGEXP_MODE:vr,RE_STARTERS_RE:gr,SHEBANG:hr,TITLE_MODE:Sr,UNDERSCORE_IDENT_RE:Zt,UNDERSCORE_TITLE_MODE:Ar});function Nr(e,t){e.input[e.index-1]==="."&&t.ignoreMatch()}function Rr(e,t){e.className!==void 0&&(e.scope=e.className,delete e.className)}function Ir(e,t){t&&e.beginKeywords&&(e.begin="\\\\b("+e.beginKeywords.split(" ").join("|")+")(?!\\\\.)(?=\\\\b|\\\\s)",e.__beforeBegin=Nr,e.keywords=e.keywords||e.beginKeywords,delete e.beginKeywords,e.relevance===void 0&&(e.relevance=0))}function Lr(e,t){Array.isArray(e.illegal)&&(e.illegal=Gt(...e.illegal))}function Mr(e,t){if(e.match){if(e.begin||e.end)throw new Error("begin & end are not supported with match");e.begin=e.match,delete e.match}}function Or(e,t){e.relevance===void 0&&(e.relevance=1)}var Dr=(e,t)=>{if(!e.beforeMatch)return;if(e.starts)throw new Error("beforeMatch cannot be used with starts");let n=Object.assign({},e);Object.keys(e).forEach(i=>{delete e[i]}),e.keywords=n.keywords,e.begin=ve(n.beforeMatch,ss(n.begin)),e.starts={relevance:0,contains:[Object.assign(n,{endsParent:!0})]},e.relevance=0,delete n.beforeMatch},Br=["of","and","for","in","not","or","if","then","parent","list","value"],Pr="keyword";function cs(e,t,n=Pr){let i=Object.create(null);return typeof e=="string"?s(n,e.split(" ")):Array.isArray(e)?s(n,e):Object.keys(e).forEach(function(a){Object.assign(i,cs(e[a],t,a))}),i;function s(a,r){t&&(r=r.map(l=>l.toLowerCase())),r.forEach(function(l){let o=l.split("|");i[o[0]]=[a,$r(o[0],o[1])]})}}function $r(e,t){return t?Number(t):zr(e)?0:1}function zr(e){return Br.includes(e.toLowerCase())}var Qn={},_e=e=>{console.error(e)},Vn=(e,...t)=>{console.log(\`WARN: \${e}\`,...t)},Ce=(e,t)=>{Qn[\`\${e}/\${t}\`]||(console.log(\`Deprecated as of \${e}. \${t}\`),Qn[\`\${e}/\${t}\`]=!0)},pt=new Error;function us(e,t,{key:n}){let i=0,s=e[n],a={},r={};for(let l=1;l<=t.length;l++)r[l+i]=s[l],a[l+i]=!0,i+=is(t[l-1]);e[n]=r,e[n]._emit=a,e[n]._multi=!0}function Ur(e){if(Array.isArray(e.begin)){if(e.skip||e.excludeBegin||e.returnBegin)throw _e("skip, excludeBegin, returnBegin not compatible with beginScope: {}"),pt;if(typeof e.beginScope!="object"||e.beginScope===null)throw _e("beginScope must be object"),pt;us(e,e.begin,{key:"beginScope"}),e.begin=qt(e.begin,{joinWith:""})}}function Hr(e){if(Array.isArray(e.end)){if(e.skip||e.excludeEnd||e.returnEnd)throw _e("skip, excludeEnd, returnEnd not compatible with endScope: {}"),pt;if(typeof e.endScope!="object"||e.endScope===null)throw _e("endScope must be object"),pt;us(e,e.end,{key:"endScope"}),e.end=qt(e.end,{joinWith:""})}}function Fr(e){e.scope&&typeof e.scope=="object"&&e.scope!==null&&(e.beginScope=e.scope,delete e.scope)}function Gr(e){Fr(e),typeof e.beginScope=="string"&&(e.beginScope={_wrap:e.beginScope}),typeof e.endScope=="string"&&(e.endScope={_wrap:e.endScope}),Ur(e),Hr(e)}function qr(e){function t(r,l){return new RegExp(qe(r),"m"+(e.case_insensitive?"i":"")+(e.unicodeRegex?"u":"")+(l?"g":""))}class n{constructor(){this.matchIndexes={},this.regexes=[],this.matchAt=1,this.position=0}addRule(l,o){o.position=this.position++,this.matchIndexes[this.matchAt]=o,this.regexes.push([o,l]),this.matchAt+=is(l)+1}compile(){this.regexes.length===0&&(this.exec=()=>null);let l=this.regexes.map(o=>o[1]);this.matcherRe=t(qt(l,{joinWith:"|"}),!0),this.lastIndex=0}exec(l){this.matcherRe.lastIndex=this.lastIndex;let o=this.matcherRe.exec(l);if(!o)return null;let c=o.findIndex((d,p)=>p>0&&d!==void 0),u=this.matchIndexes[c];return o.splice(0,c),Object.assign(o,u)}}class i{constructor(){this.rules=[],this.multiRegexes=[],this.count=0,this.lastIndex=0,this.regexIndex=0}getMatcher(l){if(this.multiRegexes[l])return this.multiRegexes[l];let o=new n;return this.rules.slice(l).forEach(([c,u])=>o.addRule(c,u)),o.compile(),this.multiRegexes[l]=o,o}resumingScanAtSamePosition(){return this.regexIndex!==0}considerAll(){this.regexIndex=0}addRule(l,o){this.rules.push([l,o]),o.type==="begin"&&this.count++}exec(l){let o=this.getMatcher(this.regexIndex);o.lastIndex=this.lastIndex;let c=o.exec(l);if(this.resumingScanAtSamePosition()&&!(c&&c.index===this.lastIndex)){let u=this.getMatcher(0);u.lastIndex=this.lastIndex+1,c=u.exec(l)}return c&&(this.regexIndex+=c.position+1,this.regexIndex===this.count&&this.considerAll()),c}}function s(r){let l=new i;return r.contains.forEach(o=>l.addRule(o.begin,{rule:o,type:"begin"})),r.terminatorEnd&&l.addRule(r.terminatorEnd,{type:"end"}),r.illegal&&l.addRule(r.illegal,{type:"illegal"}),l}function a(r,l){let o=r;if(r.isCompiled)return o;[Rr,Mr,Gr,Dr].forEach(u=>u(r,l)),e.compilerExtensions.forEach(u=>u(r,l)),r.__beforeBegin=null,[Ir,Lr,Or].forEach(u=>u(r,l)),r.isCompiled=!0;let c=null;return typeof r.keywords=="object"&&r.keywords.$pattern&&(r.keywords=Object.assign({},r.keywords),c=r.keywords.$pattern,delete r.keywords.$pattern),c=c||/\\w+/,r.keywords&&(r.keywords=cs(r.keywords,e.case_insensitive)),o.keywordPatternRe=t(c,!0),l&&(r.begin||(r.begin=/\\B|\\b/),o.beginRe=t(o.begin),!r.end&&!r.endsWithParent&&(r.end=/\\B|\\b/),r.end&&(o.endRe=t(o.end)),o.terminatorEnd=qe(o.end)||"",r.endsWithParent&&l.terminatorEnd&&(o.terminatorEnd+=(r.end?"|":"")+l.terminatorEnd)),r.illegal&&(o.illegalRe=t(r.illegal)),r.contains||(r.contains=[]),r.contains=[].concat(...r.contains.map(function(u){return Zr(u==="self"?r:u)})),r.contains.forEach(function(u){a(u,o)}),r.starts&&a(r.starts,l),o.matcher=s(o),o}if(e.compilerExtensions||(e.compilerExtensions=[]),e.contains&&e.contains.includes("self"))throw new Error("ERR: contains \`self\` is not supported at the top-level of a language.  See documentation.");return e.classNameAliases=pe(e.classNameAliases||{}),a(e)}function ds(e){return e?e.endsWithParent||ds(e.starts):!1}function Zr(e){return e.variants&&!e.cachedVariants&&(e.cachedVariants=e.variants.map(function(t){return pe(e,{variants:null},t)})),e.cachedVariants?e.cachedVariants:ds(e)?pe(e,{starts:e.starts?pe(e.starts):null}):Object.isFrozen(e)?pe(e):e}var Kr="11.11.1",Ft=class extends Error{constructor(t,n){super(t),this.name="HTMLInjectionError",this.html=n}},$t=ns,Jn=pe,es=Symbol("nomatch"),Wr=7,ps=function(e){let t=Object.create(null),n=Object.create(null),i=[],s=!0,a="Could not find the language '{}', did you forget to load/include a language module?",r={disableAutodetect:!0,name:"Plain text",contains:[]},l={ignoreUnescapedHTML:!1,throwUnescapedHTML:!1,noHighlightRe:/^(no-?highlight)$/i,languageDetectRe:/\\blang(?:uage)?-([\\w-]+)\\b/i,classPrefix:"hljs-",cssSelector:"pre code",languages:null,__emitter:Ht};function o(g){return l.noHighlightRe.test(g)}function c(g){let k=g.className+" ";k+=g.parentNode?g.parentNode.className:"";let b=l.languageDetectRe.exec(k);if(b){let w=U(b[1]);return w||(Vn(a.replace("{}",b[1])),Vn("Falling back to no-highlight mode for this block.",g)),w?b[1]:"no-highlight"}return k.split(/\\s+/).find(w=>o(w)||U(w))}function u(g,k,b){let w="",S="";typeof k=="object"?(w=g,b=k.ignoreIllegals,S=k.language):(Ce("10.7.0","highlight(lang, code, ...args) has been deprecated."),Ce("10.7.0",\`Please use highlight(code, options) instead.
https://github.com/highlightjs/highlight.js/issues/2277\`),S=g,w=k),b===void 0&&(b=!0);let L={code:w,language:S};de("before:highlight",L);let H=L.result?L.result:d(L.language,L.code,b);return H.code=L.code,de("after:highlight",H),H}function d(g,k,b,w){let S=Object.create(null);function L(h,E){return h.keywords[E]}function H(){if(!x.keywords){B.addText(C);return}let h=0;x.keywordPatternRe.lastIndex=0;let E=x.keywordPatternRe.exec(C),_="";for(;E;){_+=C.substring(h,E.index);let T=ne.case_insensitive?E[0].toLowerCase():E[0],F=L(x,T);if(F){let[oe,ai]=F;if(B.addText(_),_="",S[T]=(S[T]||0)+1,S[T]<=Wr&&(st+=ai),oe.startsWith("_"))_+=E[0];else{let oi=ne.classNameAliases[oe]||oe;te(E[0],oi)}}else _+=E[0];h=x.keywordPatternRe.lastIndex,E=x.keywordPatternRe.exec(C)}_+=C.substring(h),B.addText(_)}function ee(){if(C==="")return;let h=null;if(typeof x.subLanguage=="string"){if(!t[x.subLanguage]){B.addText(C);return}h=d(x.subLanguage,C,!0,Tn[x.subLanguage]),Tn[x.subLanguage]=h._top}else h=m(C,x.subLanguage.length?x.subLanguage:null);x.relevance>0&&(st+=h.relevance),B.__addSublanguage(h._emitter,h.language)}function W(){x.subLanguage!=null?ee():H(),C=""}function te(h,E){h!==""&&(B.startScope(E),B.addText(h),B.endScope())}function _n(h,E){let _=1,T=E.length-1;for(;_<=T;){if(!h._emit[_]){_++;continue}let F=ne.classNameAliases[h[_]]||h[_],oe=E[_];F?te(oe,F):(C=oe,H(),C=""),_++}}function vn(h,E){return h.scope&&typeof h.scope=="string"&&B.openNode(ne.classNameAliases[h.scope]||h.scope),h.beginScope&&(h.beginScope._wrap?(te(C,ne.classNameAliases[h.beginScope._wrap]||h.beginScope._wrap),C=""):h.beginScope._multi&&(_n(h.beginScope,E),C="")),x=Object.create(h,{parent:{value:x}}),x}function Sn(h,E,_){let T=ur(h.endRe,_);if(T){if(h["on:end"]){let F=new dt(h);h["on:end"](E,F),F.isMatchIgnored&&(T=!1)}if(T){for(;h.endsParent&&h.parent;)h=h.parent;return h}}if(h.endsWithParent)return Sn(h.parent,E,_)}function ti(h){return x.matcher.regexIndex===0?(C+=h[0],1):(St=!0,0)}function ni(h){let E=h[0],_=h.rule,T=new dt(_),F=[_.__beforeBegin,_["on:begin"]];for(let oe of F)if(oe&&(oe(h,T),T.isMatchIgnored))return ti(E);return _.skip?C+=E:(_.excludeBegin&&(C+=E),W(),!_.returnBegin&&!_.excludeBegin&&(C=E)),vn(_,h),_.returnBegin?0:E.length}function si(h){let E=h[0],_=k.substring(h.index),T=Sn(x,h,_);if(!T)return es;let F=x;x.endScope&&x.endScope._wrap?(W(),te(E,x.endScope._wrap)):x.endScope&&x.endScope._multi?(W(),_n(x.endScope,h)):F.skip?C+=E:(F.returnEnd||F.excludeEnd||(C+=E),W(),F.excludeEnd&&(C=E));do x.scope&&B.closeNode(),!x.skip&&!x.subLanguage&&(st+=x.relevance),x=x.parent;while(x!==T.parent);return T.starts&&vn(T.starts,h),F.returnEnd?0:E.length}function ii(){let h=[];for(let E=x;E!==ne;E=E.parent)E.scope&&h.unshift(E.scope);h.forEach(E=>B.openNode(E))}let nt={};function An(h,E){let _=E&&E[0];if(C+=h,_==null)return W(),0;if(nt.type==="begin"&&E.type==="end"&&nt.index===E.index&&_===""){if(C+=k.slice(E.index,E.index+1),!s){let T=new Error(\`0 width match regex (\${g})\`);throw T.languageName=g,T.badRule=nt.rule,T}return 1}if(nt=E,E.type==="begin")return ni(E);if(E.type==="illegal"&&!b){let T=new Error('Illegal lexeme "'+_+'" for mode "'+(x.scope||"<unnamed>")+'"');throw T.mode=x,T}else if(E.type==="end"){let T=si(E);if(T!==es)return T}if(E.type==="illegal"&&_==="")return C+=\`
\`,1;if(vt>1e5&&vt>E.index*3)throw new Error("potential infinite loop, way more iterations than matches");return C+=_,_.length}let ne=U(g);if(!ne)throw _e(a.replace("{}",g)),new Error('Unknown language: "'+g+'"');let ri=qr(ne),_t="",x=w||ri,Tn={},B=new l.__emitter(l);ii();let C="",st=0,Ee=0,vt=0,St=!1;try{if(ne.__emitTokens)ne.__emitTokens(k,B);else{for(x.matcher.considerAll();;){vt++,St?St=!1:x.matcher.considerAll(),x.matcher.lastIndex=Ee;let h=x.matcher.exec(k);if(!h)break;let E=k.substring(Ee,h.index),_=An(E,h);Ee=h.index+_}An(k.substring(Ee))}return B.finalize(),_t=B.toHTML(),{language:g,value:_t,relevance:st,illegal:!1,_emitter:B,_top:x}}catch(h){if(h.message&&h.message.includes("Illegal"))return{language:g,value:$t(k),illegal:!0,relevance:0,_illegalBy:{message:h.message,index:Ee,context:k.slice(Ee-100,Ee+100),mode:h.mode,resultSoFar:_t},_emitter:B};if(s)return{language:g,value:$t(k),illegal:!1,relevance:0,errorRaised:h,_emitter:B,_top:x};throw h}}function p(g){let k={value:$t(g),illegal:!1,relevance:0,_top:r,_emitter:new l.__emitter(l)};return k._emitter.addText(g),k}function m(g,k){k=k||l.languages||Object.keys(t);let b=p(g),w=k.filter(U).filter(Te).map(W=>d(W,g,!1));w.unshift(b);let S=w.sort((W,te)=>{if(W.relevance!==te.relevance)return te.relevance-W.relevance;if(W.language&&te.language){if(U(W.language).supersetOf===te.language)return 1;if(U(te.language).supersetOf===W.language)return-1}return 0}),[L,H]=S,ee=L;return ee.secondBest=H,ee}function f(g,k,b){let w=k&&n[k]||b;g.classList.add("hljs"),g.classList.add(\`language-\${w}\`)}function y(g){let k=null,b=c(g);if(o(b))return;if(de("before:highlightElement",{el:g,language:b}),g.dataset.highlighted){console.log("Element previously highlighted. To highlight again, first unset \`dataset.highlighted\`.",g);return}if(g.children.length>0&&(l.ignoreUnescapedHTML||(console.warn("One of your code blocks includes unescaped HTML. This is a potentially serious security risk."),console.warn("https://github.com/highlightjs/highlight.js/wiki/security"),console.warn("The element with unescaped HTML:"),console.warn(g)),l.throwUnescapedHTML))throw new Ft("One of your code blocks includes unescaped HTML.",g.innerHTML);k=g;let w=k.textContent,S=b?u(w,{language:b,ignoreIllegals:!0}):m(w);g.innerHTML=S.value,g.dataset.highlighted="yes",f(g,b,S.language),g.result={language:S.language,re:S.relevance,relevance:S.relevance},S.secondBest&&(g.secondBest={language:S.secondBest.language,relevance:S.secondBest.relevance}),de("after:highlightElement",{el:g,result:S,text:w})}function R(g){l=Jn(l,g)}let M=()=>{z(),Ce("10.6.0","initHighlighting() deprecated.  Use highlightAll() now.")};function O(){z(),Ce("10.6.0","initHighlightingOnLoad() deprecated.  Use highlightAll() now.")}let $=!1;function z(){function g(){z()}if(document.readyState==="loading"){$||window.addEventListener("DOMContentLoaded",g,!1),$=!0;return}document.querySelectorAll(l.cssSelector).forEach(y)}function I(g,k){let b=null;try{b=k(e)}catch(w){if(_e("Language definition for '{}' could not be registered.".replace("{}",g)),s)_e(w);else throw w;b=r}b.name||(b.name=g),t[g]=b,b.rawDefinition=k.bind(null,e),b.aliases&&K(b.aliases,{languageName:g})}function N(g){delete t[g];for(let k of Object.keys(n))n[k]===g&&delete n[k]}function ke(){return Object.keys(t)}function U(g){return g=(g||"").toLowerCase(),t[g]||t[n[g]]}function K(g,{languageName:k}){typeof g=="string"&&(g=[g]),g.forEach(b=>{n[b.toLowerCase()]=k})}function Te(g){let k=U(g);return k&&!k.disableAutodetect}function Be(g){g["before:highlightBlock"]&&!g["before:highlightElement"]&&(g["before:highlightElement"]=k=>{g["before:highlightBlock"](Object.assign({block:k.el},k))}),g["after:highlightBlock"]&&!g["after:highlightElement"]&&(g["after:highlightElement"]=k=>{g["after:highlightBlock"](Object.assign({block:k.el},k))})}function Pe(g){Be(g),i.push(g)}function $e(g){let k=i.indexOf(g);k!==-1&&i.splice(k,1)}function de(g,k){let b=g;i.forEach(function(w){w[b]&&w[b](k)})}function ze(g){return Ce("10.7.0","highlightBlock will be removed entirely in v12.0"),Ce("10.7.0","Please use highlightElement now."),y(g)}Object.assign(e,{highlight:u,highlightAuto:m,highlightAll:z,highlightElement:y,highlightBlock:ze,configure:R,initHighlighting:M,initHighlightingOnLoad:O,registerLanguage:I,unregisterLanguage:N,listLanguages:ke,getLanguage:U,registerAliases:K,autoDetection:Te,inherit:Jn,addPlugin:Pe,removePlugin:$e}),e.debugMode=function(){s=!1},e.safeMode=function(){s=!0},e.versionString=Kr,e.regex={concat:ve,lookahead:ss,either:Gt,optional:lr,anyNumberOfTimes:or};for(let g in ut)typeof ut[g]=="object"&&ts(ut[g]);return Object.assign(e,ut),e},Ne=ps({});Ne.newInstance=()=>ps({});gs.exports=Ne;Ne.HighlightJS=Ne;Ne.default=Ne});var j=null;function Nn(e){function t(){j=new WebSocket("ws://"+location.host),j.onopen=function(){e.onOpen()},j.onclose=function(){j=null,e.onClose(),setTimeout(t,2e3)},j.onmessage=function(n){try{let i=JSON.parse(n.data);e.onMessage(i)}catch{}},j.onerror=function(){}}t()}function X(e){j&&j.readyState===WebSocket.OPEN&&j.send(JSON.stringify(e))}function Rn(){return j!==null&&j.readyState===WebSocket.OPEN}function Nt(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var we=Nt();function Pn(e){we=e}var ye={exec:()=>null};function v(e,t=""){let n=typeof e=="string"?e:e.source,i={replace:(s,a)=>{let r=typeof a=="string"?a:a.source;return r=r.replace(q.caret,"$1"),n=n.replace(s,r),i},getRegex:()=>new RegExp(n,t)};return i}var mi=(()=>{try{return!!new RegExp("(?<=1)(?<!1)")}catch{return!1}})(),q={codeRemoveIndent:/^(?: {1,4}| {0,3}\\t)/gm,outputLinkReplace:/\\\\([\\[\\]])/g,indentCodeCompensation:/^(\\s+)(?:\`\`\`)/,beginningSpace:/^\\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\\n/g,tabCharGlobal:/\\t/g,multipleSpaceGlobal:/\\s+/g,blankLine:/^[ \\t]*$/,doubleBlankLine:/\\n[ \\t]*\\n[ \\t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\\n {0,3}((?:=+|-+) *)(?=\\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \\t]?/gm,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\\[[ xX]\\] +\\S/,listReplaceTask:/^\\[[ xX]\\] +/,listTaskCheckbox:/\\[[ xX]\\]/,anyLine:/\\n.*\\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\\||\\| *$/g,tableRowBlankLine:/\\n[ \\t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\\s|>)/i,endPreScriptTag:/^<\\/(pre|code|kbd|script)(\\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\\s])\\s+(['"])(.*)\\2/,unicodeAlphaNumeric:/[\\p{L}\\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\\w+);)/g,unescapeTest:/&(#(?:\\d+)|(?:#x[0-9A-Fa-f]+)|(?:\\w+));?/ig,caret:/(^|[^\\[])\\^/g,percentDecode:/%25/g,findPipe:/\\|/g,splitPipe:/ \\|/,slashPipe:/\\\\\\|/g,carriageReturn:/\\r\\n|\\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\\S*/,endingNewline:/\\n$/,listItemRegex:e=>new RegExp(\`^( {0,3}\${e})((?:[	 ][^\\\\n]*)?(?:\\\\n|$))\`),nextBulletRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}(?:[*+-]|\\\\d{1,9}[.)])((?:[ 	][^\\\\n]*)?(?:\\\\n|$))\`),hrRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\\\* *){3,})(?:\\\\n+|$)\`),fencesBeginRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}(?:\\\`\\\`\\\`|~~~)\`),headingBeginRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}#\`),htmlBeginRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}<(?:[a-z].*>|!--)\`,"i"),blockquoteBeginRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}>\`)},bi=/^(?:[ \\t]*(?:\\n|$))+/,ki=/^((?: {4}| {0,3}\\t)[^\\n]+(?:\\n(?:[ \\t]*(?:\\n|$))*)?)+/,Ei=/^ {0,3}(\`{3,}(?=[^\`\\n]*(?:\\n|$))|~{3,})([^\\n]*)(?:\\n|$)(?:|([\\s\\S]*?)(?:\\n|$))(?: {0,3}\\1[~\`]* *(?=\\n|$)|$)/,Ge=/^ {0,3}((?:-[\\t ]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)/,yi=/^ {0,3}(#{1,6})(?=\\s|$)(.*)(?:\\n+|$)/,Rt=/ {0,3}(?:[*+-]|\\d{1,9}[.)])/,$n=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\\n(?!\\s*?\\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\\n {0,3}(=+|-+) *(?:\\n+|$)/,zn=v($n).replace(/bull/g,Rt).replace(/blockCode/g,/(?: {4}| {0,3}\\t)/).replace(/fences/g,/ {0,3}(?:\`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\\n>]+>\\n/).replace(/\\|table/g,"").getRegex(),xi=v($n).replace(/bull/g,Rt).replace(/blockCode/g,/(?: {4}| {0,3}\\t)/).replace(/fences/g,/ {0,3}(?:\`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\\n>]+>\\n/).replace(/table/g,/ {0,3}\\|?(?:[:\\- ]*\\|)+[\\:\\- ]*\\n/).getRegex(),It=/^([^\\n]+(?:\\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\\n)[^\\n]+)*)/,wi=/^[^\\n]+/,Lt=/(?!\\s*\\])(?:\\\\[\\s\\S]|[^\\[\\]\\\\])+/,_i=v(/^ {0,3}\\[(label)\\]: *(?:\\n[ \\t]*)?([^<\\s][^\\s]*|<.*?>)(?:(?: +(?:\\n[ \\t]*)?| *\\n[ \\t]*)(title))? *(?:\\n+|$)/).replace("label",Lt).replace("title",/(?:"(?:\\\\"?|[^"\\\\])*"|'[^'\\n]*(?:\\n[^'\\n]+)*\\n?'|\\([^()]*\\))/).getRegex(),vi=v(/^(bull)([ \\t][^\\n]+?)?(?:\\n|$)/).replace(/bull/g,Rt).getRegex(),lt="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",Mt=/<!--(?:-?>|[\\s\\S]*?(?:-->|$))/,Si=v("^ {0,3}(?:<(script|pre|style|textarea)[\\\\s>][\\\\s\\\\S]*?(?:</\\\\1>[^\\\\n]*\\\\n+|$)|comment[^\\\\n]*(\\\\n+|$)|<\\\\?[\\\\s\\\\S]*?(?:\\\\?>\\\\n*|$)|<![A-Z][\\\\s\\\\S]*?(?:>\\\\n*|$)|<!\\\\[CDATA\\\\[[\\\\s\\\\S]*?(?:\\\\]\\\\]>\\\\n*|$)|</?(tag)(?: +|\\\\n|/?>)[\\\\s\\\\S]*?(?:(?:\\\\n[ 	]*)+\\\\n|$)|<(?!script|pre|style|textarea)([a-z][\\\\w-]*)(?:attribute)*? */?>(?=[ \\\\t]*(?:\\\\n|$))[\\\\s\\\\S]*?(?:(?:\\\\n[ 	]*)+\\\\n|$)|</(?!script|pre|style|textarea)[a-z][\\\\w-]*\\\\s*>(?=[ \\\\t]*(?:\\\\n|$))[\\\\s\\\\S]*?(?:(?:\\\\n[ 	]*)+\\\\n|$))","i").replace("comment",Mt).replace("tag",lt).replace("attribute",/ +[a-zA-Z:_][\\w.:-]*(?: *= *"[^"\\n]*"| *= *'[^'\\n]*'| *= *[^\\s"'=<>\`]+)?/).getRegex(),Un=v(It).replace("hr",Ge).replace("heading"," {0,3}#{1,6}(?:\\\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:\`{3,}(?=[^\`\\\\n]*\\\\n)|~{3,})[^\\\\n]*\\\\n").replace("list"," {0,3}(?:[*+-]|1[.)])[ \\\\t]").replace("html","</?(?:tag)(?: +|\\\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",lt).getRegex(),Ai=v(/^( {0,3}> ?(paragraph|[^\\n]*)(?:\\n|$))+/).replace("paragraph",Un).getRegex(),Ot={blockquote:Ai,code:ki,def:_i,fences:Ei,heading:yi,hr:Ge,html:Si,lheading:zn,list:vi,newline:bi,paragraph:Un,table:ye,text:wi},In=v("^ *([^\\\\n ].*)\\\\n {0,3}((?:\\\\| *)?:?-+:? *(?:\\\\| *:?-+:? *)*(?:\\\\| *)?)(?:\\\\n((?:(?! *\\\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\\\n|$))*)\\\\n*|$)").replace("hr",Ge).replace("heading"," {0,3}#{1,6}(?:\\\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\\\n]").replace("fences"," {0,3}(?:\`{3,}(?=[^\`\\\\n]*\\\\n)|~{3,})[^\\\\n]*\\\\n").replace("list"," {0,3}(?:[*+-]|1[.)])[ \\\\t]").replace("html","</?(?:tag)(?: +|\\\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",lt).getRegex(),Ti={...Ot,lheading:xi,table:In,paragraph:v(It).replace("hr",Ge).replace("heading"," {0,3}#{1,6}(?:\\\\s|$)").replace("|lheading","").replace("table",In).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:\`{3,}(?=[^\`\\\\n]*\\\\n)|~{3,})[^\\\\n]*\\\\n").replace("list"," {0,3}(?:[*+-]|1[.)])[ \\\\t]").replace("html","</?(?:tag)(?: +|\\\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",lt).getRegex()},Ci={...Ot,html:v(\`^ *(?:comment *(?:\\\\n|\\\\s*$)|<(tag)[\\\\s\\\\S]+?</\\\\1> *(?:\\\\n{2,}|\\\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\\\s[^'"/>\\\\s]*)*?/?> *(?:\\\\n{2,}|\\\\s*$))\`).replace("comment",Mt).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\\\b)\\\\w+(?!:|[^\\\\w\\\\s@]*@)\\\\b").getRegex(),def:/^ *\\[([^\\]]+)\\]: *<?([^\\s>]+)>?(?: +(["(][^\\n]+[")]))? *(?:\\n+|$)/,heading:/^(#{1,6})(.*)(?:\\n+|$)/,fences:ye,lheading:/^(.+?)\\n {0,3}(=+|-+) *(?:\\n+|$)/,paragraph:v(It).replace("hr",Ge).replace("heading",\` *#{1,6} *[^
]\`).replace("lheading",zn).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},Ni=/^\\\\([!"#$%&'()*+,\\-./:;<=>?@\\[\\]\\\\^_\`{|}~])/,Ri=/^(\`+)([^\`]|[^\`][\\s\\S]*?[^\`])\\1(?!\`)/,Hn=/^( {2,}|\\\\)\\n(?!\\s*$)/,Ii=/^(\`+|[^\`])(?:(?= {2,}\\n)|[\\s\\S]*?(?:(?=[\\\\<!\\[\`*_]|\\b_|$)|[^ ](?= {2,}\\n)))/,ct=/[\\p{P}\\p{S}]/u,Dt=/[\\s\\p{P}\\p{S}]/u,Fn=/[^\\s\\p{P}\\p{S}]/u,Li=v(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,Dt).getRegex(),Gn=/(?!~)[\\p{P}\\p{S}]/u,Mi=/(?!~)[\\s\\p{P}\\p{S}]/u,Oi=/(?:[^\\s\\p{P}\\p{S}]|~)/u,qn=/(?![*_])[\\p{P}\\p{S}]/u,Di=/(?![*_])[\\s\\p{P}\\p{S}]/u,Bi=/(?:[^\\s\\p{P}\\p{S}]|[*_])/u,Pi=v(/link|precode-code|html/,"g").replace("link",/\\[(?:[^\\[\\]\`]|(?<a>\`+)[^\`]+\\k<a>(?!\`))*?\\]\\((?:\\\\[\\s\\S]|[^\\\\\\(\\)]|\\((?:\\\\[\\s\\S]|[^\\\\\\(\\)])*\\))*\\)/).replace("precode-",mi?"(?<!\`)()":"(^^|[^\`])").replace("code",/(?<b>\`+)[^\`]+\\k<b>(?!\`)/).replace("html",/<(?! )[^<>]*?>/).getRegex(),Zn=/^(?:\\*+(?:((?!\\*)punct)|[^\\s*]))|^_+(?:((?!_)punct)|([^\\s_]))/,$i=v(Zn,"u").replace(/punct/g,ct).getRegex(),zi=v(Zn,"u").replace(/punct/g,Gn).getRegex(),Kn="^[^_*]*?__[^_*]*?\\\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\\\*)punct(\\\\*+)(?=[\\\\s]|$)|notPunctSpace(\\\\*+)(?!\\\\*)(?=punctSpace|$)|(?!\\\\*)punctSpace(\\\\*+)(?=notPunctSpace)|[\\\\s](\\\\*+)(?!\\\\*)(?=punct)|(?!\\\\*)punct(\\\\*+)(?!\\\\*)(?=punct)|notPunctSpace(\\\\*+)(?=notPunctSpace)",Ui=v(Kn,"gu").replace(/notPunctSpace/g,Fn).replace(/punctSpace/g,Dt).replace(/punct/g,ct).getRegex(),Hi=v(Kn,"gu").replace(/notPunctSpace/g,Oi).replace(/punctSpace/g,Mi).replace(/punct/g,Gn).getRegex(),Fi=v("^[^_*]*?\\\\*\\\\*[^_*]*?_[^_*]*?(?=\\\\*\\\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,Fn).replace(/punctSpace/g,Dt).replace(/punct/g,ct).getRegex(),Gi=v(/^~~?(?:((?!~)punct)|[^\\s~])/,"u").replace(/punct/g,qn).getRegex(),qi="^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)",Zi=v(qi,"gu").replace(/notPunctSpace/g,Bi).replace(/punctSpace/g,Di).replace(/punct/g,qn).getRegex(),Ki=v(/\\\\(punct)/,"gu").replace(/punct/g,ct).getRegex(),Wi=v(/^<(scheme:[^\\s\\x00-\\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_\`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),ji=v(Mt).replace("(?:-->|$)","-->").getRegex(),Xi=v("^comment|^</[a-zA-Z][\\\\w:-]*\\\\s*>|^<[a-zA-Z][\\\\w-]*(?:attribute)*?\\\\s*/?>|^<\\\\?[\\\\s\\\\S]*?\\\\?>|^<![a-zA-Z]+\\\\s[\\\\s\\\\S]*?>|^<!\\\\[CDATA\\\\[[\\\\s\\\\S]*?\\\\]\\\\]>").replace("comment",ji).replace("attribute",/\\s+[a-zA-Z:_][\\w.:-]*(?:\\s*=\\s*"[^"]*"|\\s*=\\s*'[^']*'|\\s*=\\s*[^\\s"'=<>\`]+)?/).getRegex(),rt=/(?:\\[(?:\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]|\\\\[\\s\\S]|\`+[^\`]*?\`+(?!\`)|[^\\[\\]\\\\\`])*?/,Yi=v(/^!?\\[(label)\\]\\(\\s*(href)(?:(?:[ \\t]*(?:\\n[ \\t]*)?)(title))?\\s*\\)/).replace("label",rt).replace("href",/<(?:\\\\.|[^\\n<>\\\\])+>|[^ \\t\\n\\x00-\\x1f]*/).replace("title",/"(?:\\\\"?|[^"\\\\])*"|'(?:\\\\'?|[^'\\\\])*'|\\((?:\\\\\\)?|[^)\\\\])*\\)/).getRegex(),Wn=v(/^!?\\[(label)\\]\\[(ref)\\]/).replace("label",rt).replace("ref",Lt).getRegex(),jn=v(/^!?\\[(ref)\\](?:\\[\\])?/).replace("ref",Lt).getRegex(),Qi=v("reflink|nolink(?!\\\\()","g").replace("reflink",Wn).replace("nolink",jn).getRegex(),Ln=/[hH][tT][tT][pP][sS]?|[fF][tT][pP]/,Bt={_backpedal:ye,anyPunctuation:Ki,autolink:Wi,blockSkip:Pi,br:Hn,code:Ri,del:ye,delLDelim:ye,delRDelim:ye,emStrongLDelim:$i,emStrongRDelimAst:Ui,emStrongRDelimUnd:Fi,escape:Ni,link:Yi,nolink:jn,punctuation:Li,reflink:Wn,reflinkSearch:Qi,tag:Xi,text:Ii,url:ye},Vi={...Bt,link:v(/^!?\\[(label)\\]\\((.*?)\\)/).replace("label",rt).getRegex(),reflink:v(/^!?\\[(label)\\]\\s*\\[([^\\]]*)\\]/).replace("label",rt).getRegex()},At={...Bt,emStrongRDelimAst:Hi,emStrongLDelim:zi,delLDelim:Gi,delRDelim:Zi,url:v(/^((?:protocol):\\/\\/|www\\.)(?:[a-zA-Z0-9\\-]+\\.?)+[^\\s<]*|^email/).replace("protocol",Ln).replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\\([^)]*\\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\\s~])((?:\\\\[\\s\\S]|[^\\\\])*?(?:\\\\[\\s\\S]|[^\\s~\\\\]))\\1(?=[^~]|$)/,text:v(/^([\`~]+|[^\`~])(?:(?= {2,}\\n)|(?=[a-zA-Z0-9.!#$%&'*+\\/=?_\`{\\|}~-]+@)|[\\s\\S]*?(?:(?=[\\\\<!\\[\`*~_]|\\b_|protocol:\\/\\/|www\\.|$)|[^ ](?= {2,}\\n)|[^a-zA-Z0-9.!#$%&'*+\\/=?_\`{\\|}~-](?=[a-zA-Z0-9.!#$%&'*+\\/=?_\`{\\|}~-]+@)))/).replace("protocol",Ln).getRegex()},Ji={...At,br:v(Hn).replace("{2,}","*").getRegex(),text:v(At.text).replace("\\\\b_","\\\\b_| {2,}\\\\n").replace(/\\{2,\\}/g,"*").getRegex()},it={normal:Ot,gfm:Ti,pedantic:Ci},Ue={normal:Bt,gfm:At,breaks:Ji,pedantic:Vi},er={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},Mn=e=>er[e];function se(e,t){if(t){if(q.escapeTest.test(e))return e.replace(q.escapeReplace,Mn)}else if(q.escapeTestNoEncode.test(e))return e.replace(q.escapeReplaceNoEncode,Mn);return e}function On(e){try{e=encodeURI(e).replace(q.percentDecode,"%")}catch{return null}return e}function Dn(e,t){let n=e.replace(q.findPipe,(a,r,l)=>{let o=!1,c=r;for(;--c>=0&&l[c]==="\\\\";)o=!o;return o?"|":" |"}),i=n.split(q.splitPipe),s=0;if(i[0].trim()||i.shift(),i.length>0&&!i.at(-1)?.trim()&&i.pop(),t)if(i.length>t)i.splice(t);else for(;i.length<t;)i.push("");for(;s<i.length;s++)i[s]=i[s].trim().replace(q.slashPipe,"|");return i}function He(e,t,n){let i=e.length;if(i===0)return"";let s=0;for(;s<i;){let a=e.charAt(i-s-1);if(a===t&&!n)s++;else if(a!==t&&n)s++;else break}return e.slice(0,i-s)}function tr(e,t){if(e.indexOf(t[1])===-1)return-1;let n=0;for(let i=0;i<e.length;i++)if(e[i]==="\\\\")i++;else if(e[i]===t[0])n++;else if(e[i]===t[1]&&(n--,n<0))return i;return n>0?-2:-1}function nr(e,t=0){let n=t,i="";for(let s of e)if(s==="	"){let a=4-n%4;i+=" ".repeat(a),n+=a}else i+=s,n++;return i}function Bn(e,t,n,i,s){let a=t.href,r=t.title||null,l=e[1].replace(s.other.outputLinkReplace,"$1");i.state.inLink=!0;let o={type:e[0].charAt(0)==="!"?"image":"link",raw:n,href:a,title:r,text:l,tokens:i.inlineTokens(l)};return i.state.inLink=!1,o}function sr(e,t,n){let i=e.match(n.other.indentCodeCompensation);if(i===null)return t;let s=i[1];return t.split(\`
\`).map(a=>{let r=a.match(n.other.beginningSpace);if(r===null)return a;let[l]=r;return l.length>=s.length?a.slice(s.length):a}).join(\`
\`)}var at=class{options;rules;lexer;constructor(e){this.options=e||we}space(e){let t=this.rules.block.newline.exec(e);if(t&&t[0].length>0)return{type:"space",raw:t[0]}}code(e){let t=this.rules.block.code.exec(e);if(t){let n=t[0].replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:t[0],codeBlockStyle:"indented",text:this.options.pedantic?n:He(n,\`
\`)}}}fences(e){let t=this.rules.block.fences.exec(e);if(t){let n=t[0],i=sr(n,t[3]||"",this.rules);return{type:"code",raw:n,lang:t[2]?t[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):t[2],text:i}}}heading(e){let t=this.rules.block.heading.exec(e);if(t){let n=t[2].trim();if(this.rules.other.endingHash.test(n)){let i=He(n,"#");(this.options.pedantic||!i||this.rules.other.endingSpaceChar.test(i))&&(n=i.trim())}return{type:"heading",raw:t[0],depth:t[1].length,text:n,tokens:this.lexer.inline(n)}}}hr(e){let t=this.rules.block.hr.exec(e);if(t)return{type:"hr",raw:He(t[0],\`
\`)}}blockquote(e){let t=this.rules.block.blockquote.exec(e);if(t){let n=He(t[0],\`
\`).split(\`
\`),i="",s="",a=[];for(;n.length>0;){let r=!1,l=[],o;for(o=0;o<n.length;o++)if(this.rules.other.blockquoteStart.test(n[o]))l.push(n[o]),r=!0;else if(!r)l.push(n[o]);else break;n=n.slice(o);let c=l.join(\`
\`),u=c.replace(this.rules.other.blockquoteSetextReplace,\`
    $1\`).replace(this.rules.other.blockquoteSetextReplace2,"");i=i?\`\${i}
\${c}\`:c,s=s?\`\${s}
\${u}\`:u;let d=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(u,a,!0),this.lexer.state.top=d,n.length===0)break;let p=a.at(-1);if(p?.type==="code")break;if(p?.type==="blockquote"){let m=p,f=m.raw+\`
\`+n.join(\`
\`),y=this.blockquote(f);a[a.length-1]=y,i=i.substring(0,i.length-m.raw.length)+y.raw,s=s.substring(0,s.length-m.text.length)+y.text;break}else if(p?.type==="list"){let m=p,f=m.raw+\`
\`+n.join(\`
\`),y=this.list(f);a[a.length-1]=y,i=i.substring(0,i.length-p.raw.length)+y.raw,s=s.substring(0,s.length-m.raw.length)+y.raw,n=f.substring(a.at(-1).raw.length).split(\`
\`);continue}}return{type:"blockquote",raw:i,tokens:a,text:s}}}list(e){let t=this.rules.block.list.exec(e);if(t){let n=t[1].trim(),i=n.length>1,s={type:"list",raw:"",ordered:i,start:i?+n.slice(0,-1):"",loose:!1,items:[]};n=i?\`\\\\d{1,9}\\\\\${n.slice(-1)}\`:\`\\\\\${n}\`,this.options.pedantic&&(n=i?n:"[*+-]");let a=this.rules.other.listItemRegex(n),r=!1;for(;e;){let o=!1,c="",u="";if(!(t=a.exec(e))||this.rules.block.hr.test(e))break;c=t[0],e=e.substring(c.length);let d=nr(t[2].split(\`
\`,1)[0],t[1].length),p=e.split(\`
\`,1)[0],m=!d.trim(),f=0;if(this.options.pedantic?(f=2,u=d.trimStart()):m?f=t[1].length+1:(f=d.search(this.rules.other.nonSpaceChar),f=f>4?1:f,u=d.slice(f),f+=t[1].length),m&&this.rules.other.blankLine.test(p)&&(c+=p+\`
\`,e=e.substring(p.length+1),o=!0),!o){let y=this.rules.other.nextBulletRegex(f),R=this.rules.other.hrRegex(f),M=this.rules.other.fencesBeginRegex(f),O=this.rules.other.headingBeginRegex(f),$=this.rules.other.htmlBeginRegex(f),z=this.rules.other.blockquoteBeginRegex(f);for(;e;){let I=e.split(\`
\`,1)[0],N;if(p=I,this.options.pedantic?(p=p.replace(this.rules.other.listReplaceNesting,"  "),N=p):N=p.replace(this.rules.other.tabCharGlobal,"    "),M.test(p)||O.test(p)||$.test(p)||z.test(p)||y.test(p)||R.test(p))break;if(N.search(this.rules.other.nonSpaceChar)>=f||!p.trim())u+=\`
\`+N.slice(f);else{if(m||d.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||M.test(d)||O.test(d)||R.test(d))break;u+=\`
\`+p}m=!p.trim(),c+=I+\`
\`,e=e.substring(I.length+1),d=N.slice(f)}}s.loose||(r?s.loose=!0:this.rules.other.doubleBlankLine.test(c)&&(r=!0)),s.items.push({type:"list_item",raw:c,task:!!this.options.gfm&&this.rules.other.listIsTask.test(u),loose:!1,text:u,tokens:[]}),s.raw+=c}let l=s.items.at(-1);if(l)l.raw=l.raw.trimEnd(),l.text=l.text.trimEnd();else return;s.raw=s.raw.trimEnd();for(let o of s.items){if(this.lexer.state.top=!1,o.tokens=this.lexer.blockTokens(o.text,[]),o.task){if(o.text=o.text.replace(this.rules.other.listReplaceTask,""),o.tokens[0]?.type==="text"||o.tokens[0]?.type==="paragraph"){o.tokens[0].raw=o.tokens[0].raw.replace(this.rules.other.listReplaceTask,""),o.tokens[0].text=o.tokens[0].text.replace(this.rules.other.listReplaceTask,"");for(let u=this.lexer.inlineQueue.length-1;u>=0;u--)if(this.rules.other.listIsTask.test(this.lexer.inlineQueue[u].src)){this.lexer.inlineQueue[u].src=this.lexer.inlineQueue[u].src.replace(this.rules.other.listReplaceTask,"");break}}let c=this.rules.other.listTaskCheckbox.exec(o.raw);if(c){let u={type:"checkbox",raw:c[0]+" ",checked:c[0]!=="[ ]"};o.checked=u.checked,s.loose?o.tokens[0]&&["paragraph","text"].includes(o.tokens[0].type)&&"tokens"in o.tokens[0]&&o.tokens[0].tokens?(o.tokens[0].raw=u.raw+o.tokens[0].raw,o.tokens[0].text=u.raw+o.tokens[0].text,o.tokens[0].tokens.unshift(u)):o.tokens.unshift({type:"paragraph",raw:u.raw,text:u.raw,tokens:[u]}):o.tokens.unshift(u)}}if(!s.loose){let c=o.tokens.filter(d=>d.type==="space"),u=c.length>0&&c.some(d=>this.rules.other.anyLine.test(d.raw));s.loose=u}}if(s.loose)for(let o of s.items){o.loose=!0;for(let c of o.tokens)c.type==="text"&&(c.type="paragraph")}return s}}html(e){let t=this.rules.block.html.exec(e);if(t)return{type:"html",block:!0,raw:t[0],pre:t[1]==="pre"||t[1]==="script"||t[1]==="style",text:t[0]}}def(e){let t=this.rules.block.def.exec(e);if(t){let n=t[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),i=t[2]?t[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",s=t[3]?t[3].substring(1,t[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):t[3];return{type:"def",tag:n,raw:t[0],href:i,title:s}}}table(e){let t=this.rules.block.table.exec(e);if(!t||!this.rules.other.tableDelimiter.test(t[2]))return;let n=Dn(t[1]),i=t[2].replace(this.rules.other.tableAlignChars,"").split("|"),s=t[3]?.trim()?t[3].replace(this.rules.other.tableRowBlankLine,"").split(\`
\`):[],a={type:"table",raw:t[0],header:[],align:[],rows:[]};if(n.length===i.length){for(let r of i)this.rules.other.tableAlignRight.test(r)?a.align.push("right"):this.rules.other.tableAlignCenter.test(r)?a.align.push("center"):this.rules.other.tableAlignLeft.test(r)?a.align.push("left"):a.align.push(null);for(let r=0;r<n.length;r++)a.header.push({text:n[r],tokens:this.lexer.inline(n[r]),header:!0,align:a.align[r]});for(let r of s)a.rows.push(Dn(r,a.header.length).map((l,o)=>({text:l,tokens:this.lexer.inline(l),header:!1,align:a.align[o]})));return a}}lheading(e){let t=this.rules.block.lheading.exec(e);if(t)return{type:"heading",raw:t[0],depth:t[2].charAt(0)==="="?1:2,text:t[1],tokens:this.lexer.inline(t[1])}}paragraph(e){let t=this.rules.block.paragraph.exec(e);if(t){let n=t[1].charAt(t[1].length-1)===\`
\`?t[1].slice(0,-1):t[1];return{type:"paragraph",raw:t[0],text:n,tokens:this.lexer.inline(n)}}}text(e){let t=this.rules.block.text.exec(e);if(t)return{type:"text",raw:t[0],text:t[0],tokens:this.lexer.inline(t[0])}}escape(e){let t=this.rules.inline.escape.exec(e);if(t)return{type:"escape",raw:t[0],text:t[1]}}tag(e){let t=this.rules.inline.tag.exec(e);if(t)return!this.lexer.state.inLink&&this.rules.other.startATag.test(t[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(t[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(t[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(t[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:t[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:t[0]}}link(e){let t=this.rules.inline.link.exec(e);if(t){let n=t[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(n)){if(!this.rules.other.endAngleBracket.test(n))return;let a=He(n.slice(0,-1),"\\\\");if((n.length-a.length)%2===0)return}else{let a=tr(t[2],"()");if(a===-2)return;if(a>-1){let r=(t[0].indexOf("!")===0?5:4)+t[1].length+a;t[2]=t[2].substring(0,a),t[0]=t[0].substring(0,r).trim(),t[3]=""}}let i=t[2],s="";if(this.options.pedantic){let a=this.rules.other.pedanticHrefTitle.exec(i);a&&(i=a[1],s=a[3])}else s=t[3]?t[3].slice(1,-1):"";return i=i.trim(),this.rules.other.startAngleBracket.test(i)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(n)?i=i.slice(1):i=i.slice(1,-1)),Bn(t,{href:i&&i.replace(this.rules.inline.anyPunctuation,"$1"),title:s&&s.replace(this.rules.inline.anyPunctuation,"$1")},t[0],this.lexer,this.rules)}}reflink(e,t){let n;if((n=this.rules.inline.reflink.exec(e))||(n=this.rules.inline.nolink.exec(e))){let i=(n[2]||n[1]).replace(this.rules.other.multipleSpaceGlobal," "),s=t[i.toLowerCase()];if(!s){let a=n[0].charAt(0);return{type:"text",raw:a,text:a}}return Bn(n,s,n[0],this.lexer,this.rules)}}emStrong(e,t,n=""){let i=this.rules.inline.emStrongLDelim.exec(e);if(!(!i||i[3]&&n.match(this.rules.other.unicodeAlphaNumeric))&&(!(i[1]||i[2])||!n||this.rules.inline.punctuation.exec(n))){let s=[...i[0]].length-1,a,r,l=s,o=0,c=i[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(c.lastIndex=0,t=t.slice(-1*e.length+s);(i=c.exec(t))!=null;){if(a=i[1]||i[2]||i[3]||i[4]||i[5]||i[6],!a)continue;if(r=[...a].length,i[3]||i[4]){l+=r;continue}else if((i[5]||i[6])&&s%3&&!((s+r)%3)){o+=r;continue}if(l-=r,l>0)continue;r=Math.min(r,r+l+o);let u=[...i[0]][0].length,d=e.slice(0,s+i.index+u+r);if(Math.min(s,r)%2){let m=d.slice(1,-1);return{type:"em",raw:d,text:m,tokens:this.lexer.inlineTokens(m)}}let p=d.slice(2,-2);return{type:"strong",raw:d,text:p,tokens:this.lexer.inlineTokens(p)}}}}codespan(e){let t=this.rules.inline.code.exec(e);if(t){let n=t[2].replace(this.rules.other.newLineCharGlobal," "),i=this.rules.other.nonSpaceChar.test(n),s=this.rules.other.startingSpaceChar.test(n)&&this.rules.other.endingSpaceChar.test(n);return i&&s&&(n=n.substring(1,n.length-1)),{type:"codespan",raw:t[0],text:n}}}br(e){let t=this.rules.inline.br.exec(e);if(t)return{type:"br",raw:t[0]}}del(e,t,n=""){let i=this.rules.inline.delLDelim.exec(e);if(i&&(!i[1]||!n||this.rules.inline.punctuation.exec(n))){let s=[...i[0]].length-1,a,r,l=s,o=this.rules.inline.delRDelim;for(o.lastIndex=0,t=t.slice(-1*e.length+s);(i=o.exec(t))!=null;){if(a=i[1]||i[2]||i[3]||i[4]||i[5]||i[6],!a||(r=[...a].length,r!==s))continue;if(i[3]||i[4]){l+=r;continue}if(l-=r,l>0)continue;r=Math.min(r,r+l);let c=[...i[0]][0].length,u=e.slice(0,s+i.index+c+r),d=u.slice(s,-s);return{type:"del",raw:u,text:d,tokens:this.lexer.inlineTokens(d)}}}}autolink(e){let t=this.rules.inline.autolink.exec(e);if(t){let n,i;return t[2]==="@"?(n=t[1],i="mailto:"+n):(n=t[1],i=n),{type:"link",raw:t[0],text:n,href:i,tokens:[{type:"text",raw:n,text:n}]}}}url(e){let t;if(t=this.rules.inline.url.exec(e)){let n,i;if(t[2]==="@")n=t[0],i="mailto:"+n;else{let s;do s=t[0],t[0]=this.rules.inline._backpedal.exec(t[0])?.[0]??"";while(s!==t[0]);n=t[0],t[1]==="www."?i="http://"+t[0]:i=t[0]}return{type:"link",raw:t[0],text:n,href:i,tokens:[{type:"text",raw:n,text:n}]}}}inlineText(e){let t=this.rules.inline.text.exec(e);if(t){let n=this.lexer.state.inRawBlock;return{type:"text",raw:t[0],text:t[0],escaped:n}}}},Y=class Tt{tokens;options;state;inlineQueue;tokenizer;constructor(t){this.tokens=[],this.tokens.links=Object.create(null),this.options=t||we,this.options.tokenizer=this.options.tokenizer||new at,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};let n={other:q,block:it.normal,inline:Ue.normal};this.options.pedantic?(n.block=it.pedantic,n.inline=Ue.pedantic):this.options.gfm&&(n.block=it.gfm,this.options.breaks?n.inline=Ue.breaks:n.inline=Ue.gfm),this.tokenizer.rules=n}static get rules(){return{block:it,inline:Ue}}static lex(t,n){return new Tt(n).lex(t)}static lexInline(t,n){return new Tt(n).inlineTokens(t)}lex(t){t=t.replace(q.carriageReturn,\`
\`),this.blockTokens(t,this.tokens);for(let n=0;n<this.inlineQueue.length;n++){let i=this.inlineQueue[n];this.inlineTokens(i.src,i.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(t,n=[],i=!1){for(this.options.pedantic&&(t=t.replace(q.tabCharGlobal,"    ").replace(q.spaceLine,""));t;){let s;if(this.options.extensions?.block?.some(r=>(s=r.call({lexer:this},t,n))?(t=t.substring(s.raw.length),n.push(s),!0):!1))continue;if(s=this.tokenizer.space(t)){t=t.substring(s.raw.length);let r=n.at(-1);s.raw.length===1&&r!==void 0?r.raw+=\`
\`:n.push(s);continue}if(s=this.tokenizer.code(t)){t=t.substring(s.raw.length);let r=n.at(-1);r?.type==="paragraph"||r?.type==="text"?(r.raw+=(r.raw.endsWith(\`
\`)?"":\`
\`)+s.raw,r.text+=\`
\`+s.text,this.inlineQueue.at(-1).src=r.text):n.push(s);continue}if(s=this.tokenizer.fences(t)){t=t.substring(s.raw.length),n.push(s);continue}if(s=this.tokenizer.heading(t)){t=t.substring(s.raw.length),n.push(s);continue}if(s=this.tokenizer.hr(t)){t=t.substring(s.raw.length),n.push(s);continue}if(s=this.tokenizer.blockquote(t)){t=t.substring(s.raw.length),n.push(s);continue}if(s=this.tokenizer.list(t)){t=t.substring(s.raw.length),n.push(s);continue}if(s=this.tokenizer.html(t)){t=t.substring(s.raw.length),n.push(s);continue}if(s=this.tokenizer.def(t)){t=t.substring(s.raw.length);let r=n.at(-1);r?.type==="paragraph"||r?.type==="text"?(r.raw+=(r.raw.endsWith(\`
\`)?"":\`
\`)+s.raw,r.text+=\`
\`+s.raw,this.inlineQueue.at(-1).src=r.text):this.tokens.links[s.tag]||(this.tokens.links[s.tag]={href:s.href,title:s.title},n.push(s));continue}if(s=this.tokenizer.table(t)){t=t.substring(s.raw.length),n.push(s);continue}if(s=this.tokenizer.lheading(t)){t=t.substring(s.raw.length),n.push(s);continue}let a=t;if(this.options.extensions?.startBlock){let r=1/0,l=t.slice(1),o;this.options.extensions.startBlock.forEach(c=>{o=c.call({lexer:this},l),typeof o=="number"&&o>=0&&(r=Math.min(r,o))}),r<1/0&&r>=0&&(a=t.substring(0,r+1))}if(this.state.top&&(s=this.tokenizer.paragraph(a))){let r=n.at(-1);i&&r?.type==="paragraph"?(r.raw+=(r.raw.endsWith(\`
\`)?"":\`
\`)+s.raw,r.text+=\`
\`+s.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=r.text):n.push(s),i=a.length!==t.length,t=t.substring(s.raw.length);continue}if(s=this.tokenizer.text(t)){t=t.substring(s.raw.length);let r=n.at(-1);r?.type==="text"?(r.raw+=(r.raw.endsWith(\`
\`)?"":\`
\`)+s.raw,r.text+=\`
\`+s.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=r.text):n.push(s);continue}if(t){let r="Infinite loop on byte: "+t.charCodeAt(0);if(this.options.silent){console.error(r);break}else throw new Error(r)}}return this.state.top=!0,n}inline(t,n=[]){return this.inlineQueue.push({src:t,tokens:n}),n}inlineTokens(t,n=[]){let i=t,s=null;if(this.tokens.links){let o=Object.keys(this.tokens.links);if(o.length>0)for(;(s=this.tokenizer.rules.inline.reflinkSearch.exec(i))!=null;)o.includes(s[0].slice(s[0].lastIndexOf("[")+1,-1))&&(i=i.slice(0,s.index)+"["+"a".repeat(s[0].length-2)+"]"+i.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(s=this.tokenizer.rules.inline.anyPunctuation.exec(i))!=null;)i=i.slice(0,s.index)+"++"+i.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);let a;for(;(s=this.tokenizer.rules.inline.blockSkip.exec(i))!=null;)a=s[2]?s[2].length:0,i=i.slice(0,s.index+a)+"["+"a".repeat(s[0].length-a-2)+"]"+i.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);i=this.options.hooks?.emStrongMask?.call({lexer:this},i)??i;let r=!1,l="";for(;t;){r||(l=""),r=!1;let o;if(this.options.extensions?.inline?.some(u=>(o=u.call({lexer:this},t,n))?(t=t.substring(o.raw.length),n.push(o),!0):!1))continue;if(o=this.tokenizer.escape(t)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.tag(t)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.link(t)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.reflink(t,this.tokens.links)){t=t.substring(o.raw.length);let u=n.at(-1);o.type==="text"&&u?.type==="text"?(u.raw+=o.raw,u.text+=o.text):n.push(o);continue}if(o=this.tokenizer.emStrong(t,i,l)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.codespan(t)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.br(t)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.del(t,i,l)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.autolink(t)){t=t.substring(o.raw.length),n.push(o);continue}if(!this.state.inLink&&(o=this.tokenizer.url(t))){t=t.substring(o.raw.length),n.push(o);continue}let c=t;if(this.options.extensions?.startInline){let u=1/0,d=t.slice(1),p;this.options.extensions.startInline.forEach(m=>{p=m.call({lexer:this},d),typeof p=="number"&&p>=0&&(u=Math.min(u,p))}),u<1/0&&u>=0&&(c=t.substring(0,u+1))}if(o=this.tokenizer.inlineText(c)){t=t.substring(o.raw.length),o.raw.slice(-1)!=="_"&&(l=o.raw.slice(-1)),r=!0;let u=n.at(-1);u?.type==="text"?(u.raw+=o.raw,u.text+=o.text):n.push(o);continue}if(t){let u="Infinite loop on byte: "+t.charCodeAt(0);if(this.options.silent){console.error(u);break}else throw new Error(u)}}return n}},ot=class{options;parser;constructor(e){this.options=e||we}space(e){return""}code({text:e,lang:t,escaped:n}){let i=(t||"").match(q.notSpaceStart)?.[0],s=e.replace(q.endingNewline,"")+\`
\`;return i?'<pre><code class="language-'+se(i)+'">'+(n?s:se(s,!0))+\`</code></pre>
\`:"<pre><code>"+(n?s:se(s,!0))+\`</code></pre>
\`}blockquote({tokens:e}){return\`<blockquote>
\${this.parser.parse(e)}</blockquote>
\`}html({text:e}){return e}def(e){return""}heading({tokens:e,depth:t}){return\`<h\${t}>\${this.parser.parseInline(e)}</h\${t}>
\`}hr(e){return\`<hr>
\`}list(e){let t=e.ordered,n=e.start,i="";for(let r=0;r<e.items.length;r++){let l=e.items[r];i+=this.listitem(l)}let s=t?"ol":"ul",a=t&&n!==1?' start="'+n+'"':"";return"<"+s+a+\`>
\`+i+"</"+s+\`>
\`}listitem(e){return\`<li>\${this.parser.parse(e.tokens)}</li>
\`}checkbox({checked:e}){return"<input "+(e?'checked="" ':"")+'disabled="" type="checkbox"> '}paragraph({tokens:e}){return\`<p>\${this.parser.parseInline(e)}</p>
\`}table(e){let t="",n="";for(let s=0;s<e.header.length;s++)n+=this.tablecell(e.header[s]);t+=this.tablerow({text:n});let i="";for(let s=0;s<e.rows.length;s++){let a=e.rows[s];n="";for(let r=0;r<a.length;r++)n+=this.tablecell(a[r]);i+=this.tablerow({text:n})}return i&&(i=\`<tbody>\${i}</tbody>\`),\`<table>
<thead>
\`+t+\`</thead>
\`+i+\`</table>
\`}tablerow({text:e}){return\`<tr>
\${e}</tr>
\`}tablecell(e){let t=this.parser.parseInline(e.tokens),n=e.header?"th":"td";return(e.align?\`<\${n} align="\${e.align}">\`:\`<\${n}>\`)+t+\`</\${n}>
\`}strong({tokens:e}){return\`<strong>\${this.parser.parseInline(e)}</strong>\`}em({tokens:e}){return\`<em>\${this.parser.parseInline(e)}</em>\`}codespan({text:e}){return\`<code>\${se(e,!0)}</code>\`}br(e){return"<br>"}del({tokens:e}){return\`<del>\${this.parser.parseInline(e)}</del>\`}link({href:e,title:t,tokens:n}){let i=this.parser.parseInline(n),s=On(e);if(s===null)return i;e=s;let a='<a href="'+e+'"';return t&&(a+=' title="'+se(t)+'"'),a+=">"+i+"</a>",a}image({href:e,title:t,text:n,tokens:i}){i&&(n=this.parser.parseInline(i,this.parser.textRenderer));let s=On(e);if(s===null)return se(n);e=s;let a=\`<img src="\${e}" alt="\${se(n)}"\`;return t&&(a+=\` title="\${se(t)}"\`),a+=">",a}text(e){return"tokens"in e&&e.tokens?this.parser.parseInline(e.tokens):"escaped"in e&&e.escaped?e.text:se(e.text)}},Pt=class{strong({text:e}){return e}em({text:e}){return e}codespan({text:e}){return e}del({text:e}){return e}html({text:e}){return e}text({text:e}){return e}link({text:e}){return""+e}image({text:e}){return""+e}br(){return""}checkbox({raw:e}){return e}},Q=class Ct{options;renderer;textRenderer;constructor(t){this.options=t||we,this.options.renderer=this.options.renderer||new ot,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new Pt}static parse(t,n){return new Ct(n).parse(t)}static parseInline(t,n){return new Ct(n).parseInline(t)}parse(t){let n="";for(let i=0;i<t.length;i++){let s=t[i];if(this.options.extensions?.renderers?.[s.type]){let r=s,l=this.options.extensions.renderers[r.type].call({parser:this},r);if(l!==!1||!["space","hr","heading","code","table","blockquote","list","html","def","paragraph","text"].includes(r.type)){n+=l||"";continue}}let a=s;switch(a.type){case"space":{n+=this.renderer.space(a);break}case"hr":{n+=this.renderer.hr(a);break}case"heading":{n+=this.renderer.heading(a);break}case"code":{n+=this.renderer.code(a);break}case"table":{n+=this.renderer.table(a);break}case"blockquote":{n+=this.renderer.blockquote(a);break}case"list":{n+=this.renderer.list(a);break}case"checkbox":{n+=this.renderer.checkbox(a);break}case"html":{n+=this.renderer.html(a);break}case"def":{n+=this.renderer.def(a);break}case"paragraph":{n+=this.renderer.paragraph(a);break}case"text":{n+=this.renderer.text(a);break}default:{let r='Token with "'+a.type+'" type was not found.';if(this.options.silent)return console.error(r),"";throw new Error(r)}}}return n}parseInline(t,n=this.renderer){let i="";for(let s=0;s<t.length;s++){let a=t[s];if(this.options.extensions?.renderers?.[a.type]){let l=this.options.extensions.renderers[a.type].call({parser:this},a);if(l!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(a.type)){i+=l||"";continue}}let r=a;switch(r.type){case"escape":{i+=n.text(r);break}case"html":{i+=n.html(r);break}case"link":{i+=n.link(r);break}case"image":{i+=n.image(r);break}case"checkbox":{i+=n.checkbox(r);break}case"strong":{i+=n.strong(r);break}case"em":{i+=n.em(r);break}case"codespan":{i+=n.codespan(r);break}case"br":{i+=n.br(r);break}case"del":{i+=n.del(r);break}case"text":{i+=n.text(r);break}default:{let l='Token with "'+r.type+'" type was not found.';if(this.options.silent)return console.error(l),"";throw new Error(l)}}}return i}},Fe=class{options;block;constructor(e){this.options=e||we}static passThroughHooks=new Set(["preprocess","postprocess","processAllTokens","emStrongMask"]);static passThroughHooksRespectAsync=new Set(["preprocess","postprocess","processAllTokens"]);preprocess(e){return e}postprocess(e){return e}processAllTokens(e){return e}emStrongMask(e){return e}provideLexer(){return this.block?Y.lex:Y.lexInline}provideParser(){return this.block?Q.parse:Q.parseInline}},ir=class{defaults=Nt();options=this.setOptions;parse=this.parseMarkdown(!0);parseInline=this.parseMarkdown(!1);Parser=Q;Renderer=ot;TextRenderer=Pt;Lexer=Y;Tokenizer=at;Hooks=Fe;constructor(...e){this.use(...e)}walkTokens(e,t){let n=[];for(let i of e)switch(n=n.concat(t.call(this,i)),i.type){case"table":{let s=i;for(let a of s.header)n=n.concat(this.walkTokens(a.tokens,t));for(let a of s.rows)for(let r of a)n=n.concat(this.walkTokens(r.tokens,t));break}case"list":{let s=i;n=n.concat(this.walkTokens(s.items,t));break}default:{let s=i;this.defaults.extensions?.childTokens?.[s.type]?this.defaults.extensions.childTokens[s.type].forEach(a=>{let r=s[a].flat(1/0);n=n.concat(this.walkTokens(r,t))}):s.tokens&&(n=n.concat(this.walkTokens(s.tokens,t)))}}return n}use(...e){let t=this.defaults.extensions||{renderers:{},childTokens:{}};return e.forEach(n=>{let i={...n};if(i.async=this.defaults.async||i.async||!1,n.extensions&&(n.extensions.forEach(s=>{if(!s.name)throw new Error("extension name required");if("renderer"in s){let a=t.renderers[s.name];a?t.renderers[s.name]=function(...r){let l=s.renderer.apply(this,r);return l===!1&&(l=a.apply(this,r)),l}:t.renderers[s.name]=s.renderer}if("tokenizer"in s){if(!s.level||s.level!=="block"&&s.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");let a=t[s.level];a?a.unshift(s.tokenizer):t[s.level]=[s.tokenizer],s.start&&(s.level==="block"?t.startBlock?t.startBlock.push(s.start):t.startBlock=[s.start]:s.level==="inline"&&(t.startInline?t.startInline.push(s.start):t.startInline=[s.start]))}"childTokens"in s&&s.childTokens&&(t.childTokens[s.name]=s.childTokens)}),i.extensions=t),n.renderer){let s=this.defaults.renderer||new ot(this.defaults);for(let a in n.renderer){if(!(a in s))throw new Error(\`renderer '\${a}' does not exist\`);if(["options","parser"].includes(a))continue;let r=a,l=n.renderer[r],o=s[r];s[r]=(...c)=>{let u=l.apply(s,c);return u===!1&&(u=o.apply(s,c)),u||""}}i.renderer=s}if(n.tokenizer){let s=this.defaults.tokenizer||new at(this.defaults);for(let a in n.tokenizer){if(!(a in s))throw new Error(\`tokenizer '\${a}' does not exist\`);if(["options","rules","lexer"].includes(a))continue;let r=a,l=n.tokenizer[r],o=s[r];s[r]=(...c)=>{let u=l.apply(s,c);return u===!1&&(u=o.apply(s,c)),u}}i.tokenizer=s}if(n.hooks){let s=this.defaults.hooks||new Fe;for(let a in n.hooks){if(!(a in s))throw new Error(\`hook '\${a}' does not exist\`);if(["options","block"].includes(a))continue;let r=a,l=n.hooks[r],o=s[r];Fe.passThroughHooks.has(a)?s[r]=c=>{if(this.defaults.async&&Fe.passThroughHooksRespectAsync.has(a))return(async()=>{let d=await l.call(s,c);return o.call(s,d)})();let u=l.call(s,c);return o.call(s,u)}:s[r]=(...c)=>{if(this.defaults.async)return(async()=>{let d=await l.apply(s,c);return d===!1&&(d=await o.apply(s,c)),d})();let u=l.apply(s,c);return u===!1&&(u=o.apply(s,c)),u}}i.hooks=s}if(n.walkTokens){let s=this.defaults.walkTokens,a=n.walkTokens;i.walkTokens=function(r){let l=[];return l.push(a.call(this,r)),s&&(l=l.concat(s.call(this,r))),l}}this.defaults={...this.defaults,...i}}),this}setOptions(e){return this.defaults={...this.defaults,...e},this}lexer(e,t){return Y.lex(e,t??this.defaults)}parser(e,t){return Q.parse(e,t??this.defaults)}parseMarkdown(e){return(t,n)=>{let i={...n},s={...this.defaults,...i},a=this.onError(!!s.silent,!!s.async);if(this.defaults.async===!0&&i.async===!1)return a(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof t>"u"||t===null)return a(new Error("marked(): input parameter is undefined or null"));if(typeof t!="string")return a(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(t)+", string expected"));if(s.hooks&&(s.hooks.options=s,s.hooks.block=e),s.async)return(async()=>{let r=s.hooks?await s.hooks.preprocess(t):t,l=await(s.hooks?await s.hooks.provideLexer():e?Y.lex:Y.lexInline)(r,s),o=s.hooks?await s.hooks.processAllTokens(l):l;s.walkTokens&&await Promise.all(this.walkTokens(o,s.walkTokens));let c=await(s.hooks?await s.hooks.provideParser():e?Q.parse:Q.parseInline)(o,s);return s.hooks?await s.hooks.postprocess(c):c})().catch(a);try{s.hooks&&(t=s.hooks.preprocess(t));let r=(s.hooks?s.hooks.provideLexer():e?Y.lex:Y.lexInline)(t,s);s.hooks&&(r=s.hooks.processAllTokens(r)),s.walkTokens&&this.walkTokens(r,s.walkTokens);let l=(s.hooks?s.hooks.provideParser():e?Q.parse:Q.parseInline)(r,s);return s.hooks&&(l=s.hooks.postprocess(l)),l}catch(r){return a(r)}}}onError(e,t){return n=>{if(n.message+=\`
Please report this to https://github.com/markedjs/marked.\`,e){let i="<p>An error occurred:</p><pre>"+se(n.message+"",!0)+"</pre>";return t?Promise.resolve(i):i}if(t)return Promise.reject(n);throw n}}},xe=new ir;function A(e,t){return xe.parse(e,t)}A.options=A.setOptions=function(e){return xe.setOptions(e),A.defaults=xe.defaults,Pn(A.defaults),A};A.getDefaults=Nt;A.defaults=we;A.use=function(...e){return xe.use(...e),A.defaults=xe.defaults,Pn(A.defaults),A};A.walkTokens=function(e,t){return xe.walkTokens(e,t)};A.parseInline=xe.parseInline;A.Parser=Q;A.parser=Q.parse;A.Renderer=ot;A.TextRenderer=Pt;A.Lexer=Y;A.lexer=Y.lex;A.Tokenizer=at;A.Hooks=Fe;A.parse=A;var Ya=A.options,Qa=A.setOptions,Va=A.use,Ja=A.walkTokens,eo=A.parseInline;var to=Q.parse,no=Y.lex;var fs=fi(hs(),1);var P=fs.default;var ms="[A-Za-z$_][0-9A-Za-z$_]*",jr=["as","in","of","if","for","while","finally","var","new","function","do","return","void","else","break","catch","instanceof","with","throw","case","default","try","switch","continue","typeof","delete","let","yield","const","class","debugger","async","await","static","import","from","export","extends","using"],Xr=["true","false","null","undefined","NaN","Infinity"],bs=["Object","Function","Boolean","Symbol","Math","Date","Number","BigInt","String","RegExp","Array","Float32Array","Float64Array","Int8Array","Uint8Array","Uint8ClampedArray","Int16Array","Int32Array","Uint16Array","Uint32Array","BigInt64Array","BigUint64Array","Set","Map","WeakSet","WeakMap","ArrayBuffer","SharedArrayBuffer","Atomics","DataView","JSON","Promise","Generator","GeneratorFunction","AsyncFunction","Reflect","Proxy","Intl","WebAssembly"],ks=["Error","EvalError","InternalError","RangeError","ReferenceError","SyntaxError","TypeError","URIError"],Es=["setInterval","setTimeout","clearInterval","clearTimeout","require","exports","eval","isFinite","isNaN","parseFloat","parseInt","decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape","unescape"],Yr=["arguments","this","super","console","window","document","localStorage","sessionStorage","module","global"],Qr=[].concat(Es,bs,ks);function Kt(e){let t=e.regex,n=(b,{after:w})=>{let S="</"+b[0].slice(1);return b.input.indexOf(S,w)!==-1},i=ms,s={begin:"<>",end:"</>"},a=/<[A-Za-z0-9\\\\._:-]+\\s*\\/>/,r={begin:/<[A-Za-z0-9\\\\._:-]+/,end:/\\/[A-Za-z0-9\\\\._:-]+>|\\/>/,isTrulyOpeningTag:(b,w)=>{let S=b[0].length+b.index,L=b.input[S];if(L==="<"||L===","){w.ignoreMatch();return}L===">"&&(n(b,{after:S})||w.ignoreMatch());let H,ee=b.input.substring(S);if(H=ee.match(/^\\s*=/)){w.ignoreMatch();return}if((H=ee.match(/^\\s+extends\\s+/))&&H.index===0){w.ignoreMatch();return}}},l={$pattern:ms,keyword:jr,literal:Xr,built_in:Qr,"variable.language":Yr},o="[0-9](_?[0-9])*",c=\`\\\\.(\${o})\`,u="0|[1-9](_?[0-9])*|0[0-7]*[89][0-9]*",d={className:"number",variants:[{begin:\`(\\\\b(\${u})((\${c})|\\\\.)?|(\${c}))[eE][+-]?(\${o})\\\\b\`},{begin:\`\\\\b(\${u})\\\\b((\${c})\\\\b|\\\\.)?|(\${c})\\\\b\`},{begin:"\\\\b(0|[1-9](_?[0-9])*)n\\\\b"},{begin:"\\\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*n?\\\\b"},{begin:"\\\\b0[bB][0-1](_?[0-1])*n?\\\\b"},{begin:"\\\\b0[oO][0-7](_?[0-7])*n?\\\\b"},{begin:"\\\\b0[0-7]+n?\\\\b"}],relevance:0},p={className:"subst",begin:"\\\\$\\\\{",end:"\\\\}",keywords:l,contains:[]},m={begin:".?html\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,p],subLanguage:"xml"}},f={begin:".?css\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,p],subLanguage:"css"}},y={begin:".?gql\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,p],subLanguage:"graphql"}},R={className:"string",begin:"\`",end:"\`",contains:[e.BACKSLASH_ESCAPE,p]},O={className:"comment",variants:[e.COMMENT(/\\/\\*\\*(?!\\/)/,"\\\\*/",{relevance:0,contains:[{begin:"(?=@[A-Za-z]+)",relevance:0,contains:[{className:"doctag",begin:"@[A-Za-z]+"},{className:"type",begin:"\\\\{",end:"\\\\}",excludeEnd:!0,excludeBegin:!0,relevance:0},{className:"variable",begin:i+"(?=\\\\s*(-)|$)",endsParent:!0,relevance:0},{begin:/(?=[^\\n])\\s/,relevance:0}]}]}),e.C_BLOCK_COMMENT_MODE,e.C_LINE_COMMENT_MODE]},$=[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,m,f,y,R,{match:/\\$\\d+/},d];p.contains=$.concat({begin:/\\{/,end:/\\}/,keywords:l,contains:["self"].concat($)});let z=[].concat(O,p.contains),I=z.concat([{begin:/(\\s*)\\(/,end:/\\)/,keywords:l,contains:["self"].concat(z)}]),N={className:"params",begin:/(\\s*)\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:I},ke={variants:[{match:[/class/,/\\s+/,i,/\\s+/,/extends/,/\\s+/,t.concat(i,"(",t.concat(/\\./,i),")*")],scope:{1:"keyword",3:"title.class",5:"keyword",7:"title.class.inherited"}},{match:[/class/,/\\s+/,i],scope:{1:"keyword",3:"title.class"}}]},U={relevance:0,match:t.either(/\\bJSON/,/\\b[A-Z][a-z]+([A-Z][a-z]*|\\d)*/,/\\b[A-Z]{2,}([A-Z][a-z]+|\\d)+([A-Z][a-z]*)*/,/\\b[A-Z]{2,}[a-z]+([A-Z][a-z]+|\\d)*([A-Z][a-z]*)*/),className:"title.class",keywords:{_:[...bs,...ks]}},K={label:"use_strict",className:"meta",relevance:10,begin:/^\\s*['"]use (strict|asm)['"]/},Te={variants:[{match:[/function/,/\\s+/,i,/(?=\\s*\\()/]},{match:[/function/,/\\s*(?=\\()/]}],className:{1:"keyword",3:"title.function"},label:"func.def",contains:[N],illegal:/%/},Be={relevance:0,match:/\\b[A-Z][A-Z_0-9]+\\b/,className:"variable.constant"};function Pe(b){return t.concat("(?!",b.join("|"),")")}let $e={match:t.concat(/\\b/,Pe([...Es,"super","import"].map(b=>\`\${b}\\\\s*\\\\(\`)),i,t.lookahead(/\\s*\\(/)),className:"title.function",relevance:0},de={begin:t.concat(/\\./,t.lookahead(t.concat(i,/(?![0-9A-Za-z$_(])/))),end:i,excludeBegin:!0,keywords:"prototype",className:"property",relevance:0},ze={match:[/get|set/,/\\s+/,i,/(?=\\()/],className:{1:"keyword",3:"title.function"},contains:[{begin:/\\(\\)/},N]},g="(\\\\([^()]*(\\\\([^()]*(\\\\([^()]*\\\\)[^()]*)*\\\\)[^()]*)*\\\\)|"+e.UNDERSCORE_IDENT_RE+")\\\\s*=>",k={match:[/const|var|let/,/\\s+/,i,/\\s*/,/=\\s*/,/(async\\s*)?/,t.lookahead(g)],keywords:"async",className:{1:"keyword",3:"title.function"},contains:[N]};return{name:"JavaScript",aliases:["js","jsx","mjs","cjs"],keywords:l,exports:{PARAMS_CONTAINS:I,CLASS_REFERENCE:U},illegal:/#(?![$_A-z])/,contains:[e.SHEBANG({label:"shebang",binary:"node",relevance:5}),K,e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,m,f,y,R,O,{match:/\\$\\d+/},d,U,{scope:"attr",match:i+t.lookahead(":"),relevance:0},k,{begin:"("+e.RE_STARTERS_RE+"|\\\\b(case|return|throw)\\\\b)\\\\s*",keywords:"return throw case",relevance:0,contains:[O,e.REGEXP_MODE,{className:"function",begin:g,returnBegin:!0,end:"\\\\s*=>",contains:[{className:"params",variants:[{begin:e.UNDERSCORE_IDENT_RE,relevance:0},{className:null,begin:/\\(\\s*\\)/,skip:!0},{begin:/(\\s*)\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:I}]}]},{begin:/,/,relevance:0},{match:/\\s+/,relevance:0},{variants:[{begin:s.begin,end:s.end},{match:a},{begin:r.begin,"on:begin":r.isTrulyOpeningTag,end:r.end}],subLanguage:"xml",contains:[{begin:r.begin,end:r.end,skip:!0,contains:["self"]}]}]},Te,{beginKeywords:"while if switch catch for"},{begin:"\\\\b(?!function)"+e.UNDERSCORE_IDENT_RE+"\\\\([^()]*(\\\\([^()]*(\\\\([^()]*\\\\)[^()]*)*\\\\)[^()]*)*\\\\)\\\\s*\\\\{",returnBegin:!0,label:"func.def",contains:[N,e.inherit(e.TITLE_MODE,{begin:i,className:"title.function"})]},{match:/\\.\\.\\./,relevance:0},de,{match:"\\\\$"+i,relevance:0},{match:[/\\bconstructor(?=\\s*\\()/],className:{1:"title.function"},contains:[N]},$e,Be,ke,ze,{match:/\\$[(.]/}]}}var ht="[A-Za-z$_][0-9A-Za-z$_]*",ys=["as","in","of","if","for","while","finally","var","new","function","do","return","void","else","break","catch","instanceof","with","throw","case","default","try","switch","continue","typeof","delete","let","yield","const","class","debugger","async","await","static","import","from","export","extends","using"],xs=["true","false","null","undefined","NaN","Infinity"],ws=["Object","Function","Boolean","Symbol","Math","Date","Number","BigInt","String","RegExp","Array","Float32Array","Float64Array","Int8Array","Uint8Array","Uint8ClampedArray","Int16Array","Int32Array","Uint16Array","Uint32Array","BigInt64Array","BigUint64Array","Set","Map","WeakSet","WeakMap","ArrayBuffer","SharedArrayBuffer","Atomics","DataView","JSON","Promise","Generator","GeneratorFunction","AsyncFunction","Reflect","Proxy","Intl","WebAssembly"],_s=["Error","EvalError","InternalError","RangeError","ReferenceError","SyntaxError","TypeError","URIError"],vs=["setInterval","setTimeout","clearInterval","clearTimeout","require","exports","eval","isFinite","isNaN","parseFloat","parseInt","decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape","unescape"],Ss=["arguments","this","super","console","window","document","localStorage","sessionStorage","module","global"],As=[].concat(vs,ws,_s);function Vr(e){let t=e.regex,n=(b,{after:w})=>{let S="</"+b[0].slice(1);return b.input.indexOf(S,w)!==-1},i=ht,s={begin:"<>",end:"</>"},a=/<[A-Za-z0-9\\\\._:-]+\\s*\\/>/,r={begin:/<[A-Za-z0-9\\\\._:-]+/,end:/\\/[A-Za-z0-9\\\\._:-]+>|\\/>/,isTrulyOpeningTag:(b,w)=>{let S=b[0].length+b.index,L=b.input[S];if(L==="<"||L===","){w.ignoreMatch();return}L===">"&&(n(b,{after:S})||w.ignoreMatch());let H,ee=b.input.substring(S);if(H=ee.match(/^\\s*=/)){w.ignoreMatch();return}if((H=ee.match(/^\\s+extends\\s+/))&&H.index===0){w.ignoreMatch();return}}},l={$pattern:ht,keyword:ys,literal:xs,built_in:As,"variable.language":Ss},o="[0-9](_?[0-9])*",c=\`\\\\.(\${o})\`,u="0|[1-9](_?[0-9])*|0[0-7]*[89][0-9]*",d={className:"number",variants:[{begin:\`(\\\\b(\${u})((\${c})|\\\\.)?|(\${c}))[eE][+-]?(\${o})\\\\b\`},{begin:\`\\\\b(\${u})\\\\b((\${c})\\\\b|\\\\.)?|(\${c})\\\\b\`},{begin:"\\\\b(0|[1-9](_?[0-9])*)n\\\\b"},{begin:"\\\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*n?\\\\b"},{begin:"\\\\b0[bB][0-1](_?[0-1])*n?\\\\b"},{begin:"\\\\b0[oO][0-7](_?[0-7])*n?\\\\b"},{begin:"\\\\b0[0-7]+n?\\\\b"}],relevance:0},p={className:"subst",begin:"\\\\$\\\\{",end:"\\\\}",keywords:l,contains:[]},m={begin:".?html\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,p],subLanguage:"xml"}},f={begin:".?css\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,p],subLanguage:"css"}},y={begin:".?gql\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,p],subLanguage:"graphql"}},R={className:"string",begin:"\`",end:"\`",contains:[e.BACKSLASH_ESCAPE,p]},O={className:"comment",variants:[e.COMMENT(/\\/\\*\\*(?!\\/)/,"\\\\*/",{relevance:0,contains:[{begin:"(?=@[A-Za-z]+)",relevance:0,contains:[{className:"doctag",begin:"@[A-Za-z]+"},{className:"type",begin:"\\\\{",end:"\\\\}",excludeEnd:!0,excludeBegin:!0,relevance:0},{className:"variable",begin:i+"(?=\\\\s*(-)|$)",endsParent:!0,relevance:0},{begin:/(?=[^\\n])\\s/,relevance:0}]}]}),e.C_BLOCK_COMMENT_MODE,e.C_LINE_COMMENT_MODE]},$=[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,m,f,y,R,{match:/\\$\\d+/},d];p.contains=$.concat({begin:/\\{/,end:/\\}/,keywords:l,contains:["self"].concat($)});let z=[].concat(O,p.contains),I=z.concat([{begin:/(\\s*)\\(/,end:/\\)/,keywords:l,contains:["self"].concat(z)}]),N={className:"params",begin:/(\\s*)\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:I},ke={variants:[{match:[/class/,/\\s+/,i,/\\s+/,/extends/,/\\s+/,t.concat(i,"(",t.concat(/\\./,i),")*")],scope:{1:"keyword",3:"title.class",5:"keyword",7:"title.class.inherited"}},{match:[/class/,/\\s+/,i],scope:{1:"keyword",3:"title.class"}}]},U={relevance:0,match:t.either(/\\bJSON/,/\\b[A-Z][a-z]+([A-Z][a-z]*|\\d)*/,/\\b[A-Z]{2,}([A-Z][a-z]+|\\d)+([A-Z][a-z]*)*/,/\\b[A-Z]{2,}[a-z]+([A-Z][a-z]+|\\d)*([A-Z][a-z]*)*/),className:"title.class",keywords:{_:[...ws,..._s]}},K={label:"use_strict",className:"meta",relevance:10,begin:/^\\s*['"]use (strict|asm)['"]/},Te={variants:[{match:[/function/,/\\s+/,i,/(?=\\s*\\()/]},{match:[/function/,/\\s*(?=\\()/]}],className:{1:"keyword",3:"title.function"},label:"func.def",contains:[N],illegal:/%/},Be={relevance:0,match:/\\b[A-Z][A-Z_0-9]+\\b/,className:"variable.constant"};function Pe(b){return t.concat("(?!",b.join("|"),")")}let $e={match:t.concat(/\\b/,Pe([...vs,"super","import"].map(b=>\`\${b}\\\\s*\\\\(\`)),i,t.lookahead(/\\s*\\(/)),className:"title.function",relevance:0},de={begin:t.concat(/\\./,t.lookahead(t.concat(i,/(?![0-9A-Za-z$_(])/))),end:i,excludeBegin:!0,keywords:"prototype",className:"property",relevance:0},ze={match:[/get|set/,/\\s+/,i,/(?=\\()/],className:{1:"keyword",3:"title.function"},contains:[{begin:/\\(\\)/},N]},g="(\\\\([^()]*(\\\\([^()]*(\\\\([^()]*\\\\)[^()]*)*\\\\)[^()]*)*\\\\)|"+e.UNDERSCORE_IDENT_RE+")\\\\s*=>",k={match:[/const|var|let/,/\\s+/,i,/\\s*/,/=\\s*/,/(async\\s*)?/,t.lookahead(g)],keywords:"async",className:{1:"keyword",3:"title.function"},contains:[N]};return{name:"JavaScript",aliases:["js","jsx","mjs","cjs"],keywords:l,exports:{PARAMS_CONTAINS:I,CLASS_REFERENCE:U},illegal:/#(?![$_A-z])/,contains:[e.SHEBANG({label:"shebang",binary:"node",relevance:5}),K,e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,m,f,y,R,O,{match:/\\$\\d+/},d,U,{scope:"attr",match:i+t.lookahead(":"),relevance:0},k,{begin:"("+e.RE_STARTERS_RE+"|\\\\b(case|return|throw)\\\\b)\\\\s*",keywords:"return throw case",relevance:0,contains:[O,e.REGEXP_MODE,{className:"function",begin:g,returnBegin:!0,end:"\\\\s*=>",contains:[{className:"params",variants:[{begin:e.UNDERSCORE_IDENT_RE,relevance:0},{className:null,begin:/\\(\\s*\\)/,skip:!0},{begin:/(\\s*)\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:I}]}]},{begin:/,/,relevance:0},{match:/\\s+/,relevance:0},{variants:[{begin:s.begin,end:s.end},{match:a},{begin:r.begin,"on:begin":r.isTrulyOpeningTag,end:r.end}],subLanguage:"xml",contains:[{begin:r.begin,end:r.end,skip:!0,contains:["self"]}]}]},Te,{beginKeywords:"while if switch catch for"},{begin:"\\\\b(?!function)"+e.UNDERSCORE_IDENT_RE+"\\\\([^()]*(\\\\([^()]*(\\\\([^()]*\\\\)[^()]*)*\\\\)[^()]*)*\\\\)\\\\s*\\\\{",returnBegin:!0,label:"func.def",contains:[N,e.inherit(e.TITLE_MODE,{begin:i,className:"title.function"})]},{match:/\\.\\.\\./,relevance:0},de,{match:"\\\\$"+i,relevance:0},{match:[/\\bconstructor(?=\\s*\\()/],className:{1:"title.function"},contains:[N]},$e,Be,ke,ze,{match:/\\$[(.]/}]}}function Wt(e){let t=e.regex,n=Vr(e),i=ht,s=["any","void","number","boolean","string","object","never","symbol","bigint","unknown"],a={begin:[/namespace/,/\\s+/,e.IDENT_RE],beginScope:{1:"keyword",3:"title.class"}},r={beginKeywords:"interface",end:/\\{/,excludeEnd:!0,keywords:{keyword:"interface extends",built_in:s},contains:[n.exports.CLASS_REFERENCE]},l={className:"meta",relevance:10,begin:/^\\s*['"]use strict['"]/},o=["type","interface","public","private","protected","implements","declare","abstract","readonly","enum","override","satisfies"],c={$pattern:ht,keyword:ys.concat(o),literal:xs,built_in:As.concat(s),"variable.language":Ss},u={className:"meta",begin:"@"+i},d=(y,R,M)=>{let O=y.contains.findIndex($=>$.label===R);if(O===-1)throw new Error("can not find mode to replace");y.contains.splice(O,1,M)};Object.assign(n.keywords,c),n.exports.PARAMS_CONTAINS.push(u);let p=n.contains.find(y=>y.scope==="attr"),m=Object.assign({},p,{match:t.concat(i,t.lookahead(/\\s*\\?:/))});n.exports.PARAMS_CONTAINS.push([n.exports.CLASS_REFERENCE,p,m]),n.contains=n.contains.concat([u,a,r,m]),d(n,"shebang",e.SHEBANG()),d(n,"use_strict",l);let f=n.contains.find(y=>y.label==="func.def");return f.relevance=0,Object.assign(n,{name:"TypeScript",aliases:["ts","tsx","mts","cts"]}),n}function jt(e){let t=e.regex,n=/[\\p{XID_Start}_]\\p{XID_Continue}*/u,i=["and","as","assert","async","await","break","case","class","continue","def","del","elif","else","except","finally","for","from","global","if","import","in","is","lambda","match","nonlocal|10","not","or","pass","raise","return","try","while","with","yield"],l={$pattern:/[A-Za-z]\\w+|__\\w+__/,keyword:i,built_in:["__import__","abs","all","any","ascii","bin","bool","breakpoint","bytearray","bytes","callable","chr","classmethod","compile","complex","delattr","dict","dir","divmod","enumerate","eval","exec","filter","float","format","frozenset","getattr","globals","hasattr","hash","help","hex","id","input","int","isinstance","issubclass","iter","len","list","locals","map","max","memoryview","min","next","object","oct","open","ord","pow","print","property","range","repr","reversed","round","set","setattr","slice","sorted","staticmethod","str","sum","super","tuple","type","vars","zip"],literal:["__debug__","Ellipsis","False","None","NotImplemented","True"],type:["Any","Callable","Coroutine","Dict","List","Literal","Generic","Optional","Sequence","Set","Tuple","Type","Union"]},o={className:"meta",begin:/^(>>>|\\.\\.\\.) /},c={className:"subst",begin:/\\{/,end:/\\}/,keywords:l,illegal:/#/},u={begin:/\\{\\{/,relevance:0},d={className:"string",contains:[e.BACKSLASH_ESCAPE],variants:[{begin:/([uU]|[bB]|[rR]|[bB][rR]|[rR][bB])?'''/,end:/'''/,contains:[e.BACKSLASH_ESCAPE,o],relevance:10},{begin:/([uU]|[bB]|[rR]|[bB][rR]|[rR][bB])?"""/,end:/"""/,contains:[e.BACKSLASH_ESCAPE,o],relevance:10},{begin:/([fF][rR]|[rR][fF]|[fF])'''/,end:/'''/,contains:[e.BACKSLASH_ESCAPE,o,u,c]},{begin:/([fF][rR]|[rR][fF]|[fF])"""/,end:/"""/,contains:[e.BACKSLASH_ESCAPE,o,u,c]},{begin:/([uU]|[rR])'/,end:/'/,relevance:10},{begin:/([uU]|[rR])"/,end:/"/,relevance:10},{begin:/([bB]|[bB][rR]|[rR][bB])'/,end:/'/},{begin:/([bB]|[bB][rR]|[rR][bB])"/,end:/"/},{begin:/([fF][rR]|[rR][fF]|[fF])'/,end:/'/,contains:[e.BACKSLASH_ESCAPE,u,c]},{begin:/([fF][rR]|[rR][fF]|[fF])"/,end:/"/,contains:[e.BACKSLASH_ESCAPE,u,c]},e.APOS_STRING_MODE,e.QUOTE_STRING_MODE]},p="[0-9](_?[0-9])*",m=\`(\\\\b(\${p}))?\\\\.(\${p})|\\\\b(\${p})\\\\.\`,f=\`\\\\b|\${i.join("|")}\`,y={className:"number",relevance:0,variants:[{begin:\`(\\\\b(\${p})|(\${m}))[eE][+-]?(\${p})[jJ]?(?=\${f})\`},{begin:\`(\${m})[jJ]?\`},{begin:\`\\\\b([1-9](_?[0-9])*|0+(_?0)*)[lLjJ]?(?=\${f})\`},{begin:\`\\\\b0[bB](_?[01])+[lL]?(?=\${f})\`},{begin:\`\\\\b0[oO](_?[0-7])+[lL]?(?=\${f})\`},{begin:\`\\\\b0[xX](_?[0-9a-fA-F])+[lL]?(?=\${f})\`},{begin:\`\\\\b(\${p})[jJ](?=\${f})\`}]},R={className:"comment",begin:t.lookahead(/# type:/),end:/$/,keywords:l,contains:[{begin:/# type:/},{begin:/#/,end:/\\b\\B/,endsWithParent:!0}]},M={className:"params",variants:[{className:"",begin:/\\(\\s*\\)/,skip:!0},{begin:/\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:["self",o,y,d,e.HASH_COMMENT_MODE]}]};return c.contains=[d,y,o],{name:"Python",aliases:["py","gyp","ipython"],unicodeRegex:!0,keywords:l,illegal:/(<\\/|\\?)|=>/,contains:[o,y,{scope:"variable.language",match:/\\bself\\b/},{beginKeywords:"if",relevance:0},{match:/\\bor\\b/,scope:"keyword"},d,R,e.HASH_COMMENT_MODE,{match:[/\\bdef/,/\\s+/,n],scope:{1:"keyword",3:"title.function"},contains:[M]},{variants:[{match:[/\\bclass/,/\\s+/,n,/\\s*/,/\\(\\s*/,n,/\\s*\\)/]},{match:[/\\bclass/,/\\s+/,n]}],scope:{1:"keyword",3:"title.class",6:"title.class.inherited"}},{className:"meta",begin:/^[\\t ]*@/,end:/(?=#)|$/,contains:[y,M,d]}]}}function Xt(e){let t=e.regex,n={},i={begin:/\\$\\{/,end:/\\}/,contains:["self",{begin:/:-/,contains:[n]}]};Object.assign(n,{className:"variable",variants:[{begin:t.concat(/\\$[\\w\\d#@][\\w\\d_]*/,"(?![\\\\w\\\\d])(?![$])")},i]});let s={className:"subst",begin:/\\$\\(/,end:/\\)/,contains:[e.BACKSLASH_ESCAPE]},a=e.inherit(e.COMMENT(),{match:[/(^|\\s)/,/#.*$/],scope:{2:"comment"}}),r={begin:/<<-?\\s*(?=\\w+)/,starts:{contains:[e.END_SAME_AS_BEGIN({begin:/(\\w+)/,end:/(\\w+)/,className:"string"})]}},l={className:"string",begin:/"/,end:/"/,contains:[e.BACKSLASH_ESCAPE,n,s]};s.contains.push(l);let o={match:/\\\\"/},c={className:"string",begin:/'/,end:/'/},u={match:/\\\\'/},d={begin:/\\$?\\(\\(/,end:/\\)\\)/,contains:[{begin:/\\d+#[0-9a-f]+/,className:"number"},e.NUMBER_MODE,n]},p=["fish","bash","zsh","sh","csh","ksh","tcsh","dash","scsh"],m=e.SHEBANG({binary:\`(\${p.join("|")})\`,relevance:10}),f={className:"function",begin:/\\w[\\w\\d_]*\\s*\\(\\s*\\)\\s*\\{/,returnBegin:!0,contains:[e.inherit(e.TITLE_MODE,{begin:/\\w[\\w\\d_]*/})],relevance:0},y=["if","then","else","elif","fi","time","for","while","until","in","do","done","case","esac","coproc","function","select"],R=["true","false"],M={match:/(\\/[a-z._-]+)+/},O=["break","cd","continue","eval","exec","exit","export","getopts","hash","pwd","readonly","return","shift","test","times","trap","umask","unset"],$=["alias","bind","builtin","caller","command","declare","echo","enable","help","let","local","logout","mapfile","printf","read","readarray","source","sudo","type","typeset","ulimit","unalias"],z=["autoload","bg","bindkey","bye","cap","chdir","clone","comparguments","compcall","compctl","compdescribe","compfiles","compgroups","compquote","comptags","comptry","compvalues","dirs","disable","disown","echotc","echoti","emulate","fc","fg","float","functions","getcap","getln","history","integer","jobs","kill","limit","log","noglob","popd","print","pushd","pushln","rehash","sched","setcap","setopt","stat","suspend","ttyctl","unfunction","unhash","unlimit","unsetopt","vared","wait","whence","where","which","zcompile","zformat","zftp","zle","zmodload","zparseopts","zprof","zpty","zregexparse","zsocket","zstyle","ztcp"],I=["chcon","chgrp","chown","chmod","cp","dd","df","dir","dircolors","ln","ls","mkdir","mkfifo","mknod","mktemp","mv","realpath","rm","rmdir","shred","sync","touch","truncate","vdir","b2sum","base32","base64","cat","cksum","comm","csplit","cut","expand","fmt","fold","head","join","md5sum","nl","numfmt","od","paste","ptx","pr","sha1sum","sha224sum","sha256sum","sha384sum","sha512sum","shuf","sort","split","sum","tac","tail","tr","tsort","unexpand","uniq","wc","arch","basename","chroot","date","dirname","du","echo","env","expr","factor","groups","hostid","id","link","logname","nice","nohup","nproc","pathchk","pinky","printenv","printf","pwd","readlink","runcon","seq","sleep","stat","stdbuf","stty","tee","test","timeout","tty","uname","unlink","uptime","users","who","whoami","yes"];return{name:"Bash",aliases:["sh","zsh"],keywords:{$pattern:/\\b[a-z][a-z0-9._-]+\\b/,keyword:y,literal:R,built_in:[...O,...$,"set","shopt",...z,...I]},contains:[m,e.SHEBANG(),f,d,a,r,M,l,o,c,u,n]}}function Ts(e){let t={className:"attr",begin:/"(\\\\.|[^\\\\"\\r\\n])*"(?=\\s*:)/,relevance:1.01},n={match:/[{}[\\],:]/,className:"punctuation",relevance:0},i=["true","false","null"],s={scope:"literal",beginKeywords:i.join(" ")};return{name:"JSON",aliases:["jsonc"],keywords:{literal:i},contains:[t,n,e.QUOTE_STRING_MODE,s,e.C_NUMBER_MODE,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE],illegal:"\\\\S"}}function Yt(e){let t=e.regex,n=t.concat(/[\\p{L}_]/u,t.optional(/[\\p{L}0-9_.-]*:/u),/[\\p{L}0-9_.-]*/u),i=/[\\p{L}0-9._:-]+/u,s={className:"symbol",begin:/&[a-z]+;|&#[0-9]+;|&#x[a-f0-9]+;/},a={begin:/\\s/,contains:[{className:"keyword",begin:/#?[a-z_][a-z1-9_-]+/,illegal:/\\n/}]},r=e.inherit(a,{begin:/\\(/,end:/\\)/}),l=e.inherit(e.APOS_STRING_MODE,{className:"string"}),o=e.inherit(e.QUOTE_STRING_MODE,{className:"string"}),c={endsWithParent:!0,illegal:/</,relevance:0,contains:[{className:"attr",begin:i,relevance:0},{begin:/=\\s*/,relevance:0,contains:[{className:"string",endsParent:!0,variants:[{begin:/"/,end:/"/,contains:[s]},{begin:/'/,end:/'/,contains:[s]},{begin:/[^\\s"'=<>\`]+/}]}]}]};return{name:"HTML, XML",aliases:["html","xhtml","rss","atom","xjb","xsd","xsl","plist","wsf","svg"],case_insensitive:!0,unicodeRegex:!0,contains:[{className:"meta",begin:/<![a-z]/,end:/>/,relevance:10,contains:[a,o,l,r,{begin:/\\[/,end:/\\]/,contains:[{className:"meta",begin:/<![a-z]/,end:/>/,contains:[a,r,o,l]}]}]},e.COMMENT(/<!--/,/-->/,{relevance:10}),{begin:/<!\\[CDATA\\[/,end:/\\]\\]>/,relevance:10},s,{className:"meta",end:/\\?>/,variants:[{begin:/<\\?xml/,relevance:10,contains:[o]},{begin:/<\\?[a-z][a-z0-9]+/}]},{className:"tag",begin:/<style(?=\\s|>)/,end:/>/,keywords:{name:"style"},contains:[c],starts:{end:/<\\/style>/,returnEnd:!0,subLanguage:["css","xml"]}},{className:"tag",begin:/<script(?=\\s|>)/,end:/>/,keywords:{name:"script"},contains:[c],starts:{end:/<\\/script>/,returnEnd:!0,subLanguage:["javascript","handlebars","xml"]}},{className:"tag",begin:/<>|<\\/>/},{className:"tag",begin:t.concat(/</,t.lookahead(t.concat(n,t.either(/\\/>/,/>/,/\\s/)))),end:/\\/?>/,contains:[{className:"name",begin:n,relevance:0,starts:c}]},{className:"tag",begin:t.concat(/<\\//,t.lookahead(t.concat(n,/>/))),contains:[{className:"name",begin:n,relevance:0},{begin:/>/,relevance:0,endsParent:!0}]}]}}var Jr=e=>({IMPORTANT:{scope:"meta",begin:"!important"},BLOCK_COMMENT:e.C_BLOCK_COMMENT_MODE,HEXCOLOR:{scope:"number",begin:/#(([0-9a-fA-F]{3,4})|(([0-9a-fA-F]{2}){3,4}))\\b/},FUNCTION_DISPATCH:{className:"built_in",begin:/[\\w-]+(?=\\()/},ATTRIBUTE_SELECTOR_MODE:{scope:"selector-attr",begin:/\\[/,end:/\\]/,illegal:"$",contains:[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE]},CSS_NUMBER_MODE:{scope:"number",begin:e.NUMBER_RE+"(%|em|ex|ch|rem|vw|vh|vmin|vmax|cm|mm|in|pt|pc|px|deg|grad|rad|turn|s|ms|Hz|kHz|dpi|dpcm|dppx)?",relevance:0},CSS_VARIABLE:{className:"attr",begin:/--[A-Za-z_][A-Za-z0-9_-]*/}}),ea=["a","abbr","address","article","aside","audio","b","blockquote","body","button","canvas","caption","cite","code","dd","del","details","dfn","div","dl","dt","em","fieldset","figcaption","figure","footer","form","h1","h2","h3","h4","h5","h6","header","hgroup","html","i","iframe","img","input","ins","kbd","label","legend","li","main","mark","menu","nav","object","ol","optgroup","option","p","picture","q","quote","samp","section","select","source","span","strong","summary","sup","table","tbody","td","textarea","tfoot","th","thead","time","tr","ul","var","video"],ta=["defs","g","marker","mask","pattern","svg","switch","symbol","feBlend","feColorMatrix","feComponentTransfer","feComposite","feConvolveMatrix","feDiffuseLighting","feDisplacementMap","feFlood","feGaussianBlur","feImage","feMerge","feMorphology","feOffset","feSpecularLighting","feTile","feTurbulence","linearGradient","radialGradient","stop","circle","ellipse","image","line","path","polygon","polyline","rect","text","use","textPath","tspan","foreignObject","clipPath"],na=[...ea,...ta],sa=["any-hover","any-pointer","aspect-ratio","color","color-gamut","color-index","device-aspect-ratio","device-height","device-width","display-mode","forced-colors","grid","height","hover","inverted-colors","monochrome","orientation","overflow-block","overflow-inline","pointer","prefers-color-scheme","prefers-contrast","prefers-reduced-motion","prefers-reduced-transparency","resolution","scan","scripting","update","width","min-width","max-width","min-height","max-height"].sort().reverse(),ia=["active","any-link","blank","checked","current","default","defined","dir","disabled","drop","empty","enabled","first","first-child","first-of-type","fullscreen","future","focus","focus-visible","focus-within","has","host","host-context","hover","indeterminate","in-range","invalid","is","lang","last-child","last-of-type","left","link","local-link","not","nth-child","nth-col","nth-last-child","nth-last-col","nth-last-of-type","nth-of-type","only-child","only-of-type","optional","out-of-range","past","placeholder-shown","read-only","read-write","required","right","root","scope","target","target-within","user-invalid","valid","visited","where"].sort().reverse(),ra=["after","backdrop","before","cue","cue-region","first-letter","first-line","grammar-error","marker","part","placeholder","selection","slotted","spelling-error"].sort().reverse(),aa=["accent-color","align-content","align-items","align-self","alignment-baseline","all","anchor-name","animation","animation-composition","animation-delay","animation-direction","animation-duration","animation-fill-mode","animation-iteration-count","animation-name","animation-play-state","animation-range","animation-range-end","animation-range-start","animation-timeline","animation-timing-function","appearance","aspect-ratio","backdrop-filter","backface-visibility","background","background-attachment","background-blend-mode","background-clip","background-color","background-image","background-origin","background-position","background-position-x","background-position-y","background-repeat","background-size","baseline-shift","block-size","border","border-block","border-block-color","border-block-end","border-block-end-color","border-block-end-style","border-block-end-width","border-block-start","border-block-start-color","border-block-start-style","border-block-start-width","border-block-style","border-block-width","border-bottom","border-bottom-color","border-bottom-left-radius","border-bottom-right-radius","border-bottom-style","border-bottom-width","border-collapse","border-color","border-end-end-radius","border-end-start-radius","border-image","border-image-outset","border-image-repeat","border-image-slice","border-image-source","border-image-width","border-inline","border-inline-color","border-inline-end","border-inline-end-color","border-inline-end-style","border-inline-end-width","border-inline-start","border-inline-start-color","border-inline-start-style","border-inline-start-width","border-inline-style","border-inline-width","border-left","border-left-color","border-left-style","border-left-width","border-radius","border-right","border-right-color","border-right-style","border-right-width","border-spacing","border-start-end-radius","border-start-start-radius","border-style","border-top","border-top-color","border-top-left-radius","border-top-right-radius","border-top-style","border-top-width","border-width","bottom","box-align","box-decoration-break","box-direction","box-flex","box-flex-group","box-lines","box-ordinal-group","box-orient","box-pack","box-shadow","box-sizing","break-after","break-before","break-inside","caption-side","caret-color","clear","clip","clip-path","clip-rule","color","color-interpolation","color-interpolation-filters","color-profile","color-rendering","color-scheme","column-count","column-fill","column-gap","column-rule","column-rule-color","column-rule-style","column-rule-width","column-span","column-width","columns","contain","contain-intrinsic-block-size","contain-intrinsic-height","contain-intrinsic-inline-size","contain-intrinsic-size","contain-intrinsic-width","container","container-name","container-type","content","content-visibility","counter-increment","counter-reset","counter-set","cue","cue-after","cue-before","cursor","cx","cy","direction","display","dominant-baseline","empty-cells","enable-background","field-sizing","fill","fill-opacity","fill-rule","filter","flex","flex-basis","flex-direction","flex-flow","flex-grow","flex-shrink","flex-wrap","float","flood-color","flood-opacity","flow","font","font-display","font-family","font-feature-settings","font-kerning","font-language-override","font-optical-sizing","font-palette","font-size","font-size-adjust","font-smooth","font-smoothing","font-stretch","font-style","font-synthesis","font-synthesis-position","font-synthesis-small-caps","font-synthesis-style","font-synthesis-weight","font-variant","font-variant-alternates","font-variant-caps","font-variant-east-asian","font-variant-emoji","font-variant-ligatures","font-variant-numeric","font-variant-position","font-variation-settings","font-weight","forced-color-adjust","gap","glyph-orientation-horizontal","glyph-orientation-vertical","grid","grid-area","grid-auto-columns","grid-auto-flow","grid-auto-rows","grid-column","grid-column-end","grid-column-start","grid-gap","grid-row","grid-row-end","grid-row-start","grid-template","grid-template-areas","grid-template-columns","grid-template-rows","hanging-punctuation","height","hyphenate-character","hyphenate-limit-chars","hyphens","icon","image-orientation","image-rendering","image-resolution","ime-mode","initial-letter","initial-letter-align","inline-size","inset","inset-area","inset-block","inset-block-end","inset-block-start","inset-inline","inset-inline-end","inset-inline-start","isolation","justify-content","justify-items","justify-self","kerning","left","letter-spacing","lighting-color","line-break","line-height","line-height-step","list-style","list-style-image","list-style-position","list-style-type","margin","margin-block","margin-block-end","margin-block-start","margin-bottom","margin-inline","margin-inline-end","margin-inline-start","margin-left","margin-right","margin-top","margin-trim","marker","marker-end","marker-mid","marker-start","marks","mask","mask-border","mask-border-mode","mask-border-outset","mask-border-repeat","mask-border-slice","mask-border-source","mask-border-width","mask-clip","mask-composite","mask-image","mask-mode","mask-origin","mask-position","mask-repeat","mask-size","mask-type","masonry-auto-flow","math-depth","math-shift","math-style","max-block-size","max-height","max-inline-size","max-width","min-block-size","min-height","min-inline-size","min-width","mix-blend-mode","nav-down","nav-index","nav-left","nav-right","nav-up","none","normal","object-fit","object-position","offset","offset-anchor","offset-distance","offset-path","offset-position","offset-rotate","opacity","order","orphans","outline","outline-color","outline-offset","outline-style","outline-width","overflow","overflow-anchor","overflow-block","overflow-clip-margin","overflow-inline","overflow-wrap","overflow-x","overflow-y","overlay","overscroll-behavior","overscroll-behavior-block","overscroll-behavior-inline","overscroll-behavior-x","overscroll-behavior-y","padding","padding-block","padding-block-end","padding-block-start","padding-bottom","padding-inline","padding-inline-end","padding-inline-start","padding-left","padding-right","padding-top","page","page-break-after","page-break-before","page-break-inside","paint-order","pause","pause-after","pause-before","perspective","perspective-origin","place-content","place-items","place-self","pointer-events","position","position-anchor","position-visibility","print-color-adjust","quotes","r","resize","rest","rest-after","rest-before","right","rotate","row-gap","ruby-align","ruby-position","scale","scroll-behavior","scroll-margin","scroll-margin-block","scroll-margin-block-end","scroll-margin-block-start","scroll-margin-bottom","scroll-margin-inline","scroll-margin-inline-end","scroll-margin-inline-start","scroll-margin-left","scroll-margin-right","scroll-margin-top","scroll-padding","scroll-padding-block","scroll-padding-block-end","scroll-padding-block-start","scroll-padding-bottom","scroll-padding-inline","scroll-padding-inline-end","scroll-padding-inline-start","scroll-padding-left","scroll-padding-right","scroll-padding-top","scroll-snap-align","scroll-snap-stop","scroll-snap-type","scroll-timeline","scroll-timeline-axis","scroll-timeline-name","scrollbar-color","scrollbar-gutter","scrollbar-width","shape-image-threshold","shape-margin","shape-outside","shape-rendering","speak","speak-as","src","stop-color","stop-opacity","stroke","stroke-dasharray","stroke-dashoffset","stroke-linecap","stroke-linejoin","stroke-miterlimit","stroke-opacity","stroke-width","tab-size","table-layout","text-align","text-align-all","text-align-last","text-anchor","text-combine-upright","text-decoration","text-decoration-color","text-decoration-line","text-decoration-skip","text-decoration-skip-ink","text-decoration-style","text-decoration-thickness","text-emphasis","text-emphasis-color","text-emphasis-position","text-emphasis-style","text-indent","text-justify","text-orientation","text-overflow","text-rendering","text-shadow","text-size-adjust","text-transform","text-underline-offset","text-underline-position","text-wrap","text-wrap-mode","text-wrap-style","timeline-scope","top","touch-action","transform","transform-box","transform-origin","transform-style","transition","transition-behavior","transition-delay","transition-duration","transition-property","transition-timing-function","translate","unicode-bidi","user-modify","user-select","vector-effect","vertical-align","view-timeline","view-timeline-axis","view-timeline-inset","view-timeline-name","view-transition-name","visibility","voice-balance","voice-duration","voice-family","voice-pitch","voice-range","voice-rate","voice-stress","voice-volume","white-space","white-space-collapse","widows","width","will-change","word-break","word-spacing","word-wrap","writing-mode","x","y","z-index","zoom"].sort().reverse();function Cs(e){let t=e.regex,n=Jr(e),i={begin:/-(webkit|moz|ms|o)-(?=[a-z])/},s="and or not only",a=/@-?\\w[\\w]*(-\\w+)*/,r="[a-zA-Z-][a-zA-Z0-9_-]*",l=[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE];return{name:"CSS",case_insensitive:!0,illegal:/[=|'\\$]/,keywords:{keyframePosition:"from to"},classNameAliases:{keyframePosition:"selector-tag"},contains:[n.BLOCK_COMMENT,i,n.CSS_NUMBER_MODE,{className:"selector-id",begin:/#[A-Za-z0-9_-]+/,relevance:0},{className:"selector-class",begin:"\\\\."+r,relevance:0},n.ATTRIBUTE_SELECTOR_MODE,{className:"selector-pseudo",variants:[{begin:":("+ia.join("|")+")"},{begin:":(:)?("+ra.join("|")+")"}]},n.CSS_VARIABLE,{className:"attribute",begin:"\\\\b("+aa.join("|")+")\\\\b"},{begin:/:/,end:/[;}{]/,contains:[n.BLOCK_COMMENT,n.HEXCOLOR,n.IMPORTANT,n.CSS_NUMBER_MODE,...l,{begin:/(url|data-uri)\\(/,end:/\\)/,relevance:0,keywords:{built_in:"url data-uri"},contains:[...l,{className:"string",begin:/[^)]/,endsWithParent:!0,excludeEnd:!0}]},n.FUNCTION_DISPATCH]},{begin:t.lookahead(/@/),end:"[{;]",relevance:0,illegal:/:/,contains:[{className:"keyword",begin:a},{begin:/\\s/,endsWithParent:!0,excludeEnd:!0,relevance:0,keywords:{$pattern:/[a-z-]+/,keyword:s,attribute:sa.join(" ")},contains:[{begin:/[a-z-]+(?=:)/,className:"attribute"},...l,n.CSS_NUMBER_MODE]}]},{className:"selector-tag",begin:"\\\\b("+na.join("|")+")\\\\b"}]}}function Ns(e){let t=e.regex,n=e.COMMENT("--","$"),i={scope:"string",variants:[{begin:/'/,end:/'/,contains:[{match:/''/}]}]},s={begin:/"/,end:/"/,contains:[{match:/""/}]},a=["true","false","unknown"],r=["double precision","large object","with timezone","without timezone"],l=["bigint","binary","blob","boolean","char","character","clob","date","dec","decfloat","decimal","float","int","integer","interval","nchar","nclob","national","numeric","real","row","smallint","time","timestamp","varchar","varying","varbinary"],o=["add","asc","collation","desc","final","first","last","view"],c=["abs","acos","all","allocate","alter","and","any","are","array","array_agg","array_max_cardinality","as","asensitive","asin","asymmetric","at","atan","atomic","authorization","avg","begin","begin_frame","begin_partition","between","bigint","binary","blob","boolean","both","by","call","called","cardinality","cascaded","case","cast","ceil","ceiling","char","char_length","character","character_length","check","classifier","clob","close","coalesce","collate","collect","column","commit","condition","connect","constraint","contains","convert","copy","corr","corresponding","cos","cosh","count","covar_pop","covar_samp","create","cross","cube","cume_dist","current","current_catalog","current_date","current_default_transform_group","current_path","current_role","current_row","current_schema","current_time","current_timestamp","current_path","current_role","current_transform_group_for_type","current_user","cursor","cycle","date","day","deallocate","dec","decimal","decfloat","declare","default","define","delete","dense_rank","deref","describe","deterministic","disconnect","distinct","double","drop","dynamic","each","element","else","empty","end","end_frame","end_partition","end-exec","equals","escape","every","except","exec","execute","exists","exp","external","extract","false","fetch","filter","first_value","float","floor","for","foreign","frame_row","free","from","full","function","fusion","get","global","grant","group","grouping","groups","having","hold","hour","identity","in","indicator","initial","inner","inout","insensitive","insert","int","integer","intersect","intersection","interval","into","is","join","json_array","json_arrayagg","json_exists","json_object","json_objectagg","json_query","json_table","json_table_primitive","json_value","lag","language","large","last_value","lateral","lead","leading","left","like","like_regex","listagg","ln","local","localtime","localtimestamp","log","log10","lower","match","match_number","match_recognize","matches","max","member","merge","method","min","minute","mod","modifies","module","month","multiset","national","natural","nchar","nclob","new","no","none","normalize","not","nth_value","ntile","null","nullif","numeric","octet_length","occurrences_regex","of","offset","old","omit","on","one","only","open","or","order","out","outer","over","overlaps","overlay","parameter","partition","pattern","per","percent","percent_rank","percentile_cont","percentile_disc","period","portion","position","position_regex","power","precedes","precision","prepare","primary","procedure","ptf","range","rank","reads","real","recursive","ref","references","referencing","regr_avgx","regr_avgy","regr_count","regr_intercept","regr_r2","regr_slope","regr_sxx","regr_sxy","regr_syy","release","result","return","returns","revoke","right","rollback","rollup","row","row_number","rows","running","savepoint","scope","scroll","search","second","seek","select","sensitive","session_user","set","show","similar","sin","sinh","skip","smallint","some","specific","specifictype","sql","sqlexception","sqlstate","sqlwarning","sqrt","start","static","stddev_pop","stddev_samp","submultiset","subset","substring","substring_regex","succeeds","sum","symmetric","system","system_time","system_user","table","tablesample","tan","tanh","then","time","timestamp","timezone_hour","timezone_minute","to","trailing","translate","translate_regex","translation","treat","trigger","trim","trim_array","true","truncate","uescape","union","unique","unknown","unnest","update","upper","user","using","value","values","value_of","var_pop","var_samp","varbinary","varchar","varying","versioning","when","whenever","where","width_bucket","window","with","within","without","year"],u=["abs","acos","array_agg","asin","atan","avg","cast","ceil","ceiling","coalesce","corr","cos","cosh","count","covar_pop","covar_samp","cume_dist","dense_rank","deref","element","exp","extract","first_value","floor","json_array","json_arrayagg","json_exists","json_object","json_objectagg","json_query","json_table","json_table_primitive","json_value","lag","last_value","lead","listagg","ln","log","log10","lower","max","min","mod","nth_value","ntile","nullif","percent_rank","percentile_cont","percentile_disc","position","position_regex","power","rank","regr_avgx","regr_avgy","regr_count","regr_intercept","regr_r2","regr_slope","regr_sxx","regr_sxy","regr_syy","row_number","sin","sinh","sqrt","stddev_pop","stddev_samp","substring","substring_regex","sum","tan","tanh","translate","translate_regex","treat","trim","trim_array","unnest","upper","value_of","var_pop","var_samp","width_bucket"],d=["current_catalog","current_date","current_default_transform_group","current_path","current_role","current_schema","current_transform_group_for_type","current_user","session_user","system_time","system_user","current_time","localtime","current_timestamp","localtimestamp"],p=["create table","insert into","primary key","foreign key","not null","alter table","add constraint","grouping sets","on overflow","character set","respect nulls","ignore nulls","nulls first","nulls last","depth first","breadth first"],m=u,f=[...c,...o].filter(I=>!u.includes(I)),y={scope:"variable",match:/@[a-z0-9][a-z0-9_]*/},R={scope:"operator",match:/[-+*/=%^~]|&&?|\\|\\|?|!=?|<(?:=>?|<|>)?|>[>=]?/,relevance:0},M={match:t.concat(/\\b/,t.either(...m),/\\s*\\(/),relevance:0,keywords:{built_in:m}};function O(I){return t.concat(/\\b/,t.either(...I.map(N=>N.replace(/\\s+/,"\\\\s+"))),/\\b/)}let $={scope:"keyword",match:O(p),relevance:0};function z(I,{exceptions:N,when:ke}={}){let U=ke;return N=N||[],I.map(K=>K.match(/\\|\\d+$/)||N.includes(K)?K:U(K)?\`\${K}|0\`:K)}return{name:"SQL",case_insensitive:!0,illegal:/[{}]|<\\//,keywords:{$pattern:/\\b[\\w\\.]+/,keyword:z(f,{when:I=>I.length<3}),literal:a,type:l,built_in:d},contains:[{scope:"type",match:O(r)},$,M,y,i,s,e.C_NUMBER_MODE,e.C_BLOCK_COMMENT_MODE,n,R]}}P.registerLanguage("javascript",Kt);P.registerLanguage("js",Kt);P.registerLanguage("typescript",Wt);P.registerLanguage("ts",Wt);P.registerLanguage("python",jt);P.registerLanguage("py",jt);P.registerLanguage("bash",Xt);P.registerLanguage("sh",Xt);P.registerLanguage("json",Ts);P.registerLanguage("html",Yt);P.registerLanguage("xml",Yt);P.registerLanguage("css",Cs);P.registerLanguage("sql",Ns);function oa(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}var la={link({href:e,title:t,text:n}){let i=t?\` title="\${t}"\`:"";return\`<a href="\${e}"\${i} target="_blank" rel="noopener noreferrer">\${n}</a>\`},code({text:e,lang:t}){let n=t&&P.getLanguage(t)?t:null,i=n?P.highlight(e,{language:n}).value:P.highlightAuto(e).value,s=n?\` language-\${n}\`:"";return\`<div class="code-block"><button class="copy-btn" data-code="\${oa(e)}">Copy</button><pre><code class="hljs\${s}">\${i}</code></pre></div>\`}};A.use({gfm:!0,breaks:!0,renderer:la});function Qt(e){return A.parse(e)}var Ke=!0;function Rs(){let e=document.getElementById("dash-hdr"),t=document.getElementById("stop-all-btn");e.addEventListener("click",function(){Ke=!Ke,document.getElementById("dash-body").style.display=Ke?"":"none",document.getElementById("dash-icon").textContent=Ke?"\\u25B2":"\\u25BC",e.setAttribute("aria-expanded",String(Ke))}),e.addEventListener("keydown",function(n){(n.key==="Enter"||n.key===" ")&&(n.preventDefault(),e.click())}),t.addEventListener("click",function(){X({type:"stop-all"})})}function Is(e){let t=document.getElementById("dash"),n=document.getElementById("stop-all-btn");if(!e||e.length===0){t.classList.add("hidden"),n.disabled=!0;return}t.classList.remove("hidden");let i=null,s=[];for(let o=0;o<e.length;o++)e[o].type==="master"?i=e[o]:s.push(e[o]);let a=document.getElementById("dash-master");a.innerHTML=i?'<div style="padding:2px 0;color:var(--text-primary)"><strong>Master:</strong> '+(i.model||"unknown")+" \\xA0|\\xA0 "+i.status+"</div>":"";let r=document.getElementById("dash-workers");if(s.length===0)r.innerHTML="",n.disabled=!0;else{n.disabled=!1;let o='<div style="font-weight:500;padding:2px 0">Workers ('+s.length+"):</div>";for(let c=0;c<s.length;c++){let u=s[c],d=u.progress_pct||0,p="s-"+(u.status||"running"),m=u.started_at?Math.floor((Date.now()-new Date(u.started_at).getTime())/1e3)+"s":"",f=String(u.id);o+='<div class="agent-row"><span style="font-family:monospace;color:var(--text-secondary);flex-shrink:0">'+f.slice(0,8)+'</span><span class="abadge '+p+'">'+(u.model||"\\u2014")+'</span><span style="color:var(--text-muted);flex-shrink:0">'+(u.profile||"\\u2014")+'</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary)">'+(u.task_summary||"\\u2014")+'</span><div class="prog-wrap"><div class="prog-bar" style="width:'+d+'%"></div></div><span style="color:var(--text-muted);white-space:nowrap;flex-shrink:0">'+d+'%</span><span style="color:var(--text-muted);white-space:nowrap;flex-shrink:0;min-width:32px;text-align:right">'+m+'</span><button class="stop-btn" title="Stop this worker" aria-label="Stop worker '+f.slice(0,8)+'" data-worker-id="'+f+'">\\u2715</button></div>'}r.innerHTML=o,r.querySelectorAll("[data-worker-id]").forEach(function(c){c.addEventListener("click",function(){X({type:"stop-worker",workerId:c.dataset.workerId})})})}let l=0;for(let o=0;o<e.length;o++)l+=e[o].cost_usd||0;document.getElementById("dash-cost").innerHTML='<div class="dash-cost">Cost: 
</body>
</html>
+l.toFixed(4)+" \\xA0|\\xA0 Active workers: "+s.length+"</div>",document.getElementById("dash-lbl").textContent="Agent Status ("+e.length+" active)"}var je=!1,Re=null,V=null,Se=null,Vt=null,Jt=null,en=null;function Ls(e){Jt=e}function Ms(e){en=e}function ge(){return window.innerWidth>=768}function Os(){je=!0,Re.classList.add("open"),ge()||(V.classList.add("visible"),V.removeAttribute("aria-hidden")),Se.setAttribute("aria-expanded","true"),Se.setAttribute("aria-label","Close sidebar"),Re.setAttribute("aria-hidden","false")}function We(){je=!1,Re.classList.remove("open"),V.classList.remove("visible"),V.setAttribute("aria-hidden","true"),Se.setAttribute("aria-expanded","false"),Se.setAttribute("aria-label","Open sidebar"),Re.setAttribute("aria-hidden","true")}function ca(){je?(We(),ge()&&localStorage.setItem("ob-sidebar-open","false")):(Os(),ge()&&localStorage.setItem("ob-sidebar-open","true"))}function Ds(e){if(!e)return"";let t=new Date(e),n=Math.floor((Date.now()-t.getTime())/1e3);return n<60?"just now":n<3600?Math.floor(n/60)+"m ago":n<86400?Math.floor(n/3600)+"h ago":n<86400*7?Math.floor(n/86400)+"d ago":t.toLocaleDateString(void 0,{month:"short",day:"numeric"})}function ua(e,t){let n=document.createElement("div");n.className="sidebar-session-item"+(t?" active":""),n.setAttribute("role","listitem"),n.setAttribute("tabindex","0"),n.dataset.sessionId=e.session_id;let i=document.createElement("div");i.className="sidebar-session-title",i.textContent=e.title||"Conversation";let s=document.createElement("div");s.className="sidebar-session-meta";let a=document.createElement("span");a.textContent=Ds(e.last_message_at);let r=document.createElement("span"),l=e.message_count||0;return r.textContent=l+(l===1?" msg":" msgs"),s.appendChild(a),s.appendChild(r),n.appendChild(i),n.appendChild(s),n}async function Xe(e){let t=document.getElementById("sidebar-sessions");if(!t)return;let n;try{let a=await fetch("/api/sessions?limit=50");if(!a.ok)return;n=await a.json()}catch{return}if(!Array.isArray(n)||n.length===0){t.innerHTML='<div class="sidebar-empty">No conversations yet.</div>';return}let i=e??n[0].session_id;Vt=i;let s=document.createDocumentFragment();for(let a of n){let r=ua(a,a.session_id===i);s.appendChild(r)}t.replaceChildren(s)}function tn(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function da(e,t,n){if(!e)return"";n=n||120;let i=t.trim().split(/\\s+/).filter(Boolean),s=-1;for(let o=0;o<i.length;o++){let c=e.toLowerCase().indexOf(i[o].toLowerCase());if(c!==-1){s=c;break}}if(s===-1)return e.slice(0,n)+(e.length>n?"\\u2026":"");let a=Math.max(0,s-30),r=Math.min(e.length,a+n),l=e.slice(a,r);return(a>0?"\\u2026":"")+l+(r<e.length?"\\u2026":"")}function pa(e,t){if(!e)return"";let n=tn(e),i=t.trim().split(/\\s+/).filter(Boolean);if(i.length===0)return n;let s=i.map(function(r){return tn(r).replace(/[.*+?^\${}()|[\\]\\\\]/g,"\\\\<script src="js/app.js" type="module"></script>")}).join("|"),a=new RegExp("("+s+")","gi");return n.replace(a,'<mark class="sidebar-match">$1</mark>')}function ga(e,t){let n=document.createElement("div");n.className="sidebar-session-item sidebar-search-result",n.setAttribute("role","listitem"),n.setAttribute("tabindex","0"),n.dataset.sessionId=e.session_id;let i=da(e.content,t),s=pa(i,t),a=document.createElement("div");a.className="sidebar-search-snippet",a.innerHTML=s;let r=document.createElement("div");r.className="sidebar-session-meta";let l=document.createElement("span");l.textContent=e.role==="user"?"You":"AI";let o=document.createElement("span");return o.textContent=Ds(e.created_at),r.appendChild(l),r.appendChild(o),n.appendChild(a),n.appendChild(r),n}async function ha(e){let t=document.getElementById("sidebar-sessions");if(!t)return;t.innerHTML='<div class="sidebar-empty">Searching\\u2026</div>';let n;try{let s=await fetch("/api/sessions/search?q="+encodeURIComponent(e)+"&limit=20");if(!s.ok){t.innerHTML='<div class="sidebar-empty">Search failed.</div>';return}n=await s.json()}catch{t.innerHTML='<div class="sidebar-empty">Search failed.</div>';return}if(!Array.isArray(n)||n.length===0){t.innerHTML='<div class="sidebar-empty">No results for \\u201C'+tn(e)+"\\u201D.</div>";return}let i=document.createDocumentFragment();for(let s of n)i.appendChild(ga(s,e));t.replaceChildren(i)}function Bs(){if(Re=document.getElementById("sidebar"),V=document.getElementById("sidebar-overlay"),Se=document.getElementById("sidebar-toggle"),!Re||!V||!Se)return;Se.addEventListener("click",ca);let e=document.getElementById("new-conversation-btn");e&&e.addEventListener("click",function(){en&&en(),ge()||We()}),V.addEventListener("click",function(){We()}),document.addEventListener("keydown",function(s){s.key==="Escape"&&je&&!ge()&&We()}),window.addEventListener("resize",function(){je&&(ge()?(V.classList.remove("visible"),V.setAttribute("aria-hidden","true")):(V.classList.add("visible"),V.removeAttribute("aria-hidden")))});let t=document.getElementById("sidebar-sessions");t&&(t.addEventListener("click",function(s){let a=s.target.closest(".sidebar-session-item");if(!a)return;let r=a.dataset.sessionId;r&&(t.querySelectorAll(".sidebar-session-item").forEach(function(l){l.classList.toggle("active",l===a)}),Vt=r,ge()||We(),Jt&&Jt(r))}),t.addEventListener("keydown",function(s){if(s.key!=="Enter"&&s.key!==" ")return;let a=s.target.closest(".sidebar-session-item");a&&(s.preventDefault(),a.click())}));let n=document.getElementById("sidebar-search-input"),i=null;n&&n.addEventListener("input",function(){clearTimeout(i);let s=n.value.trim();if(!s){Xe(Vt);return}i=setTimeout(function(){ha(s)},300)}),ge()&&localStorage.getItem("ob-sidebar-open")!=="false"&&Os()}var nn=[{name:"/history",description:"Show conversation history"},{name:"/stop",description:"Stop the current worker"},{name:"/status",description:"Show agent status"},{name:"/deep",description:"Enable deep mode for complex tasks"},{name:"/audit",description:"Run a workspace audit"},{name:"/scope",description:"Show or change task scope"},{name:"/apps",description:"List connected apps"},{name:"/help",description:"Show available commands"},{name:"/doctor",description:"Run system health diagnostics"},{name:"/confirm",description:"Confirm a pending action"},{name:"/skip",description:"Skip a pending confirmation"}],le=null,Ie=null;async function fa(){return le!==null?le:(Ie!==null||(Ie=fetch("/api/commands").then(function(e){if(!e.ok)throw new Error("HTTP "+e.status);return e.json()}).then(function(e){return Array.isArray(e)&&e.length>0?le=e:le=nn,Ie=null,le}).catch(function(){return le=nn,Ie=null,le})),Ie)}function Ps(e){if(!e)return;let t=e.closest(".inp-wrap");if(!t)return;fa();let n=document.createElement("ul");n.className="autocomplete-dropdown",n.setAttribute("role","listbox"),n.setAttribute("aria-label","Command suggestions"),n.id="autocomplete-dropdown",e.setAttribute("aria-autocomplete","list"),e.setAttribute("aria-controls","autocomplete-dropdown"),t.appendChild(n);let i=-1,s=!1,a=[];function r(d){a=d,i=-1,s=!0,n.replaceChildren();for(let p=0;p<d.length;p++){let m=d[p],f=document.createElement("li");f.className="autocomplete-item",f.setAttribute("role","option"),f.setAttribute("aria-selected","false"),f.dataset.index=String(p);let y=document.createElement("span");y.className="autocomplete-cmd",y.textContent=m.name;let R=document.createElement("span");R.className="autocomplete-desc",R.textContent=m.description,f.appendChild(y),f.appendChild(R),f.addEventListener("mousedown",function(M){M.preventDefault(),c(p)}),n.appendChild(f)}n.classList.add("visible"),e.setAttribute("aria-expanded","true")}function l(){s=!1,i=-1,n.classList.remove("visible"),n.replaceChildren(),e.setAttribute("aria-expanded","false")}function o(d){n.querySelectorAll(".autocomplete-item").forEach(function(m,f){f===d?(m.classList.add("active"),m.setAttribute("aria-selected","true"),m.scrollIntoView({block:"nearest"})):(m.classList.remove("active"),m.setAttribute("aria-selected","false"))}),i=d}function c(d){let p=a[d];p&&(e.value=p.name+" ",e.dispatchEvent(new Event("input")),e.focus(),l())}function u(){let d=e.value;return!d.startsWith("/")||d.includes(" ")?null:d}e.addEventListener("input",function(){let d=u();if(d===null){l();return}let p=d.toLowerCase(),f=(le!==null?le:nn).filter(function(y){return y.name.startsWith(p)});f.length===0?l():r(f)}),e.addEventListener("keydown",function(d){if(s)if(d.key==="ArrowDown"){d.preventDefault();let p=Math.min(i+1,a.length-1);o(p)}else if(d.key==="ArrowUp"){d.preventDefault();let p=Math.max(i-1,0);o(p)}else if(d.key==="Enter")i>=0&&(d.preventDefault(),d.stopPropagation(),c(i));else if(d.key==="Tab"){if(a.length>0){d.preventDefault();let p=i>=0?i:0;c(p)}}else d.key==="Escape"&&l()}),e.addEventListener("blur",function(){setTimeout(l,150)})}var J=null,Ae=null,an=!1,sn=null,rn=null;function zs(e){sn=e}function Us(e){rn=e}function $s(){return an}function ma(){if(!J||!Ae)return;an=!0,J.classList.add("open"),Ae.classList.add("visible"),J.setAttribute("aria-hidden","false");let e=document.getElementById("settings-theme-select");e&&(e.value=document.documentElement.getAttribute("data-theme")||"light");let t=J.querySelector(".settings-close-btn");t&&t.focus()}function ft(){if(!J||!Ae)return;an=!1,J.classList.remove("open"),Ae.classList.remove("visible"),J.setAttribute("aria-hidden","true");let e=document.getElementById("settings-btn");e&&e.focus()}function ba(e){document.documentElement.setAttribute("data-theme",e),localStorage.setItem("ob-theme",e);let t=document.getElementById("theme-toggle");t&&(t.textContent=e==="dark"?"Light":"Dark");let n=document.getElementById("settings-theme-select");n&&(n.value=e),sn&&sn(e)}function ka(){let e=document.getElementById("settings-tool-select");e&&fetch("/api/discovery").then(function(t){return t.ok?t.json():null}).then(function(t){if(!t||!Array.isArray(t.tools))return;for(;e.options.length>1;)e.remove(1);for(let i of t.tools){let s=document.createElement("option");s.value=i.name||i.id||"",s.textContent=(i.name||i.id||"Unknown")+(i.version?" v"+i.version:""),e.appendChild(s)}let n=localStorage.getItem("ob-preferred-tool");n&&(e.value=n)}).catch(function(){})}function Ea(){let e=document.getElementById("settings-tool-select");if(!e)return;let t=localStorage.getItem("ob-preferred-tool");t&&(e.value=t),e.addEventListener("change",function(){localStorage.setItem("ob-preferred-tool",e.value)})}function ya(e){fetch("/api/webchat/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({profile:e})}).catch(function(){})}function xa(){let e=document.querySelectorAll('input[name="settings-profile"]');if(!e.length)return;let t=localStorage.getItem("ob-exec-profile")||"thorough";for(let n of e)if(n.value===t){n.checked=!0;break}for(let n of e)n.addEventListener("change",function(){n.checked&&(localStorage.setItem("ob-exec-profile",n.value),ya(n.value))})}function wa(){let e=document.getElementById("settings-sound-check"),t=document.getElementById("settings-browser-notify-check");e&&(e.checked=localStorage.getItem("ob-sound")!=="false",e.addEventListener("change",function(){let n=!e.checked;localStorage.setItem("ob-sound",n?"false":"true");let i=document.getElementById("sound-toggle");i&&(i.textContent=n?"\\u{1F507}":"\\u{1F50A}",i.setAttribute("aria-label",n?"Unmute notifications":"Mute notifications"),i.setAttribute("aria-pressed",n?"true":"false")),rn&&rn(!n)})),t&&(t.checked=Notification&&Notification.permission==="granted",t.addEventListener("change",function(){t.checked&&"Notification"in window&&Notification.requestPermission().then(function(n){t.checked=n==="granted"})}))}function _a(){let e=document.getElementById("settings-theme-select");if(!e)return;let t=document.documentElement.getAttribute("data-theme")||"light";e.value=t,e.addEventListener("change",function(){ba(e.value)})}function Hs(){J=document.getElementById("settings-panel"),Ae=document.getElementById("settings-overlay");let e=document.getElementById("settings-btn"),t=J&&J.querySelector(".settings-close-btn");!J||!Ae||!e||(e.addEventListener("click",function(){$s()?ft():(ka(),ma())}),t&&t.addEventListener("click",ft),Ae.addEventListener("click",ft),document.addEventListener("keydown",function(n){n.key==="Escape"&&$s()&&ft()}),Ea(),xa(),wa(),_a())}var on=["investigate","report","plan","execute","verify"],Me={investigate:"Investigate",report:"Report",plan:"Plan",execute:"Execute",verify:"Verify"},va={investigate:"\\u{1F50D}",report:"\\u{1F4CB}",plan:"\\u{1F4DD}",execute:"\\u2699\\uFE0F",verify:"\\u2705"},Sa={investigate:"blue",report:"purple",plan:"orange",execute:"green",verify:"teal"},Aa=new Set(["investigate","report"]),Ta=new Set(["plan"]),kt=null,ie=null,Ye=new Map,he=new Map,Le=new Map,re=null,Qe=!1,et=null,ce=null,Ve=null,fe=null,Je=null,me=null;function Ca(){return kt||(kt=document.getElementById("deep-mode-bar")),kt}function mt(){let e=Ca();if(!e)return;if(!re){e.classList.add("hidden");return}let t=he.get(re)||new Set,n=Le.get(re)||null;e.classList.remove("hidden"),e.querySelectorAll(".dm-phase-dot").forEach(function(s){let a=s.dataset.phase;s.classList.remove("dm-phase-current","dm-phase-done","dm-phase-pending");let r=s.querySelector(".dm-phase-icon");t.has(a)?(s.classList.add("dm-phase-done"),r&&(r.textContent="\\u2713"),s.setAttribute("aria-label",(Me[a]||a)+" \\u2014 completed")):a===n?(s.classList.add("dm-phase-current"),r&&(r.textContent="\\u25CF"),s.setAttribute("aria-label",(Me[a]||a)+" \\u2014 in progress")):(s.classList.add("dm-phase-pending"),r&&(r.textContent="\\u25CB"),s.setAttribute("aria-label",(Me[a]||a)+" \\u2014 pending"))})}function bt(){if(!ce)return;let t=!!re&&!Qe;ce.disabled=!t;let n=t&&Aa.has(et);fe.disabled=!n,Ve.disabled=!n;let i=t&&Ta.has(et);me.disabled=!i,Je.disabled=!i}function Fs(e){let t=document.createElement("select");t.className="dm-num-select",t.setAttribute("aria-label",e);for(let n=1;n<=10;n++){let i=document.createElement("option");i.value=String(n),i.textContent=String(n),t.appendChild(i)}return t}function ln(e,t,n){let i=Sa[e]||"blue",s=va[e]||"\\u25C9",a=Me[e]||e,r=document.createElement("div");r.className="dm-phase-card dm-phase-card--"+i+" dm-phase-card--"+t,r.dataset.phase=e,r.dataset.status=t;let l=document.createElement("div");l.className="dm-card-header";let o=document.createElement("span");o.className="dm-card-icon",o.setAttribute("aria-hidden","true"),o.textContent=s;let c=document.createElement("span");c.className="dm-card-name",c.textContent=a;let u=document.createElement("span");if(u.className="dm-card-status",t==="started"){u.textContent="In progress\\u2026";let d=document.createElement("span");d.className="dm-card-spinner",d.setAttribute("aria-hidden","true"),l.appendChild(o),l.appendChild(c),l.appendChild(u),l.appendChild(d)}else t==="completed"?(u.textContent="Completed",l.appendChild(o),l.appendChild(c),l.appendChild(u)):t==="skipped"?(u.textContent="Skipped",l.appendChild(o),l.appendChild(c),l.appendChild(u)):(u.textContent="Aborted",l.appendChild(o),l.appendChild(c),l.appendChild(u));if(r.appendChild(l),n&&(t==="completed"||t==="skipped")){let d=document.createElement("div");d.className="dm-card-body";let p=document.createElement("div");if(p.className="dm-card-summary",p.textContent=n,d.appendChild(p),n.length>200){p.classList.add("dm-card-summary--collapsed");let m=document.createElement("button");m.className="dm-card-toggle",m.textContent="Show more",m.setAttribute("aria-expanded","false"),m.addEventListener("click",function(){m.getAttribute("aria-expanded")==="true"?(p.classList.add("dm-card-summary--collapsed"),m.textContent="Show more",m.setAttribute("aria-expanded","false")):(p.classList.remove("dm-card-summary--collapsed"),m.textContent="Show less",m.setAttribute("aria-expanded","true"))}),d.appendChild(m)}r.appendChild(d)}return r}function Na(e,t,n,i){if(!ie)return;let s=e+":"+t;if(n==="started"){let a=ln(t,n,i);requestAnimationFrame(function(){a.classList.add("dm-phase-card--enter")}),Ye.set(s,a),ie.appendChild(a),ie.scrollTop=ie.scrollHeight}else{let a=Ye.get(s);if(a){let r=ln(t,n,i);a.replaceWith(r),requestAnimationFrame(function(){r.classList.add("dm-phase-card--enter")}),Ye.set(s,r),ie.scrollTop=ie.scrollHeight}else{let r=ln(t,n,i);requestAnimationFrame(function(){r.classList.add("dm-phase-card--enter")}),Ye.set(s,r),ie.appendChild(r),ie.scrollTop=ie.scrollHeight}n==="aborted"&&Ye.delete(s)}}function Gs(e){e&&(ie=e);let t=document.getElementById("deep-mode-bar");if(!t)return;kt=t;let n=t.querySelector(".dm-track");if(!n)return;n.replaceChildren();for(let r=0;r<on.length;r++){let l=on[r],o=document.createElement("div");o.className="dm-phase-item";let c=document.createElement("div");c.className="dm-phase-dot dm-phase-pending",c.dataset.phase=l,c.setAttribute("aria-label",(Me[l]||l)+" \\u2014 pending");let u=document.createElement("span");u.className="dm-phase-icon",u.setAttribute("aria-hidden","true"),u.textContent="\\u25CB";let d=document.createElement("span");if(d.className="dm-phase-label",d.textContent=Me[l]||l,c.appendChild(u),o.appendChild(c),o.appendChild(d),n.appendChild(o),r<on.length-1){let p=document.createElement("div");p.className="dm-connector",p.setAttribute("aria-hidden","true"),n.appendChild(p)}}let i=document.createElement("div");i.className="dm-actions",ce=document.createElement("button"),ce.className="dm-proceed-btn",ce.textContent="Proceed",ce.setAttribute("aria-label","Proceed to next Deep Mode phase"),ce.disabled=!0,ce.addEventListener("click",function(){X({type:"message",content:"/proceed"})}),i.appendChild(ce);let s=document.createElement("div");s.className="dm-action-group",Ve=Fs("Finding number to focus on"),Ve.disabled=!0,fe=document.createElement("button"),fe.className="dm-action-btn",fe.textContent="Focus on #",fe.setAttribute("aria-label","Focus investigation on a specific finding"),fe.disabled=!0,fe.addEventListener("click",function(){X({type:"message",content:"/focus "+Ve.value})}),s.appendChild(Ve),s.appendChild(fe),i.appendChild(s);let a=document.createElement("div");a.className="dm-action-group",Je=Fs("Task number to skip"),Je.disabled=!0,me=document.createElement("button"),me.className="dm-action-btn",me.textContent="Skip #",me.setAttribute("aria-label","Skip a specific task in the plan"),me.disabled=!0,me.addEventListener("click",function(){X({type:"message",content:"/skip "+Je.value})}),a.appendChild(Je),a.appendChild(me),i.appendChild(a),t.appendChild(i)}function qs(e){let{sessionId:t,phase:n,status:i,result:s}=e;Na(t,n,i,s),i==="started"?(re=t,Qe=!0,he.has(t)||he.set(t,new Set),Le.set(t,n),mt(),bt()):i==="completed"||i==="skipped"?(re=t,Qe=!1,et=n,he.has(t)||he.set(t,new Set),he.get(t).add(n),Le.get(t)===n&&Le.delete(t),mt(),bt(),n==="verify"&&setTimeout(function(){he.delete(t),Le.delete(t),re===t&&(re=null),et=null,Qe=!1,mt(),bt()},3e3)):i==="aborted"&&(he.delete(t),Le.delete(t),re===t&&(re=null),et=null,Qe=!1,mt(),bt())}var D=document.getElementById("msgs"),Xs=document.getElementById("form"),Z=document.getElementById("inp"),Ra=document.getElementById("send"),Ia=document.getElementById("dot"),cn=document.getElementById("connLabel"),Ys=document.getElementById("status-bar"),Qs=document.getElementById("status-text"),gn=document.getElementById("status-timer"),Oe=null,hn=null,La=typeof crypto<"u"&&typeof crypto.randomUUID=="function"?crypto.randomUUID():Math.random().toString(36).slice(2),un=0;(function(){let t=window.__OB_PUBLIC_URL__;if(!t)return;let n=document.getElementById("public-url-bar"),i=document.getElementById("public-url-text"),s=document.getElementById("url-copy-btn");!n||!i||!s||(i.textContent=t,n.classList.remove("hidden"),n.classList.add("visible"),s.addEventListener("click",function(){navigator.clipboard.writeText(t).then(function(){s.textContent="Copied!",s.classList.add("copied"),setTimeout(function(){s.textContent="Copy",s.classList.remove("copied")},2e3)},function(){let a=document.createElement("textarea");a.value=t,a.style.position="fixed",a.style.opacity="0",document.body.appendChild(a),a.select(),document.execCommand("copy"),document.body.removeChild(a),s.textContent="Copied!",s.classList.add("copied"),setTimeout(function(){s.textContent="Copy",s.classList.remove("copied")},2e3)})}))})();(function(){let t=document.getElementById("share-btn"),n=document.getElementById("share-toast");if(!t||!n)return;let i=null;function s(){i&&clearTimeout(i),n.classList.add("visible"),i=setTimeout(function(){n.classList.remove("visible"),i=null},2e3)}t.addEventListener("click",function(){let a=window.location.href;navigator.clipboard.writeText(a).then(function(){s()},function(){let r=document.createElement("textarea");r.value=a,r.style.position="fixed",r.style.opacity="0",document.body.appendChild(r),r.select(),document.execCommand("copy"),document.body.removeChild(r),s()})})})();var tt=localStorage.getItem("ob-ts")!=="false";function kn(e){let t=Math.floor((Date.now()-e.getTime())/1e3);return t<60?"just now":t<3600?Math.floor(t/60)+"m ago":t<86400?Math.floor(t/3600)+"h ago":Math.floor(t/86400)+"d ago"}function Zs(){let e=document.getElementById("ts-toggle");e&&(e.textContent=tt?"Hide times":"Show times"),document.documentElement.setAttribute("data-ts",tt?"show":"hide")}(function(){Zs();let t=document.getElementById("ts-toggle");t&&t.addEventListener("click",function(){tt=!tt,localStorage.setItem("ob-ts",tt?"true":"false"),Zs()}),setInterval(function(){D.querySelectorAll("time.bubble-ts").forEach(function(n){n.textContent=kn(new Date(n.dateTime))})},6e4)})();(function(){let t=document.getElementById("theme-toggle");function n(i){document.documentElement.setAttribute("data-theme",i),t.textContent=i==="dark"?"Light":"Dark",localStorage.setItem("ob-theme",i)}n(localStorage.getItem("ob-theme")||"light"),t.addEventListener("click",function(){let s=document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark";n(s);let a=document.getElementById("settings-theme-select");a&&(a.value=s)})})();var En="ob-conversation",fn=100,be=[],De=!0;function Ma(){try{localStorage.setItem(En,JSON.stringify(be))}catch{}}function Oa(e,t,n){De&&(be.push({content:e,cls:t,ts:(n instanceof Date?n:new Date).toISOString()}),be.length>fn&&(be=be.slice(-fn)),Ma())}function Vs(){be=[];try{localStorage.removeItem(En)}catch{}}function Da(){try{let e=localStorage.getItem(En);if(!e)return;let t=JSON.parse(e);if(!Array.isArray(t)||t.length===0)return;De=!1,be=t.slice(-fn);for(let n of be)(n.cls==="user"||n.cls==="ai")&&G(n.content,n.cls,n.ts?new Date(n.ts):new Date);De=!0}catch{De=!0}}function Js(e){let t=document.createElement("div");return t.className="avatar avatar-"+e,t.setAttribute("aria-hidden","true"),t.textContent=e==="user"?"You":"AI",t}function G(e,t,n){let i=document.createElement("div");if(i.className="bubble "+t,t==="ai"){let s=Qt(e);if(e.length>500){let a=document.createElement("div");a.className="collapsible-wrap";let r=document.createElement("div");r.className="collapsible-inner",r.style.maxHeight="120px",r.innerHTML=s;let l=document.createElement("div");l.className="collapsible-fade";let o=document.createElement("button");o.className="show-more-btn",o.textContent="Show more",o.setAttribute("aria-expanded","false"),o.addEventListener("click",function(){o.getAttribute("aria-expanded")==="false"?(r.style.maxHeight=r.scrollHeight+"px",l.style.display="none",o.textContent="Show less",o.setAttribute("aria-expanded","true")):(r.style.maxHeight="120px",l.style.display="",o.textContent="Show more",o.setAttribute("aria-expanded","false"))}),a.appendChild(r),a.appendChild(l),i.appendChild(a),i.appendChild(o)}else i.innerHTML=s}else i.textContent=e;if(t!=="sys"){let s=n instanceof Date?n:new Date,a=document.createElement("time");if(a.className="bubble-ts",a.dateTime=s.toISOString(),a.title=s.toLocaleString(),a.textContent=kn(s),i.appendChild(a),t==="ai"){un++;let l=document.createElement("div");l.className="feedback-row";let o=document.createElement("button");o.type="button",o.className="feedback-btn",o.setAttribute("aria-label","Good response"),o.dataset.rating="up",o.dataset.msgIdx=String(un),o.textContent="\\u{1F44D}";let c=document.createElement("button");c.type="button",c.className="feedback-btn",c.setAttribute("aria-label","Poor response"),c.dataset.rating="down",c.dataset.msgIdx=String(un),c.textContent="\\u{1F44E}",l.appendChild(o),l.appendChild(c),i.appendChild(l)}let r=document.createElement("div");r.className="msg-row "+t,r.appendChild(Js(t)),r.appendChild(i),D.appendChild(r)}else D.appendChild(i);return D.scrollTop=D.scrollHeight,(t==="user"||t==="ai")&&Oa(e,t,n instanceof Date?n:new Date),i}D.addEventListener("click",function(e){let t=e.target.closest(".copy-btn");if(!t)return;let n=t.dataset.code;n&&navigator.clipboard.writeText(n).then(function(){t.textContent="Copied!",t.classList.add("copied"),setTimeout(function(){t.textContent="Copy",t.classList.remove("copied")},2e3)})});var Ks=(function(){let e=document.createElement("div");return e.className="feedback-toast",e.textContent="Thanks!",document.body.appendChild(e),e})(),Et=null;function Ba(){Et&&clearTimeout(Et),Ks.classList.add("visible"),Et=setTimeout(function(){Ks.classList.remove("visible"),Et=null},2e3)}D.addEventListener("click",function(e){let t=e.target.closest(".feedback-btn");if(!t||t.disabled)return;let n=t.dataset.rating,i=t.dataset.msgIdx,s=t.closest(".feedback-row");s&&s.querySelectorAll(".feedback-btn").forEach(function(a){a.disabled=!0,a.dataset.rating===n&&a.classList.add(n==="up"?"active-up":"active-down")}),Ba(),fetch("/api/feedback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({session:La,message:i,rating:n})}).catch(function(){})});function Pa(){Oe||(hn=Date.now(),gn.textContent="0s",Oe=setInterval(function(){let e=Math.floor((Date.now()-hn)/1e3);gn.textContent=e+"s"},1e3))}function $a(){Oe&&(clearInterval(Oe),Oe=null),hn=null,gn.textContent=""}function mn(e){Ys.classList.remove("hidden"),Qs.innerHTML=e,Oe||Pa()}function yt(){Ys.classList.add("hidden"),Qs.innerHTML="",$a()}function za(e){if(e.type==="classifying")return'\\u{1F50D} Analyzing request<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>';if(e.type==="planning")return'\\u{1F4CB} Planning subtasks<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>';if(e.type==="spawning"){let t=e.workerCount;return"\\u{1F4CB} Breaking into "+t+" subtask"+(t!==1?"s":"")+'<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>'}return e.type==="worker-progress"?(e.workerName?"\\u2699\\uFE0F "+e.workerName+": ":"\\u2699\\uFE0F ")+e.completed+"/"+e.total+' workers done<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>':e.type==="synthesizing"?'\\u{1F4DD} Preparing final response<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>':e.type==="exploring"?"\\u{1F5FA}\\uFE0F "+e.phase+'<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>':e.type==="exploring-directory"?"\\u{1F4C2} Exploring directories: "+e.completed+"/"+e.total+(e.directory?" ("+e.directory+")":"")+'<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>':null}function Ws(e,t){Ia.className="conn-dot"+(e?" online":""),e?cn.textContent="Connected":t?cn.textContent="Reconnecting...":cn.textContent="Disconnected",Z.disabled=!e,Ra.disabled=!e;let n=document.getElementById("upload-btn");n&&(n.disabled=!e);let i=document.getElementById("mic-btn");i&&(i.disabled=!e)}function Ua(e){if(e.type==="response")yt(),G(e.content,"ai",e.timestamp?new Date(e.timestamp):new Date),Fa(),qa(e.content),wn(),Xe();else if(e.type==="download"){yt();let t=e.timestamp?new Date(e.timestamp):new Date,n=document.createElement("div");n.className="bubble ai",e.content&&(n.innerHTML=Qt(e.content)+"<br>");let i=document.createElement("a");i.href=e.url,i.download=e.filename||"download",i.className="download-link",i.textContent="\\u2B07\\uFE0F Download "+(e.filename||"file"),i.setAttribute("aria-label","Download "+(e.filename||"file")),n.appendChild(i);let s=document.createElement("time");s.className="bubble-ts",s.dateTime=t.toISOString(),s.title=t.toLocaleString(),s.textContent=kn(t),n.appendChild(s);let a=document.createElement("div");a.className="msg-row ai",a.appendChild(Js("ai")),a.appendChild(n),D.appendChild(a),D.scrollTop=D.scrollHeight}else if(e.type==="typing")mn('\\u{1F914} Thinking<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>');else if(e.type==="progress"){if(e.event&&e.event.type==="complete")yt();else if(e.event&&e.event.type==="worker-result"){let t=e.event.success?"\\u2705":"\\u274C",n=e.event.tool?" \\xB7 "+e.event.tool:"",i=t+" **Subtask "+e.event.workerIndex+"/"+e.event.total+"** ("+e.event.profile+n+\`):

\`;G(i+e.event.content,"ai",new Date)}else if(e.event&&e.event.type==="worker-cancelled")G("\\u{1F6D1} Worker "+e.event.workerId+" was stopped by "+e.event.cancelledBy+".","sys");else if(e.event&&e.event.type==="deep-phase")qs(e.event);else if(e.event){let t=za(e.event);t&&mn(t)}}else e.type==="agent-status"&&Is(e.agents)}var dn=document.getElementById("char-count");function yn(){Z.style.height="auto",Z.style.height=Z.scrollHeight+"px"}function xn(){let e=Z.value.length;e>500?(dn.textContent=e.toLocaleString()+" chars",dn.classList.remove("hidden")):dn.classList.add("hidden")}Z.addEventListener("input",function(){yn(),xn()});Z.addEventListener("keydown",function(e){e.key==="Enter"&&!e.shiftKey?(e.preventDefault(),Xs.requestSubmit()):e.key==="Escape"&&(Z.value="",yn(),xn())});Xs.addEventListener("submit",function(e){e.preventDefault();let t=Z.value.trim(),n=ue.length>0;if(!t&&!n||!Rn())return;let i=ue.slice();if(ue=[],xt(),G(t||"(\\u{1F4CE} file upload)","user",new Date),Z.value="",yn(),xn(),mn('\\u{1F914} Thinking<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>'),i.length===0){X({type:"message",content:t});return}Promise.all(i.map(function(a){let r=new FormData;return r.append("file",a,a.name),fetch("/api/upload",{method:"POST",body:r}).then(function(l){return l.ok?l.json():null}).catch(function(){return null})})).then(function(a){let r=a.filter(function(o){return o&&o.fileId}).map(function(o){return"- "+o.filename+" (path: "+o.path+")"}),l=t;r.length>0&&(l&&(l+=\`

\`),l+=\`[Attached files]
\`+r.join(\`
\`)),l||(l="[File upload failed \\u2014 no files were saved]"),X({type:"message",content:l})})});var ue=[];function Ha(e){return e<1024?e+" B":e<1024*1024?(e/1024).toFixed(1)+" KB":(e/(1024*1024)).toFixed(1)+" MB"}function xt(){let e=document.getElementById("file-preview");if(e){if(ue.length===0){e.classList.add("hidden"),e.replaceChildren();return}e.classList.remove("hidden"),e.replaceChildren();for(let t=0;t<ue.length;t++){let n=ue[t],i=document.createElement("div");i.className="file-chip";let s=document.createElement("span");s.className="file-chip-icon",s.setAttribute("aria-hidden","true"),s.textContent="\\u{1F4C4}";let a=document.createElement("span");a.className="file-chip-info";let r=document.createElement("span");r.className="file-chip-name",r.textContent=n.name;let l=document.createElement("span");l.className="file-chip-meta",l.textContent=Ha(n.size)+(n.type?" \\xB7 "+n.type:""),a.appendChild(r),a.appendChild(l);let o=document.createElement("button");o.type="button",o.className="file-chip-remove",o.setAttribute("aria-label","Remove "+n.name),o.textContent="\\xD7";let c=t;o.addEventListener("click",function(){ue.splice(c,1),xt()}),i.appendChild(s),i.appendChild(a),i.appendChild(o),e.appendChild(i)}}}(function(){let t=document.getElementById("upload-btn"),n=document.getElementById("file-input"),i=document.querySelector(".chat-wrap");!t||!n||(t.addEventListener("click",function(){n.click()}),n.addEventListener("change",function(){let s=Array.from(n.files||[]);for(let a of s)ue.push(a);n.value="",xt()}),i&&(i.addEventListener("dragover",function(s){s.preventDefault(),i.classList.add("drag-over")}),i.addEventListener("dragleave",function(s){i.contains(s.relatedTarget)||i.classList.remove("drag-over")}),i.addEventListener("drop",function(s){s.preventDefault(),i.classList.remove("drag-over");let a=Array.from(s.dataTransfer?s.dataTransfer.files:[]);for(let r of a)ue.push(r);xt()})))})();(function(){let t=document.getElementById("mic-btn");if(!t)return;if(typeof MediaRecorder>"u"||!navigator.mediaDevices){t.style.display="none";return}let n=null,i=[],s=null;function a(){if(s)return;let c=document.getElementById("file-preview");c&&(s=document.createElement("div"),s.className="recording-indicator",s.innerHTML='<span class="recording-dot"></span>Recording\\u2026',c.classList.remove("hidden"),c.appendChild(s))}function r(){if(!s)return;let c=document.getElementById("file-preview");s.remove(),s=null,c&&c.children.length===0&&c.classList.add("hidden")}function l(){i=[],navigator.mediaDevices.getUserMedia({audio:!0}).then(function(c){let u=MediaRecorder.isTypeSupported("audio/webm")?"audio/webm":"audio/ogg";n=new MediaRecorder(c,{mimeType:u}),n.addEventListener("dataavailable",function(d){d.data&&d.data.size>0&&i.push(d.data)}),n.addEventListener("stop",function(){c.getTracks().forEach(function(f){f.stop()});let d=new Blob(i,{type:u});i=[],r(),t.classList.remove("recording"),t.title="Record voice message",t.setAttribute("aria-label","Record voice message");let p=u==="audio/webm"?".webm":".ogg",m=new FormData;m.append("file",d,"voice"+p),G("\\u{1F3A4} Transcribing voice\\u2026","sys"),fetch("/api/transcribe",{method:"POST",body:m}).then(function(f){return f.ok?f.json():Promise.reject(f.status)}).then(function(f){if(f&&f.text){Z.value=f.text,Z.dispatchEvent(new Event("input")),Z.focus();let y=D.querySelector(".bubble.sys:last-of-type");y&&y.textContent.includes("Transcribing")&&(y.closest(".bubble.sys")&&y.remove(),D.querySelectorAll(".bubble.sys").forEach(function(M){M.textContent.includes("Transcribing")&&M.remove()}))}}).catch(function(){G("\\u26A0\\uFE0F Voice transcription failed.","sys")})}),n.start(),t.classList.add("recording"),t.title="Stop recording",t.setAttribute("aria-label","Stop recording"),a()}).catch(function(){G("\\u26A0\\uFE0F Microphone access denied. Please allow microphone permissions.","sys")})}function o(){n&&n.state!=="inactive"&&n.stop()}t.addEventListener("click",function(){t.classList.contains("recording")?o():l()})})();var wt=0,js="OpenBridge";function ei(){document.title=wt>0?"("+wt+") "+js:js}function Fa(){document.visibilityState!=="visible"&&(wt++,ei())}function Ga(){wt=0,ei()}document.addEventListener("visibilitychange",function(){document.visibilityState==="visible"&&Ga()});function qa(e){if(document.visibilityState!=="visible"&&"Notification"in window&&Notification.permission==="granted"){var t=e.length>100?e.slice(0,97)+"...":e;new Notification("OpenBridge",{body:t,icon:"/icons/icon-192.png"})}}(function(){"Notification"in window&&Notification.permission==="default"&&setTimeout(function(){Notification.requestPermission()},3e3)})();var ae=localStorage.getItem("ob-sound")==="false",pn=null;function Za(){return pn||(pn=new(window.AudioContext||window.webkitAudioContext)),pn}function wn(){if(!ae&&!(!window.AudioContext&&!window.webkitAudioContext))try{let e=Za(),t=e.createOscillator(),n=e.createGain();t.connect(n),n.connect(e.destination),t.type="sine",t.frequency.setValueAtTime(880,e.currentTime),t.frequency.exponentialRampToValueAtTime(660,e.currentTime+.15),n.gain.setValueAtTime(.3,e.currentTime),n.gain.exponentialRampToValueAtTime(.001,e.currentTime+.25),t.start(e.currentTime),t.stop(e.currentTime+.25)}catch{}}function bn(){let e=document.getElementById("sound-toggle");e&&(e.textContent=ae?"\\u{1F507}":"\\u{1F50A}",e.setAttribute("aria-label",ae?"Unmute notifications":"Mute notifications"),e.setAttribute("aria-pressed",ae?"true":"false"))}(function(){bn();let t=document.getElementById("sound-toggle");t&&t.addEventListener("click",function(){ae=!ae,localStorage.setItem("ob-sound",ae?"false":"true"),bn(),ae||wn()})})();(function(){if(!(window.matchMedia("(max-width: 767px)").matches||("ontouchstart"in window||navigator.maxTouchPoints>0)&&screen.width<=1024)||window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===!0||localStorage.getItem("ob-pwa-dismissed")==="1")return;let i=document.getElementById("pwa-banner"),s=document.getElementById("pwa-install-btn"),a=document.getElementById("pwa-dismiss-btn"),r=document.getElementById("pwa-banner-hint");if(!i||!s||!a)return;let l=null,o=/iphone|ipad|ipod/i.test(navigator.userAgent),c=/safari/i.test(navigator.userAgent)&&!/chrome|crios|fxios/i.test(navigator.userAgent);function u(){i.classList.remove("hidden")}function d(){i.classList.add("hidden"),localStorage.setItem("ob-pwa-dismissed","1")}a.addEventListener("click",d),o&&c?(r&&(r.textContent="Tap Share \\u238E then \\u201CAdd to Home Screen\\u201D"),s.style.display="none",setTimeout(u,2e3)):(window.addEventListener("beforeinstallprompt",function(p){p.preventDefault(),l=p,setTimeout(u,2e3)}),s.addEventListener("click",function(){l&&(l.prompt(),l.userChoice.then(function(p){p.outcome==="accepted"&&localStorage.setItem("ob-pwa-dismissed","1"),l=null,i.classList.add("hidden")}))}),window.addEventListener("appinstalled",function(){i.classList.add("hidden"),localStorage.setItem("ob-pwa-dismissed","1"),l=null}))})();(function(){"serviceWorker"in navigator&&navigator.serviceWorker.register("/sw.js").catch(function(t){typeof console<"u"&&console.warn("SW registration failed:",t)})})();async function Ka(e){Vs(),De=!1,D.replaceChildren(),G("Loading conversation\\u2026","sys");try{let t=await fetch("/api/sessions/"+encodeURIComponent(e));if(!t.ok){D.replaceChildren(),G("Failed to load conversation.","sys");return}let i=(await t.json()).messages;if(D.replaceChildren(),!Array.isArray(i)||i.length===0){G("No messages in this conversation.","sys");return}for(let s of i){let a=s.role==="user"?"user":s.role==="system"?"sys":"ai",r=s.created_at?new Date(s.created_at):new Date;G(s.content,a,r)}}catch{D.replaceChildren(),G("Failed to load conversation.","sys")}finally{De=!0}}function Wa(){Vs(),D.replaceChildren(),G("New conversation started.","sys"),X({type:"new-session"}),Xe()}Ps(Z);Da();Bs();Ls(Ka);Ms(Wa);Xe();Rs();Gs(D);Hs();zs(function(e){let t=document.getElementById("theme-toggle");t&&(t.textContent=e==="dark"?"Light":"Dark")});Us(function(e){ae=!e,bn(),ae||wn()});Nn({onOpen:function(){Ws(!0),G("Connected to OpenBridge","sys")},onClose:function(){Ws(!1,!0),yt(),G("Disconnected \\u2014 reconnecting...","sys")},onMessage:Ua});})();

</script>
</body>
</html>
`;

export const WEBCHAT_LOGIN_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>OpenBridge WebChat &mdash; Sign in</title>
  <style>
:root {
  --bg-primary: #f0f2f5;
  --bg-surface: #ffffff;
  --text-primary: #202124;
  --text-secondary: #5f6368;
  --accent: #1a73e8;
  --accent-hover: #1557b0;
  --border-input: #dadce0;
  --header-bg: #1a73e8;
  --header-text: #ffffff;
  --shadow: rgba(0, 0, 0, 0.12);
}
[data-theme='dark'] {
  --bg-primary: #0d0d0d;
  --bg-surface: #1e1e1e;
  --text-primary: #e0e0e0;
  --text-secondary: #9e9e9e;
  --accent: #4da3f7;
  --accent-hover: #2196f3;
  --border-input: #424242;
  --header-bg: #1a1a2e;
  --header-text: #e0e0e0;
  --shadow: rgba(0, 0, 0, 0.5);
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg-primary);
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.login-wrap {
  width: 100%;
  max-width: 400px;
  background: var(--bg-surface);
  border-radius: 12px;
  box-shadow: 0 4px 24px var(--shadow);
  overflow: hidden;
}
.login-header {
  padding: 14px 20px;
  background: var(--header-bg);
  color: var(--header-text);
}
.login-header h1 {
  font-size: 17px;
  font-weight: 600;
}
.login-body {
  padding: 28px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.login-subtitle {
  font-size: 14px;
  color: var(--text-secondary);
}
#pwd {
  width: 100%;
  padding: 10px 16px;
  border: 1.5px solid var(--border-input);
  border-radius: 24px;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.2s;
  background: var(--bg-surface);
  color: var(--text-primary);
}
#pwd:focus { border-color: var(--accent); }
#login-btn {
  width: 100%;
  padding: 10px 22px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 24px;
  font-size: 14px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.2s;
}
#login-btn:hover:not(:disabled) { background: var(--accent-hover); }
#login-btn:disabled { background: #bdc1c6; cursor: not-allowed; }
#error-msg {
  font-size: 13px;
  color: #c5221f;
  background: #fce8e6;
  border-radius: 8px;
  padding: 8px 12px;
  display: none;
}
[data-theme='dark'] #error-msg {
  background: #3b1212;
  color: #f28b82;
}
#error-msg.visible { display: block; }
/* Mobile: full-width card, no border-radius */
@media (max-width: 767px) {
  body { align-items: flex-start; padding: 0; }
  .login-wrap { max-width: 100%; border-radius: 0; box-shadow: none; }
  #pwd, #login-btn { font-size: 16px; padding: 12px 16px; }
}
/* iOS safe area insets */
.login-wrap {
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
}
.login-header {
  padding-top: calc(14px + env(safe-area-inset-top, 0px));
}
@media (max-width: 767px) {
  .login-header {
    padding-top: calc(14px + env(safe-area-inset-top, 0px));
  }
}
  </style>
  <script>
    (function () {
      var t = localStorage.getItem('ob-theme');
      if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    })();
  </script>
</head>
<body>
  <div class="login-wrap">
    <header class="login-header">
      <h1>OpenBridge WebChat</h1>
    </header>
    <div class="login-body">
      <p class="login-subtitle">Enter your password to continue.</p>
      <form id="login-form">
        <input
          type="password"
          id="pwd"
          placeholder="Password"
          autocomplete="current-password"
          aria-label="Password"
          required
        />
        <div id="error-msg" role="alert" aria-live="polite"></div>
        <button type="submit" id="login-btn">Sign in</button>
      </form>
    </div>
  </div>
  <script>
    (function () {
      var form = document.getElementById('login-form');
      var btn = document.getElementById('login-btn');
      var errMsg = document.getElementById('error-msg');
      function showError(msg) {
        errMsg.textContent = msg;
        errMsg.classList.add('visible');
      }
      function clearError() {
        errMsg.textContent = '';
        errMsg.classList.remove('visible');
      }
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        clearError();
        var pwd = document.getElementById('pwd').value;
        if (!pwd) { showError('Please enter your password.'); return; }
        btn.disabled = true;
        btn.textContent = 'Signing in\\u2026';
        fetch('/api/webchat/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd }),
        })
          .then(function (res) {
            if (res.ok) {
              window.location.replace('/');
            } else {
              return res.json().then(function (data) {
                showError((data && data.error) || 'Invalid password. Please try again.');
              });
            }
          })
          .catch(function () {
            showError('Connection error. Please try again.');
          })
          .finally(function () {
            btn.disabled = false;
            btn.textContent = 'Sign in';
          });
      });
    })();
  </script>
</body>
</html>
`;

export const WEBCHAT_SW_JS = `"use strict";(()=>{var a="openbridge-webchat-v1";self.addEventListener("install",function(n){n.waitUntil(caches.open(a).then(function(t){return t.addAll(["/"])})),self.skipWaiting()});self.addEventListener("activate",function(n){n.waitUntil(caches.keys().then(function(t){return Promise.all(t.filter(function(e){return e!==a}).map(function(e){return caches.delete(e)}))})),self.clients.claim()});self.addEventListener("fetch",function(n){var t=n.request;if(t.method==="GET"){var e=new URL(t.url);e.origin===self.location.origin&&(e.pathname==="/"||e.pathname==="")&&n.respondWith(caches.match(t).then(function(i){return i||fetch(t)}))}});self.addEventListener("push",function(n){var t={title:"OpenBridge",body:"New message received"};if(n.data)try{t=n.data.json()}catch{t.body=n.data.text()}n.waitUntil(self.registration.showNotification(t.title||"OpenBridge",{body:t.body,icon:"/icons/icon-192.png"}))});self.addEventListener("notificationclick",function(n){n.notification.close(),n.waitUntil(clients.matchAll({type:"window",includeUncontrolled:!0}).then(function(t){for(var e=0;e<t.length;e++){var i=t[e];if("focus"in i)return i.focus()}return clients.openWindow("/")}))});})();
`;
