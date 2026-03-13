// AUTO-GENERATED — do not edit manually. Run: npm run build:webchat
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

/* MCP Server panel */
.settings-mcp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.settings-mcp-header .settings-label {
  margin-bottom: 0;
}

.mcp-add-btn {
  font-size: 12px;
  padding: 3px 10px;
  border: 1.5px solid var(--accent);
  border-radius: 6px;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, color 0.15s;
}

.mcp-add-btn:hover {
  background: var(--accent);
  color: #fff;
}

.mcp-add-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
}

.settings-input {
  width: 100%;
  padding: 7px 10px;
  border: 1.5px solid var(--border-input);
  border-radius: 8px;
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.2s;
}

.settings-input:focus {
  border-color: var(--accent);
}

.mcp-form-actions {
  display: flex;
  gap: 8px;
}

.mcp-btn-primary {
  padding: 5px 14px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s;
}

.mcp-btn-primary:hover {
  background: var(--accent-hover);
}

.mcp-btn-secondary {
  padding: 5px 14px;
  background: transparent;
  color: var(--text-secondary);
  border: 1.5px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}

.mcp-server-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
}

.mcp-server-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-muted);
}

.mcp-server-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.mcp-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.mcp-status-healthy { background: #34a853; }
.mcp-status-error   { background: #ea4335; }
.mcp-status-unknown { background: #9aa0a6; }

.mcp-server-name {
  font-size: 13px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mcp-server-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.mcp-toggle {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
  cursor: pointer;
}

.mcp-toggle-input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}

.mcp-toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--border-input);
  border-radius: 9px;
  transition: background 0.2s;
}

.mcp-toggle-slider::before {
  content: '';
  position: absolute;
  width: 12px;
  height: 12px;
  left: 3px;
  top: 3px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}

.mcp-toggle-input:checked + .mcp-toggle-slider {
  background: var(--accent);
}

.mcp-toggle-input:checked + .mcp-toggle-slider::before {
  transform: translateX(14px);
}

.mcp-remove-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}

.mcp-remove-btn:hover {
  color: #ea4335;
  background: rgba(234, 67, 53, 0.08);
}

/* --- Permission Prompt Modal --- */

.permission-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: permission-fade-in 0.2s ease;
}

@keyframes permission-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.permission-modal {
  background: var(--bg-surface);
  border-radius: 12px;
  box-shadow: 0 8px 32px var(--shadow);
  max-width: 440px;
  width: 90%;
  padding: 24px;
  animation: permission-slide-up 0.25s ease;
}

@keyframes permission-slide-up {
  from { transform: translateY(16px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.permission-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.permission-icon {
  font-size: 24px;
  flex-shrink: 0;
}

.permission-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.permission-body {
  margin-bottom: 20px;
}

.permission-tool {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-muted);
  border-radius: 8px;
  margin-bottom: 12px;
  border: 1px solid var(--border);
}

.permission-tool-name {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 14px;
}

.permission-detail {
  font-family: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
  font-size: 13px;
  color: var(--text-secondary);
  background: var(--bg-muted);
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  word-break: break-all;
  max-height: 120px;
  overflow-y: auto;
}

.permission-actions {
  display: flex;
  gap: 10px;
}

.permission-btn {
  flex: 1;
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}

.permission-btn:active {
  transform: scale(0.97);
}

.permission-btn-allow {
  background: #34a853;
  color: #fff;
}

.permission-btn-allow:hover {
  background: #2d9249;
}

.permission-btn-deny {
  background: var(--bg-hover);
  color: var(--text-primary);
  border: 1px solid var(--border);
}

.permission-btn-deny:hover {
  background: var(--border);
}

.permission-countdown {
  text-align: center;
  margin-top: 12px;
  font-size: 12px;
  color: var(--text-muted);
}

.permission-countdown-bar {
  height: 3px;
  background: var(--accent);
  border-radius: 2px;
  margin-top: 6px;
  transition: width 1s linear;
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

      <!-- MCP Servers -->
      <section class="settings-section" aria-labelledby="settings-mcp-label">
        <div class="settings-mcp-header">
          <span id="settings-mcp-label" class="settings-label">MCP Servers</span>
          <button id="mcp-add-btn" class="mcp-add-btn" aria-label="Add MCP server">+ Add</button>
        </div>
        <div id="mcp-add-form" style="display:none;" class="mcp-add-form">
          <input id="mcp-new-name" class="settings-input" type="text" placeholder="Server name (e.g. gmail)" aria-label="MCP server name" />
          <input id="mcp-new-command" class="settings-input" type="text" placeholder="Command (e.g. mcp-server-gmail)" aria-label="MCP server command" />
          <div class="mcp-form-actions">
            <button id="mcp-add-submit" class="mcp-btn-primary">Add</button>
            <button id="mcp-add-cancel" class="mcp-btn-secondary">Cancel</button>
          </div>
        </div>
        <div id="mcp-server-list" class="mcp-server-list">
          <p class="settings-hint">Loading...</p>
        </div>
      </section>
    </div>
  </aside>

  <!-- Permission prompt modal (populated dynamically by app.js) -->
  <div id="permission-container"></div>

  <script>
"use strict";(()=>{var Ei=Object.create;var Dn=Object.defineProperty;var yi=Object.getOwnPropertyDescriptor;var xi=Object.getOwnPropertyNames;var wi=Object.getPrototypeOf,vi=Object.prototype.hasOwnProperty;var _i=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports);var Si=(e,t,n,i)=>{if(t&&typeof t=="object"||typeof t=="function")for(let s of xi(t))!vi.call(e,s)&&s!==n&&Dn(e,s,{get:()=>t[s],enumerable:!(i=yi(t,s))||i.enumerable});return e};var Ai=(e,t,n)=>(n=e!=null?Ei(wi(e)):{},Si(t||!e||!e.__esModule?Dn(n,"default",{value:e,enumerable:!0}):n,e));var ws=_i((vo,xs)=>{function cs(e){return e instanceof Map?e.clear=e.delete=e.set=function(){throw new Error("map is read-only")}:e instanceof Set&&(e.add=e.clear=e.delete=function(){throw new Error("set is read-only")}),Object.freeze(e),Object.getOwnPropertyNames(e).forEach(t=>{let n=e[t],i=typeof n;(i==="object"||i==="function")&&!Object.isFrozen(n)&&cs(n)}),e}var mt=class{constructor(t){t.data===void 0&&(t.data={}),this.data=t.data,this.isMatchIgnored=!1}ignoreMatch(){this.isMatchIgnored=!0}};function us(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;")}function fe(e,...t){let n=Object.create(null);for(let i in e)n[i]=e[i];return t.forEach(function(i){for(let s in i)n[s]=i[s]}),n}var mr="</span>",ss=e=>!!e.scope,br=(e,{prefix:t})=>{if(e.startsWith("language:"))return e.replace("language:","language-");if(e.includes(".")){let n=e.split(".");return[\`\${t}\${n.shift()}\`,...n.map((i,s)=>\`\${i}\${"_".repeat(s+1)}\`)].join(" ")}return\`\${t}\${e}\`},Gt=class{constructor(t,n){this.buffer="",this.classPrefix=n.classPrefix,t.walk(this)}addText(t){this.buffer+=us(t)}openNode(t){if(!ss(t))return;let n=br(t.scope,{prefix:this.classPrefix});this.span(n)}closeNode(t){ss(t)&&(this.buffer+=mr)}value(){return this.buffer}span(t){this.buffer+=\`<span class="\${t}">\`}},is=(e={})=>{let t={children:[]};return Object.assign(t,e),t},qt=class e{constructor(){this.rootNode=is(),this.stack=[this.rootNode]}get top(){return this.stack[this.stack.length-1]}get root(){return this.rootNode}add(t){this.top.children.push(t)}openNode(t){let n=is({scope:t});this.add(n),this.stack.push(n)}closeNode(){if(this.stack.length>1)return this.stack.pop()}closeAllNodes(){for(;this.closeNode(););}toJSON(){return JSON.stringify(this.rootNode,null,4)}walk(t){return this.constructor._walk(t,this.rootNode)}static _walk(t,n){return typeof n=="string"?t.addText(n):n.children&&(t.openNode(n),n.children.forEach(i=>this._walk(t,i)),t.closeNode(n)),t}static _collapse(t){typeof t!="string"&&t.children&&(t.children.every(n=>typeof n=="string")?t.children=[t.children.join("")]:t.children.forEach(n=>{e._collapse(n)}))}},Kt=class extends qt{constructor(t){super(),this.options=t}addText(t){t!==""&&this.add(t)}startScope(t){this.openNode(t)}endScope(){this.closeNode()}__addSublanguage(t,n){let i=t.root;n&&(i.scope=\`language:\${n}\`),this.add(i)}toHTML(){return new Gt(this,this.options).value()}finalize(){return this.closeAllNodes(),!0}};function Ye(e){return e?typeof e=="string"?e:e.source:null}function ds(e){return Se("(?=",e,")")}function kr(e){return Se("(?:",e,")*")}function Er(e){return Se("(?:",e,")?")}function Se(...e){return e.map(n=>Ye(n)).join("")}function yr(e){let t=e[e.length-1];return typeof t=="object"&&t.constructor===Object?(e.splice(e.length-1,1),t):{}}function jt(...e){return"("+(yr(e).capture?"":"?:")+e.map(i=>Ye(i)).join("|")+")"}function ps(e){return new RegExp(e.toString()+"|").exec("").length-1}function xr(e,t){let n=e&&e.exec(t);return n&&n.index===0}var wr=/\\[(?:[^\\\\\\]]|\\\\.)*\\]|\\(\\??|\\\\([1-9][0-9]*)|\\\\./;function Wt(e,{joinWith:t}){let n=0;return e.map(i=>{n+=1;let s=n,a=Ye(i),r="";for(;a.length>0;){let l=wr.exec(a);if(!l){r+=a;break}r+=a.substring(0,l.index),a=a.substring(l.index+l[0].length),l[0][0]==="\\\\"&&l[1]?r+="\\\\"+String(Number(l[1])+s):(r+=l[0],l[0]==="("&&n++)}return r}).map(i=>\`(\${i})\`).join(t)}var vr=/\\b\\B/,hs="[a-zA-Z]\\\\w*",Xt="[a-zA-Z_]\\\\w*",gs="\\\\b\\\\d+(\\\\.\\\\d+)?",fs="(-?)(\\\\b0[xX][a-fA-F0-9]+|(\\\\b\\\\d+(\\\\.\\\\d*)?|\\\\.\\\\d+)([eE][-+]?\\\\d+)?)",ms="\\\\b(0b[01]+)",_r="!|!=|!==|%|%=|&|&&|&=|\\\\*|\\\\*=|\\\\+|\\\\+=|,|-|-=|/=|/|:|;|<<|<<=|<=|<|===|==|=|>>>=|>>=|>=|>>>|>>|>|\\\\?|\\\\[|\\\\{|\\\\(|\\\\^|\\\\^=|\\\\||\\\\|=|\\\\|\\\\||~",Sr=(e={})=>{let t=/^#![ ]*\\//;return e.binary&&(e.begin=Se(t,/.*\\b/,e.binary,/\\b.*/)),fe({scope:"meta",begin:t,end:/$/,relevance:0,"on:begin":(n,i)=>{n.index!==0&&i.ignoreMatch()}},e)},Qe={begin:"\\\\\\\\[\\\\s\\\\S]",relevance:0},Ar={scope:"string",begin:"'",end:"'",illegal:"\\\\n",contains:[Qe]},Tr={scope:"string",begin:'"',end:'"',illegal:"\\\\n",contains:[Qe]},Cr={begin:/\\b(a|an|the|are|I'm|isn't|don't|doesn't|won't|but|just|should|pretty|simply|enough|gonna|going|wtf|so|such|will|you|your|they|like|more)\\b/},kt=function(e,t,n={}){let i=fe({scope:"comment",begin:e,end:t,contains:[]},n);i.contains.push({scope:"doctag",begin:"[ ]*(?=(TODO|FIXME|NOTE|BUG|OPTIMIZE|HACK|XXX):)",end:/(TODO|FIXME|NOTE|BUG|OPTIMIZE|HACK|XXX):/,excludeBegin:!0,relevance:0});let s=jt("I","a","is","so","us","to","at","if","in","it","on",/[A-Za-z]+['](d|ve|re|ll|t|s|n)/,/[A-Za-z]+[-][a-z]+/,/[A-Za-z][a-z]{2,}/);return i.contains.push({begin:Se(/[ ]+/,"(",s,/[.]?[:]?([.][ ]|[ ])/,"){3}")}),i},Nr=kt("//","$"),Rr=kt("/\\\\*","\\\\*/"),Ir=kt("#","$"),Lr={scope:"number",begin:gs,relevance:0},Mr={scope:"number",begin:fs,relevance:0},Or={scope:"number",begin:ms,relevance:0},Br={scope:"regexp",begin:/\\/(?=[^/\\n]*\\/)/,end:/\\/[gimuy]*/,contains:[Qe,{begin:/\\[/,end:/\\]/,relevance:0,contains:[Qe]}]},Dr={scope:"title",begin:hs,relevance:0},Pr={scope:"title",begin:Xt,relevance:0},$r={begin:"\\\\.\\\\s*"+Xt,relevance:0},zr=function(e){return Object.assign(e,{"on:begin":(t,n)=>{n.data._beginMatch=t[1]},"on:end":(t,n)=>{n.data._beginMatch!==t[1]&&n.ignoreMatch()}})},ft=Object.freeze({__proto__:null,APOS_STRING_MODE:Ar,BACKSLASH_ESCAPE:Qe,BINARY_NUMBER_MODE:Or,BINARY_NUMBER_RE:ms,COMMENT:kt,C_BLOCK_COMMENT_MODE:Rr,C_LINE_COMMENT_MODE:Nr,C_NUMBER_MODE:Mr,C_NUMBER_RE:fs,END_SAME_AS_BEGIN:zr,HASH_COMMENT_MODE:Ir,IDENT_RE:hs,MATCH_NOTHING_RE:vr,METHOD_GUARD:$r,NUMBER_MODE:Lr,NUMBER_RE:gs,PHRASAL_WORDS_MODE:Cr,QUOTE_STRING_MODE:Tr,REGEXP_MODE:Br,RE_STARTERS_RE:_r,SHEBANG:Sr,TITLE_MODE:Dr,UNDERSCORE_IDENT_RE:Xt,UNDERSCORE_TITLE_MODE:Pr});function Ur(e,t){e.input[e.index-1]==="."&&t.ignoreMatch()}function Hr(e,t){e.className!==void 0&&(e.scope=e.className,delete e.className)}function Fr(e,t){t&&e.beginKeywords&&(e.begin="\\\\b("+e.beginKeywords.split(" ").join("|")+")(?!\\\\.)(?=\\\\b|\\\\s)",e.__beforeBegin=Ur,e.keywords=e.keywords||e.beginKeywords,delete e.beginKeywords,e.relevance===void 0&&(e.relevance=0))}function Gr(e,t){Array.isArray(e.illegal)&&(e.illegal=jt(...e.illegal))}function qr(e,t){if(e.match){if(e.begin||e.end)throw new Error("begin & end are not supported with match");e.begin=e.match,delete e.match}}function Kr(e,t){e.relevance===void 0&&(e.relevance=1)}var Zr=(e,t)=>{if(!e.beforeMatch)return;if(e.starts)throw new Error("beforeMatch cannot be used with starts");let n=Object.assign({},e);Object.keys(e).forEach(i=>{delete e[i]}),e.keywords=n.keywords,e.begin=Se(n.beforeMatch,ds(n.begin)),e.starts={relevance:0,contains:[Object.assign(n,{endsParent:!0})]},e.relevance=0,delete n.beforeMatch},jr=["of","and","for","in","not","or","if","then","parent","list","value"],Wr="keyword";function bs(e,t,n=Wr){let i=Object.create(null);return typeof e=="string"?s(n,e.split(" ")):Array.isArray(e)?s(n,e):Object.keys(e).forEach(function(a){Object.assign(i,bs(e[a],t,a))}),i;function s(a,r){t&&(r=r.map(l=>l.toLowerCase())),r.forEach(function(l){let o=l.split("|");i[o[0]]=[a,Xr(o[0],o[1])]})}}function Xr(e,t){return t?Number(t):Yr(e)?0:1}function Yr(e){return jr.includes(e.toLowerCase())}var rs={},_e=e=>{console.error(e)},as=(e,...t)=>{console.log(\`WARN: \${e}\`,...t)},Le=(e,t)=>{rs[\`\${e}/\${t}\`]||(console.log(\`Deprecated as of \${e}. \${t}\`),rs[\`\${e}/\${t}\`]=!0)},bt=new Error;function ks(e,t,{key:n}){let i=0,s=e[n],a={},r={};for(let l=1;l<=t.length;l++)r[l+i]=s[l],a[l+i]=!0,i+=ps(t[l-1]);e[n]=r,e[n]._emit=a,e[n]._multi=!0}function Qr(e){if(Array.isArray(e.begin)){if(e.skip||e.excludeBegin||e.returnBegin)throw _e("skip, excludeBegin, returnBegin not compatible with beginScope: {}"),bt;if(typeof e.beginScope!="object"||e.beginScope===null)throw _e("beginScope must be object"),bt;ks(e,e.begin,{key:"beginScope"}),e.begin=Wt(e.begin,{joinWith:""})}}function Vr(e){if(Array.isArray(e.end)){if(e.skip||e.excludeEnd||e.returnEnd)throw _e("skip, excludeEnd, returnEnd not compatible with endScope: {}"),bt;if(typeof e.endScope!="object"||e.endScope===null)throw _e("endScope must be object"),bt;ks(e,e.end,{key:"endScope"}),e.end=Wt(e.end,{joinWith:""})}}function Jr(e){e.scope&&typeof e.scope=="object"&&e.scope!==null&&(e.beginScope=e.scope,delete e.scope)}function ea(e){Jr(e),typeof e.beginScope=="string"&&(e.beginScope={_wrap:e.beginScope}),typeof e.endScope=="string"&&(e.endScope={_wrap:e.endScope}),Qr(e),Vr(e)}function ta(e){function t(r,l){return new RegExp(Ye(r),"m"+(e.case_insensitive?"i":"")+(e.unicodeRegex?"u":"")+(l?"g":""))}class n{constructor(){this.matchIndexes={},this.regexes=[],this.matchAt=1,this.position=0}addRule(l,o){o.position=this.position++,this.matchIndexes[this.matchAt]=o,this.regexes.push([o,l]),this.matchAt+=ps(l)+1}compile(){this.regexes.length===0&&(this.exec=()=>null);let l=this.regexes.map(o=>o[1]);this.matcherRe=t(Wt(l,{joinWith:"|"}),!0),this.lastIndex=0}exec(l){this.matcherRe.lastIndex=this.lastIndex;let o=this.matcherRe.exec(l);if(!o)return null;let c=o.findIndex((d,p)=>p>0&&d!==void 0),u=this.matchIndexes[c];return o.splice(0,c),Object.assign(o,u)}}class i{constructor(){this.rules=[],this.multiRegexes=[],this.count=0,this.lastIndex=0,this.regexIndex=0}getMatcher(l){if(this.multiRegexes[l])return this.multiRegexes[l];let o=new n;return this.rules.slice(l).forEach(([c,u])=>o.addRule(c,u)),o.compile(),this.multiRegexes[l]=o,o}resumingScanAtSamePosition(){return this.regexIndex!==0}considerAll(){this.regexIndex=0}addRule(l,o){this.rules.push([l,o]),o.type==="begin"&&this.count++}exec(l){let o=this.getMatcher(this.regexIndex);o.lastIndex=this.lastIndex;let c=o.exec(l);if(this.resumingScanAtSamePosition()&&!(c&&c.index===this.lastIndex)){let u=this.getMatcher(0);u.lastIndex=this.lastIndex+1,c=u.exec(l)}return c&&(this.regexIndex+=c.position+1,this.regexIndex===this.count&&this.considerAll()),c}}function s(r){let l=new i;return r.contains.forEach(o=>l.addRule(o.begin,{rule:o,type:"begin"})),r.terminatorEnd&&l.addRule(r.terminatorEnd,{type:"end"}),r.illegal&&l.addRule(r.illegal,{type:"illegal"}),l}function a(r,l){let o=r;if(r.isCompiled)return o;[Hr,qr,ea,Zr].forEach(u=>u(r,l)),e.compilerExtensions.forEach(u=>u(r,l)),r.__beforeBegin=null,[Fr,Gr,Kr].forEach(u=>u(r,l)),r.isCompiled=!0;let c=null;return typeof r.keywords=="object"&&r.keywords.$pattern&&(r.keywords=Object.assign({},r.keywords),c=r.keywords.$pattern,delete r.keywords.$pattern),c=c||/\\w+/,r.keywords&&(r.keywords=bs(r.keywords,e.case_insensitive)),o.keywordPatternRe=t(c,!0),l&&(r.begin||(r.begin=/\\B|\\b/),o.beginRe=t(o.begin),!r.end&&!r.endsWithParent&&(r.end=/\\B|\\b/),r.end&&(o.endRe=t(o.end)),o.terminatorEnd=Ye(o.end)||"",r.endsWithParent&&l.terminatorEnd&&(o.terminatorEnd+=(r.end?"|":"")+l.terminatorEnd)),r.illegal&&(o.illegalRe=t(r.illegal)),r.contains||(r.contains=[]),r.contains=[].concat(...r.contains.map(function(u){return na(u==="self"?r:u)})),r.contains.forEach(function(u){a(u,o)}),r.starts&&a(r.starts,l),o.matcher=s(o),o}if(e.compilerExtensions||(e.compilerExtensions=[]),e.contains&&e.contains.includes("self"))throw new Error("ERR: contains \`self\` is not supported at the top-level of a language.  See documentation.");return e.classNameAliases=fe(e.classNameAliases||{}),a(e)}function Es(e){return e?e.endsWithParent||Es(e.starts):!1}function na(e){return e.variants&&!e.cachedVariants&&(e.cachedVariants=e.variants.map(function(t){return fe(e,{variants:null},t)})),e.cachedVariants?e.cachedVariants:Es(e)?fe(e,{starts:e.starts?fe(e.starts):null}):Object.isFrozen(e)?fe(e):e}var sa="11.11.1",Zt=class extends Error{constructor(t,n){super(t),this.name="HTMLInjectionError",this.html=n}},Ft=us,os=fe,ls=Symbol("nomatch"),ia=7,ys=function(e){let t=Object.create(null),n=Object.create(null),i=[],s=!0,a="Could not find the language '{}', did you forget to load/include a language module?",r={disableAutodetect:!0,name:"Plain text",contains:[]},l={ignoreUnescapedHTML:!1,throwUnescapedHTML:!1,noHighlightRe:/^(no-?highlight)$/i,languageDetectRe:/\\blang(?:uage)?-([\\w-]+)\\b/i,classPrefix:"hljs-",cssSelector:"pre code",languages:null,__emitter:Kt};function o(h){return l.noHighlightRe.test(h)}function c(h){let k=h.className+" ";k+=h.parentNode?h.parentNode.className:"";let b=l.languageDetectRe.exec(k);if(b){let w=U(b[1]);return w||(as(a.replace("{}",b[1])),as("Falling back to no-highlight mode for this block.",h)),w?b[1]:"no-highlight"}return k.split(/\\s+/).find(w=>o(w)||U(w))}function u(h,k,b){let w="",S="";typeof k=="object"?(w=h,b=k.ignoreIllegals,S=k.language):(Le("10.7.0","highlight(lang, code, ...args) has been deprecated."),Le("10.7.0",\`Please use highlight(code, options) instead.
https://github.com/highlightjs/highlight.js/issues/2277\`),S=h,w=k),b===void 0&&(b=!0);let B={code:w,language:S};ge("before:highlight",B);let H=B.result?B.result:d(B.language,B.code,b);return H.code=B.code,ge("after:highlight",H),H}function d(h,k,b,w){let S=Object.create(null);function B(f,E){return f.keywords[E]}function H(){if(!x.keywords){$.addText(L);return}let f=0;x.keywordPatternRe.lastIndex=0;let E=x.keywordPatternRe.exec(L),v="";for(;E;){v+=L.substring(f,E.index);let C=ie.case_insensitive?E[0].toLowerCase():E[0],F=B(x,C);if(F){let[le,bi]=F;if($.addText(v),v="",S[C]=(S[C]||0)+1,S[C]<=ia&&(lt+=bi),le.startsWith("_"))v+=E[0];else{let ki=ie.classNameAliases[le]||le;se(E[0],ki)}}else v+=E[0];f=x.keywordPatternRe.lastIndex,E=x.keywordPatternRe.exec(L)}v+=L.substring(f),$.addText(v)}function ne(){if(L==="")return;let f=null;if(typeof x.subLanguage=="string"){if(!t[x.subLanguage]){$.addText(L);return}f=d(x.subLanguage,L,!0,Bn[x.subLanguage]),Bn[x.subLanguage]=f._top}else f=m(L,x.subLanguage.length?x.subLanguage:null);x.relevance>0&&(lt+=f.relevance),$.__addSublanguage(f._emitter,f.language)}function W(){x.subLanguage!=null?ne():H(),L=""}function se(f,E){f!==""&&($.startScope(E),$.addText(f),$.endScope())}function In(f,E){let v=1,C=E.length-1;for(;v<=C;){if(!f._emit[v]){v++;continue}let F=ie.classNameAliases[f[v]]||f[v],le=E[v];F?se(le,F):(L=le,H(),L=""),v++}}function Ln(f,E){return f.scope&&typeof f.scope=="string"&&$.openNode(ie.classNameAliases[f.scope]||f.scope),f.beginScope&&(f.beginScope._wrap?(se(L,ie.classNameAliases[f.beginScope._wrap]||f.beginScope._wrap),L=""):f.beginScope._multi&&(In(f.beginScope,E),L="")),x=Object.create(f,{parent:{value:x}}),x}function Mn(f,E,v){let C=xr(f.endRe,v);if(C){if(f["on:end"]){let F=new mt(f);f["on:end"](E,F),F.isMatchIgnored&&(C=!1)}if(C){for(;f.endsParent&&f.parent;)f=f.parent;return f}}if(f.endsWithParent)return Mn(f.parent,E,v)}function pi(f){return x.matcher.regexIndex===0?(L+=f[0],1):(Nt=!0,0)}function hi(f){let E=f[0],v=f.rule,C=new mt(v),F=[v.__beforeBegin,v["on:begin"]];for(let le of F)if(le&&(le(f,C),C.isMatchIgnored))return pi(E);return v.skip?L+=E:(v.excludeBegin&&(L+=E),W(),!v.returnBegin&&!v.excludeBegin&&(L=E)),Ln(v,f),v.returnBegin?0:E.length}function gi(f){let E=f[0],v=k.substring(f.index),C=Mn(x,f,v);if(!C)return ls;let F=x;x.endScope&&x.endScope._wrap?(W(),se(E,x.endScope._wrap)):x.endScope&&x.endScope._multi?(W(),In(x.endScope,f)):F.skip?L+=E:(F.returnEnd||F.excludeEnd||(L+=E),W(),F.excludeEnd&&(L=E));do x.scope&&$.closeNode(),!x.skip&&!x.subLanguage&&(lt+=x.relevance),x=x.parent;while(x!==C.parent);return C.starts&&Ln(C.starts,f),F.returnEnd?0:E.length}function fi(){let f=[];for(let E=x;E!==ie;E=E.parent)E.scope&&f.unshift(E.scope);f.forEach(E=>$.openNode(E))}let ot={};function On(f,E){let v=E&&E[0];if(L+=f,v==null)return W(),0;if(ot.type==="begin"&&E.type==="end"&&ot.index===E.index&&v===""){if(L+=k.slice(E.index,E.index+1),!s){let C=new Error(\`0 width match regex (\${h})\`);throw C.languageName=h,C.badRule=ot.rule,C}return 1}if(ot=E,E.type==="begin")return hi(E);if(E.type==="illegal"&&!b){let C=new Error('Illegal lexeme "'+v+'" for mode "'+(x.scope||"<unnamed>")+'"');throw C.mode=x,C}else if(E.type==="end"){let C=gi(E);if(C!==ls)return C}if(E.type==="illegal"&&v==="")return L+=\`
\`,1;if(Ct>1e5&&Ct>E.index*3)throw new Error("potential infinite loop, way more iterations than matches");return L+=v,v.length}let ie=U(h);if(!ie)throw _e(a.replace("{}",h)),new Error('Unknown language: "'+h+'"');let mi=ta(ie),Tt="",x=w||mi,Bn={},$=new l.__emitter(l);fi();let L="",lt=0,ye=0,Ct=0,Nt=!1;try{if(ie.__emitTokens)ie.__emitTokens(k,$);else{for(x.matcher.considerAll();;){Ct++,Nt?Nt=!1:x.matcher.considerAll(),x.matcher.lastIndex=ye;let f=x.matcher.exec(k);if(!f)break;let E=k.substring(ye,f.index),v=On(E,f);ye=f.index+v}On(k.substring(ye))}return $.finalize(),Tt=$.toHTML(),{language:h,value:Tt,relevance:lt,illegal:!1,_emitter:$,_top:x}}catch(f){if(f.message&&f.message.includes("Illegal"))return{language:h,value:Ft(k),illegal:!0,relevance:0,_illegalBy:{message:f.message,index:ye,context:k.slice(ye-100,ye+100),mode:f.mode,resultSoFar:Tt},_emitter:$};if(s)return{language:h,value:Ft(k),illegal:!1,relevance:0,errorRaised:f,_emitter:$,_top:x};throw f}}function p(h){let k={value:Ft(h),illegal:!1,relevance:0,_top:r,_emitter:new l.__emitter(l)};return k._emitter.addText(h),k}function m(h,k){k=k||l.languages||Object.keys(t);let b=p(h),w=k.filter(U).filter(Ie).map(W=>d(W,h,!1));w.unshift(b);let S=w.sort((W,se)=>{if(W.relevance!==se.relevance)return se.relevance-W.relevance;if(W.language&&se.language){if(U(W.language).supersetOf===se.language)return 1;if(U(se.language).supersetOf===W.language)return-1}return 0}),[B,H]=S,ne=B;return ne.secondBest=H,ne}function g(h,k,b){let w=k&&n[k]||b;h.classList.add("hljs"),h.classList.add(\`language-\${w}\`)}function y(h){let k=null,b=c(h);if(o(b))return;if(ge("before:highlightElement",{el:h,language:b}),h.dataset.highlighted){console.log("Element previously highlighted. To highlight again, first unset \`dataset.highlighted\`.",h);return}if(h.children.length>0&&(l.ignoreUnescapedHTML||(console.warn("One of your code blocks includes unescaped HTML. This is a potentially serious security risk."),console.warn("https://github.com/highlightjs/highlight.js/wiki/security"),console.warn("The element with unescaped HTML:"),console.warn(h)),l.throwUnescapedHTML))throw new Zt("One of your code blocks includes unescaped HTML.",h.innerHTML);k=h;let w=k.textContent,S=b?u(w,{language:b,ignoreIllegals:!0}):m(w);h.innerHTML=S.value,h.dataset.highlighted="yes",g(h,b,S.language),h.result={language:S.language,re:S.relevance,relevance:S.relevance},S.secondBest&&(h.secondBest={language:S.secondBest.language,relevance:S.secondBest.relevance}),ge("after:highlightElement",{el:h,result:S,text:w})}function T(h){l=os(l,h)}let I=()=>{O(),Le("10.6.0","initHighlighting() deprecated.  Use highlightAll() now.")};function M(){O(),Le("10.6.0","initHighlightingOnLoad() deprecated.  Use highlightAll() now.")}let D=!1;function O(){function h(){O()}if(document.readyState==="loading"){D||window.addEventListener("DOMContentLoaded",h,!1),D=!0;return}document.querySelectorAll(l.cssSelector).forEach(y)}function N(h,k){let b=null;try{b=k(e)}catch(w){if(_e("Language definition for '{}' could not be registered.".replace("{}",h)),s)_e(w);else throw w;b=r}b.name||(b.name=h),t[h]=b,b.rawDefinition=k.bind(null,e),b.aliases&&j(b.aliases,{languageName:h})}function R(h){delete t[h];for(let k of Object.keys(n))n[k]===h&&delete n[k]}function K(){return Object.keys(t)}function U(h){return h=(h||"").toLowerCase(),t[h]||t[n[h]]}function j(h,{languageName:k}){typeof h=="string"&&(h=[h]),h.forEach(b=>{n[b.toLowerCase()]=k})}function Ie(h){let k=U(h);return k&&!k.disableAutodetect}function Fe(h){h["before:highlightBlock"]&&!h["before:highlightElement"]&&(h["before:highlightElement"]=k=>{h["before:highlightBlock"](Object.assign({block:k.el},k))}),h["after:highlightBlock"]&&!h["after:highlightElement"]&&(h["after:highlightElement"]=k=>{h["after:highlightBlock"](Object.assign({block:k.el},k))})}function Ge(h){Fe(h),i.push(h)}function qe(h){let k=i.indexOf(h);k!==-1&&i.splice(k,1)}function ge(h,k){let b=h;i.forEach(function(w){w[b]&&w[b](k)})}function Ke(h){return Le("10.7.0","highlightBlock will be removed entirely in v12.0"),Le("10.7.0","Please use highlightElement now."),y(h)}Object.assign(e,{highlight:u,highlightAuto:m,highlightAll:O,highlightElement:y,highlightBlock:Ke,configure:T,initHighlighting:I,initHighlightingOnLoad:M,registerLanguage:N,unregisterLanguage:R,listLanguages:K,getLanguage:U,registerAliases:j,autoDetection:Ie,inherit:os,addPlugin:Ge,removePlugin:qe}),e.debugMode=function(){s=!1},e.safeMode=function(){s=!0},e.versionString=sa,e.regex={concat:Se,lookahead:ds,either:jt,optional:Er,anyNumberOfTimes:kr};for(let h in ft)typeof ft[h]=="object"&&cs(ft[h]);return Object.assign(e,ft),e},Me=ys({});Me.newInstance=()=>ys({});xs.exports=Me;Me.HighlightJS=Me;Me.default=Me});var Y=null;function Pn(e){function t(){var n=location.protocol==="https:"?"wss:":"ws:",i=n+"//"+location.host,s=new URLSearchParams(location.search),a=s.get("token");a&&(i+="?token="+encodeURIComponent(a)),Y=new WebSocket(i),Y.onopen=function(){e.onOpen()},Y.onclose=function(){Y=null,e.onClose(),setTimeout(t,2e3)},Y.onmessage=function(r){try{let l=JSON.parse(r.data);e.onMessage(l)}catch{}},Y.onerror=function(){}}t()}function X(e){Y&&Y.readyState===WebSocket.OPEN&&Y.send(JSON.stringify(e))}function $n(){return Y!==null&&Y.readyState===WebSocket.OPEN}function Mt(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var ve=Mt();function Kn(e){ve=e}var xe={exec:()=>null};function _(e,t=""){let n=typeof e=="string"?e:e.source,i={replace:(s,a)=>{let r=typeof a=="string"?a:a.source;return r=r.replace(q.caret,"$1"),n=n.replace(s,r),i},getRegex:()=>new RegExp(n,t)};return i}var Ti=(()=>{try{return!!new RegExp("(?<=1)(?<!1)")}catch{return!1}})(),q={codeRemoveIndent:/^(?: {1,4}| {0,3}\\t)/gm,outputLinkReplace:/\\\\([\\[\\]])/g,indentCodeCompensation:/^(\\s+)(?:\`\`\`)/,beginningSpace:/^\\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\\n/g,tabCharGlobal:/\\t/g,multipleSpaceGlobal:/\\s+/g,blankLine:/^[ \\t]*$/,doubleBlankLine:/\\n[ \\t]*\\n[ \\t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\\n {0,3}((?:=+|-+) *)(?=\\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \\t]?/gm,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\\[[ xX]\\] +\\S/,listReplaceTask:/^\\[[ xX]\\] +/,listTaskCheckbox:/\\[[ xX]\\]/,anyLine:/\\n.*\\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\\||\\| *$/g,tableRowBlankLine:/\\n[ \\t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\\s|>)/i,endPreScriptTag:/^<\\/(pre|code|kbd|script)(\\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\\s])\\s+(['"])(.*)\\2/,unicodeAlphaNumeric:/[\\p{L}\\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\\w+);)/g,unescapeTest:/&(#(?:\\d+)|(?:#x[0-9A-Fa-f]+)|(?:\\w+));?/ig,caret:/(^|[^\\[])\\^/g,percentDecode:/%25/g,findPipe:/\\|/g,splitPipe:/ \\|/,slashPipe:/\\\\\\|/g,carriageReturn:/\\r\\n|\\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\\S*/,endingNewline:/\\n$/,listItemRegex:e=>new RegExp(\`^( {0,3}\${e})((?:[	 ][^\\\\n]*)?(?:\\\\n|$))\`),nextBulletRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}(?:[*+-]|\\\\d{1,9}[.)])((?:[ 	][^\\\\n]*)?(?:\\\\n|$))\`),hrRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\\\* *){3,})(?:\\\\n+|$)\`),fencesBeginRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}(?:\\\`\\\`\\\`|~~~)\`),headingBeginRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}#\`),htmlBeginRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}<(?:[a-z].*>|!--)\`,"i"),blockquoteBeginRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}>\`)},Ci=/^(?:[ \\t]*(?:\\n|$))+/,Ni=/^((?: {4}| {0,3}\\t)[^\\n]+(?:\\n(?:[ \\t]*(?:\\n|$))*)?)+/,Ri=/^ {0,3}(\`{3,}(?=[^\`\\n]*(?:\\n|$))|~{3,})([^\\n]*)(?:\\n|$)(?:|([\\s\\S]*?)(?:\\n|$))(?: {0,3}\\1[~\`]* *(?=\\n|$)|$)/,Xe=/^ {0,3}((?:-[\\t ]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)/,Ii=/^ {0,3}(#{1,6})(?=\\s|$)(.*)(?:\\n+|$)/,Ot=/ {0,3}(?:[*+-]|\\d{1,9}[.)])/,Zn=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\\n(?!\\s*?\\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\\n {0,3}(=+|-+) *(?:\\n+|$)/,jn=_(Zn).replace(/bull/g,Ot).replace(/blockCode/g,/(?: {4}| {0,3}\\t)/).replace(/fences/g,/ {0,3}(?:\`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\\n>]+>\\n/).replace(/\\|table/g,"").getRegex(),Li=_(Zn).replace(/bull/g,Ot).replace(/blockCode/g,/(?: {4}| {0,3}\\t)/).replace(/fences/g,/ {0,3}(?:\`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\\n>]+>\\n/).replace(/table/g,/ {0,3}\\|?(?:[:\\- ]*\\|)+[\\:\\- ]*\\n/).getRegex(),Bt=/^([^\\n]+(?:\\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\\n)[^\\n]+)*)/,Mi=/^[^\\n]+/,Dt=/(?!\\s*\\])(?:\\\\[\\s\\S]|[^\\[\\]\\\\])+/,Oi=_(/^ {0,3}\\[(label)\\]: *(?:\\n[ \\t]*)?([^<\\s][^\\s]*|<.*?>)(?:(?: +(?:\\n[ \\t]*)?| *\\n[ \\t]*)(title))? *(?:\\n+|$)/).replace("label",Dt).replace("title",/(?:"(?:\\\\"?|[^"\\\\])*"|'[^'\\n]*(?:\\n[^'\\n]+)*\\n?'|\\([^()]*\\))/).getRegex(),Bi=_(/^(bull)([ \\t][^\\n]+?)?(?:\\n|$)/).replace(/bull/g,Ot).getRegex(),ht="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",Pt=/<!--(?:-?>|[\\s\\S]*?(?:-->|$))/,Di=_("^ {0,3}(?:<(script|pre|style|textarea)[\\\\s>][\\\\s\\\\S]*?(?:</\\\\1>[^\\\\n]*\\\\n+|$)|comment[^\\\\n]*(\\\\n+|$)|<\\\\?[\\\\s\\\\S]*?(?:\\\\?>\\\\n*|$)|<![A-Z][\\\\s\\\\S]*?(?:>\\\\n*|$)|<!\\\\[CDATA\\\\[[\\\\s\\\\S]*?(?:\\\\]\\\\]>\\\\n*|$)|</?(tag)(?: +|\\\\n|/?>)[\\\\s\\\\S]*?(?:(?:\\\\n[ 	]*)+\\\\n|$)|<(?!script|pre|style|textarea)([a-z][\\\\w-]*)(?:attribute)*? */?>(?=[ \\\\t]*(?:\\\\n|$))[\\\\s\\\\S]*?(?:(?:\\\\n[ 	]*)+\\\\n|$)|</(?!script|pre|style|textarea)[a-z][\\\\w-]*\\\\s*>(?=[ \\\\t]*(?:\\\\n|$))[\\\\s\\\\S]*?(?:(?:\\\\n[ 	]*)+\\\\n|$))","i").replace("comment",Pt).replace("tag",ht).replace("attribute",/ +[a-zA-Z:_][\\w.:-]*(?: *= *"[^"\\n]*"| *= *'[^'\\n]*'| *= *[^\\s"'=<>\`]+)?/).getRegex(),Wn=_(Bt).replace("hr",Xe).replace("heading"," {0,3}#{1,6}(?:\\\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:\`{3,}(?=[^\`\\\\n]*\\\\n)|~{3,})[^\\\\n]*\\\\n").replace("list"," {0,3}(?:[*+-]|1[.)])[ \\\\t]").replace("html","</?(?:tag)(?: +|\\\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",ht).getRegex(),Pi=_(/^( {0,3}> ?(paragraph|[^\\n]*)(?:\\n|$))+/).replace("paragraph",Wn).getRegex(),$t={blockquote:Pi,code:Ni,def:Oi,fences:Ri,heading:Ii,hr:Xe,html:Di,lheading:jn,list:Bi,newline:Ci,paragraph:Wn,table:xe,text:Mi},zn=_("^ *([^\\\\n ].*)\\\\n {0,3}((?:\\\\| *)?:?-+:? *(?:\\\\| *:?-+:? *)*(?:\\\\| *)?)(?:\\\\n((?:(?! *\\\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\\\n|$))*)\\\\n*|$)").replace("hr",Xe).replace("heading"," {0,3}#{1,6}(?:\\\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\\\n]").replace("fences"," {0,3}(?:\`{3,}(?=[^\`\\\\n]*\\\\n)|~{3,})[^\\\\n]*\\\\n").replace("list"," {0,3}(?:[*+-]|1[.)])[ \\\\t]").replace("html","</?(?:tag)(?: +|\\\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",ht).getRegex(),$i={...$t,lheading:Li,table:zn,paragraph:_(Bt).replace("hr",Xe).replace("heading"," {0,3}#{1,6}(?:\\\\s|$)").replace("|lheading","").replace("table",zn).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:\`{3,}(?=[^\`\\\\n]*\\\\n)|~{3,})[^\\\\n]*\\\\n").replace("list"," {0,3}(?:[*+-]|1[.)])[ \\\\t]").replace("html","</?(?:tag)(?: +|\\\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",ht).getRegex()},zi={...$t,html:_(\`^ *(?:comment *(?:\\\\n|\\\\s*$)|<(tag)[\\\\s\\\\S]+?</\\\\1> *(?:\\\\n{2,}|\\\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\\\s[^'"/>\\\\s]*)*?/?> *(?:\\\\n{2,}|\\\\s*$))\`).replace("comment",Pt).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\\\b)\\\\w+(?!:|[^\\\\w\\\\s@]*@)\\\\b").getRegex(),def:/^ *\\[([^\\]]+)\\]: *<?([^\\s>]+)>?(?: +(["(][^\\n]+[")]))? *(?:\\n+|$)/,heading:/^(#{1,6})(.*)(?:\\n+|$)/,fences:xe,lheading:/^(.+?)\\n {0,3}(=+|-+) *(?:\\n+|$)/,paragraph:_(Bt).replace("hr",Xe).replace("heading",\` *#{1,6} *[^
]\`).replace("lheading",jn).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},Ui=/^\\\\([!"#$%&'()*+,\\-./:;<=>?@\\[\\]\\\\^_\`{|}~])/,Hi=/^(\`+)([^\`]|[^\`][\\s\\S]*?[^\`])\\1(?!\`)/,Xn=/^( {2,}|\\\\)\\n(?!\\s*$)/,Fi=/^(\`+|[^\`])(?:(?= {2,}\\n)|[\\s\\S]*?(?:(?=[\\\\<!\\[\`*_]|\\b_|$)|[^ ](?= {2,}\\n)))/,gt=/[\\p{P}\\p{S}]/u,zt=/[\\s\\p{P}\\p{S}]/u,Yn=/[^\\s\\p{P}\\p{S}]/u,Gi=_(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,zt).getRegex(),Qn=/(?!~)[\\p{P}\\p{S}]/u,qi=/(?!~)[\\s\\p{P}\\p{S}]/u,Ki=/(?:[^\\s\\p{P}\\p{S}]|~)/u,Vn=/(?![*_])[\\p{P}\\p{S}]/u,Zi=/(?![*_])[\\s\\p{P}\\p{S}]/u,ji=/(?:[^\\s\\p{P}\\p{S}]|[*_])/u,Wi=_(/link|precode-code|html/,"g").replace("link",/\\[(?:[^\\[\\]\`]|(?<a>\`+)[^\`]+\\k<a>(?!\`))*?\\]\\((?:\\\\[\\s\\S]|[^\\\\\\(\\)]|\\((?:\\\\[\\s\\S]|[^\\\\\\(\\)])*\\))*\\)/).replace("precode-",Ti?"(?<!\`)()":"(^^|[^\`])").replace("code",/(?<b>\`+)[^\`]+\\k<b>(?!\`)/).replace("html",/<(?! )[^<>]*?>/).getRegex(),Jn=/^(?:\\*+(?:((?!\\*)punct)|[^\\s*]))|^_+(?:((?!_)punct)|([^\\s_]))/,Xi=_(Jn,"u").replace(/punct/g,gt).getRegex(),Yi=_(Jn,"u").replace(/punct/g,Qn).getRegex(),es="^[^_*]*?__[^_*]*?\\\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\\\*)punct(\\\\*+)(?=[\\\\s]|$)|notPunctSpace(\\\\*+)(?!\\\\*)(?=punctSpace|$)|(?!\\\\*)punctSpace(\\\\*+)(?=notPunctSpace)|[\\\\s](\\\\*+)(?!\\\\*)(?=punct)|(?!\\\\*)punct(\\\\*+)(?!\\\\*)(?=punct)|notPunctSpace(\\\\*+)(?=notPunctSpace)",Qi=_(es,"gu").replace(/notPunctSpace/g,Yn).replace(/punctSpace/g,zt).replace(/punct/g,gt).getRegex(),Vi=_(es,"gu").replace(/notPunctSpace/g,Ki).replace(/punctSpace/g,qi).replace(/punct/g,Qn).getRegex(),Ji=_("^[^_*]*?\\\\*\\\\*[^_*]*?_[^_*]*?(?=\\\\*\\\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,Yn).replace(/punctSpace/g,zt).replace(/punct/g,gt).getRegex(),er=_(/^~~?(?:((?!~)punct)|[^\\s~])/,"u").replace(/punct/g,Vn).getRegex(),tr="^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)",nr=_(tr,"gu").replace(/notPunctSpace/g,ji).replace(/punctSpace/g,Zi).replace(/punct/g,Vn).getRegex(),sr=_(/\\\\(punct)/,"gu").replace(/punct/g,gt).getRegex(),ir=_(/^<(scheme:[^\\s\\x00-\\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_\`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),rr=_(Pt).replace("(?:-->|$)","-->").getRegex(),ar=_("^comment|^</[a-zA-Z][\\\\w:-]*\\\\s*>|^<[a-zA-Z][\\\\w-]*(?:attribute)*?\\\\s*/?>|^<\\\\?[\\\\s\\\\S]*?\\\\?>|^<![a-zA-Z]+\\\\s[\\\\s\\\\S]*?>|^<!\\\\[CDATA\\\\[[\\\\s\\\\S]*?\\\\]\\\\]>").replace("comment",rr).replace("attribute",/\\s+[a-zA-Z:_][\\w.:-]*(?:\\s*=\\s*"[^"]*"|\\s*=\\s*'[^']*'|\\s*=\\s*[^\\s"'=<>\`]+)?/).getRegex(),ut=/(?:\\[(?:\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]|\\\\[\\s\\S]|\`+[^\`]*?\`+(?!\`)|[^\\[\\]\\\\\`])*?/,or=_(/^!?\\[(label)\\]\\(\\s*(href)(?:(?:[ \\t]*(?:\\n[ \\t]*)?)(title))?\\s*\\)/).replace("label",ut).replace("href",/<(?:\\\\.|[^\\n<>\\\\])+>|[^ \\t\\n\\x00-\\x1f]*/).replace("title",/"(?:\\\\"?|[^"\\\\])*"|'(?:\\\\'?|[^'\\\\])*'|\\((?:\\\\\\)?|[^)\\\\])*\\)/).getRegex(),ts=_(/^!?\\[(label)\\]\\[(ref)\\]/).replace("label",ut).replace("ref",Dt).getRegex(),ns=_(/^!?\\[(ref)\\](?:\\[\\])?/).replace("ref",Dt).getRegex(),lr=_("reflink|nolink(?!\\\\()","g").replace("reflink",ts).replace("nolink",ns).getRegex(),Un=/[hH][tT][tT][pP][sS]?|[fF][tT][pP]/,Ut={_backpedal:xe,anyPunctuation:sr,autolink:ir,blockSkip:Wi,br:Xn,code:Hi,del:xe,delLDelim:xe,delRDelim:xe,emStrongLDelim:Xi,emStrongRDelimAst:Qi,emStrongRDelimUnd:Ji,escape:Ui,link:or,nolink:ns,punctuation:Gi,reflink:ts,reflinkSearch:lr,tag:ar,text:Fi,url:xe},cr={...Ut,link:_(/^!?\\[(label)\\]\\((.*?)\\)/).replace("label",ut).getRegex(),reflink:_(/^!?\\[(label)\\]\\s*\\[([^\\]]*)\\]/).replace("label",ut).getRegex()},Rt={...Ut,emStrongRDelimAst:Vi,emStrongLDelim:Yi,delLDelim:er,delRDelim:nr,url:_(/^((?:protocol):\\/\\/|www\\.)(?:[a-zA-Z0-9\\-]+\\.?)+[^\\s<]*|^email/).replace("protocol",Un).replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\\([^)]*\\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\\s~])((?:\\\\[\\s\\S]|[^\\\\])*?(?:\\\\[\\s\\S]|[^\\s~\\\\]))\\1(?=[^~]|$)/,text:_(/^([\`~]+|[^\`~])(?:(?= {2,}\\n)|(?=[a-zA-Z0-9.!#$%&'*+\\/=?_\`{\\|}~-]+@)|[\\s\\S]*?(?:(?=[\\\\<!\\[\`*~_]|\\b_|protocol:\\/\\/|www\\.|$)|[^ ](?= {2,}\\n)|[^a-zA-Z0-9.!#$%&'*+\\/=?_\`{\\|}~-](?=[a-zA-Z0-9.!#$%&'*+\\/=?_\`{\\|}~-]+@)))/).replace("protocol",Un).getRegex()},ur={...Rt,br:_(Xn).replace("{2,}","*").getRegex(),text:_(Rt.text).replace("\\\\b_","\\\\b_| {2,}\\\\n").replace(/\\{2,\\}/g,"*").getRegex()},ct={normal:$t,gfm:$i,pedantic:zi},Ze={normal:Ut,gfm:Rt,breaks:ur,pedantic:cr},dr={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},Hn=e=>dr[e];function re(e,t){if(t){if(q.escapeTest.test(e))return e.replace(q.escapeReplace,Hn)}else if(q.escapeTestNoEncode.test(e))return e.replace(q.escapeReplaceNoEncode,Hn);return e}function Fn(e){try{e=encodeURI(e).replace(q.percentDecode,"%")}catch{return null}return e}function Gn(e,t){let n=e.replace(q.findPipe,(a,r,l)=>{let o=!1,c=r;for(;--c>=0&&l[c]==="\\\\";)o=!o;return o?"|":" |"}),i=n.split(q.splitPipe),s=0;if(i[0].trim()||i.shift(),i.length>0&&!i.at(-1)?.trim()&&i.pop(),t)if(i.length>t)i.splice(t);else for(;i.length<t;)i.push("");for(;s<i.length;s++)i[s]=i[s].trim().replace(q.slashPipe,"|");return i}function je(e,t,n){let i=e.length;if(i===0)return"";let s=0;for(;s<i;){let a=e.charAt(i-s-1);if(a===t&&!n)s++;else if(a!==t&&n)s++;else break}return e.slice(0,i-s)}function pr(e,t){if(e.indexOf(t[1])===-1)return-1;let n=0;for(let i=0;i<e.length;i++)if(e[i]==="\\\\")i++;else if(e[i]===t[0])n++;else if(e[i]===t[1]&&(n--,n<0))return i;return n>0?-2:-1}function hr(e,t=0){let n=t,i="";for(let s of e)if(s==="	"){let a=4-n%4;i+=" ".repeat(a),n+=a}else i+=s,n++;return i}function qn(e,t,n,i,s){let a=t.href,r=t.title||null,l=e[1].replace(s.other.outputLinkReplace,"$1");i.state.inLink=!0;let o={type:e[0].charAt(0)==="!"?"image":"link",raw:n,href:a,title:r,text:l,tokens:i.inlineTokens(l)};return i.state.inLink=!1,o}function gr(e,t,n){let i=e.match(n.other.indentCodeCompensation);if(i===null)return t;let s=i[1];return t.split(\`
\`).map(a=>{let r=a.match(n.other.beginningSpace);if(r===null)return a;let[l]=r;return l.length>=s.length?a.slice(s.length):a}).join(\`
\`)}var dt=class{options;rules;lexer;constructor(e){this.options=e||ve}space(e){let t=this.rules.block.newline.exec(e);if(t&&t[0].length>0)return{type:"space",raw:t[0]}}code(e){let t=this.rules.block.code.exec(e);if(t){let n=t[0].replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:t[0],codeBlockStyle:"indented",text:this.options.pedantic?n:je(n,\`
\`)}}}fences(e){let t=this.rules.block.fences.exec(e);if(t){let n=t[0],i=gr(n,t[3]||"",this.rules);return{type:"code",raw:n,lang:t[2]?t[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):t[2],text:i}}}heading(e){let t=this.rules.block.heading.exec(e);if(t){let n=t[2].trim();if(this.rules.other.endingHash.test(n)){let i=je(n,"#");(this.options.pedantic||!i||this.rules.other.endingSpaceChar.test(i))&&(n=i.trim())}return{type:"heading",raw:t[0],depth:t[1].length,text:n,tokens:this.lexer.inline(n)}}}hr(e){let t=this.rules.block.hr.exec(e);if(t)return{type:"hr",raw:je(t[0],\`
\`)}}blockquote(e){let t=this.rules.block.blockquote.exec(e);if(t){let n=je(t[0],\`
\`).split(\`
\`),i="",s="",a=[];for(;n.length>0;){let r=!1,l=[],o;for(o=0;o<n.length;o++)if(this.rules.other.blockquoteStart.test(n[o]))l.push(n[o]),r=!0;else if(!r)l.push(n[o]);else break;n=n.slice(o);let c=l.join(\`
\`),u=c.replace(this.rules.other.blockquoteSetextReplace,\`
    $1\`).replace(this.rules.other.blockquoteSetextReplace2,"");i=i?\`\${i}
\${c}\`:c,s=s?\`\${s}
\${u}\`:u;let d=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(u,a,!0),this.lexer.state.top=d,n.length===0)break;let p=a.at(-1);if(p?.type==="code")break;if(p?.type==="blockquote"){let m=p,g=m.raw+\`
\`+n.join(\`
\`),y=this.blockquote(g);a[a.length-1]=y,i=i.substring(0,i.length-m.raw.length)+y.raw,s=s.substring(0,s.length-m.text.length)+y.text;break}else if(p?.type==="list"){let m=p,g=m.raw+\`
\`+n.join(\`
\`),y=this.list(g);a[a.length-1]=y,i=i.substring(0,i.length-p.raw.length)+y.raw,s=s.substring(0,s.length-m.raw.length)+y.raw,n=g.substring(a.at(-1).raw.length).split(\`
\`);continue}}return{type:"blockquote",raw:i,tokens:a,text:s}}}list(e){let t=this.rules.block.list.exec(e);if(t){let n=t[1].trim(),i=n.length>1,s={type:"list",raw:"",ordered:i,start:i?+n.slice(0,-1):"",loose:!1,items:[]};n=i?\`\\\\d{1,9}\\\\\${n.slice(-1)}\`:\`\\\\\${n}\`,this.options.pedantic&&(n=i?n:"[*+-]");let a=this.rules.other.listItemRegex(n),r=!1;for(;e;){let o=!1,c="",u="";if(!(t=a.exec(e))||this.rules.block.hr.test(e))break;c=t[0],e=e.substring(c.length);let d=hr(t[2].split(\`
\`,1)[0],t[1].length),p=e.split(\`
\`,1)[0],m=!d.trim(),g=0;if(this.options.pedantic?(g=2,u=d.trimStart()):m?g=t[1].length+1:(g=d.search(this.rules.other.nonSpaceChar),g=g>4?1:g,u=d.slice(g),g+=t[1].length),m&&this.rules.other.blankLine.test(p)&&(c+=p+\`
\`,e=e.substring(p.length+1),o=!0),!o){let y=this.rules.other.nextBulletRegex(g),T=this.rules.other.hrRegex(g),I=this.rules.other.fencesBeginRegex(g),M=this.rules.other.headingBeginRegex(g),D=this.rules.other.htmlBeginRegex(g),O=this.rules.other.blockquoteBeginRegex(g);for(;e;){let N=e.split(\`
\`,1)[0],R;if(p=N,this.options.pedantic?(p=p.replace(this.rules.other.listReplaceNesting,"  "),R=p):R=p.replace(this.rules.other.tabCharGlobal,"    "),I.test(p)||M.test(p)||D.test(p)||O.test(p)||y.test(p)||T.test(p))break;if(R.search(this.rules.other.nonSpaceChar)>=g||!p.trim())u+=\`
\`+R.slice(g);else{if(m||d.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||I.test(d)||M.test(d)||T.test(d))break;u+=\`
\`+p}m=!p.trim(),c+=N+\`
\`,e=e.substring(N.length+1),d=R.slice(g)}}s.loose||(r?s.loose=!0:this.rules.other.doubleBlankLine.test(c)&&(r=!0)),s.items.push({type:"list_item",raw:c,task:!!this.options.gfm&&this.rules.other.listIsTask.test(u),loose:!1,text:u,tokens:[]}),s.raw+=c}let l=s.items.at(-1);if(l)l.raw=l.raw.trimEnd(),l.text=l.text.trimEnd();else return;s.raw=s.raw.trimEnd();for(let o of s.items){if(this.lexer.state.top=!1,o.tokens=this.lexer.blockTokens(o.text,[]),o.task){if(o.text=o.text.replace(this.rules.other.listReplaceTask,""),o.tokens[0]?.type==="text"||o.tokens[0]?.type==="paragraph"){o.tokens[0].raw=o.tokens[0].raw.replace(this.rules.other.listReplaceTask,""),o.tokens[0].text=o.tokens[0].text.replace(this.rules.other.listReplaceTask,"");for(let u=this.lexer.inlineQueue.length-1;u>=0;u--)if(this.rules.other.listIsTask.test(this.lexer.inlineQueue[u].src)){this.lexer.inlineQueue[u].src=this.lexer.inlineQueue[u].src.replace(this.rules.other.listReplaceTask,"");break}}let c=this.rules.other.listTaskCheckbox.exec(o.raw);if(c){let u={type:"checkbox",raw:c[0]+" ",checked:c[0]!=="[ ]"};o.checked=u.checked,s.loose?o.tokens[0]&&["paragraph","text"].includes(o.tokens[0].type)&&"tokens"in o.tokens[0]&&o.tokens[0].tokens?(o.tokens[0].raw=u.raw+o.tokens[0].raw,o.tokens[0].text=u.raw+o.tokens[0].text,o.tokens[0].tokens.unshift(u)):o.tokens.unshift({type:"paragraph",raw:u.raw,text:u.raw,tokens:[u]}):o.tokens.unshift(u)}}if(!s.loose){let c=o.tokens.filter(d=>d.type==="space"),u=c.length>0&&c.some(d=>this.rules.other.anyLine.test(d.raw));s.loose=u}}if(s.loose)for(let o of s.items){o.loose=!0;for(let c of o.tokens)c.type==="text"&&(c.type="paragraph")}return s}}html(e){let t=this.rules.block.html.exec(e);if(t)return{type:"html",block:!0,raw:t[0],pre:t[1]==="pre"||t[1]==="script"||t[1]==="style",text:t[0]}}def(e){let t=this.rules.block.def.exec(e);if(t){let n=t[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),i=t[2]?t[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",s=t[3]?t[3].substring(1,t[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):t[3];return{type:"def",tag:n,raw:t[0],href:i,title:s}}}table(e){let t=this.rules.block.table.exec(e);if(!t||!this.rules.other.tableDelimiter.test(t[2]))return;let n=Gn(t[1]),i=t[2].replace(this.rules.other.tableAlignChars,"").split("|"),s=t[3]?.trim()?t[3].replace(this.rules.other.tableRowBlankLine,"").split(\`
\`):[],a={type:"table",raw:t[0],header:[],align:[],rows:[]};if(n.length===i.length){for(let r of i)this.rules.other.tableAlignRight.test(r)?a.align.push("right"):this.rules.other.tableAlignCenter.test(r)?a.align.push("center"):this.rules.other.tableAlignLeft.test(r)?a.align.push("left"):a.align.push(null);for(let r=0;r<n.length;r++)a.header.push({text:n[r],tokens:this.lexer.inline(n[r]),header:!0,align:a.align[r]});for(let r of s)a.rows.push(Gn(r,a.header.length).map((l,o)=>({text:l,tokens:this.lexer.inline(l),header:!1,align:a.align[o]})));return a}}lheading(e){let t=this.rules.block.lheading.exec(e);if(t)return{type:"heading",raw:t[0],depth:t[2].charAt(0)==="="?1:2,text:t[1],tokens:this.lexer.inline(t[1])}}paragraph(e){let t=this.rules.block.paragraph.exec(e);if(t){let n=t[1].charAt(t[1].length-1)===\`
\`?t[1].slice(0,-1):t[1];return{type:"paragraph",raw:t[0],text:n,tokens:this.lexer.inline(n)}}}text(e){let t=this.rules.block.text.exec(e);if(t)return{type:"text",raw:t[0],text:t[0],tokens:this.lexer.inline(t[0])}}escape(e){let t=this.rules.inline.escape.exec(e);if(t)return{type:"escape",raw:t[0],text:t[1]}}tag(e){let t=this.rules.inline.tag.exec(e);if(t)return!this.lexer.state.inLink&&this.rules.other.startATag.test(t[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(t[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(t[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(t[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:t[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:t[0]}}link(e){let t=this.rules.inline.link.exec(e);if(t){let n=t[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(n)){if(!this.rules.other.endAngleBracket.test(n))return;let a=je(n.slice(0,-1),"\\\\");if((n.length-a.length)%2===0)return}else{let a=pr(t[2],"()");if(a===-2)return;if(a>-1){let r=(t[0].indexOf("!")===0?5:4)+t[1].length+a;t[2]=t[2].substring(0,a),t[0]=t[0].substring(0,r).trim(),t[3]=""}}let i=t[2],s="";if(this.options.pedantic){let a=this.rules.other.pedanticHrefTitle.exec(i);a&&(i=a[1],s=a[3])}else s=t[3]?t[3].slice(1,-1):"";return i=i.trim(),this.rules.other.startAngleBracket.test(i)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(n)?i=i.slice(1):i=i.slice(1,-1)),qn(t,{href:i&&i.replace(this.rules.inline.anyPunctuation,"$1"),title:s&&s.replace(this.rules.inline.anyPunctuation,"$1")},t[0],this.lexer,this.rules)}}reflink(e,t){let n;if((n=this.rules.inline.reflink.exec(e))||(n=this.rules.inline.nolink.exec(e))){let i=(n[2]||n[1]).replace(this.rules.other.multipleSpaceGlobal," "),s=t[i.toLowerCase()];if(!s){let a=n[0].charAt(0);return{type:"text",raw:a,text:a}}return qn(n,s,n[0],this.lexer,this.rules)}}emStrong(e,t,n=""){let i=this.rules.inline.emStrongLDelim.exec(e);if(!(!i||i[3]&&n.match(this.rules.other.unicodeAlphaNumeric))&&(!(i[1]||i[2])||!n||this.rules.inline.punctuation.exec(n))){let s=[...i[0]].length-1,a,r,l=s,o=0,c=i[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(c.lastIndex=0,t=t.slice(-1*e.length+s);(i=c.exec(t))!=null;){if(a=i[1]||i[2]||i[3]||i[4]||i[5]||i[6],!a)continue;if(r=[...a].length,i[3]||i[4]){l+=r;continue}else if((i[5]||i[6])&&s%3&&!((s+r)%3)){o+=r;continue}if(l-=r,l>0)continue;r=Math.min(r,r+l+o);let u=[...i[0]][0].length,d=e.slice(0,s+i.index+u+r);if(Math.min(s,r)%2){let m=d.slice(1,-1);return{type:"em",raw:d,text:m,tokens:this.lexer.inlineTokens(m)}}let p=d.slice(2,-2);return{type:"strong",raw:d,text:p,tokens:this.lexer.inlineTokens(p)}}}}codespan(e){let t=this.rules.inline.code.exec(e);if(t){let n=t[2].replace(this.rules.other.newLineCharGlobal," "),i=this.rules.other.nonSpaceChar.test(n),s=this.rules.other.startingSpaceChar.test(n)&&this.rules.other.endingSpaceChar.test(n);return i&&s&&(n=n.substring(1,n.length-1)),{type:"codespan",raw:t[0],text:n}}}br(e){let t=this.rules.inline.br.exec(e);if(t)return{type:"br",raw:t[0]}}del(e,t,n=""){let i=this.rules.inline.delLDelim.exec(e);if(i&&(!i[1]||!n||this.rules.inline.punctuation.exec(n))){let s=[...i[0]].length-1,a,r,l=s,o=this.rules.inline.delRDelim;for(o.lastIndex=0,t=t.slice(-1*e.length+s);(i=o.exec(t))!=null;){if(a=i[1]||i[2]||i[3]||i[4]||i[5]||i[6],!a||(r=[...a].length,r!==s))continue;if(i[3]||i[4]){l+=r;continue}if(l-=r,l>0)continue;r=Math.min(r,r+l);let c=[...i[0]][0].length,u=e.slice(0,s+i.index+c+r),d=u.slice(s,-s);return{type:"del",raw:u,text:d,tokens:this.lexer.inlineTokens(d)}}}}autolink(e){let t=this.rules.inline.autolink.exec(e);if(t){let n,i;return t[2]==="@"?(n=t[1],i="mailto:"+n):(n=t[1],i=n),{type:"link",raw:t[0],text:n,href:i,tokens:[{type:"text",raw:n,text:n}]}}}url(e){let t;if(t=this.rules.inline.url.exec(e)){let n,i;if(t[2]==="@")n=t[0],i="mailto:"+n;else{let s;do s=t[0],t[0]=this.rules.inline._backpedal.exec(t[0])?.[0]??"";while(s!==t[0]);n=t[0],t[1]==="www."?i="http://"+t[0]:i=t[0]}return{type:"link",raw:t[0],text:n,href:i,tokens:[{type:"text",raw:n,text:n}]}}}inlineText(e){let t=this.rules.inline.text.exec(e);if(t){let n=this.lexer.state.inRawBlock;return{type:"text",raw:t[0],text:t[0],escaped:n}}}},Q=class It{tokens;options;state;inlineQueue;tokenizer;constructor(t){this.tokens=[],this.tokens.links=Object.create(null),this.options=t||ve,this.options.tokenizer=this.options.tokenizer||new dt,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};let n={other:q,block:ct.normal,inline:Ze.normal};this.options.pedantic?(n.block=ct.pedantic,n.inline=Ze.pedantic):this.options.gfm&&(n.block=ct.gfm,this.options.breaks?n.inline=Ze.breaks:n.inline=Ze.gfm),this.tokenizer.rules=n}static get rules(){return{block:ct,inline:Ze}}static lex(t,n){return new It(n).lex(t)}static lexInline(t,n){return new It(n).inlineTokens(t)}lex(t){t=t.replace(q.carriageReturn,\`
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
\`+s.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=r.text):n.push(s);continue}if(t){let r="Infinite loop on byte: "+t.charCodeAt(0);if(this.options.silent){console.error(r);break}else throw new Error(r)}}return this.state.top=!0,n}inline(t,n=[]){return this.inlineQueue.push({src:t,tokens:n}),n}inlineTokens(t,n=[]){let i=t,s=null;if(this.tokens.links){let o=Object.keys(this.tokens.links);if(o.length>0)for(;(s=this.tokenizer.rules.inline.reflinkSearch.exec(i))!=null;)o.includes(s[0].slice(s[0].lastIndexOf("[")+1,-1))&&(i=i.slice(0,s.index)+"["+"a".repeat(s[0].length-2)+"]"+i.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(s=this.tokenizer.rules.inline.anyPunctuation.exec(i))!=null;)i=i.slice(0,s.index)+"++"+i.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);let a;for(;(s=this.tokenizer.rules.inline.blockSkip.exec(i))!=null;)a=s[2]?s[2].length:0,i=i.slice(0,s.index+a)+"["+"a".repeat(s[0].length-a-2)+"]"+i.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);i=this.options.hooks?.emStrongMask?.call({lexer:this},i)??i;let r=!1,l="";for(;t;){r||(l=""),r=!1;let o;if(this.options.extensions?.inline?.some(u=>(o=u.call({lexer:this},t,n))?(t=t.substring(o.raw.length),n.push(o),!0):!1))continue;if(o=this.tokenizer.escape(t)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.tag(t)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.link(t)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.reflink(t,this.tokens.links)){t=t.substring(o.raw.length);let u=n.at(-1);o.type==="text"&&u?.type==="text"?(u.raw+=o.raw,u.text+=o.text):n.push(o);continue}if(o=this.tokenizer.emStrong(t,i,l)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.codespan(t)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.br(t)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.del(t,i,l)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.autolink(t)){t=t.substring(o.raw.length),n.push(o);continue}if(!this.state.inLink&&(o=this.tokenizer.url(t))){t=t.substring(o.raw.length),n.push(o);continue}let c=t;if(this.options.extensions?.startInline){let u=1/0,d=t.slice(1),p;this.options.extensions.startInline.forEach(m=>{p=m.call({lexer:this},d),typeof p=="number"&&p>=0&&(u=Math.min(u,p))}),u<1/0&&u>=0&&(c=t.substring(0,u+1))}if(o=this.tokenizer.inlineText(c)){t=t.substring(o.raw.length),o.raw.slice(-1)!=="_"&&(l=o.raw.slice(-1)),r=!0;let u=n.at(-1);u?.type==="text"?(u.raw+=o.raw,u.text+=o.text):n.push(o);continue}if(t){let u="Infinite loop on byte: "+t.charCodeAt(0);if(this.options.silent){console.error(u);break}else throw new Error(u)}}return n}},pt=class{options;parser;constructor(e){this.options=e||ve}space(e){return""}code({text:e,lang:t,escaped:n}){let i=(t||"").match(q.notSpaceStart)?.[0],s=e.replace(q.endingNewline,"")+\`
\`;return i?'<pre><code class="language-'+re(i)+'">'+(n?s:re(s,!0))+\`</code></pre>
\`:"<pre><code>"+(n?s:re(s,!0))+\`</code></pre>
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
\`}strong({tokens:e}){return\`<strong>\${this.parser.parseInline(e)}</strong>\`}em({tokens:e}){return\`<em>\${this.parser.parseInline(e)}</em>\`}codespan({text:e}){return\`<code>\${re(e,!0)}</code>\`}br(e){return"<br>"}del({tokens:e}){return\`<del>\${this.parser.parseInline(e)}</del>\`}link({href:e,title:t,tokens:n}){let i=this.parser.parseInline(n),s=Fn(e);if(s===null)return i;e=s;let a='<a href="'+e+'"';return t&&(a+=' title="'+re(t)+'"'),a+=">"+i+"</a>",a}image({href:e,title:t,text:n,tokens:i}){i&&(n=this.parser.parseInline(i,this.parser.textRenderer));let s=Fn(e);if(s===null)return re(n);e=s;let a=\`<img src="\${e}" alt="\${re(n)}"\`;return t&&(a+=\` title="\${re(t)}"\`),a+=">",a}text(e){return"tokens"in e&&e.tokens?this.parser.parseInline(e.tokens):"escaped"in e&&e.escaped?e.text:re(e.text)}},Ht=class{strong({text:e}){return e}em({text:e}){return e}codespan({text:e}){return e}del({text:e}){return e}html({text:e}){return e}text({text:e}){return e}link({text:e}){return""+e}image({text:e}){return""+e}br(){return""}checkbox({raw:e}){return e}},V=class Lt{options;renderer;textRenderer;constructor(t){this.options=t||ve,this.options.renderer=this.options.renderer||new pt,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new Ht}static parse(t,n){return new Lt(n).parse(t)}static parseInline(t,n){return new Lt(n).parseInline(t)}parse(t){let n="";for(let i=0;i<t.length;i++){let s=t[i];if(this.options.extensions?.renderers?.[s.type]){let r=s,l=this.options.extensions.renderers[r.type].call({parser:this},r);if(l!==!1||!["space","hr","heading","code","table","blockquote","list","html","def","paragraph","text"].includes(r.type)){n+=l||"";continue}}let a=s;switch(a.type){case"space":{n+=this.renderer.space(a);break}case"hr":{n+=this.renderer.hr(a);break}case"heading":{n+=this.renderer.heading(a);break}case"code":{n+=this.renderer.code(a);break}case"table":{n+=this.renderer.table(a);break}case"blockquote":{n+=this.renderer.blockquote(a);break}case"list":{n+=this.renderer.list(a);break}case"checkbox":{n+=this.renderer.checkbox(a);break}case"html":{n+=this.renderer.html(a);break}case"def":{n+=this.renderer.def(a);break}case"paragraph":{n+=this.renderer.paragraph(a);break}case"text":{n+=this.renderer.text(a);break}default:{let r='Token with "'+a.type+'" type was not found.';if(this.options.silent)return console.error(r),"";throw new Error(r)}}}return n}parseInline(t,n=this.renderer){let i="";for(let s=0;s<t.length;s++){let a=t[s];if(this.options.extensions?.renderers?.[a.type]){let l=this.options.extensions.renderers[a.type].call({parser:this},a);if(l!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(a.type)){i+=l||"";continue}}let r=a;switch(r.type){case"escape":{i+=n.text(r);break}case"html":{i+=n.html(r);break}case"link":{i+=n.link(r);break}case"image":{i+=n.image(r);break}case"checkbox":{i+=n.checkbox(r);break}case"strong":{i+=n.strong(r);break}case"em":{i+=n.em(r);break}case"codespan":{i+=n.codespan(r);break}case"br":{i+=n.br(r);break}case"del":{i+=n.del(r);break}case"text":{i+=n.text(r);break}default:{let l='Token with "'+r.type+'" type was not found.';if(this.options.silent)return console.error(l),"";throw new Error(l)}}}return i}},We=class{options;block;constructor(e){this.options=e||ve}static passThroughHooks=new Set(["preprocess","postprocess","processAllTokens","emStrongMask"]);static passThroughHooksRespectAsync=new Set(["preprocess","postprocess","processAllTokens"]);preprocess(e){return e}postprocess(e){return e}processAllTokens(e){return e}emStrongMask(e){return e}provideLexer(){return this.block?Q.lex:Q.lexInline}provideParser(){return this.block?V.parse:V.parseInline}},fr=class{defaults=Mt();options=this.setOptions;parse=this.parseMarkdown(!0);parseInline=this.parseMarkdown(!1);Parser=V;Renderer=pt;TextRenderer=Ht;Lexer=Q;Tokenizer=dt;Hooks=We;constructor(...e){this.use(...e)}walkTokens(e,t){let n=[];for(let i of e)switch(n=n.concat(t.call(this,i)),i.type){case"table":{let s=i;for(let a of s.header)n=n.concat(this.walkTokens(a.tokens,t));for(let a of s.rows)for(let r of a)n=n.concat(this.walkTokens(r.tokens,t));break}case"list":{let s=i;n=n.concat(this.walkTokens(s.items,t));break}default:{let s=i;this.defaults.extensions?.childTokens?.[s.type]?this.defaults.extensions.childTokens[s.type].forEach(a=>{let r=s[a].flat(1/0);n=n.concat(this.walkTokens(r,t))}):s.tokens&&(n=n.concat(this.walkTokens(s.tokens,t)))}}return n}use(...e){let t=this.defaults.extensions||{renderers:{},childTokens:{}};return e.forEach(n=>{let i={...n};if(i.async=this.defaults.async||i.async||!1,n.extensions&&(n.extensions.forEach(s=>{if(!s.name)throw new Error("extension name required");if("renderer"in s){let a=t.renderers[s.name];a?t.renderers[s.name]=function(...r){let l=s.renderer.apply(this,r);return l===!1&&(l=a.apply(this,r)),l}:t.renderers[s.name]=s.renderer}if("tokenizer"in s){if(!s.level||s.level!=="block"&&s.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");let a=t[s.level];a?a.unshift(s.tokenizer):t[s.level]=[s.tokenizer],s.start&&(s.level==="block"?t.startBlock?t.startBlock.push(s.start):t.startBlock=[s.start]:s.level==="inline"&&(t.startInline?t.startInline.push(s.start):t.startInline=[s.start]))}"childTokens"in s&&s.childTokens&&(t.childTokens[s.name]=s.childTokens)}),i.extensions=t),n.renderer){let s=this.defaults.renderer||new pt(this.defaults);for(let a in n.renderer){if(!(a in s))throw new Error(\`renderer '\${a}' does not exist\`);if(["options","parser"].includes(a))continue;let r=a,l=n.renderer[r],o=s[r];s[r]=(...c)=>{let u=l.apply(s,c);return u===!1&&(u=o.apply(s,c)),u||""}}i.renderer=s}if(n.tokenizer){let s=this.defaults.tokenizer||new dt(this.defaults);for(let a in n.tokenizer){if(!(a in s))throw new Error(\`tokenizer '\${a}' does not exist\`);if(["options","rules","lexer"].includes(a))continue;let r=a,l=n.tokenizer[r],o=s[r];s[r]=(...c)=>{let u=l.apply(s,c);return u===!1&&(u=o.apply(s,c)),u}}i.tokenizer=s}if(n.hooks){let s=this.defaults.hooks||new We;for(let a in n.hooks){if(!(a in s))throw new Error(\`hook '\${a}' does not exist\`);if(["options","block"].includes(a))continue;let r=a,l=n.hooks[r],o=s[r];We.passThroughHooks.has(a)?s[r]=c=>{if(this.defaults.async&&We.passThroughHooksRespectAsync.has(a))return(async()=>{let d=await l.call(s,c);return o.call(s,d)})();let u=l.call(s,c);return o.call(s,u)}:s[r]=(...c)=>{if(this.defaults.async)return(async()=>{let d=await l.apply(s,c);return d===!1&&(d=await o.apply(s,c)),d})();let u=l.apply(s,c);return u===!1&&(u=o.apply(s,c)),u}}i.hooks=s}if(n.walkTokens){let s=this.defaults.walkTokens,a=n.walkTokens;i.walkTokens=function(r){let l=[];return l.push(a.call(this,r)),s&&(l=l.concat(s.call(this,r))),l}}this.defaults={...this.defaults,...i}}),this}setOptions(e){return this.defaults={...this.defaults,...e},this}lexer(e,t){return Q.lex(e,t??this.defaults)}parser(e,t){return V.parse(e,t??this.defaults)}parseMarkdown(e){return(t,n)=>{let i={...n},s={...this.defaults,...i},a=this.onError(!!s.silent,!!s.async);if(this.defaults.async===!0&&i.async===!1)return a(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof t>"u"||t===null)return a(new Error("marked(): input parameter is undefined or null"));if(typeof t!="string")return a(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(t)+", string expected"));if(s.hooks&&(s.hooks.options=s,s.hooks.block=e),s.async)return(async()=>{let r=s.hooks?await s.hooks.preprocess(t):t,l=await(s.hooks?await s.hooks.provideLexer():e?Q.lex:Q.lexInline)(r,s),o=s.hooks?await s.hooks.processAllTokens(l):l;s.walkTokens&&await Promise.all(this.walkTokens(o,s.walkTokens));let c=await(s.hooks?await s.hooks.provideParser():e?V.parse:V.parseInline)(o,s);return s.hooks?await s.hooks.postprocess(c):c})().catch(a);try{s.hooks&&(t=s.hooks.preprocess(t));let r=(s.hooks?s.hooks.provideLexer():e?Q.lex:Q.lexInline)(t,s);s.hooks&&(r=s.hooks.processAllTokens(r)),s.walkTokens&&this.walkTokens(r,s.walkTokens);let l=(s.hooks?s.hooks.provideParser():e?V.parse:V.parseInline)(r,s);return s.hooks&&(l=s.hooks.postprocess(l)),l}catch(r){return a(r)}}}onError(e,t){return n=>{if(n.message+=\`
Please report this to https://github.com/markedjs/marked.\`,e){let i="<p>An error occurred:</p><pre>"+re(n.message+"",!0)+"</pre>";return t?Promise.resolve(i):i}if(t)return Promise.reject(n);throw n}}},we=new fr;function A(e,t){return we.parse(e,t)}A.options=A.setOptions=function(e){return we.setOptions(e),A.defaults=we.defaults,Kn(A.defaults),A};A.getDefaults=Mt;A.defaults=ve;A.use=function(...e){return we.use(...e),A.defaults=we.defaults,Kn(A.defaults),A};A.walkTokens=function(e,t){return we.walkTokens(e,t)};A.parseInline=we.parseInline;A.Parser=V;A.parser=V.parse;A.Renderer=pt;A.TextRenderer=Ht;A.Lexer=Q;A.lexer=Q.lex;A.Tokenizer=dt;A.Hooks=We;A.parse=A;var co=A.options,uo=A.setOptions,po=A.use,ho=A.walkTokens,go=A.parseInline;var fo=V.parse,mo=Q.lex;var vs=Ai(ws(),1);var z=vs.default;var _s="[A-Za-z$_][0-9A-Za-z$_]*",ra=["as","in","of","if","for","while","finally","var","new","function","do","return","void","else","break","catch","instanceof","with","throw","case","default","try","switch","continue","typeof","delete","let","yield","const","class","debugger","async","await","static","import","from","export","extends","using"],aa=["true","false","null","undefined","NaN","Infinity"],Ss=["Object","Function","Boolean","Symbol","Math","Date","Number","BigInt","String","RegExp","Array","Float32Array","Float64Array","Int8Array","Uint8Array","Uint8ClampedArray","Int16Array","Int32Array","Uint16Array","Uint32Array","BigInt64Array","BigUint64Array","Set","Map","WeakSet","WeakMap","ArrayBuffer","SharedArrayBuffer","Atomics","DataView","JSON","Promise","Generator","GeneratorFunction","AsyncFunction","Reflect","Proxy","Intl","WebAssembly"],As=["Error","EvalError","InternalError","RangeError","ReferenceError","SyntaxError","TypeError","URIError"],Ts=["setInterval","setTimeout","clearInterval","clearTimeout","require","exports","eval","isFinite","isNaN","parseFloat","parseInt","decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape","unescape"],oa=["arguments","this","super","console","window","document","localStorage","sessionStorage","module","global"],la=[].concat(Ts,Ss,As);function Yt(e){let t=e.regex,n=(b,{after:w})=>{let S="</"+b[0].slice(1);return b.input.indexOf(S,w)!==-1},i=_s,s={begin:"<>",end:"</>"},a=/<[A-Za-z0-9\\\\._:-]+\\s*\\/>/,r={begin:/<[A-Za-z0-9\\\\._:-]+/,end:/\\/[A-Za-z0-9\\\\._:-]+>|\\/>/,isTrulyOpeningTag:(b,w)=>{let S=b[0].length+b.index,B=b.input[S];if(B==="<"||B===","){w.ignoreMatch();return}B===">"&&(n(b,{after:S})||w.ignoreMatch());let H,ne=b.input.substring(S);if(H=ne.match(/^\\s*=/)){w.ignoreMatch();return}if((H=ne.match(/^\\s+extends\\s+/))&&H.index===0){w.ignoreMatch();return}}},l={$pattern:_s,keyword:ra,literal:aa,built_in:la,"variable.language":oa},o="[0-9](_?[0-9])*",c=\`\\\\.(\${o})\`,u="0|[1-9](_?[0-9])*|0[0-7]*[89][0-9]*",d={className:"number",variants:[{begin:\`(\\\\b(\${u})((\${c})|\\\\.)?|(\${c}))[eE][+-]?(\${o})\\\\b\`},{begin:\`\\\\b(\${u})\\\\b((\${c})\\\\b|\\\\.)?|(\${c})\\\\b\`},{begin:"\\\\b(0|[1-9](_?[0-9])*)n\\\\b"},{begin:"\\\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*n?\\\\b"},{begin:"\\\\b0[bB][0-1](_?[0-1])*n?\\\\b"},{begin:"\\\\b0[oO][0-7](_?[0-7])*n?\\\\b"},{begin:"\\\\b0[0-7]+n?\\\\b"}],relevance:0},p={className:"subst",begin:"\\\\$\\\\{",end:"\\\\}",keywords:l,contains:[]},m={begin:".?html\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,p],subLanguage:"xml"}},g={begin:".?css\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,p],subLanguage:"css"}},y={begin:".?gql\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,p],subLanguage:"graphql"}},T={className:"string",begin:"\`",end:"\`",contains:[e.BACKSLASH_ESCAPE,p]},M={className:"comment",variants:[e.COMMENT(/\\/\\*\\*(?!\\/)/,"\\\\*/",{relevance:0,contains:[{begin:"(?=@[A-Za-z]+)",relevance:0,contains:[{className:"doctag",begin:"@[A-Za-z]+"},{className:"type",begin:"\\\\{",end:"\\\\}",excludeEnd:!0,excludeBegin:!0,relevance:0},{className:"variable",begin:i+"(?=\\\\s*(-)|$)",endsParent:!0,relevance:0},{begin:/(?=[^\\n])\\s/,relevance:0}]}]}),e.C_BLOCK_COMMENT_MODE,e.C_LINE_COMMENT_MODE]},D=[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,m,g,y,T,{match:/\\$\\d+/},d];p.contains=D.concat({begin:/\\{/,end:/\\}/,keywords:l,contains:["self"].concat(D)});let O=[].concat(M,p.contains),N=O.concat([{begin:/(\\s*)\\(/,end:/\\)/,keywords:l,contains:["self"].concat(O)}]),R={className:"params",begin:/(\\s*)\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:N},K={variants:[{match:[/class/,/\\s+/,i,/\\s+/,/extends/,/\\s+/,t.concat(i,"(",t.concat(/\\./,i),")*")],scope:{1:"keyword",3:"title.class",5:"keyword",7:"title.class.inherited"}},{match:[/class/,/\\s+/,i],scope:{1:"keyword",3:"title.class"}}]},U={relevance:0,match:t.either(/\\bJSON/,/\\b[A-Z][a-z]+([A-Z][a-z]*|\\d)*/,/\\b[A-Z]{2,}([A-Z][a-z]+|\\d)+([A-Z][a-z]*)*/,/\\b[A-Z]{2,}[a-z]+([A-Z][a-z]+|\\d)*([A-Z][a-z]*)*/),className:"title.class",keywords:{_:[...Ss,...As]}},j={label:"use_strict",className:"meta",relevance:10,begin:/^\\s*['"]use (strict|asm)['"]/},Ie={variants:[{match:[/function/,/\\s+/,i,/(?=\\s*\\()/]},{match:[/function/,/\\s*(?=\\()/]}],className:{1:"keyword",3:"title.function"},label:"func.def",contains:[R],illegal:/%/},Fe={relevance:0,match:/\\b[A-Z][A-Z_0-9]+\\b/,className:"variable.constant"};function Ge(b){return t.concat("(?!",b.join("|"),")")}let qe={match:t.concat(/\\b/,Ge([...Ts,"super","import"].map(b=>\`\${b}\\\\s*\\\\(\`)),i,t.lookahead(/\\s*\\(/)),className:"title.function",relevance:0},ge={begin:t.concat(/\\./,t.lookahead(t.concat(i,/(?![0-9A-Za-z$_(])/))),end:i,excludeBegin:!0,keywords:"prototype",className:"property",relevance:0},Ke={match:[/get|set/,/\\s+/,i,/(?=\\()/],className:{1:"keyword",3:"title.function"},contains:[{begin:/\\(\\)/},R]},h="(\\\\([^()]*(\\\\([^()]*(\\\\([^()]*\\\\)[^()]*)*\\\\)[^()]*)*\\\\)|"+e.UNDERSCORE_IDENT_RE+")\\\\s*=>",k={match:[/const|var|let/,/\\s+/,i,/\\s*/,/=\\s*/,/(async\\s*)?/,t.lookahead(h)],keywords:"async",className:{1:"keyword",3:"title.function"},contains:[R]};return{name:"JavaScript",aliases:["js","jsx","mjs","cjs"],keywords:l,exports:{PARAMS_CONTAINS:N,CLASS_REFERENCE:U},illegal:/#(?![$_A-z])/,contains:[e.SHEBANG({label:"shebang",binary:"node",relevance:5}),j,e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,m,g,y,T,M,{match:/\\$\\d+/},d,U,{scope:"attr",match:i+t.lookahead(":"),relevance:0},k,{begin:"("+e.RE_STARTERS_RE+"|\\\\b(case|return|throw)\\\\b)\\\\s*",keywords:"return throw case",relevance:0,contains:[M,e.REGEXP_MODE,{className:"function",begin:h,returnBegin:!0,end:"\\\\s*=>",contains:[{className:"params",variants:[{begin:e.UNDERSCORE_IDENT_RE,relevance:0},{className:null,begin:/\\(\\s*\\)/,skip:!0},{begin:/(\\s*)\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:N}]}]},{begin:/,/,relevance:0},{match:/\\s+/,relevance:0},{variants:[{begin:s.begin,end:s.end},{match:a},{begin:r.begin,"on:begin":r.isTrulyOpeningTag,end:r.end}],subLanguage:"xml",contains:[{begin:r.begin,end:r.end,skip:!0,contains:["self"]}]}]},Ie,{beginKeywords:"while if switch catch for"},{begin:"\\\\b(?!function)"+e.UNDERSCORE_IDENT_RE+"\\\\([^()]*(\\\\([^()]*(\\\\([^()]*\\\\)[^()]*)*\\\\)[^()]*)*\\\\)\\\\s*\\\\{",returnBegin:!0,label:"func.def",contains:[R,e.inherit(e.TITLE_MODE,{begin:i,className:"title.function"})]},{match:/\\.\\.\\./,relevance:0},ge,{match:"\\\\$"+i,relevance:0},{match:[/\\bconstructor(?=\\s*\\()/],className:{1:"title.function"},contains:[R]},qe,Fe,K,Ke,{match:/\\$[(.]/}]}}var Et="[A-Za-z$_][0-9A-Za-z$_]*",Cs=["as","in","of","if","for","while","finally","var","new","function","do","return","void","else","break","catch","instanceof","with","throw","case","default","try","switch","continue","typeof","delete","let","yield","const","class","debugger","async","await","static","import","from","export","extends","using"],Ns=["true","false","null","undefined","NaN","Infinity"],Rs=["Object","Function","Boolean","Symbol","Math","Date","Number","BigInt","String","RegExp","Array","Float32Array","Float64Array","Int8Array","Uint8Array","Uint8ClampedArray","Int16Array","Int32Array","Uint16Array","Uint32Array","BigInt64Array","BigUint64Array","Set","Map","WeakSet","WeakMap","ArrayBuffer","SharedArrayBuffer","Atomics","DataView","JSON","Promise","Generator","GeneratorFunction","AsyncFunction","Reflect","Proxy","Intl","WebAssembly"],Is=["Error","EvalError","InternalError","RangeError","ReferenceError","SyntaxError","TypeError","URIError"],Ls=["setInterval","setTimeout","clearInterval","clearTimeout","require","exports","eval","isFinite","isNaN","parseFloat","parseInt","decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape","unescape"],Ms=["arguments","this","super","console","window","document","localStorage","sessionStorage","module","global"],Os=[].concat(Ls,Rs,Is);function ca(e){let t=e.regex,n=(b,{after:w})=>{let S="</"+b[0].slice(1);return b.input.indexOf(S,w)!==-1},i=Et,s={begin:"<>",end:"</>"},a=/<[A-Za-z0-9\\\\._:-]+\\s*\\/>/,r={begin:/<[A-Za-z0-9\\\\._:-]+/,end:/\\/[A-Za-z0-9\\\\._:-]+>|\\/>/,isTrulyOpeningTag:(b,w)=>{let S=b[0].length+b.index,B=b.input[S];if(B==="<"||B===","){w.ignoreMatch();return}B===">"&&(n(b,{after:S})||w.ignoreMatch());let H,ne=b.input.substring(S);if(H=ne.match(/^\\s*=/)){w.ignoreMatch();return}if((H=ne.match(/^\\s+extends\\s+/))&&H.index===0){w.ignoreMatch();return}}},l={$pattern:Et,keyword:Cs,literal:Ns,built_in:Os,"variable.language":Ms},o="[0-9](_?[0-9])*",c=\`\\\\.(\${o})\`,u="0|[1-9](_?[0-9])*|0[0-7]*[89][0-9]*",d={className:"number",variants:[{begin:\`(\\\\b(\${u})((\${c})|\\\\.)?|(\${c}))[eE][+-]?(\${o})\\\\b\`},{begin:\`\\\\b(\${u})\\\\b((\${c})\\\\b|\\\\.)?|(\${c})\\\\b\`},{begin:"\\\\b(0|[1-9](_?[0-9])*)n\\\\b"},{begin:"\\\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*n?\\\\b"},{begin:"\\\\b0[bB][0-1](_?[0-1])*n?\\\\b"},{begin:"\\\\b0[oO][0-7](_?[0-7])*n?\\\\b"},{begin:"\\\\b0[0-7]+n?\\\\b"}],relevance:0},p={className:"subst",begin:"\\\\$\\\\{",end:"\\\\}",keywords:l,contains:[]},m={begin:".?html\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,p],subLanguage:"xml"}},g={begin:".?css\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,p],subLanguage:"css"}},y={begin:".?gql\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,p],subLanguage:"graphql"}},T={className:"string",begin:"\`",end:"\`",contains:[e.BACKSLASH_ESCAPE,p]},M={className:"comment",variants:[e.COMMENT(/\\/\\*\\*(?!\\/)/,"\\\\*/",{relevance:0,contains:[{begin:"(?=@[A-Za-z]+)",relevance:0,contains:[{className:"doctag",begin:"@[A-Za-z]+"},{className:"type",begin:"\\\\{",end:"\\\\}",excludeEnd:!0,excludeBegin:!0,relevance:0},{className:"variable",begin:i+"(?=\\\\s*(-)|$)",endsParent:!0,relevance:0},{begin:/(?=[^\\n])\\s/,relevance:0}]}]}),e.C_BLOCK_COMMENT_MODE,e.C_LINE_COMMENT_MODE]},D=[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,m,g,y,T,{match:/\\$\\d+/},d];p.contains=D.concat({begin:/\\{/,end:/\\}/,keywords:l,contains:["self"].concat(D)});let O=[].concat(M,p.contains),N=O.concat([{begin:/(\\s*)\\(/,end:/\\)/,keywords:l,contains:["self"].concat(O)}]),R={className:"params",begin:/(\\s*)\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:N},K={variants:[{match:[/class/,/\\s+/,i,/\\s+/,/extends/,/\\s+/,t.concat(i,"(",t.concat(/\\./,i),")*")],scope:{1:"keyword",3:"title.class",5:"keyword",7:"title.class.inherited"}},{match:[/class/,/\\s+/,i],scope:{1:"keyword",3:"title.class"}}]},U={relevance:0,match:t.either(/\\bJSON/,/\\b[A-Z][a-z]+([A-Z][a-z]*|\\d)*/,/\\b[A-Z]{2,}([A-Z][a-z]+|\\d)+([A-Z][a-z]*)*/,/\\b[A-Z]{2,}[a-z]+([A-Z][a-z]+|\\d)*([A-Z][a-z]*)*/),className:"title.class",keywords:{_:[...Rs,...Is]}},j={label:"use_strict",className:"meta",relevance:10,begin:/^\\s*['"]use (strict|asm)['"]/},Ie={variants:[{match:[/function/,/\\s+/,i,/(?=\\s*\\()/]},{match:[/function/,/\\s*(?=\\()/]}],className:{1:"keyword",3:"title.function"},label:"func.def",contains:[R],illegal:/%/},Fe={relevance:0,match:/\\b[A-Z][A-Z_0-9]+\\b/,className:"variable.constant"};function Ge(b){return t.concat("(?!",b.join("|"),")")}let qe={match:t.concat(/\\b/,Ge([...Ls,"super","import"].map(b=>\`\${b}\\\\s*\\\\(\`)),i,t.lookahead(/\\s*\\(/)),className:"title.function",relevance:0},ge={begin:t.concat(/\\./,t.lookahead(t.concat(i,/(?![0-9A-Za-z$_(])/))),end:i,excludeBegin:!0,keywords:"prototype",className:"property",relevance:0},Ke={match:[/get|set/,/\\s+/,i,/(?=\\()/],className:{1:"keyword",3:"title.function"},contains:[{begin:/\\(\\)/},R]},h="(\\\\([^()]*(\\\\([^()]*(\\\\([^()]*\\\\)[^()]*)*\\\\)[^()]*)*\\\\)|"+e.UNDERSCORE_IDENT_RE+")\\\\s*=>",k={match:[/const|var|let/,/\\s+/,i,/\\s*/,/=\\s*/,/(async\\s*)?/,t.lookahead(h)],keywords:"async",className:{1:"keyword",3:"title.function"},contains:[R]};return{name:"JavaScript",aliases:["js","jsx","mjs","cjs"],keywords:l,exports:{PARAMS_CONTAINS:N,CLASS_REFERENCE:U},illegal:/#(?![$_A-z])/,contains:[e.SHEBANG({label:"shebang",binary:"node",relevance:5}),j,e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,m,g,y,T,M,{match:/\\$\\d+/},d,U,{scope:"attr",match:i+t.lookahead(":"),relevance:0},k,{begin:"("+e.RE_STARTERS_RE+"|\\\\b(case|return|throw)\\\\b)\\\\s*",keywords:"return throw case",relevance:0,contains:[M,e.REGEXP_MODE,{className:"function",begin:h,returnBegin:!0,end:"\\\\s*=>",contains:[{className:"params",variants:[{begin:e.UNDERSCORE_IDENT_RE,relevance:0},{className:null,begin:/\\(\\s*\\)/,skip:!0},{begin:/(\\s*)\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:N}]}]},{begin:/,/,relevance:0},{match:/\\s+/,relevance:0},{variants:[{begin:s.begin,end:s.end},{match:a},{begin:r.begin,"on:begin":r.isTrulyOpeningTag,end:r.end}],subLanguage:"xml",contains:[{begin:r.begin,end:r.end,skip:!0,contains:["self"]}]}]},Ie,{beginKeywords:"while if switch catch for"},{begin:"\\\\b(?!function)"+e.UNDERSCORE_IDENT_RE+"\\\\([^()]*(\\\\([^()]*(\\\\([^()]*\\\\)[^()]*)*\\\\)[^()]*)*\\\\)\\\\s*\\\\{",returnBegin:!0,label:"func.def",contains:[R,e.inherit(e.TITLE_MODE,{begin:i,className:"title.function"})]},{match:/\\.\\.\\./,relevance:0},ge,{match:"\\\\$"+i,relevance:0},{match:[/\\bconstructor(?=\\s*\\()/],className:{1:"title.function"},contains:[R]},qe,Fe,K,Ke,{match:/\\$[(.]/}]}}function Qt(e){let t=e.regex,n=ca(e),i=Et,s=["any","void","number","boolean","string","object","never","symbol","bigint","unknown"],a={begin:[/namespace/,/\\s+/,e.IDENT_RE],beginScope:{1:"keyword",3:"title.class"}},r={beginKeywords:"interface",end:/\\{/,excludeEnd:!0,keywords:{keyword:"interface extends",built_in:s},contains:[n.exports.CLASS_REFERENCE]},l={className:"meta",relevance:10,begin:/^\\s*['"]use strict['"]/},o=["type","interface","public","private","protected","implements","declare","abstract","readonly","enum","override","satisfies"],c={$pattern:Et,keyword:Cs.concat(o),literal:Ns,built_in:Os.concat(s),"variable.language":Ms},u={className:"meta",begin:"@"+i},d=(y,T,I)=>{let M=y.contains.findIndex(D=>D.label===T);if(M===-1)throw new Error("can not find mode to replace");y.contains.splice(M,1,I)};Object.assign(n.keywords,c),n.exports.PARAMS_CONTAINS.push(u);let p=n.contains.find(y=>y.scope==="attr"),m=Object.assign({},p,{match:t.concat(i,t.lookahead(/\\s*\\?:/))});n.exports.PARAMS_CONTAINS.push([n.exports.CLASS_REFERENCE,p,m]),n.contains=n.contains.concat([u,a,r,m]),d(n,"shebang",e.SHEBANG()),d(n,"use_strict",l);let g=n.contains.find(y=>y.label==="func.def");return g.relevance=0,Object.assign(n,{name:"TypeScript",aliases:["ts","tsx","mts","cts"]}),n}function Vt(e){let t=e.regex,n=/[\\p{XID_Start}_]\\p{XID_Continue}*/u,i=["and","as","assert","async","await","break","case","class","continue","def","del","elif","else","except","finally","for","from","global","if","import","in","is","lambda","match","nonlocal|10","not","or","pass","raise","return","try","while","with","yield"],l={$pattern:/[A-Za-z]\\w+|__\\w+__/,keyword:i,built_in:["__import__","abs","all","any","ascii","bin","bool","breakpoint","bytearray","bytes","callable","chr","classmethod","compile","complex","delattr","dict","dir","divmod","enumerate","eval","exec","filter","float","format","frozenset","getattr","globals","hasattr","hash","help","hex","id","input","int","isinstance","issubclass","iter","len","list","locals","map","max","memoryview","min","next","object","oct","open","ord","pow","print","property","range","repr","reversed","round","set","setattr","slice","sorted","staticmethod","str","sum","super","tuple","type","vars","zip"],literal:["__debug__","Ellipsis","False","None","NotImplemented","True"],type:["Any","Callable","Coroutine","Dict","List","Literal","Generic","Optional","Sequence","Set","Tuple","Type","Union"]},o={className:"meta",begin:/^(>>>|\\.\\.\\.) /},c={className:"subst",begin:/\\{/,end:/\\}/,keywords:l,illegal:/#/},u={begin:/\\{\\{/,relevance:0},d={className:"string",contains:[e.BACKSLASH_ESCAPE],variants:[{begin:/([uU]|[bB]|[rR]|[bB][rR]|[rR][bB])?'''/,end:/'''/,contains:[e.BACKSLASH_ESCAPE,o],relevance:10},{begin:/([uU]|[bB]|[rR]|[bB][rR]|[rR][bB])?"""/,end:/"""/,contains:[e.BACKSLASH_ESCAPE,o],relevance:10},{begin:/([fF][rR]|[rR][fF]|[fF])'''/,end:/'''/,contains:[e.BACKSLASH_ESCAPE,o,u,c]},{begin:/([fF][rR]|[rR][fF]|[fF])"""/,end:/"""/,contains:[e.BACKSLASH_ESCAPE,o,u,c]},{begin:/([uU]|[rR])'/,end:/'/,relevance:10},{begin:/([uU]|[rR])"/,end:/"/,relevance:10},{begin:/([bB]|[bB][rR]|[rR][bB])'/,end:/'/},{begin:/([bB]|[bB][rR]|[rR][bB])"/,end:/"/},{begin:/([fF][rR]|[rR][fF]|[fF])'/,end:/'/,contains:[e.BACKSLASH_ESCAPE,u,c]},{begin:/([fF][rR]|[rR][fF]|[fF])"/,end:/"/,contains:[e.BACKSLASH_ESCAPE,u,c]},e.APOS_STRING_MODE,e.QUOTE_STRING_MODE]},p="[0-9](_?[0-9])*",m=\`(\\\\b(\${p}))?\\\\.(\${p})|\\\\b(\${p})\\\\.\`,g=\`\\\\b|\${i.join("|")}\`,y={className:"number",relevance:0,variants:[{begin:\`(\\\\b(\${p})|(\${m}))[eE][+-]?(\${p})[jJ]?(?=\${g})\`},{begin:\`(\${m})[jJ]?\`},{begin:\`\\\\b([1-9](_?[0-9])*|0+(_?0)*)[lLjJ]?(?=\${g})\`},{begin:\`\\\\b0[bB](_?[01])+[lL]?(?=\${g})\`},{begin:\`\\\\b0[oO](_?[0-7])+[lL]?(?=\${g})\`},{begin:\`\\\\b0[xX](_?[0-9a-fA-F])+[lL]?(?=\${g})\`},{begin:\`\\\\b(\${p})[jJ](?=\${g})\`}]},T={className:"comment",begin:t.lookahead(/# type:/),end:/$/,keywords:l,contains:[{begin:/# type:/},{begin:/#/,end:/\\b\\B/,endsWithParent:!0}]},I={className:"params",variants:[{className:"",begin:/\\(\\s*\\)/,skip:!0},{begin:/\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:["self",o,y,d,e.HASH_COMMENT_MODE]}]};return c.contains=[d,y,o],{name:"Python",aliases:["py","gyp","ipython"],unicodeRegex:!0,keywords:l,illegal:/(<\\/|\\?)|=>/,contains:[o,y,{scope:"variable.language",match:/\\bself\\b/},{beginKeywords:"if",relevance:0},{match:/\\bor\\b/,scope:"keyword"},d,T,e.HASH_COMMENT_MODE,{match:[/\\bdef/,/\\s+/,n],scope:{1:"keyword",3:"title.function"},contains:[I]},{variants:[{match:[/\\bclass/,/\\s+/,n,/\\s*/,/\\(\\s*/,n,/\\s*\\)/]},{match:[/\\bclass/,/\\s+/,n]}],scope:{1:"keyword",3:"title.class",6:"title.class.inherited"}},{className:"meta",begin:/^[\\t ]*@/,end:/(?=#)|$/,contains:[y,I,d]}]}}function Jt(e){let t=e.regex,n={},i={begin:/\\$\\{/,end:/\\}/,contains:["self",{begin:/:-/,contains:[n]}]};Object.assign(n,{className:"variable",variants:[{begin:t.concat(/\\$[\\w\\d#@][\\w\\d_]*/,"(?![\\\\w\\\\d])(?![$])")},i]});let s={className:"subst",begin:/\\$\\(/,end:/\\)/,contains:[e.BACKSLASH_ESCAPE]},a=e.inherit(e.COMMENT(),{match:[/(^|\\s)/,/#.*$/],scope:{2:"comment"}}),r={begin:/<<-?\\s*(?=\\w+)/,starts:{contains:[e.END_SAME_AS_BEGIN({begin:/(\\w+)/,end:/(\\w+)/,className:"string"})]}},l={className:"string",begin:/"/,end:/"/,contains:[e.BACKSLASH_ESCAPE,n,s]};s.contains.push(l);let o={match:/\\\\"/},c={className:"string",begin:/'/,end:/'/},u={match:/\\\\'/},d={begin:/\\$?\\(\\(/,end:/\\)\\)/,contains:[{begin:/\\d+#[0-9a-f]+/,className:"number"},e.NUMBER_MODE,n]},p=["fish","bash","zsh","sh","csh","ksh","tcsh","dash","scsh"],m=e.SHEBANG({binary:\`(\${p.join("|")})\`,relevance:10}),g={className:"function",begin:/\\w[\\w\\d_]*\\s*\\(\\s*\\)\\s*\\{/,returnBegin:!0,contains:[e.inherit(e.TITLE_MODE,{begin:/\\w[\\w\\d_]*/})],relevance:0},y=["if","then","else","elif","fi","time","for","while","until","in","do","done","case","esac","coproc","function","select"],T=["true","false"],I={match:/(\\/[a-z._-]+)+/},M=["break","cd","continue","eval","exec","exit","export","getopts","hash","pwd","readonly","return","shift","test","times","trap","umask","unset"],D=["alias","bind","builtin","caller","command","declare","echo","enable","help","let","local","logout","mapfile","printf","read","readarray","source","sudo","type","typeset","ulimit","unalias"],O=["autoload","bg","bindkey","bye","cap","chdir","clone","comparguments","compcall","compctl","compdescribe","compfiles","compgroups","compquote","comptags","comptry","compvalues","dirs","disable","disown","echotc","echoti","emulate","fc","fg","float","functions","getcap","getln","history","integer","jobs","kill","limit","log","noglob","popd","print","pushd","pushln","rehash","sched","setcap","setopt","stat","suspend","ttyctl","unfunction","unhash","unlimit","unsetopt","vared","wait","whence","where","which","zcompile","zformat","zftp","zle","zmodload","zparseopts","zprof","zpty","zregexparse","zsocket","zstyle","ztcp"],N=["chcon","chgrp","chown","chmod","cp","dd","df","dir","dircolors","ln","ls","mkdir","mkfifo","mknod","mktemp","mv","realpath","rm","rmdir","shred","sync","touch","truncate","vdir","b2sum","base32","base64","cat","cksum","comm","csplit","cut","expand","fmt","fold","head","join","md5sum","nl","numfmt","od","paste","ptx","pr","sha1sum","sha224sum","sha256sum","sha384sum","sha512sum","shuf","sort","split","sum","tac","tail","tr","tsort","unexpand","uniq","wc","arch","basename","chroot","date","dirname","du","echo","env","expr","factor","groups","hostid","id","link","logname","nice","nohup","nproc","pathchk","pinky","printenv","printf","pwd","readlink","runcon","seq","sleep","stat","stdbuf","stty","tee","test","timeout","tty","uname","unlink","uptime","users","who","whoami","yes"];return{name:"Bash",aliases:["sh","zsh"],keywords:{$pattern:/\\b[a-z][a-z0-9._-]+\\b/,keyword:y,literal:T,built_in:[...M,...D,"set","shopt",...O,...N]},contains:[m,e.SHEBANG(),g,d,a,r,I,l,o,c,u,n]}}function Bs(e){let t={className:"attr",begin:/"(\\\\.|[^\\\\"\\r\\n])*"(?=\\s*:)/,relevance:1.01},n={match:/[{}[\\],:]/,className:"punctuation",relevance:0},i=["true","false","null"],s={scope:"literal",beginKeywords:i.join(" ")};return{name:"JSON",aliases:["jsonc"],keywords:{literal:i},contains:[t,n,e.QUOTE_STRING_MODE,s,e.C_NUMBER_MODE,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE],illegal:"\\\\S"}}function en(e){let t=e.regex,n=t.concat(/[\\p{L}_]/u,t.optional(/[\\p{L}0-9_.-]*:/u),/[\\p{L}0-9_.-]*/u),i=/[\\p{L}0-9._:-]+/u,s={className:"symbol",begin:/&[a-z]+;|&#[0-9]+;|&#x[a-f0-9]+;/},a={begin:/\\s/,contains:[{className:"keyword",begin:/#?[a-z_][a-z1-9_-]+/,illegal:/\\n/}]},r=e.inherit(a,{begin:/\\(/,end:/\\)/}),l=e.inherit(e.APOS_STRING_MODE,{className:"string"}),o=e.inherit(e.QUOTE_STRING_MODE,{className:"string"}),c={endsWithParent:!0,illegal:/</,relevance:0,contains:[{className:"attr",begin:i,relevance:0},{begin:/=\\s*/,relevance:0,contains:[{className:"string",endsParent:!0,variants:[{begin:/"/,end:/"/,contains:[s]},{begin:/'/,end:/'/,contains:[s]},{begin:/[^\\s"'=<>\`]+/}]}]}]};return{name:"HTML, XML",aliases:["html","xhtml","rss","atom","xjb","xsd","xsl","plist","wsf","svg"],case_insensitive:!0,unicodeRegex:!0,contains:[{className:"meta",begin:/<![a-z]/,end:/>/,relevance:10,contains:[a,o,l,r,{begin:/\\[/,end:/\\]/,contains:[{className:"meta",begin:/<![a-z]/,end:/>/,contains:[a,r,o,l]}]}]},e.COMMENT(/<!--/,/-->/,{relevance:10}),{begin:/<!\\[CDATA\\[/,end:/\\]\\]>/,relevance:10},s,{className:"meta",end:/\\?>/,variants:[{begin:/<\\?xml/,relevance:10,contains:[o]},{begin:/<\\?[a-z][a-z0-9]+/}]},{className:"tag",begin:/<style(?=\\s|>)/,end:/>/,keywords:{name:"style"},contains:[c],starts:{end:/<\\/style>/,returnEnd:!0,subLanguage:["css","xml"]}},{className:"tag",begin:/<script(?=\\s|>)/,end:/>/,keywords:{name:"script"},contains:[c],starts:{end:/<\\/script>/,returnEnd:!0,subLanguage:["javascript","handlebars","xml"]}},{className:"tag",begin:/<>|<\\/>/},{className:"tag",begin:t.concat(/</,t.lookahead(t.concat(n,t.either(/\\/>/,/>/,/\\s/)))),end:/\\/?>/,contains:[{className:"name",begin:n,relevance:0,starts:c}]},{className:"tag",begin:t.concat(/<\\//,t.lookahead(t.concat(n,/>/))),contains:[{className:"name",begin:n,relevance:0},{begin:/>/,relevance:0,endsParent:!0}]}]}}var ua=e=>({IMPORTANT:{scope:"meta",begin:"!important"},BLOCK_COMMENT:e.C_BLOCK_COMMENT_MODE,HEXCOLOR:{scope:"number",begin:/#(([0-9a-fA-F]{3,4})|(([0-9a-fA-F]{2}){3,4}))\\b/},FUNCTION_DISPATCH:{className:"built_in",begin:/[\\w-]+(?=\\()/},ATTRIBUTE_SELECTOR_MODE:{scope:"selector-attr",begin:/\\[/,end:/\\]/,illegal:"$",contains:[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE]},CSS_NUMBER_MODE:{scope:"number",begin:e.NUMBER_RE+"(%|em|ex|ch|rem|vw|vh|vmin|vmax|cm|mm|in|pt|pc|px|deg|grad|rad|turn|s|ms|Hz|kHz|dpi|dpcm|dppx)?",relevance:0},CSS_VARIABLE:{className:"attr",begin:/--[A-Za-z_][A-Za-z0-9_-]*/}}),da=["a","abbr","address","article","aside","audio","b","blockquote","body","button","canvas","caption","cite","code","dd","del","details","dfn","div","dl","dt","em","fieldset","figcaption","figure","footer","form","h1","h2","h3","h4","h5","h6","header","hgroup","html","i","iframe","img","input","ins","kbd","label","legend","li","main","mark","menu","nav","object","ol","optgroup","option","p","picture","q","quote","samp","section","select","source","span","strong","summary","sup","table","tbody","td","textarea","tfoot","th","thead","time","tr","ul","var","video"],pa=["defs","g","marker","mask","pattern","svg","switch","symbol","feBlend","feColorMatrix","feComponentTransfer","feComposite","feConvolveMatrix","feDiffuseLighting","feDisplacementMap","feFlood","feGaussianBlur","feImage","feMerge","feMorphology","feOffset","feSpecularLighting","feTile","feTurbulence","linearGradient","radialGradient","stop","circle","ellipse","image","line","path","polygon","polyline","rect","text","use","textPath","tspan","foreignObject","clipPath"],ha=[...da,...pa],ga=["any-hover","any-pointer","aspect-ratio","color","color-gamut","color-index","device-aspect-ratio","device-height","device-width","display-mode","forced-colors","grid","height","hover","inverted-colors","monochrome","orientation","overflow-block","overflow-inline","pointer","prefers-color-scheme","prefers-contrast","prefers-reduced-motion","prefers-reduced-transparency","resolution","scan","scripting","update","width","min-width","max-width","min-height","max-height"].sort().reverse(),fa=["active","any-link","blank","checked","current","default","defined","dir","disabled","drop","empty","enabled","first","first-child","first-of-type","fullscreen","future","focus","focus-visible","focus-within","has","host","host-context","hover","indeterminate","in-range","invalid","is","lang","last-child","last-of-type","left","link","local-link","not","nth-child","nth-col","nth-last-child","nth-last-col","nth-last-of-type","nth-of-type","only-child","only-of-type","optional","out-of-range","past","placeholder-shown","read-only","read-write","required","right","root","scope","target","target-within","user-invalid","valid","visited","where"].sort().reverse(),ma=["after","backdrop","before","cue","cue-region","first-letter","first-line","grammar-error","marker","part","placeholder","selection","slotted","spelling-error"].sort().reverse(),ba=["accent-color","align-content","align-items","align-self","alignment-baseline","all","anchor-name","animation","animation-composition","animation-delay","animation-direction","animation-duration","animation-fill-mode","animation-iteration-count","animation-name","animation-play-state","animation-range","animation-range-end","animation-range-start","animation-timeline","animation-timing-function","appearance","aspect-ratio","backdrop-filter","backface-visibility","background","background-attachment","background-blend-mode","background-clip","background-color","background-image","background-origin","background-position","background-position-x","background-position-y","background-repeat","background-size","baseline-shift","block-size","border","border-block","border-block-color","border-block-end","border-block-end-color","border-block-end-style","border-block-end-width","border-block-start","border-block-start-color","border-block-start-style","border-block-start-width","border-block-style","border-block-width","border-bottom","border-bottom-color","border-bottom-left-radius","border-bottom-right-radius","border-bottom-style","border-bottom-width","border-collapse","border-color","border-end-end-radius","border-end-start-radius","border-image","border-image-outset","border-image-repeat","border-image-slice","border-image-source","border-image-width","border-inline","border-inline-color","border-inline-end","border-inline-end-color","border-inline-end-style","border-inline-end-width","border-inline-start","border-inline-start-color","border-inline-start-style","border-inline-start-width","border-inline-style","border-inline-width","border-left","border-left-color","border-left-style","border-left-width","border-radius","border-right","border-right-color","border-right-style","border-right-width","border-spacing","border-start-end-radius","border-start-start-radius","border-style","border-top","border-top-color","border-top-left-radius","border-top-right-radius","border-top-style","border-top-width","border-width","bottom","box-align","box-decoration-break","box-direction","box-flex","box-flex-group","box-lines","box-ordinal-group","box-orient","box-pack","box-shadow","box-sizing","break-after","break-before","break-inside","caption-side","caret-color","clear","clip","clip-path","clip-rule","color","color-interpolation","color-interpolation-filters","color-profile","color-rendering","color-scheme","column-count","column-fill","column-gap","column-rule","column-rule-color","column-rule-style","column-rule-width","column-span","column-width","columns","contain","contain-intrinsic-block-size","contain-intrinsic-height","contain-intrinsic-inline-size","contain-intrinsic-size","contain-intrinsic-width","container","container-name","container-type","content","content-visibility","counter-increment","counter-reset","counter-set","cue","cue-after","cue-before","cursor","cx","cy","direction","display","dominant-baseline","empty-cells","enable-background","field-sizing","fill","fill-opacity","fill-rule","filter","flex","flex-basis","flex-direction","flex-flow","flex-grow","flex-shrink","flex-wrap","float","flood-color","flood-opacity","flow","font","font-display","font-family","font-feature-settings","font-kerning","font-language-override","font-optical-sizing","font-palette","font-size","font-size-adjust","font-smooth","font-smoothing","font-stretch","font-style","font-synthesis","font-synthesis-position","font-synthesis-small-caps","font-synthesis-style","font-synthesis-weight","font-variant","font-variant-alternates","font-variant-caps","font-variant-east-asian","font-variant-emoji","font-variant-ligatures","font-variant-numeric","font-variant-position","font-variation-settings","font-weight","forced-color-adjust","gap","glyph-orientation-horizontal","glyph-orientation-vertical","grid","grid-area","grid-auto-columns","grid-auto-flow","grid-auto-rows","grid-column","grid-column-end","grid-column-start","grid-gap","grid-row","grid-row-end","grid-row-start","grid-template","grid-template-areas","grid-template-columns","grid-template-rows","hanging-punctuation","height","hyphenate-character","hyphenate-limit-chars","hyphens","icon","image-orientation","image-rendering","image-resolution","ime-mode","initial-letter","initial-letter-align","inline-size","inset","inset-area","inset-block","inset-block-end","inset-block-start","inset-inline","inset-inline-end","inset-inline-start","isolation","justify-content","justify-items","justify-self","kerning","left","letter-spacing","lighting-color","line-break","line-height","line-height-step","list-style","list-style-image","list-style-position","list-style-type","margin","margin-block","margin-block-end","margin-block-start","margin-bottom","margin-inline","margin-inline-end","margin-inline-start","margin-left","margin-right","margin-top","margin-trim","marker","marker-end","marker-mid","marker-start","marks","mask","mask-border","mask-border-mode","mask-border-outset","mask-border-repeat","mask-border-slice","mask-border-source","mask-border-width","mask-clip","mask-composite","mask-image","mask-mode","mask-origin","mask-position","mask-repeat","mask-size","mask-type","masonry-auto-flow","math-depth","math-shift","math-style","max-block-size","max-height","max-inline-size","max-width","min-block-size","min-height","min-inline-size","min-width","mix-blend-mode","nav-down","nav-index","nav-left","nav-right","nav-up","none","normal","object-fit","object-position","offset","offset-anchor","offset-distance","offset-path","offset-position","offset-rotate","opacity","order","orphans","outline","outline-color","outline-offset","outline-style","outline-width","overflow","overflow-anchor","overflow-block","overflow-clip-margin","overflow-inline","overflow-wrap","overflow-x","overflow-y","overlay","overscroll-behavior","overscroll-behavior-block","overscroll-behavior-inline","overscroll-behavior-x","overscroll-behavior-y","padding","padding-block","padding-block-end","padding-block-start","padding-bottom","padding-inline","padding-inline-end","padding-inline-start","padding-left","padding-right","padding-top","page","page-break-after","page-break-before","page-break-inside","paint-order","pause","pause-after","pause-before","perspective","perspective-origin","place-content","place-items","place-self","pointer-events","position","position-anchor","position-visibility","print-color-adjust","quotes","r","resize","rest","rest-after","rest-before","right","rotate","row-gap","ruby-align","ruby-position","scale","scroll-behavior","scroll-margin","scroll-margin-block","scroll-margin-block-end","scroll-margin-block-start","scroll-margin-bottom","scroll-margin-inline","scroll-margin-inline-end","scroll-margin-inline-start","scroll-margin-left","scroll-margin-right","scroll-margin-top","scroll-padding","scroll-padding-block","scroll-padding-block-end","scroll-padding-block-start","scroll-padding-bottom","scroll-padding-inline","scroll-padding-inline-end","scroll-padding-inline-start","scroll-padding-left","scroll-padding-right","scroll-padding-top","scroll-snap-align","scroll-snap-stop","scroll-snap-type","scroll-timeline","scroll-timeline-axis","scroll-timeline-name","scrollbar-color","scrollbar-gutter","scrollbar-width","shape-image-threshold","shape-margin","shape-outside","shape-rendering","speak","speak-as","src","stop-color","stop-opacity","stroke","stroke-dasharray","stroke-dashoffset","stroke-linecap","stroke-linejoin","stroke-miterlimit","stroke-opacity","stroke-width","tab-size","table-layout","text-align","text-align-all","text-align-last","text-anchor","text-combine-upright","text-decoration","text-decoration-color","text-decoration-line","text-decoration-skip","text-decoration-skip-ink","text-decoration-style","text-decoration-thickness","text-emphasis","text-emphasis-color","text-emphasis-position","text-emphasis-style","text-indent","text-justify","text-orientation","text-overflow","text-rendering","text-shadow","text-size-adjust","text-transform","text-underline-offset","text-underline-position","text-wrap","text-wrap-mode","text-wrap-style","timeline-scope","top","touch-action","transform","transform-box","transform-origin","transform-style","transition","transition-behavior","transition-delay","transition-duration","transition-property","transition-timing-function","translate","unicode-bidi","user-modify","user-select","vector-effect","vertical-align","view-timeline","view-timeline-axis","view-timeline-inset","view-timeline-name","view-transition-name","visibility","voice-balance","voice-duration","voice-family","voice-pitch","voice-range","voice-rate","voice-stress","voice-volume","white-space","white-space-collapse","widows","width","will-change","word-break","word-spacing","word-wrap","writing-mode","x","y","z-index","zoom"].sort().reverse();function Ds(e){let t=e.regex,n=ua(e),i={begin:/-(webkit|moz|ms|o)-(?=[a-z])/},s="and or not only",a=/@-?\\w[\\w]*(-\\w+)*/,r="[a-zA-Z-][a-zA-Z0-9_-]*",l=[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE];return{name:"CSS",case_insensitive:!0,illegal:/[=|'\\$]/,keywords:{keyframePosition:"from to"},classNameAliases:{keyframePosition:"selector-tag"},contains:[n.BLOCK_COMMENT,i,n.CSS_NUMBER_MODE,{className:"selector-id",begin:/#[A-Za-z0-9_-]+/,relevance:0},{className:"selector-class",begin:"\\\\."+r,relevance:0},n.ATTRIBUTE_SELECTOR_MODE,{className:"selector-pseudo",variants:[{begin:":("+fa.join("|")+")"},{begin:":(:)?("+ma.join("|")+")"}]},n.CSS_VARIABLE,{className:"attribute",begin:"\\\\b("+ba.join("|")+")\\\\b"},{begin:/:/,end:/[;}{]/,contains:[n.BLOCK_COMMENT,n.HEXCOLOR,n.IMPORTANT,n.CSS_NUMBER_MODE,...l,{begin:/(url|data-uri)\\(/,end:/\\)/,relevance:0,keywords:{built_in:"url data-uri"},contains:[...l,{className:"string",begin:/[^)]/,endsWithParent:!0,excludeEnd:!0}]},n.FUNCTION_DISPATCH]},{begin:t.lookahead(/@/),end:"[{;]",relevance:0,illegal:/:/,contains:[{className:"keyword",begin:a},{begin:/\\s/,endsWithParent:!0,excludeEnd:!0,relevance:0,keywords:{$pattern:/[a-z-]+/,keyword:s,attribute:ga.join(" ")},contains:[{begin:/[a-z-]+(?=:)/,className:"attribute"},...l,n.CSS_NUMBER_MODE]}]},{className:"selector-tag",begin:"\\\\b("+ha.join("|")+")\\\\b"}]}}function Ps(e){let t=e.regex,n=e.COMMENT("--","$"),i={scope:"string",variants:[{begin:/'/,end:/'/,contains:[{match:/''/}]}]},s={begin:/"/,end:/"/,contains:[{match:/""/}]},a=["true","false","unknown"],r=["double precision","large object","with timezone","without timezone"],l=["bigint","binary","blob","boolean","char","character","clob","date","dec","decfloat","decimal","float","int","integer","interval","nchar","nclob","national","numeric","real","row","smallint","time","timestamp","varchar","varying","varbinary"],o=["add","asc","collation","desc","final","first","last","view"],c=["abs","acos","all","allocate","alter","and","any","are","array","array_agg","array_max_cardinality","as","asensitive","asin","asymmetric","at","atan","atomic","authorization","avg","begin","begin_frame","begin_partition","between","bigint","binary","blob","boolean","both","by","call","called","cardinality","cascaded","case","cast","ceil","ceiling","char","char_length","character","character_length","check","classifier","clob","close","coalesce","collate","collect","column","commit","condition","connect","constraint","contains","convert","copy","corr","corresponding","cos","cosh","count","covar_pop","covar_samp","create","cross","cube","cume_dist","current","current_catalog","current_date","current_default_transform_group","current_path","current_role","current_row","current_schema","current_time","current_timestamp","current_path","current_role","current_transform_group_for_type","current_user","cursor","cycle","date","day","deallocate","dec","decimal","decfloat","declare","default","define","delete","dense_rank","deref","describe","deterministic","disconnect","distinct","double","drop","dynamic","each","element","else","empty","end","end_frame","end_partition","end-exec","equals","escape","every","except","exec","execute","exists","exp","external","extract","false","fetch","filter","first_value","float","floor","for","foreign","frame_row","free","from","full","function","fusion","get","global","grant","group","grouping","groups","having","hold","hour","identity","in","indicator","initial","inner","inout","insensitive","insert","int","integer","intersect","intersection","interval","into","is","join","json_array","json_arrayagg","json_exists","json_object","json_objectagg","json_query","json_table","json_table_primitive","json_value","lag","language","large","last_value","lateral","lead","leading","left","like","like_regex","listagg","ln","local","localtime","localtimestamp","log","log10","lower","match","match_number","match_recognize","matches","max","member","merge","method","min","minute","mod","modifies","module","month","multiset","national","natural","nchar","nclob","new","no","none","normalize","not","nth_value","ntile","null","nullif","numeric","octet_length","occurrences_regex","of","offset","old","omit","on","one","only","open","or","order","out","outer","over","overlaps","overlay","parameter","partition","pattern","per","percent","percent_rank","percentile_cont","percentile_disc","period","portion","position","position_regex","power","precedes","precision","prepare","primary","procedure","ptf","range","rank","reads","real","recursive","ref","references","referencing","regr_avgx","regr_avgy","regr_count","regr_intercept","regr_r2","regr_slope","regr_sxx","regr_sxy","regr_syy","release","result","return","returns","revoke","right","rollback","rollup","row","row_number","rows","running","savepoint","scope","scroll","search","second","seek","select","sensitive","session_user","set","show","similar","sin","sinh","skip","smallint","some","specific","specifictype","sql","sqlexception","sqlstate","sqlwarning","sqrt","start","static","stddev_pop","stddev_samp","submultiset","subset","substring","substring_regex","succeeds","sum","symmetric","system","system_time","system_user","table","tablesample","tan","tanh","then","time","timestamp","timezone_hour","timezone_minute","to","trailing","translate","translate_regex","translation","treat","trigger","trim","trim_array","true","truncate","uescape","union","unique","unknown","unnest","update","upper","user","using","value","values","value_of","var_pop","var_samp","varbinary","varchar","varying","versioning","when","whenever","where","width_bucket","window","with","within","without","year"],u=["abs","acos","array_agg","asin","atan","avg","cast","ceil","ceiling","coalesce","corr","cos","cosh","count","covar_pop","covar_samp","cume_dist","dense_rank","deref","element","exp","extract","first_value","floor","json_array","json_arrayagg","json_exists","json_object","json_objectagg","json_query","json_table","json_table_primitive","json_value","lag","last_value","lead","listagg","ln","log","log10","lower","max","min","mod","nth_value","ntile","nullif","percent_rank","percentile_cont","percentile_disc","position","position_regex","power","rank","regr_avgx","regr_avgy","regr_count","regr_intercept","regr_r2","regr_slope","regr_sxx","regr_sxy","regr_syy","row_number","sin","sinh","sqrt","stddev_pop","stddev_samp","substring","substring_regex","sum","tan","tanh","translate","translate_regex","treat","trim","trim_array","unnest","upper","value_of","var_pop","var_samp","width_bucket"],d=["current_catalog","current_date","current_default_transform_group","current_path","current_role","current_schema","current_transform_group_for_type","current_user","session_user","system_time","system_user","current_time","localtime","current_timestamp","localtimestamp"],p=["create table","insert into","primary key","foreign key","not null","alter table","add constraint","grouping sets","on overflow","character set","respect nulls","ignore nulls","nulls first","nulls last","depth first","breadth first"],m=u,g=[...c,...o].filter(N=>!u.includes(N)),y={scope:"variable",match:/@[a-z0-9][a-z0-9_]*/},T={scope:"operator",match:/[-+*/=%^~]|&&?|\\|\\|?|!=?|<(?:=>?|<|>)?|>[>=]?/,relevance:0},I={match:t.concat(/\\b/,t.either(...m),/\\s*\\(/),relevance:0,keywords:{built_in:m}};function M(N){return t.concat(/\\b/,t.either(...N.map(R=>R.replace(/\\s+/,"\\\\s+"))),/\\b/)}let D={scope:"keyword",match:M(p),relevance:0};function O(N,{exceptions:R,when:K}={}){let U=K;return R=R||[],N.map(j=>j.match(/\\|\\d+$/)||R.includes(j)?j:U(j)?\`\${j}|0\`:j)}return{name:"SQL",case_insensitive:!0,illegal:/[{}]|<\\//,keywords:{$pattern:/\\b[\\w\\.]+/,keyword:O(g,{when:N=>N.length<3}),literal:a,type:l,built_in:d},contains:[{scope:"type",match:M(r)},D,I,y,i,s,e.C_NUMBER_MODE,e.C_BLOCK_COMMENT_MODE,n,T]}}z.registerLanguage("javascript",Yt);z.registerLanguage("js",Yt);z.registerLanguage("typescript",Qt);z.registerLanguage("ts",Qt);z.registerLanguage("python",Vt);z.registerLanguage("py",Vt);z.registerLanguage("bash",Jt);z.registerLanguage("sh",Jt);z.registerLanguage("json",Bs);z.registerLanguage("html",en);z.registerLanguage("xml",en);z.registerLanguage("css",Ds);z.registerLanguage("sql",Ps);function ka(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}var Ea={link({href:e,title:t,text:n}){let i=t?\` title="\${t}"\`:"";return\`<a href="\${e}"\${i} target="_blank" rel="noopener noreferrer">\${n}</a>\`},code({text:e,lang:t}){let n=t&&z.getLanguage(t)?t:null,i=n?z.highlight(e,{language:n}).value:z.highlightAuto(e).value,s=n?\` language-\${n}\`:"";return\`<div class="code-block"><button class="copy-btn" data-code="\${ka(e)}">Copy</button><pre><code class="hljs\${s}">\${i}</code></pre></div>\`}};A.use({gfm:!0,breaks:!0,renderer:Ea});function tn(e){return A.parse(e)}var Ve=!0;function $s(){let e=document.getElementById("dash-hdr"),t=document.getElementById("stop-all-btn");e.addEventListener("click",function(){Ve=!Ve,document.getElementById("dash-body").style.display=Ve?"":"none",document.getElementById("dash-icon").textContent=Ve?"\\u25B2":"\\u25BC",e.setAttribute("aria-expanded",String(Ve))}),e.addEventListener("keydown",function(n){(n.key==="Enter"||n.key===" ")&&(n.preventDefault(),e.click())}),t.addEventListener("click",function(){X({type:"stop-all"})})}function zs(e){let t=document.getElementById("dash"),n=document.getElementById("stop-all-btn");if(!e||e.length===0){t.classList.add("hidden"),n.disabled=!0;return}t.classList.remove("hidden");let i=null,s=[];for(let o=0;o<e.length;o++)e[o].type==="master"?i=e[o]:s.push(e[o]);let a=document.getElementById("dash-master");a.innerHTML=i?'<div style="padding:2px 0;color:var(--text-primary)"><strong>Master:</strong> '+(i.model||"unknown")+" \\xA0|\\xA0 "+i.status+"</div>":"";let r=document.getElementById("dash-workers");if(s.length===0)r.innerHTML="",n.disabled=!0;else{n.disabled=!1;let o='<div style="font-weight:500;padding:2px 0">Workers ('+s.length+"):</div>";for(let c=0;c<s.length;c++){let u=s[c],d=u.progress_pct||0,p="s-"+(u.status||"running"),m=u.started_at?Math.floor((Date.now()-new Date(u.started_at).getTime())/1e3)+"s":"",g=String(u.id);o+='<div class="agent-row"><span style="font-family:monospace;color:var(--text-secondary);flex-shrink:0">'+g.slice(0,8)+'</span><span class="abadge '+p+'">'+(u.model||"\\u2014")+'</span><span style="color:var(--text-muted);flex-shrink:0">'+(u.profile||"\\u2014")+'</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary)">'+(u.task_summary||"\\u2014")+'</span><div class="prog-wrap"><div class="prog-bar" style="width:'+d+'%"></div></div><span style="color:var(--text-muted);white-space:nowrap;flex-shrink:0">'+d+'%</span><span style="color:var(--text-muted);white-space:nowrap;flex-shrink:0;min-width:32px;text-align:right">'+m+'</span><button class="stop-btn" title="Stop this worker" aria-label="Stop worker '+g.slice(0,8)+'" data-worker-id="'+g+'">\\u2715</button></div>'}r.innerHTML=o,r.querySelectorAll("[data-worker-id]").forEach(function(c){c.addEventListener("click",function(){X({type:"stop-worker",workerId:c.dataset.workerId})})})}let l=0;for(let o=0;o<e.length;o++)l+=e[o].cost_usd||0;document.getElementById("dash-cost").innerHTML='<div class="dash-cost">Cost: $'+l.toFixed(4)+" \\xA0|\\xA0 Active workers: "+s.length+"</div>",document.getElementById("dash-lbl").textContent="Agent Status ("+e.length+" active)"}var et=!1,Oe=null,J=null,Ae=null,nn=null,sn=null,rn=null;function Us(e){sn=e}function Hs(e){rn=e}function me(){return window.innerWidth>=768}function Fs(){et=!0,Oe.classList.add("open"),me()||(J.classList.add("visible"),J.removeAttribute("aria-hidden")),Ae.setAttribute("aria-expanded","true"),Ae.setAttribute("aria-label","Close sidebar"),Oe.setAttribute("aria-hidden","false")}function Je(){et=!1,Oe.classList.remove("open"),J.classList.remove("visible"),J.setAttribute("aria-hidden","true"),Ae.setAttribute("aria-expanded","false"),Ae.setAttribute("aria-label","Open sidebar"),Oe.setAttribute("aria-hidden","true")}function ya(){et?(Je(),me()&&localStorage.setItem("ob-sidebar-open","false")):(Fs(),me()&&localStorage.setItem("ob-sidebar-open","true"))}function Gs(e){if(!e)return"";let t=new Date(e),n=Math.floor((Date.now()-t.getTime())/1e3);return n<60?"just now":n<3600?Math.floor(n/60)+"m ago":n<86400?Math.floor(n/3600)+"h ago":n<86400*7?Math.floor(n/86400)+"d ago":t.toLocaleDateString(void 0,{month:"short",day:"numeric"})}function xa(e,t){let n=document.createElement("div");n.className="sidebar-session-item"+(t?" active":""),n.setAttribute("role","listitem"),n.setAttribute("tabindex","0"),n.dataset.sessionId=e.session_id;let i=document.createElement("div");i.className="sidebar-session-title",i.textContent=e.title||"Conversation";let s=document.createElement("div");s.className="sidebar-session-meta";let a=document.createElement("span");a.textContent=Gs(e.last_message_at);let r=document.createElement("span"),l=e.message_count||0;return r.textContent=l+(l===1?" msg":" msgs"),s.appendChild(a),s.appendChild(r),n.appendChild(i),n.appendChild(s),n}async function tt(e){let t=document.getElementById("sidebar-sessions");if(!t)return;let n;try{let a=await fetch("/api/sessions?limit=50");if(!a.ok)return;n=await a.json()}catch{return}if(!Array.isArray(n)||n.length===0){t.innerHTML='<div class="sidebar-empty">No conversations yet.</div>';return}let i=e??n[0].session_id;nn=i;let s=document.createDocumentFragment();for(let a of n){let r=xa(a,a.session_id===i);s.appendChild(r)}t.replaceChildren(s)}function an(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function wa(e,t,n){if(!e)return"";n=n||120;let i=t.trim().split(/\\s+/).filter(Boolean),s=-1;for(let o=0;o<i.length;o++){let c=e.toLowerCase().indexOf(i[o].toLowerCase());if(c!==-1){s=c;break}}if(s===-1)return e.slice(0,n)+(e.length>n?"\\u2026":"");let a=Math.max(0,s-30),r=Math.min(e.length,a+n),l=e.slice(a,r);return(a>0?"\\u2026":"")+l+(r<e.length?"\\u2026":"")}function va(e,t){if(!e)return"";let n=an(e),i=t.trim().split(/\\s+/).filter(Boolean);if(i.length===0)return n;let s=i.map(function(r){return an(r).replace(/[.*+?^\${}()|[\\]\\\\]/g,"\\\\$&")}).join("|"),a=new RegExp("("+s+")","gi");return n.replace(a,'<mark class="sidebar-match">$1</mark>')}function _a(e,t){let n=document.createElement("div");n.className="sidebar-session-item sidebar-search-result",n.setAttribute("role","listitem"),n.setAttribute("tabindex","0"),n.dataset.sessionId=e.session_id;let i=wa(e.content,t),s=va(i,t),a=document.createElement("div");a.className="sidebar-search-snippet",a.innerHTML=s;let r=document.createElement("div");r.className="sidebar-session-meta";let l=document.createElement("span");l.textContent=e.role==="user"?"You":"AI";let o=document.createElement("span");return o.textContent=Gs(e.created_at),r.appendChild(l),r.appendChild(o),n.appendChild(a),n.appendChild(r),n}async function Sa(e){let t=document.getElementById("sidebar-sessions");if(!t)return;t.innerHTML='<div class="sidebar-empty">Searching\\u2026</div>';let n;try{let s=await fetch("/api/sessions/search?q="+encodeURIComponent(e)+"&limit=20");if(!s.ok){t.innerHTML='<div class="sidebar-empty">Search failed.</div>';return}n=await s.json()}catch{t.innerHTML='<div class="sidebar-empty">Search failed.</div>';return}if(!Array.isArray(n)||n.length===0){t.innerHTML='<div class="sidebar-empty">No results for \\u201C'+an(e)+"\\u201D.</div>";return}let i=document.createDocumentFragment();for(let s of n)i.appendChild(_a(s,e));t.replaceChildren(i)}function qs(){if(Oe=document.getElementById("sidebar"),J=document.getElementById("sidebar-overlay"),Ae=document.getElementById("sidebar-toggle"),!Oe||!J||!Ae)return;Ae.addEventListener("click",ya);let e=document.getElementById("new-conversation-btn");e&&e.addEventListener("click",function(){rn&&rn(),me()||Je()}),J.addEventListener("click",function(){Je()}),document.addEventListener("keydown",function(s){s.key==="Escape"&&et&&!me()&&Je()}),window.addEventListener("resize",function(){et&&(me()?(J.classList.remove("visible"),J.setAttribute("aria-hidden","true")):(J.classList.add("visible"),J.removeAttribute("aria-hidden")))});let t=document.getElementById("sidebar-sessions");t&&(t.addEventListener("click",function(s){let a=s.target.closest(".sidebar-session-item");if(!a)return;let r=a.dataset.sessionId;r&&(t.querySelectorAll(".sidebar-session-item").forEach(function(l){l.classList.toggle("active",l===a)}),nn=r,me()||Je(),sn&&sn(r))}),t.addEventListener("keydown",function(s){if(s.key!=="Enter"&&s.key!==" ")return;let a=s.target.closest(".sidebar-session-item");a&&(s.preventDefault(),a.click())}));let n=document.getElementById("sidebar-search-input"),i=null;n&&n.addEventListener("input",function(){clearTimeout(i);let s=n.value.trim();if(!s){tt(nn);return}i=setTimeout(function(){Sa(s)},300)}),me()&&localStorage.getItem("ob-sidebar-open")!=="false"&&Fs()}var on=[{name:"/history",description:"Show conversation history"},{name:"/stop",description:"Stop the current worker"},{name:"/status",description:"Show agent status"},{name:"/deep",description:"Enable deep mode for complex tasks"},{name:"/audit",description:"Run a workspace audit"},{name:"/scope",description:"Show or change task scope"},{name:"/apps",description:"List connected apps"},{name:"/help",description:"Show available commands"},{name:"/doctor",description:"Run system health diagnostics"},{name:"/confirm",description:"Confirm a pending action"},{name:"/skip",description:"Skip a pending confirmation"}],ce=null,Be=null;async function Aa(){return ce!==null?ce:(Be!==null||(Be=fetch("/api/commands").then(function(e){if(!e.ok)throw new Error("HTTP "+e.status);return e.json()}).then(function(e){return Array.isArray(e)&&e.length>0?ce=e:ce=on,Be=null,ce}).catch(function(){return ce=on,Be=null,ce})),Be)}function Ks(e){if(!e)return;let t=e.closest(".inp-wrap");if(!t)return;Aa();let n=document.createElement("ul");n.className="autocomplete-dropdown",n.setAttribute("role","listbox"),n.setAttribute("aria-label","Command suggestions"),n.id="autocomplete-dropdown",e.setAttribute("aria-autocomplete","list"),e.setAttribute("aria-controls","autocomplete-dropdown"),t.appendChild(n);let i=-1,s=!1,a=[];function r(d){a=d,i=-1,s=!0,n.replaceChildren();for(let p=0;p<d.length;p++){let m=d[p],g=document.createElement("li");g.className="autocomplete-item",g.setAttribute("role","option"),g.setAttribute("aria-selected","false"),g.dataset.index=String(p);let y=document.createElement("span");y.className="autocomplete-cmd",y.textContent=m.name;let T=document.createElement("span");T.className="autocomplete-desc",T.textContent=m.description,g.appendChild(y),g.appendChild(T),g.addEventListener("mousedown",function(I){I.preventDefault(),c(p)}),n.appendChild(g)}n.classList.add("visible"),e.setAttribute("aria-expanded","true")}function l(){s=!1,i=-1,n.classList.remove("visible"),n.replaceChildren(),e.setAttribute("aria-expanded","false")}function o(d){n.querySelectorAll(".autocomplete-item").forEach(function(m,g){g===d?(m.classList.add("active"),m.setAttribute("aria-selected","true"),m.scrollIntoView({block:"nearest"})):(m.classList.remove("active"),m.setAttribute("aria-selected","false"))}),i=d}function c(d){let p=a[d];p&&(e.value=p.name+" ",e.dispatchEvent(new Event("input")),e.focus(),l())}function u(){let d=e.value;return!d.startsWith("/")||d.includes(" ")?null:d}e.addEventListener("input",function(){let d=u();if(d===null){l();return}let p=d.toLowerCase(),g=(ce!==null?ce:on).filter(function(y){return y.name.startsWith(p)});g.length===0?l():r(g)}),e.addEventListener("keydown",function(d){if(s)if(d.key==="ArrowDown"){d.preventDefault();let p=Math.min(i+1,a.length-1);o(p)}else if(d.key==="ArrowUp"){d.preventDefault();let p=Math.max(i-1,0);o(p)}else if(d.key==="Enter")i>=0&&(d.preventDefault(),d.stopPropagation(),c(i));else if(d.key==="Tab"){if(a.length>0){d.preventDefault();let p=i>=0?i:0;c(p)}}else d.key==="Escape"&&l()}),e.addEventListener("blur",function(){setTimeout(l,150)})}var ee=null,Te=null,dn=!1,ln=null,cn=null;function js(e){ln=e}function Ws(e){cn=e}function Zs(){return dn}function Ta(){if(!ee||!Te)return;dn=!0,ee.classList.add("open"),Te.classList.add("visible"),ee.setAttribute("aria-hidden","false");let e=document.getElementById("settings-theme-select");e&&(e.value=document.documentElement.getAttribute("data-theme")||"light");let t=ee.querySelector(".settings-close-btn");t&&t.focus()}function yt(){if(!ee||!Te)return;dn=!1,ee.classList.remove("open"),Te.classList.remove("visible"),ee.setAttribute("aria-hidden","true");let e=document.getElementById("settings-btn");e&&e.focus()}function Ca(e){document.documentElement.setAttribute("data-theme",e),localStorage.setItem("ob-theme",e);let t=document.getElementById("theme-toggle");t&&(t.textContent=e==="dark"?"Light":"Dark");let n=document.getElementById("settings-theme-select");n&&(n.value=e),ln&&ln(e)}function un(e){let t=document.getElementById("settings-tool-select");if(!t)return;let n=e||0;fetch("/api/discovery").then(function(i){return i.ok?i.json():null}).then(function(i){if(!i||!Array.isArray(i.tools))return;if(i.tools.length===0&&n<3){setTimeout(function(){un(n+1)},2e3);return}for(;t.options.length>1;)t.remove(1);for(let a of i.tools){let r=document.createElement("option");r.value=a.name||a.id||"",r.textContent=(a.name||a.id||"Unknown")+(a.version?" v"+a.version:""),t.appendChild(r)}let s=localStorage.getItem("ob-preferred-tool");s&&(t.value=s)}).catch(function(){n<3&&setTimeout(function(){un(n+1)},2e3)})}function Na(){let e=document.getElementById("settings-tool-select");if(!e)return;let t=localStorage.getItem("ob-preferred-tool");t&&(e.value=t),e.addEventListener("change",function(){localStorage.setItem("ob-preferred-tool",e.value)})}function Ra(e){fetch("/api/webchat/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({profile:e})}).catch(function(){})}function Ia(){let e=document.querySelectorAll('input[name="settings-profile"]');if(!e.length)return;let t=localStorage.getItem("ob-exec-profile")||"thorough";for(let n of e)if(n.value===t){n.checked=!0;break}for(let n of e)n.addEventListener("change",function(){n.checked&&(localStorage.setItem("ob-exec-profile",n.value),Ra(n.value))})}function La(){let e=document.getElementById("settings-sound-check"),t=document.getElementById("settings-browser-notify-check");e&&(e.checked=localStorage.getItem("ob-sound")!=="false",e.addEventListener("change",function(){let n=!e.checked;localStorage.setItem("ob-sound",n?"false":"true");let i=document.getElementById("sound-toggle");i&&(i.textContent=n?"\\u{1F507}":"\\u{1F50A}",i.setAttribute("aria-label",n?"Unmute notifications":"Mute notifications"),i.setAttribute("aria-pressed",n?"true":"false")),cn&&cn(!n)})),t&&(t.checked=Notification&&Notification.permission==="granted",t.addEventListener("change",function(){t.checked&&"Notification"in window&&Notification.requestPermission().then(function(n){t.checked=n==="granted"})}))}function Ma(){let e=document.getElementById("settings-theme-select");if(!e)return;let t=document.documentElement.getAttribute("data-theme")||"light";e.value=t,e.addEventListener("change",function(){Ca(e.value)})}function nt(e){return String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function pn(){let e=document.getElementById("mcp-server-list");e&&fetch("/api/mcp/servers").then(function(t){return t.ok?t.json():null}).then(function(t){if(!(!t||!Array.isArray(t.servers))){if(e.innerHTML="",t.servers.length===0){e.innerHTML='<p class="settings-hint">No MCP servers configured.</p>';return}for(let n of t.servers){let i=document.createElement("div");i.className="mcp-server-item";let s=n.status==="healthy"?"mcp-status-healthy":n.status==="error"?"mcp-status-error":"mcp-status-unknown",a=n.enabled?"checked":"";i.innerHTML='<div class="mcp-server-info"><span class="mcp-status-dot '+s+'" aria-hidden="true"></span><span class="mcp-server-name">'+nt(n.name)+'</span></div><div class="mcp-server-actions"><label class="mcp-toggle" aria-label="Enable '+nt(n.name)+'"><input type="checkbox" class="mcp-toggle-input" '+a+' data-name="'+nt(n.name)+'" /><span class="mcp-toggle-slider"></span></label><button class="mcp-remove-btn" data-name="'+nt(n.name)+'" aria-label="Remove '+nt(n.name)+'">\\u2715</button></div>',e.appendChild(i)}e.querySelectorAll(".mcp-toggle-input").forEach(function(n){n.addEventListener("change",function(){let i=n.getAttribute("data-name");fetch("/api/mcp/servers/"+encodeURIComponent(i)+"/toggle",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:n.checked})}).catch(function(){})})}),e.querySelectorAll(".mcp-remove-btn").forEach(function(n){n.addEventListener("click",function(){let i=n.getAttribute("data-name");confirm('Remove MCP server "'+i+'"?')&&fetch("/api/mcp/servers/"+encodeURIComponent(i),{method:"DELETE"}).then(function(s){s.ok&&pn()}).catch(function(){})})})}}).catch(function(){})}function Oa(){let e=document.getElementById("mcp-add-btn"),t=document.getElementById("mcp-add-form"),n=document.getElementById("mcp-add-submit"),i=document.getElementById("mcp-add-cancel");!e||!t||(e.addEventListener("click",function(){t.style.display=t.style.display==="none"?"block":"none"}),i&&i.addEventListener("click",function(){t.style.display="none"}),n&&n.addEventListener("click",function(){let s=document.getElementById("mcp-new-name"),a=document.getElementById("mcp-new-command");if(!s||!a)return;let r=s.value.trim(),l=a.value.trim();!r||!l||fetch("/api/mcp/servers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:r,command:l})}).then(function(o){o.ok&&(t.style.display="none",s.value="",a.value="",pn())}).catch(function(){})}))}function Xs(){ee=document.getElementById("settings-panel"),Te=document.getElementById("settings-overlay");let e=document.getElementById("settings-btn"),t=ee&&ee.querySelector(".settings-close-btn");!ee||!Te||!e||(e.addEventListener("click",function(){Zs()?yt():(un(),pn(),Ta())}),t&&t.addEventListener("click",yt),Te.addEventListener("click",yt),document.addEventListener("keydown",function(n){n.key==="Escape"&&Zs()&&yt()}),Na(),Ia(),La(),Ma(),Oa())}var hn=["investigate","report","plan","execute","verify"],$e={investigate:"Investigate",report:"Report",plan:"Plan",execute:"Execute",verify:"Verify"},Ba={investigate:"\\u{1F50D}",report:"\\u{1F4CB}",plan:"\\u{1F4DD}",execute:"\\u2699\\uFE0F",verify:"\\u2705"},Da={investigate:"blue",report:"purple",plan:"orange",execute:"green",verify:"teal"},Pa=new Set(["investigate","report"]),$a=new Set(["plan"]),xt=null,ae=null,De=new Map,ue=new Map,Ce=new Map,te=null,Pe=!1,ze=null,Qs="ob-deep-mode-events",de=[],rt=!1;function fn(){try{sessionStorage.setItem(Qs,JSON.stringify(de))}catch{}}function za(){try{let e=sessionStorage.getItem(Qs);return e?JSON.parse(e):[]}catch{return[]}}function Vs(){ue.clear(),Ce.clear(),De.clear(),te=null,Pe=!1,ze=null}var pe=null,st=null,be=null,it=null,ke=null;function Ua(){return xt||(xt=document.getElementById("deep-mode-bar")),xt}function Ne(){let e=Ua();if(!e)return;if(!te){e.classList.add("hidden");return}let t=ue.get(te)||new Set,n=Ce.get(te)||null;e.classList.remove("hidden"),e.querySelectorAll(".dm-phase-dot").forEach(function(s){let a=s.dataset.phase;s.classList.remove("dm-phase-current","dm-phase-done","dm-phase-pending");let r=s.querySelector(".dm-phase-icon");t.has(a)?(s.classList.add("dm-phase-done"),r&&(r.textContent="\\u2713"),s.setAttribute("aria-label",($e[a]||a)+" \\u2014 completed")):a===n?(s.classList.add("dm-phase-current"),r&&(r.textContent="\\u25CF"),s.setAttribute("aria-label",($e[a]||a)+" \\u2014 in progress")):(s.classList.add("dm-phase-pending"),r&&(r.textContent="\\u25CB"),s.setAttribute("aria-label",($e[a]||a)+" \\u2014 pending"))})}function Re(){if(!pe)return;let t=!!te&&!Pe;pe.disabled=!t;let n=t&&Pa.has(ze);be.disabled=!n,st.disabled=!n;let i=t&&$a.has(ze);ke.disabled=!i,it.disabled=!i}function Ys(e){let t=document.createElement("select");t.className="dm-num-select",t.setAttribute("aria-label",e);for(let n=1;n<=10;n++){let i=document.createElement("option");i.value=String(n),i.textContent=String(n),t.appendChild(i)}return t}function gn(e,t,n){let i=Da[e]||"blue",s=Ba[e]||"\\u25C9",a=$e[e]||e,r=document.createElement("div");r.className="dm-phase-card dm-phase-card--"+i+" dm-phase-card--"+t,r.dataset.phase=e,r.dataset.status=t;let l=document.createElement("div");l.className="dm-card-header";let o=document.createElement("span");o.className="dm-card-icon",o.setAttribute("aria-hidden","true"),o.textContent=s;let c=document.createElement("span");c.className="dm-card-name",c.textContent=a;let u=document.createElement("span");if(u.className="dm-card-status",t==="started"){u.textContent="In progress\\u2026";let d=document.createElement("span");d.className="dm-card-spinner",d.setAttribute("aria-hidden","true"),l.appendChild(o),l.appendChild(c),l.appendChild(u),l.appendChild(d)}else t==="completed"?(u.textContent="Completed",l.appendChild(o),l.appendChild(c),l.appendChild(u)):t==="skipped"?(u.textContent="Skipped",l.appendChild(o),l.appendChild(c),l.appendChild(u)):(u.textContent="Aborted",l.appendChild(o),l.appendChild(c),l.appendChild(u));if(r.appendChild(l),n&&(t==="completed"||t==="skipped")){let d=document.createElement("div");d.className="dm-card-body";let p=document.createElement("div");if(p.className="dm-card-summary",p.textContent=n,d.appendChild(p),n.length>200){p.classList.add("dm-card-summary--collapsed");let m=document.createElement("button");m.className="dm-card-toggle",m.textContent="Show more",m.setAttribute("aria-expanded","false"),m.addEventListener("click",function(){m.getAttribute("aria-expanded")==="true"?(p.classList.add("dm-card-summary--collapsed"),m.textContent="Show more",m.setAttribute("aria-expanded","false")):(p.classList.remove("dm-card-summary--collapsed"),m.textContent="Show less",m.setAttribute("aria-expanded","true"))}),d.appendChild(m)}r.appendChild(d)}return r}function Ha(e,t,n,i){if(!ae)return;let s=e+":"+t;if(n==="started"){let a=gn(t,n,i);requestAnimationFrame(function(){a.classList.add("dm-phase-card--enter")}),De.set(s,a),ae.appendChild(a),ae.scrollTop=ae.scrollHeight}else{let a=De.get(s);if(a){let r=gn(t,n,i);a.replaceWith(r),requestAnimationFrame(function(){r.classList.add("dm-phase-card--enter")}),De.set(s,r),ae.scrollTop=ae.scrollHeight}else{let r=gn(t,n,i);requestAnimationFrame(function(){r.classList.add("dm-phase-card--enter")}),De.set(s,r),ae.appendChild(r),ae.scrollTop=ae.scrollHeight}n==="aborted"&&De.delete(s)}}function Js(e){e&&(ae=e);let t=document.getElementById("deep-mode-bar");if(!t)return;xt=t;let n=t.querySelector(".dm-track");if(!n)return;n.replaceChildren();for(let r=0;r<hn.length;r++){let l=hn[r],o=document.createElement("div");o.className="dm-phase-item";let c=document.createElement("div");c.className="dm-phase-dot dm-phase-pending",c.dataset.phase=l,c.setAttribute("aria-label",($e[l]||l)+" \\u2014 pending");let u=document.createElement("span");u.className="dm-phase-icon",u.setAttribute("aria-hidden","true"),u.textContent="\\u25CB";let d=document.createElement("span");if(d.className="dm-phase-label",d.textContent=$e[l]||l,c.appendChild(u),o.appendChild(c),o.appendChild(d),n.appendChild(o),r<hn.length-1){let p=document.createElement("div");p.className="dm-connector",p.setAttribute("aria-hidden","true"),n.appendChild(p)}}let i=document.createElement("div");i.className="dm-actions",pe=document.createElement("button"),pe.className="dm-proceed-btn",pe.textContent="Proceed",pe.setAttribute("aria-label","Proceed to next Deep Mode phase"),pe.disabled=!0,pe.addEventListener("click",function(){X({type:"message",content:"/proceed"})}),i.appendChild(pe);let s=document.createElement("div");s.className="dm-action-group",st=Ys("Finding number to focus on"),st.disabled=!0,be=document.createElement("button"),be.className="dm-action-btn",be.textContent="Focus on #",be.setAttribute("aria-label","Focus investigation on a specific finding"),be.disabled=!0,be.addEventListener("click",function(){X({type:"message",content:"/focus "+st.value})}),s.appendChild(st),s.appendChild(be),i.appendChild(s);let a=document.createElement("div");a.className="dm-action-group",it=Ys("Task number to skip"),it.disabled=!0,ke=document.createElement("button"),ke.className="dm-action-btn",ke.textContent="Skip #",ke.setAttribute("aria-label","Skip a specific task in the plan"),ke.disabled=!0,ke.addEventListener("click",function(){X({type:"message",content:"/skip "+it.value})}),a.appendChild(it),a.appendChild(ke),i.appendChild(a),t.appendChild(i)}function wt(e,t){let{sessionId:n,phase:i,status:s,result:a}=e;if(t||Ha(n,i,s,a),s==="started"?(te=n,Pe=!0,ue.has(n)||ue.set(n,new Set),Ce.set(n,i),Ne(),Re()):s==="completed"||s==="skipped"?(te=n,Pe=!1,ze=i,ue.has(n)||ue.set(n,new Set),ue.get(n).add(i),Ce.get(n)===i&&Ce.delete(n),Ne(),Re(),i==="verify"&&setTimeout(function(){ue.delete(n),Ce.delete(n),te===n&&(te=null),ze=null,Pe=!1,Ne(),Re()},3e3)):s==="aborted"&&(ue.delete(n),Ce.delete(n),te===n&&(te=null),ze=null,Pe=!1,Ne(),Re()),!rt){let r=de.findIndex(function(l){return l.sessionId===n&&l.phase===i});r>=0?de[r]=e:de.push(e),s==="aborted"?de=de.filter(function(l){return l.sessionId!==n}):i==="verify"&&(s==="completed"||s==="skipped")&&setTimeout(function(){de=de.filter(function(l){return l.sessionId!==n}),fn()},5e3),fn()}}function mn(){let e=za();if(e.length!==0){Vs(),rt=!0;for(var t=0;t<e.length;t++)wt(e[t],!0);rt=!1,Ne(),Re()}}function ei(e){if(Array.isArray(e)){if(de=e,fn(),Vs(),e.length===0){Ne(),Re();return}rt=!0;for(var t=0;t<e.length;t++)wt(e[t],!0);rt=!1,Ne(),Re()}}var P=document.getElementById("msgs"),ai=document.getElementById("form"),Z=document.getElementById("inp"),Fa=document.getElementById("send"),Ga=document.getElementById("dot"),bn=document.getElementById("connLabel"),oi=document.getElementById("status-bar"),li=document.getElementById("status-text"),xn=document.getElementById("status-timer"),Ue=null,wn=null,qa=typeof crypto<"u"&&typeof crypto.randomUUID=="function"?crypto.randomUUID():Math.random().toString(36).slice(2),kn=0;(function(){let t=window.__OB_PUBLIC_URL__;if(!t)return;let n=document.getElementById("public-url-bar"),i=document.getElementById("public-url-text"),s=document.getElementById("url-copy-btn");!n||!i||!s||(i.textContent=t,n.classList.remove("hidden"),n.classList.add("visible"),s.addEventListener("click",function(){navigator.clipboard.writeText(t).then(function(){s.textContent="Copied!",s.classList.add("copied"),setTimeout(function(){s.textContent="Copy",s.classList.remove("copied")},2e3)},function(){let a=document.createElement("textarea");a.value=t,a.style.position="fixed",a.style.opacity="0",document.body.appendChild(a),a.select(),document.execCommand("copy"),document.body.removeChild(a),s.textContent="Copied!",s.classList.add("copied"),setTimeout(function(){s.textContent="Copy",s.classList.remove("copied")},2e3)})}))})();(function(){let t=document.getElementById("share-btn"),n=document.getElementById("share-toast");if(!t||!n)return;let i=null;function s(){i&&clearTimeout(i),n.classList.add("visible"),i=setTimeout(function(){n.classList.remove("visible"),i=null},2e3)}t.addEventListener("click",function(){let a=window.location.href;navigator.clipboard.writeText(a).then(function(){s()},function(){let r=document.createElement("textarea");r.value=a,r.style.position="fixed",r.style.opacity="0",document.body.appendChild(r),r.select(),document.execCommand("copy"),document.body.removeChild(r),s()})})})();var at=localStorage.getItem("ob-ts")!=="false";function An(e){let t=Math.floor((Date.now()-e.getTime())/1e3);return t<60?"just now":t<3600?Math.floor(t/60)+"m ago":t<86400?Math.floor(t/3600)+"h ago":Math.floor(t/86400)+"d ago"}function ti(){let e=document.getElementById("ts-toggle");e&&(e.textContent=at?"Hide times":"Show times"),document.documentElement.setAttribute("data-ts",at?"show":"hide")}(function(){ti();let t=document.getElementById("ts-toggle");t&&t.addEventListener("click",function(){at=!at,localStorage.setItem("ob-ts",at?"true":"false"),ti()}),setInterval(function(){P.querySelectorAll("time.bubble-ts").forEach(function(n){n.textContent=An(new Date(n.dateTime))})},6e4)})();(function(){let t=document.getElementById("theme-toggle");function n(i){document.documentElement.setAttribute("data-theme",i),t.textContent=i==="dark"?"Light":"Dark",localStorage.setItem("ob-theme",i)}n(localStorage.getItem("ob-theme")||"light"),t.addEventListener("click",function(){let s=document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark";n(s);let a=document.getElementById("settings-theme-select");a&&(a.value=s)})})();var Tn="ob-conversation",vn=100,Ee=[],He=!0;function Ka(){try{localStorage.setItem(Tn,JSON.stringify(Ee))}catch{}}function Za(e,t,n){He&&(Ee.push({content:e,cls:t,ts:(n instanceof Date?n:new Date).toISOString()}),Ee.length>vn&&(Ee=Ee.slice(-vn)),Ka())}function ci(){Ee=[];try{localStorage.removeItem(Tn)}catch{}}function ja(){try{let e=localStorage.getItem(Tn);if(!e)return;let t=JSON.parse(e);if(!Array.isArray(t)||t.length===0)return;He=!1,Ee=t.slice(-vn);for(let n of Ee)(n.cls==="user"||n.cls==="ai")&&G(n.content,n.cls,n.ts?new Date(n.ts):new Date);He=!0}catch{He=!0}}function ui(e){let t=document.createElement("div");return t.className="avatar avatar-"+e,t.setAttribute("aria-hidden","true"),t.textContent=e==="user"?"You":"AI",t}function G(e,t,n){let i=document.createElement("div");if(i.className="bubble "+t,t==="ai"){let s=tn(e);if(e.length>500){let a=document.createElement("div");a.className="collapsible-wrap";let r=document.createElement("div");r.className="collapsible-inner",r.style.maxHeight="120px",r.innerHTML=s;let l=document.createElement("div");l.className="collapsible-fade";let o=document.createElement("button");o.className="show-more-btn",o.textContent="Show more",o.setAttribute("aria-expanded","false"),o.addEventListener("click",function(){o.getAttribute("aria-expanded")==="false"?(r.style.maxHeight=r.scrollHeight+"px",l.style.display="none",o.textContent="Show less",o.setAttribute("aria-expanded","true")):(r.style.maxHeight="120px",l.style.display="",o.textContent="Show more",o.setAttribute("aria-expanded","false"))}),a.appendChild(r),a.appendChild(l),i.appendChild(a),i.appendChild(o)}else i.innerHTML=s}else i.textContent=e;if(t!=="sys"){let s=n instanceof Date?n:new Date,a=document.createElement("time");if(a.className="bubble-ts",a.dateTime=s.toISOString(),a.title=s.toLocaleString(),a.textContent=An(s),i.appendChild(a),t==="ai"){kn++;let l=document.createElement("div");l.className="feedback-row";let o=document.createElement("button");o.type="button",o.className="feedback-btn",o.setAttribute("aria-label","Good response"),o.dataset.rating="up",o.dataset.msgIdx=String(kn),o.textContent="\\u{1F44D}";let c=document.createElement("button");c.type="button",c.className="feedback-btn",c.setAttribute("aria-label","Poor response"),c.dataset.rating="down",c.dataset.msgIdx=String(kn),c.textContent="\\u{1F44E}",l.appendChild(o),l.appendChild(c),i.appendChild(l)}let r=document.createElement("div");r.className="msg-row "+t,r.appendChild(ui(t)),r.appendChild(i),P.appendChild(r)}else P.appendChild(i);return P.scrollTop=P.scrollHeight,(t==="user"||t==="ai")&&Za(e,t,n instanceof Date?n:new Date),i}P.addEventListener("click",function(e){let t=e.target.closest(".copy-btn");if(!t)return;let n=t.dataset.code;n&&navigator.clipboard.writeText(n).then(function(){t.textContent="Copied!",t.classList.add("copied"),setTimeout(function(){t.textContent="Copy",t.classList.remove("copied")},2e3)})});var ni=(function(){let e=document.createElement("div");return e.className="feedback-toast",e.textContent="Thanks!",document.body.appendChild(e),e})(),vt=null;function Wa(){vt&&clearTimeout(vt),ni.classList.add("visible"),vt=setTimeout(function(){ni.classList.remove("visible"),vt=null},2e3)}P.addEventListener("click",function(e){let t=e.target.closest(".feedback-btn");if(!t||t.disabled)return;let n=t.dataset.rating,i=t.dataset.msgIdx,s=t.closest(".feedback-row");s&&s.querySelectorAll(".feedback-btn").forEach(function(a){a.disabled=!0,a.dataset.rating===n&&a.classList.add(n==="up"?"active-up":"active-down")}),Wa(),fetch("/api/feedback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({session:qa,message:i,rating:n})}).catch(function(){})});function Xa(){Ue||(wn=Date.now(),xn.textContent="0s",Ue=setInterval(function(){let e=Math.floor((Date.now()-wn)/1e3);xn.textContent=e+"s"},1e3))}function Ya(){Ue&&(clearInterval(Ue),Ue=null),wn=null,xn.textContent=""}function _n(e){oi.classList.remove("hidden"),li.innerHTML=e,Ue||Xa()}function _t(){oi.classList.add("hidden"),li.innerHTML="",Ya()}function Qa(e){if(e.type==="classifying")return'\\u{1F50D} Analyzing request<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>';if(e.type==="planning")return'\\u{1F4CB} Planning subtasks<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>';if(e.type==="spawning"){let t=e.workerCount;return"\\u{1F4CB} Breaking into "+t+" subtask"+(t!==1?"s":"")+'<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>'}return e.type==="worker-progress"?(e.workerName?"\\u2699\\uFE0F "+e.workerName+": ":"\\u2699\\uFE0F ")+e.completed+"/"+e.total+' workers done<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>':e.type==="synthesizing"?'\\u{1F4DD} Preparing final response<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>':e.type==="exploring"?"\\u{1F5FA}\\uFE0F "+e.phase+'<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>':e.type==="exploring-directory"?"\\u{1F4C2} Exploring directories: "+e.completed+"/"+e.total+(e.directory?" ("+e.directory+")":"")+'<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>':null}function si(e,t){Ga.className="conn-dot"+(e?" online":""),e?bn.textContent="Connected":t?bn.textContent="Reconnecting...":bn.textContent="Disconnected",Z.disabled=!e,Fa.disabled=!e;let n=document.getElementById("upload-btn");n&&(n.disabled=!e);let i=document.getElementById("mic-btn");i&&(i.disabled=!e)}function Va(e){var t=document.getElementById("permission-container");if(!t)return;t.replaceChildren();var n=Math.max(1,Math.round((e.timeoutMs||6e4)/1e3)),i=n,s=null;function a(K){s&&clearInterval(s),t.replaceChildren(),X({type:"permission-response",permissionId:e.permissionId,approved:K})}var r=document.createElement("div");r.className="permission-overlay",r.setAttribute("role","dialog"),r.setAttribute("aria-modal","true"),r.setAttribute("aria-label","Permission request");var l=document.createElement("div");l.className="permission-modal";var o=document.createElement("div");o.className="permission-header";var c=document.createElement("span");c.className="permission-icon",c.setAttribute("aria-hidden","true"),c.textContent="\\u{1F510}";var u=document.createElement("span");u.className="permission-title",u.textContent="Permission Request",o.appendChild(c),o.appendChild(u);var d=document.createElement("div");d.className="permission-body";var p=document.createElement("div");p.className="permission-tool";var m=document.createElement("span");if(m.className="permission-tool-name",m.textContent=e.toolName||"Unknown tool",p.appendChild(m),d.appendChild(p),e.detail){var g=document.createElement("div");g.className="permission-detail",g.textContent=e.detail,d.appendChild(g)}var y=document.createElement("div");y.className="permission-actions";var T=document.createElement("button");T.className="permission-btn permission-btn-allow",T.textContent="Allow",T.setAttribute("aria-label","Allow this action"),T.addEventListener("click",function(){a(!0)});var I=document.createElement("button");I.className="permission-btn permission-btn-deny",I.textContent="Deny",I.setAttribute("aria-label","Deny this action"),I.addEventListener("click",function(){a(!1)}),y.appendChild(T),y.appendChild(I);var M=document.createElement("div");M.className="permission-countdown";var D=document.createElement("span");D.textContent="Auto-deny in "+i+"s";var O=document.createElement("div");O.className="permission-countdown-bar",O.style.width="100%",M.appendChild(D),M.appendChild(O),l.appendChild(o),l.appendChild(d),l.appendChild(y),l.appendChild(M),r.appendChild(l),t.appendChild(r),T.focus();function N(K){K.key==="Escape"&&(K.preventDefault(),a(!1))}document.addEventListener("keydown",N),s=setInterval(function(){if(i--,i<=0){document.removeEventListener("keydown",N),a(!1);return}D.textContent="Auto-deny in "+i+"s",O.style.width=Math.round(i/n*100)+"%"},1e3);var R=a;a=function(K){document.removeEventListener("keydown",N),R(K)}}function Ja(e){if(e.type==="response")_t(),G(e.content,"ai",e.timestamp?new Date(e.timestamp):new Date),to(),so(e.content),Rn(),tt();else if(e.type==="download"){_t();let t=e.timestamp?new Date(e.timestamp):new Date,n=document.createElement("div");n.className="bubble ai",e.content&&(n.innerHTML=tn(e.content)+"<br>");let i=document.createElement("a");i.href=e.url,i.download=e.filename||"download",i.className="download-link",i.textContent="\\u2B07\\uFE0F Download "+(e.filename||"file"),i.setAttribute("aria-label","Download "+(e.filename||"file")),n.appendChild(i);let s=document.createElement("time");s.className="bubble-ts",s.dateTime=t.toISOString(),s.title=t.toLocaleString(),s.textContent=An(t),n.appendChild(s);let a=document.createElement("div");a.className="msg-row ai",a.appendChild(ui("ai")),a.appendChild(n),P.appendChild(a),P.scrollTop=P.scrollHeight}else if(e.type==="typing")_n('\\u{1F914} Thinking<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>');else if(e.type==="progress"){if(e.event&&e.event.type==="complete")_t();else if(e.event&&e.event.type==="worker-result"){let t=e.event.success?"\\u2705":"\\u274C",n=e.event.tool?" \\xB7 "+e.event.tool:"",i=t+" **Subtask "+e.event.workerIndex+"/"+e.event.total+"** ("+e.event.profile+n+\`):

\`;G(i+e.event.content,"ai",new Date)}else if(e.event&&e.event.type==="worker-cancelled")G("\\u{1F6D1} Worker "+e.event.workerId+" was stopped by "+e.event.cancelledBy+".","sys");else if(e.event&&e.event.type==="deep-phase")wt(e.event);else if(e.event){let t=Qa(e.event);t&&_n(t)}}else e.type==="deep-mode-state"?ei(e.events):e.type==="permission-request"?Va(e):e.type==="agent-status"&&zs(e.agents)}var En=document.getElementById("char-count");function Cn(){Z.style.height="auto",Z.style.height=Z.scrollHeight+"px"}function Nn(){let e=Z.value.length;e>500?(En.textContent=e.toLocaleString()+" chars",En.classList.remove("hidden")):En.classList.add("hidden")}Z.addEventListener("input",function(){Cn(),Nn()});Z.addEventListener("keydown",function(e){e.key==="Enter"&&!e.shiftKey?(e.preventDefault(),ai.requestSubmit()):e.key==="Escape"&&(Z.value="",Cn(),Nn())});ai.addEventListener("submit",function(e){e.preventDefault();let t=Z.value.trim(),n=he.length>0;if(!t&&!n||!$n())return;let i=he.slice();if(he=[],St(),G(t||"(\\u{1F4CE} file upload)","user",new Date),Z.value="",Cn(),Nn(),_n('\\u{1F914} Thinking<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>'),i.length===0){X({type:"message",content:t});return}Promise.all(i.map(function(a){let r=new FormData;return r.append("file",a,a.name),fetch("/api/upload",{method:"POST",body:r}).then(function(l){return l.ok?l.json():null}).catch(function(){return null})})).then(function(a){let r=a.filter(function(o){return o&&o.fileId}).map(function(o){return"- "+o.filename+" (path: "+o.path+")"}),l=t;r.length>0&&(l&&(l+=\`

\`),l+=\`[Attached files]
\`+r.join(\`
\`)),l||(l="[File upload failed \\u2014 no files were saved]"),X({type:"message",content:l})})});var he=[];function eo(e){return e<1024?e+" B":e<1024*1024?(e/1024).toFixed(1)+" KB":(e/(1024*1024)).toFixed(1)+" MB"}function St(){let e=document.getElementById("file-preview");if(e){if(he.length===0){e.classList.add("hidden"),e.replaceChildren();return}e.classList.remove("hidden"),e.replaceChildren();for(let t=0;t<he.length;t++){let n=he[t],i=document.createElement("div");i.className="file-chip";let s=document.createElement("span");s.className="file-chip-icon",s.setAttribute("aria-hidden","true"),s.textContent="\\u{1F4C4}";let a=document.createElement("span");a.className="file-chip-info";let r=document.createElement("span");r.className="file-chip-name",r.textContent=n.name;let l=document.createElement("span");l.className="file-chip-meta",l.textContent=eo(n.size)+(n.type?" \\xB7 "+n.type:""),a.appendChild(r),a.appendChild(l);let o=document.createElement("button");o.type="button",o.className="file-chip-remove",o.setAttribute("aria-label","Remove "+n.name),o.textContent="\\xD7";let c=t;o.addEventListener("click",function(){he.splice(c,1),St()}),i.appendChild(s),i.appendChild(a),i.appendChild(o),e.appendChild(i)}}}(function(){let t=document.getElementById("upload-btn"),n=document.getElementById("file-input"),i=document.querySelector(".chat-wrap");!t||!n||(t.addEventListener("click",function(){n.click()}),n.addEventListener("change",function(){let s=Array.from(n.files||[]);for(let a of s)he.push(a);n.value="",St()}),i&&(i.addEventListener("dragover",function(s){s.preventDefault(),i.classList.add("drag-over")}),i.addEventListener("dragleave",function(s){i.contains(s.relatedTarget)||i.classList.remove("drag-over")}),i.addEventListener("drop",function(s){s.preventDefault(),i.classList.remove("drag-over");let a=Array.from(s.dataTransfer?s.dataTransfer.files:[]);for(let r of a)he.push(r);St()})))})();(function(){let t=document.getElementById("mic-btn");if(!t)return;if(typeof MediaRecorder>"u"||!navigator.mediaDevices){t.style.display="none";return}let n=null,i=[],s=null;function a(){if(s)return;let c=document.getElementById("file-preview");c&&(s=document.createElement("div"),s.className="recording-indicator",s.innerHTML='<span class="recording-dot"></span>Recording\\u2026',c.classList.remove("hidden"),c.appendChild(s))}function r(){if(!s)return;let c=document.getElementById("file-preview");s.remove(),s=null,c&&c.children.length===0&&c.classList.add("hidden")}function l(){i=[],navigator.mediaDevices.getUserMedia({audio:!0}).then(function(c){let u=MediaRecorder.isTypeSupported("audio/webm")?"audio/webm":"audio/ogg";n=new MediaRecorder(c,{mimeType:u}),n.addEventListener("dataavailable",function(d){d.data&&d.data.size>0&&i.push(d.data)}),n.addEventListener("stop",function(){c.getTracks().forEach(function(g){g.stop()});let d=new Blob(i,{type:u});i=[],r(),t.classList.remove("recording"),t.title="Record voice message",t.setAttribute("aria-label","Record voice message");let p=u==="audio/webm"?".webm":".ogg",m=new FormData;m.append("file",d,"voice"+p),G("\\u{1F3A4} Transcribing voice\\u2026","sys"),fetch("/api/transcribe",{method:"POST",body:m}).then(function(g){return g.ok?g.json():Promise.reject(g.status)}).then(function(g){if(g&&g.text){Z.value=g.text,Z.dispatchEvent(new Event("input")),Z.focus();let y=P.querySelector(".bubble.sys:last-of-type");y&&y.textContent.includes("Transcribing")&&(y.closest(".bubble.sys")&&y.remove(),P.querySelectorAll(".bubble.sys").forEach(function(I){I.textContent.includes("Transcribing")&&I.remove()}))}}).catch(function(){G("\\u26A0\\uFE0F Voice transcription failed.","sys")})}),n.start(),t.classList.add("recording"),t.title="Stop recording",t.setAttribute("aria-label","Stop recording"),a()}).catch(function(){G("\\u26A0\\uFE0F Microphone access denied. Please allow microphone permissions.","sys")})}function o(){n&&n.state!=="inactive"&&n.stop()}t.addEventListener("click",function(){t.classList.contains("recording")?o():l()})})();var At=0,ii="OpenBridge";function di(){document.title=At>0?"("+At+") "+ii:ii}function to(){document.visibilityState!=="visible"&&(At++,di())}function no(){At=0,di()}document.addEventListener("visibilitychange",function(){document.visibilityState==="visible"&&no()});function so(e){if(document.visibilityState!=="visible"&&"Notification"in window&&Notification.permission==="granted"){var t=e.length>100?e.slice(0,97)+"...":e;new Notification("OpenBridge",{body:t,icon:"/icons/icon-192.png"})}}(function(){"Notification"in window&&Notification.permission==="default"&&setTimeout(function(){Notification.requestPermission()},3e3)})();var oe=localStorage.getItem("ob-sound")==="false",yn=null;function io(){return yn||(yn=new(window.AudioContext||window.webkitAudioContext)),yn}function Rn(){if(!oe&&!(!window.AudioContext&&!window.webkitAudioContext))try{let e=io(),t=e.createOscillator(),n=e.createGain();t.connect(n),n.connect(e.destination),t.type="sine",t.frequency.setValueAtTime(880,e.currentTime),t.frequency.exponentialRampToValueAtTime(660,e.currentTime+.15),n.gain.setValueAtTime(.3,e.currentTime),n.gain.exponentialRampToValueAtTime(.001,e.currentTime+.25),t.start(e.currentTime),t.stop(e.currentTime+.25)}catch{}}function Sn(){let e=document.getElementById("sound-toggle");e&&(e.textContent=oe?"\\u{1F507}":"\\u{1F50A}",e.setAttribute("aria-label",oe?"Unmute notifications":"Mute notifications"),e.setAttribute("aria-pressed",oe?"true":"false"))}(function(){Sn();let t=document.getElementById("sound-toggle");t&&t.addEventListener("click",function(){oe=!oe,localStorage.setItem("ob-sound",oe?"false":"true"),Sn(),oe||Rn()})})();(function(){if(!(window.matchMedia("(max-width: 767px)").matches||("ontouchstart"in window||navigator.maxTouchPoints>0)&&screen.width<=1024)||window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===!0||localStorage.getItem("ob-pwa-dismissed")==="1")return;let i=document.getElementById("pwa-banner"),s=document.getElementById("pwa-install-btn"),a=document.getElementById("pwa-dismiss-btn"),r=document.getElementById("pwa-banner-hint");if(!i||!s||!a)return;let l=null,o=/iphone|ipad|ipod/i.test(navigator.userAgent),c=/safari/i.test(navigator.userAgent)&&!/chrome|crios|fxios/i.test(navigator.userAgent);function u(){i.classList.remove("hidden")}function d(){i.classList.add("hidden"),localStorage.setItem("ob-pwa-dismissed","1")}a.addEventListener("click",d),o&&c?(r&&(r.textContent="Tap Share \\u238E then \\u201CAdd to Home Screen\\u201D"),s.style.display="none",setTimeout(u,2e3)):(window.addEventListener("beforeinstallprompt",function(p){p.preventDefault(),l=p,setTimeout(u,2e3)}),s.addEventListener("click",function(){l&&(l.prompt(),l.userChoice.then(function(p){p.outcome==="accepted"&&localStorage.setItem("ob-pwa-dismissed","1"),l=null,i.classList.add("hidden")}))}),window.addEventListener("appinstalled",function(){i.classList.add("hidden"),localStorage.setItem("ob-pwa-dismissed","1"),l=null}))})();(function(){"serviceWorker"in navigator&&navigator.serviceWorker.register("/sw.js").catch(function(t){typeof console<"u"&&console.warn("SW registration failed:",t)})})();async function ro(e){ci(),He=!1,P.replaceChildren(),G("Loading conversation\\u2026","sys");try{let t=await fetch("/api/sessions/"+encodeURIComponent(e));if(!t.ok){P.replaceChildren(),G("Failed to load conversation.","sys");return}let i=(await t.json()).messages;if(P.replaceChildren(),!Array.isArray(i)||i.length===0){G("No messages in this conversation.","sys");return}for(let s of i){let a=s.role==="user"?"user":s.role==="system"?"sys":"ai",r=s.created_at?new Date(s.created_at):new Date;G(s.content,a,r)}}catch{P.replaceChildren(),G("Failed to load conversation.","sys")}finally{He=!0}}function ao(){ci(),P.replaceChildren(),G("New conversation started.","sys"),X({type:"new-session"}),tt()}Ks(Z);ja();qs();Us(ro);Hs(ao);tt();$s();Js(P);mn();Xs();js(function(e){let t=document.getElementById("theme-toggle");t&&(t.textContent=e==="dark"?"Light":"Dark")});Ws(function(e){oe=!e,Sn(),oe||Rn()});var ri=0;Pn({onOpen:function(){ri++,si(!0),G("Connected to OpenBridge","sys"),ri>1&&mn(),X({type:"get-deep-mode-state"})},onClose:function(){si(!1,!0),_t(),G("Disconnected \\u2014 reconnecting...","sys")},onMessage:Ja});})();

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
