// AUTO-GENERATED — do not edit manually. Run: npm run build:webchat
// Generated: 2026-03-03T20:18:52.852Z
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
  <script>
"use strict";(()=>{var Ss=Object.create;var Yt=Object.defineProperty;var vs=Object.getOwnPropertyDescriptor;var Ts=Object.getOwnPropertyNames;var As=Object.getPrototypeOf,Rs=Object.prototype.hasOwnProperty;var Ns=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports);var Cs=(e,t,n,r)=>{if(t&&typeof t=="object"||typeof t=="function")for(let s of Ts(t))!Rs.call(e,s)&&s!==n&&Yt(e,s,{get:()=>t[s],enumerable:!(r=vs(t,s))||r.enumerable});return e};var Is=(e,t,n)=>(n=e!=null?Ss(As(e)):{},Cs(t||!e||!e.__esModule?Yt(n,"default",{value:e,enumerable:!0}):n,e));var $n=Ns((la,Bn)=>{function Sn(e){return e instanceof Map?e.clear=e.delete=e.set=function(){throw new Error("map is read-only")}:e instanceof Set&&(e.add=e.clear=e.delete=function(){throw new Error("set is read-only")}),Object.freeze(e),Object.getOwnPropertyNames(e).forEach(t=>{let n=e[t],r=typeof n;(r==="object"||r==="function")&&!Object.isFrozen(n)&&Sn(n)}),e}var je=class{constructor(t){t.data===void 0&&(t.data={}),this.data=t.data,this.isMatchIgnored=!1}ignoreMatch(){this.isMatchIgnored=!0}};function vn(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;")}function ie(e,...t){let n=Object.create(null);for(let r in e)n[r]=e[r];return t.forEach(function(r){for(let s in r)n[s]=r[s]}),n}var yr="</span>",kn=e=>!!e.scope,wr=(e,{prefix:t})=>{if(e.startsWith("language:"))return e.replace("language:","language-");if(e.includes(".")){let n=e.split(".");return[\`\${t}\${n.shift()}\`,...n.map((r,s)=>\`\${r}\${"_".repeat(s+1)}\`)].join(" ")}return\`\${t}\${e}\`},mt=class{constructor(t,n){this.buffer="",this.classPrefix=n.classPrefix,t.walk(this)}addText(t){this.buffer+=vn(t)}openNode(t){if(!kn(t))return;let n=wr(t.scope,{prefix:this.classPrefix});this.span(n)}closeNode(t){kn(t)&&(this.buffer+=yr)}value(){return this.buffer}span(t){this.buffer+=\`<span class="\${t}">\`}},xn=(e={})=>{let t={children:[]};return Object.assign(t,e),t},kt=class e{constructor(){this.rootNode=xn(),this.stack=[this.rootNode]}get top(){return this.stack[this.stack.length-1]}get root(){return this.rootNode}add(t){this.top.children.push(t)}openNode(t){let n=xn({scope:t});this.add(n),this.stack.push(n)}closeNode(){if(this.stack.length>1)return this.stack.pop()}closeAllNodes(){for(;this.closeNode(););}toJSON(){return JSON.stringify(this.rootNode,null,4)}walk(t){return this.constructor._walk(t,this.rootNode)}static _walk(t,n){return typeof n=="string"?t.addText(n):n.children&&(t.openNode(n),n.children.forEach(r=>this._walk(t,r)),t.closeNode(n)),t}static _collapse(t){typeof t!="string"&&t.children&&(t.children.every(n=>typeof n=="string")?t.children=[t.children.join("")]:t.children.forEach(n=>{e._collapse(n)}))}},xt=class extends kt{constructor(t){super(),this.options=t}addText(t){t!==""&&this.add(t)}startScope(t){this.openNode(t)}endScope(){this.closeNode()}__addSublanguage(t,n){let r=t.root;n&&(r.scope=\`language:\${n}\`),this.add(r)}toHTML(){return new mt(this,this.options).value()}finalize(){return this.closeAllNodes(),!0}};function Me(e){return e?typeof e=="string"?e:e.source:null}function Tn(e){return be("(?=",e,")")}function _r(e){return be("(?:",e,")*")}function Sr(e){return be("(?:",e,")?")}function be(...e){return e.map(n=>Me(n)).join("")}function vr(e){let t=e[e.length-1];return typeof t=="object"&&t.constructor===Object?(e.splice(e.length-1,1),t):{}}function yt(...e){return"("+(vr(e).capture?"":"?:")+e.map(r=>Me(r)).join("|")+")"}function An(e){return new RegExp(e.toString()+"|").exec("").length-1}function Tr(e,t){let n=e&&e.exec(t);return n&&n.index===0}var Ar=/\\[(?:[^\\\\\\]]|\\\\.)*\\]|\\(\\??|\\\\([1-9][0-9]*)|\\\\./;function wt(e,{joinWith:t}){let n=0;return e.map(r=>{n+=1;let s=n,a=Me(r),i="";for(;a.length>0;){let l=Ar.exec(a);if(!l){i+=a;break}i+=a.substring(0,l.index),a=a.substring(l.index+l[0].length),l[0][0]==="\\\\"&&l[1]?i+="\\\\"+String(Number(l[1])+s):(i+=l[0],l[0]==="("&&n++)}return i}).map(r=>\`(\${r})\`).join(t)}var Rr=/\\b\\B/,Rn="[a-zA-Z]\\\\w*",_t="[a-zA-Z_]\\\\w*",Nn="\\\\b\\\\d+(\\\\.\\\\d+)?",Cn="(-?)(\\\\b0[xX][a-fA-F0-9]+|(\\\\b\\\\d+(\\\\.\\\\d*)?|\\\\.\\\\d+)([eE][-+]?\\\\d+)?)",In="\\\\b(0b[01]+)",Nr="!|!=|!==|%|%=|&|&&|&=|\\\\*|\\\\*=|\\\\+|\\\\+=|,|-|-=|/=|/|:|;|<<|<<=|<=|<|===|==|=|>>>=|>>=|>=|>>>|>>|>|\\\\?|\\\\[|\\\\{|\\\\(|\\\\^|\\\\^=|\\\\||\\\\|=|\\\\|\\\\||~",Cr=(e={})=>{let t=/^#![ ]*\\//;return e.binary&&(e.begin=be(t,/.*\\b/,e.binary,/\\b.*/)),ie({scope:"meta",begin:t,end:/$/,relevance:0,"on:begin":(n,r)=>{n.index!==0&&r.ignoreMatch()}},e)},Oe={begin:"\\\\\\\\[\\\\s\\\\S]",relevance:0},Ir={scope:"string",begin:"'",end:"'",illegal:"\\\\n",contains:[Oe]},Mr={scope:"string",begin:'"',end:'"',illegal:"\\\\n",contains:[Oe]},Or={begin:/\\b(a|an|the|are|I'm|isn't|don't|doesn't|won't|but|just|should|pretty|simply|enough|gonna|going|wtf|so|such|will|you|your|they|like|more)\\b/},Ye=function(e,t,n={}){let r=ie({scope:"comment",begin:e,end:t,contains:[]},n);r.contains.push({scope:"doctag",begin:"[ ]*(?=(TODO|FIXME|NOTE|BUG|OPTIMIZE|HACK|XXX):)",end:/(TODO|FIXME|NOTE|BUG|OPTIMIZE|HACK|XXX):/,excludeBegin:!0,relevance:0});let s=yt("I","a","is","so","us","to","at","if","in","it","on",/[A-Za-z]+['](d|ve|re|ll|t|s|n)/,/[A-Za-z]+[-][a-z]+/,/[A-Za-z][a-z]{2,}/);return r.contains.push({begin:be(/[ ]+/,"(",s,/[.]?[:]?([.][ ]|[ ])/,"){3}")}),r},Lr=Ye("//","$"),Dr=Ye("/\\\\*","\\\\*/"),Br=Ye("#","$"),$r={scope:"number",begin:Nn,relevance:0},Pr={scope:"number",begin:Cn,relevance:0},zr={scope:"number",begin:In,relevance:0},Ur={scope:"regexp",begin:/\\/(?=[^/\\n]*\\/)/,end:/\\/[gimuy]*/,contains:[Oe,{begin:/\\[/,end:/\\]/,relevance:0,contains:[Oe]}]},Hr={scope:"title",begin:Rn,relevance:0},Fr={scope:"title",begin:_t,relevance:0},Gr={begin:"\\\\.\\\\s*"+_t,relevance:0},qr=function(e){return Object.assign(e,{"on:begin":(t,n)=>{n.data._beginMatch=t[1]},"on:end":(t,n)=>{n.data._beginMatch!==t[1]&&n.ignoreMatch()}})},We=Object.freeze({__proto__:null,APOS_STRING_MODE:Ir,BACKSLASH_ESCAPE:Oe,BINARY_NUMBER_MODE:zr,BINARY_NUMBER_RE:In,COMMENT:Ye,C_BLOCK_COMMENT_MODE:Dr,C_LINE_COMMENT_MODE:Lr,C_NUMBER_MODE:Pr,C_NUMBER_RE:Cn,END_SAME_AS_BEGIN:qr,HASH_COMMENT_MODE:Br,IDENT_RE:Rn,MATCH_NOTHING_RE:Rr,METHOD_GUARD:Gr,NUMBER_MODE:$r,NUMBER_RE:Nn,PHRASAL_WORDS_MODE:Or,QUOTE_STRING_MODE:Mr,REGEXP_MODE:Ur,RE_STARTERS_RE:Nr,SHEBANG:Cr,TITLE_MODE:Hr,UNDERSCORE_IDENT_RE:_t,UNDERSCORE_TITLE_MODE:Fr});function Zr(e,t){e.input[e.index-1]==="."&&t.ignoreMatch()}function Kr(e,t){e.className!==void 0&&(e.scope=e.className,delete e.className)}function Wr(e,t){t&&e.beginKeywords&&(e.begin="\\\\b("+e.beginKeywords.split(" ").join("|")+")(?!\\\\.)(?=\\\\b|\\\\s)",e.__beforeBegin=Zr,e.keywords=e.keywords||e.beginKeywords,delete e.beginKeywords,e.relevance===void 0&&(e.relevance=0))}function jr(e,t){Array.isArray(e.illegal)&&(e.illegal=yt(...e.illegal))}function Xr(e,t){if(e.match){if(e.begin||e.end)throw new Error("begin & end are not supported with match");e.begin=e.match,delete e.match}}function Yr(e,t){e.relevance===void 0&&(e.relevance=1)}var Qr=(e,t)=>{if(!e.beforeMatch)return;if(e.starts)throw new Error("beforeMatch cannot be used with starts");let n=Object.assign({},e);Object.keys(e).forEach(r=>{delete e[r]}),e.keywords=n.keywords,e.begin=be(n.beforeMatch,Tn(n.begin)),e.starts={relevance:0,contains:[Object.assign(n,{endsParent:!0})]},e.relevance=0,delete n.beforeMatch},Vr=["of","and","for","in","not","or","if","then","parent","list","value"],Jr="keyword";function Mn(e,t,n=Jr){let r=Object.create(null);return typeof e=="string"?s(n,e.split(" ")):Array.isArray(e)?s(n,e):Object.keys(e).forEach(function(a){Object.assign(r,Mn(e[a],t,a))}),r;function s(a,i){t&&(i=i.map(l=>l.toLowerCase())),i.forEach(function(l){let o=l.split("|");r[o[0]]=[a,ei(o[0],o[1])]})}}function ei(e,t){return t?Number(t):ti(e)?0:1}function ti(e){return Vr.includes(e.toLowerCase())}var En={},fe=e=>{console.error(e)},yn=(e,...t)=>{console.log(\`WARN: \${e}\`,...t)},xe=(e,t)=>{En[\`\${e}/\${t}\`]||(console.log(\`Deprecated as of \${e}. \${t}\`),En[\`\${e}/\${t}\`]=!0)},Xe=new Error;function On(e,t,{key:n}){let r=0,s=e[n],a={},i={};for(let l=1;l<=t.length;l++)i[l+r]=s[l],a[l+r]=!0,r+=An(t[l-1]);e[n]=i,e[n]._emit=a,e[n]._multi=!0}function ni(e){if(Array.isArray(e.begin)){if(e.skip||e.excludeBegin||e.returnBegin)throw fe("skip, excludeBegin, returnBegin not compatible with beginScope: {}"),Xe;if(typeof e.beginScope!="object"||e.beginScope===null)throw fe("beginScope must be object"),Xe;On(e,e.begin,{key:"beginScope"}),e.begin=wt(e.begin,{joinWith:""})}}function si(e){if(Array.isArray(e.end)){if(e.skip||e.excludeEnd||e.returnEnd)throw fe("skip, excludeEnd, returnEnd not compatible with endScope: {}"),Xe;if(typeof e.endScope!="object"||e.endScope===null)throw fe("endScope must be object"),Xe;On(e,e.end,{key:"endScope"}),e.end=wt(e.end,{joinWith:""})}}function ri(e){e.scope&&typeof e.scope=="object"&&e.scope!==null&&(e.beginScope=e.scope,delete e.scope)}function ii(e){ri(e),typeof e.beginScope=="string"&&(e.beginScope={_wrap:e.beginScope}),typeof e.endScope=="string"&&(e.endScope={_wrap:e.endScope}),ni(e),si(e)}function ai(e){function t(i,l){return new RegExp(Me(i),"m"+(e.case_insensitive?"i":"")+(e.unicodeRegex?"u":"")+(l?"g":""))}class n{constructor(){this.matchIndexes={},this.regexes=[],this.matchAt=1,this.position=0}addRule(l,o){o.position=this.position++,this.matchIndexes[this.matchAt]=o,this.regexes.push([o,l]),this.matchAt+=An(l)+1}compile(){this.regexes.length===0&&(this.exec=()=>null);let l=this.regexes.map(o=>o[1]);this.matcherRe=t(wt(l,{joinWith:"|"}),!0),this.lastIndex=0}exec(l){this.matcherRe.lastIndex=this.lastIndex;let o=this.matcherRe.exec(l);if(!o)return null;let c=o.findIndex((h,p)=>p>0&&h!==void 0),u=this.matchIndexes[c];return o.splice(0,c),Object.assign(o,u)}}class r{constructor(){this.rules=[],this.multiRegexes=[],this.count=0,this.lastIndex=0,this.regexIndex=0}getMatcher(l){if(this.multiRegexes[l])return this.multiRegexes[l];let o=new n;return this.rules.slice(l).forEach(([c,u])=>o.addRule(c,u)),o.compile(),this.multiRegexes[l]=o,o}resumingScanAtSamePosition(){return this.regexIndex!==0}considerAll(){this.regexIndex=0}addRule(l,o){this.rules.push([l,o]),o.type==="begin"&&this.count++}exec(l){let o=this.getMatcher(this.regexIndex);o.lastIndex=this.lastIndex;let c=o.exec(l);if(this.resumingScanAtSamePosition()&&!(c&&c.index===this.lastIndex)){let u=this.getMatcher(0);u.lastIndex=this.lastIndex+1,c=u.exec(l)}return c&&(this.regexIndex+=c.position+1,this.regexIndex===this.count&&this.considerAll()),c}}function s(i){let l=new r;return i.contains.forEach(o=>l.addRule(o.begin,{rule:o,type:"begin"})),i.terminatorEnd&&l.addRule(i.terminatorEnd,{type:"end"}),i.illegal&&l.addRule(i.illegal,{type:"illegal"}),l}function a(i,l){let o=i;if(i.isCompiled)return o;[Kr,Xr,ii,Qr].forEach(u=>u(i,l)),e.compilerExtensions.forEach(u=>u(i,l)),i.__beforeBegin=null,[Wr,jr,Yr].forEach(u=>u(i,l)),i.isCompiled=!0;let c=null;return typeof i.keywords=="object"&&i.keywords.$pattern&&(i.keywords=Object.assign({},i.keywords),c=i.keywords.$pattern,delete i.keywords.$pattern),c=c||/\\w+/,i.keywords&&(i.keywords=Mn(i.keywords,e.case_insensitive)),o.keywordPatternRe=t(c,!0),l&&(i.begin||(i.begin=/\\B|\\b/),o.beginRe=t(o.begin),!i.end&&!i.endsWithParent&&(i.end=/\\B|\\b/),i.end&&(o.endRe=t(o.end)),o.terminatorEnd=Me(o.end)||"",i.endsWithParent&&l.terminatorEnd&&(o.terminatorEnd+=(i.end?"|":"")+l.terminatorEnd)),i.illegal&&(o.illegalRe=t(i.illegal)),i.contains||(i.contains=[]),i.contains=[].concat(...i.contains.map(function(u){return oi(u==="self"?i:u)})),i.contains.forEach(function(u){a(u,o)}),i.starts&&a(i.starts,l),o.matcher=s(o),o}if(e.compilerExtensions||(e.compilerExtensions=[]),e.contains&&e.contains.includes("self"))throw new Error("ERR: contains \`self\` is not supported at the top-level of a language.  See documentation.");return e.classNameAliases=ie(e.classNameAliases||{}),a(e)}function Ln(e){return e?e.endsWithParent||Ln(e.starts):!1}function oi(e){return e.variants&&!e.cachedVariants&&(e.cachedVariants=e.variants.map(function(t){return ie(e,{variants:null},t)})),e.cachedVariants?e.cachedVariants:Ln(e)?ie(e,{starts:e.starts?ie(e.starts):null}):Object.isFrozen(e)?ie(e):e}var li="11.11.1",Et=class extends Error{constructor(t,n){super(t),this.name="HTMLInjectionError",this.html=n}},bt=vn,wn=ie,_n=Symbol("nomatch"),ci=7,Dn=function(e){let t=Object.create(null),n=Object.create(null),r=[],s=!0,a="Could not find the language '{}', did you forget to load/include a language module?",i={disableAutodetect:!0,name:"Plain text",contains:[]},l={ignoreUnescapedHTML:!1,throwUnescapedHTML:!1,noHighlightRe:/^(no-?highlight)$/i,languageDetectRe:/\\blang(?:uage)?-([\\w-]+)\\b/i,classPrefix:"hljs-",cssSelector:"pre code",languages:null,__emitter:xt};function o(d){return l.noHighlightRe.test(d)}function c(d){let b=d.className+" ";b+=d.parentNode?d.parentNode.className:"";let f=l.languageDetectRe.exec(b);if(f){let w=z(f[1]);return w||(yn(a.replace("{}",f[1])),yn("Falling back to no-highlight mode for this block.",d)),w?f[1]:"no-highlight"}return b.split(/\\s+/).find(w=>o(w)||z(w))}function u(d,b,f){let w="",v="";typeof b=="object"?(w=d,f=b.ignoreIllegals,v=b.language):(xe("10.7.0","highlight(lang, code, ...args) has been deprecated."),xe("10.7.0",\`Please use highlight(code, options) instead.
https://github.com/highlightjs/highlight.js/issues/2277\`),v=d,w=b),f===void 0&&(f=!0);let I={code:w,language:v};re("before:highlight",I);let U=I.result?I.result:h(I.language,I.code,f);return U.code=I.code,re("after:highlight",U),U}function h(d,b,f,w){let v=Object.create(null);function I(g,k){return g.keywords[k]}function U(){if(!x.keywords){D.addText(R);return}let g=0;x.keywordPatternRe.lastIndex=0;let k=x.keywordPatternRe.exec(R),_="";for(;k;){_+=R.substring(g,k.index);let A=ee.case_insensitive?k[0].toLowerCase():k[0],H=I(x,A);if(H){let[ne,ws]=H;if(D.addText(_),_="",v[A]=(v[A]||0)+1,v[A]<=ci&&(Ue+=ws),ne.startsWith("_"))_+=k[0];else{let _s=ee.classNameAliases[ne]||ne;J(k[0],_s)}}else _+=k[0];g=x.keywordPatternRe.lastIndex,k=x.keywordPatternRe.exec(R)}_+=R.substring(g),D.addText(_)}function V(){if(R==="")return;let g=null;if(typeof x.subLanguage=="string"){if(!t[x.subLanguage]){D.addText(R);return}g=h(x.subLanguage,R,!0,Xt[x.subLanguage]),Xt[x.subLanguage]=g._top}else g=E(R,x.subLanguage.length?x.subLanguage:null);x.relevance>0&&(Ue+=g.relevance),D.__addSublanguage(g._emitter,g.language)}function K(){x.subLanguage!=null?V():U(),R=""}function J(g,k){g!==""&&(D.startScope(k),D.addText(g),D.endScope())}function Zt(g,k){let _=1,A=k.length-1;for(;_<=A;){if(!g._emit[_]){_++;continue}let H=ee.classNameAliases[g[_]]||g[_],ne=k[_];H?J(ne,H):(R=ne,U(),R=""),_++}}function Kt(g,k){return g.scope&&typeof g.scope=="string"&&D.openNode(ee.classNameAliases[g.scope]||g.scope),g.beginScope&&(g.beginScope._wrap?(J(R,ee.classNameAliases[g.beginScope._wrap]||g.beginScope._wrap),R=""):g.beginScope._multi&&(Zt(g.beginScope,k),R="")),x=Object.create(g,{parent:{value:x}}),x}function Wt(g,k,_){let A=Tr(g.endRe,_);if(A){if(g["on:end"]){let H=new je(g);g["on:end"](k,H),H.isMatchIgnored&&(A=!1)}if(A){for(;g.endsParent&&g.parent;)g=g.parent;return g}}if(g.endsWithParent)return Wt(g.parent,k,_)}function ms(g){return x.matcher.regexIndex===0?(R+=g[0],1):(st=!0,0)}function ks(g){let k=g[0],_=g.rule,A=new je(_),H=[_.__beforeBegin,_["on:begin"]];for(let ne of H)if(ne&&(ne(g,A),A.isMatchIgnored))return ms(k);return _.skip?R+=k:(_.excludeBegin&&(R+=k),K(),!_.returnBegin&&!_.excludeBegin&&(R=k)),Kt(_,g),_.returnBegin?0:k.length}function xs(g){let k=g[0],_=b.substring(g.index),A=Wt(x,g,_);if(!A)return _n;let H=x;x.endScope&&x.endScope._wrap?(K(),J(k,x.endScope._wrap)):x.endScope&&x.endScope._multi?(K(),Zt(x.endScope,g)):H.skip?R+=k:(H.returnEnd||H.excludeEnd||(R+=k),K(),H.excludeEnd&&(R=k));do x.scope&&D.closeNode(),!x.skip&&!x.subLanguage&&(Ue+=x.relevance),x=x.parent;while(x!==A.parent);return A.starts&&Kt(A.starts,g),H.returnEnd?0:k.length}function Es(){let g=[];for(let k=x;k!==ee;k=k.parent)k.scope&&g.unshift(k.scope);g.forEach(k=>D.openNode(k))}let ze={};function jt(g,k){let _=k&&k[0];if(R+=g,_==null)return K(),0;if(ze.type==="begin"&&k.type==="end"&&ze.index===k.index&&_===""){if(R+=b.slice(k.index,k.index+1),!s){let A=new Error(\`0 width match regex (\${d})\`);throw A.languageName=d,A.badRule=ze.rule,A}return 1}if(ze=k,k.type==="begin")return ks(k);if(k.type==="illegal"&&!f){let A=new Error('Illegal lexeme "'+_+'" for mode "'+(x.scope||"<unnamed>")+'"');throw A.mode=x,A}else if(k.type==="end"){let A=xs(k);if(A!==_n)return A}if(k.type==="illegal"&&_==="")return R+=\`
\`,1;if(nt>1e5&&nt>k.index*3)throw new Error("potential infinite loop, way more iterations than matches");return R+=_,_.length}let ee=z(d);if(!ee)throw fe(a.replace("{}",d)),new Error('Unknown language: "'+d+'"');let ys=ai(ee),tt="",x=w||ys,Xt={},D=new l.__emitter(l);Es();let R="",Ue=0,ue=0,nt=0,st=!1;try{if(ee.__emitTokens)ee.__emitTokens(b,D);else{for(x.matcher.considerAll();;){nt++,st?st=!1:x.matcher.considerAll(),x.matcher.lastIndex=ue;let g=x.matcher.exec(b);if(!g)break;let k=b.substring(ue,g.index),_=jt(k,g);ue=g.index+_}jt(b.substring(ue))}return D.finalize(),tt=D.toHTML(),{language:d,value:tt,relevance:Ue,illegal:!1,_emitter:D,_top:x}}catch(g){if(g.message&&g.message.includes("Illegal"))return{language:d,value:bt(b),illegal:!0,relevance:0,_illegalBy:{message:g.message,index:ue,context:b.slice(ue-100,ue+100),mode:g.mode,resultSoFar:tt},_emitter:D};if(s)return{language:d,value:bt(b),illegal:!1,relevance:0,errorRaised:g,_emitter:D,_top:x};throw g}}function p(d){let b={value:bt(d),illegal:!1,relevance:0,_top:i,_emitter:new l.__emitter(l)};return b._emitter.addText(d),b}function E(d,b){b=b||l.languages||Object.keys(t);let f=p(d),w=b.filter(z).filter(ke).map(K=>h(K,d,!1));w.unshift(f);let v=w.sort((K,J)=>{if(K.relevance!==J.relevance)return J.relevance-K.relevance;if(K.language&&J.language){if(z(K.language).supersetOf===J.language)return 1;if(z(J.language).supersetOf===K.language)return-1}return 0}),[I,U]=v,V=I;return V.secondBest=U,V}function m(d,b,f){let w=b&&n[b]||f;d.classList.add("hljs"),d.classList.add(\`language-\${w}\`)}function y(d){let b=null,f=c(d);if(o(f))return;if(re("before:highlightElement",{el:d,language:f}),d.dataset.highlighted){console.log("Element previously highlighted. To highlight again, first unset \`dataset.highlighted\`.",d);return}if(d.children.length>0&&(l.ignoreUnescapedHTML||(console.warn("One of your code blocks includes unescaped HTML. This is a potentially serious security risk."),console.warn("https://github.com/highlightjs/highlight.js/wiki/security"),console.warn("The element with unescaped HTML:"),console.warn(d)),l.throwUnescapedHTML))throw new Et("One of your code blocks includes unescaped HTML.",d.innerHTML);b=d;let w=b.textContent,v=f?u(w,{language:f,ignoreIllegals:!0}):E(w);d.innerHTML=v.value,d.dataset.highlighted="yes",m(d,f,v.language),d.result={language:v.language,re:v.relevance,relevance:v.relevance},v.secondBest&&(d.secondBest={language:v.secondBest.language,relevance:v.secondBest.relevance}),re("after:highlightElement",{el:d,result:v,text:w})}function O(d){l=wn(l,d)}let L=()=>{P(),xe("10.6.0","initHighlighting() deprecated.  Use highlightAll() now.")};function M(){P(),xe("10.6.0","initHighlightingOnLoad() deprecated.  Use highlightAll() now.")}let $=!1;function P(){function d(){P()}if(document.readyState==="loading"){$||window.addEventListener("DOMContentLoaded",d,!1),$=!0;return}document.querySelectorAll(l.cssSelector).forEach(y)}function C(d,b){let f=null;try{f=b(e)}catch(w){if(fe("Language definition for '{}' could not be registered.".replace("{}",d)),s)fe(w);else throw w;f=i}f.name||(f.name=d),t[d]=f,f.rawDefinition=b.bind(null,e),f.aliases&&Z(f.aliases,{languageName:d})}function N(d){delete t[d];for(let b of Object.keys(n))n[b]===d&&delete n[b]}function ce(){return Object.keys(t)}function z(d){return d=(d||"").toLowerCase(),t[d]||t[n[d]]}function Z(d,{languageName:b}){typeof d=="string"&&(d=[d]),d.forEach(f=>{n[f.toLowerCase()]=b})}function ke(d){let b=z(d);return b&&!b.disableAutodetect}function Se(d){d["before:highlightBlock"]&&!d["before:highlightElement"]&&(d["before:highlightElement"]=b=>{d["before:highlightBlock"](Object.assign({block:b.el},b))}),d["after:highlightBlock"]&&!d["after:highlightElement"]&&(d["after:highlightElement"]=b=>{d["after:highlightBlock"](Object.assign({block:b.el},b))})}function ve(d){Se(d),r.push(d)}function Te(d){let b=r.indexOf(d);b!==-1&&r.splice(b,1)}function re(d,b){let f=d;r.forEach(function(w){w[f]&&w[f](b)})}function Ae(d){return xe("10.7.0","highlightBlock will be removed entirely in v12.0"),xe("10.7.0","Please use highlightElement now."),y(d)}Object.assign(e,{highlight:u,highlightAuto:E,highlightAll:P,highlightElement:y,highlightBlock:Ae,configure:O,initHighlighting:L,initHighlightingOnLoad:M,registerLanguage:C,unregisterLanguage:N,listLanguages:ce,getLanguage:z,registerAliases:Z,autoDetection:ke,inherit:wn,addPlugin:ve,removePlugin:Te}),e.debugMode=function(){s=!1},e.safeMode=function(){s=!0},e.versionString=li,e.regex={concat:be,lookahead:Tn,either:yt,optional:Sr,anyNumberOfTimes:_r};for(let d in We)typeof We[d]=="object"&&Sn(We[d]);return Object.assign(e,We),e},Ee=Dn({});Ee.newInstance=()=>Dn({});Bn.exports=Ee;Ee.HighlightJS=Ee;Ee.default=Ee});var j=null;function Qt(e){function t(){j=new WebSocket("ws://"+location.host),j.onopen=function(){e.onOpen()},j.onclose=function(){j=null,e.onClose(),setTimeout(t,2e3)},j.onmessage=function(n){try{let r=JSON.parse(n.data);e.onMessage(r)}catch{}},j.onerror=function(){}}t()}function de(e){j&&j.readyState===WebSocket.OPEN&&j.send(JSON.stringify(e))}function Vt(){return j!==null&&j.readyState===WebSocket.OPEN}function ot(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var he=ot();function an(e){he=e}var pe={exec:()=>null};function S(e,t=""){let n=typeof e=="string"?e:e.source,r={replace:(s,a)=>{let i=typeof a=="string"?a:a.source;return i=i.replace(q.caret,"$1"),n=n.replace(s,i),r},getRegex:()=>new RegExp(n,t)};return r}var Ms=(()=>{try{return!!new RegExp("(?<=1)(?<!1)")}catch{return!1}})(),q={codeRemoveIndent:/^(?: {1,4}| {0,3}\\t)/gm,outputLinkReplace:/\\\\([\\[\\]])/g,indentCodeCompensation:/^(\\s+)(?:\`\`\`)/,beginningSpace:/^\\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\\n/g,tabCharGlobal:/\\t/g,multipleSpaceGlobal:/\\s+/g,blankLine:/^[ \\t]*$/,doubleBlankLine:/\\n[ \\t]*\\n[ \\t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\\n {0,3}((?:=+|-+) *)(?=\\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \\t]?/gm,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\\[[ xX]\\] +\\S/,listReplaceTask:/^\\[[ xX]\\] +/,listTaskCheckbox:/\\[[ xX]\\]/,anyLine:/\\n.*\\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\\||\\| *$/g,tableRowBlankLine:/\\n[ \\t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\\s|>)/i,endPreScriptTag:/^<\\/(pre|code|kbd|script)(\\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\\s])\\s+(['"])(.*)\\2/,unicodeAlphaNumeric:/[\\p{L}\\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\\w+);)/g,unescapeTest:/&(#(?:\\d+)|(?:#x[0-9A-Fa-f]+)|(?:\\w+));?/ig,caret:/(^|[^\\[])\\^/g,percentDecode:/%25/g,findPipe:/\\|/g,splitPipe:/ \\|/,slashPipe:/\\\\\\|/g,carriageReturn:/\\r\\n|\\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\\S*/,endingNewline:/\\n$/,listItemRegex:e=>new RegExp(\`^( {0,3}\${e})((?:[	 ][^\\\\n]*)?(?:\\\\n|$))\`),nextBulletRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}(?:[*+-]|\\\\d{1,9}[.)])((?:[ 	][^\\\\n]*)?(?:\\\\n|$))\`),hrRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\\\* *){3,})(?:\\\\n+|$)\`),fencesBeginRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}(?:\\\`\\\`\\\`|~~~)\`),headingBeginRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}#\`),htmlBeginRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}<(?:[a-z].*>|!--)\`,"i"),blockquoteBeginRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}>\`)},Os=/^(?:[ \\t]*(?:\\n|$))+/,Ls=/^((?: {4}| {0,3}\\t)[^\\n]+(?:\\n(?:[ \\t]*(?:\\n|$))*)?)+/,Ds=/^ {0,3}(\`{3,}(?=[^\`\\n]*(?:\\n|$))|~{3,})([^\\n]*)(?:\\n|$)(?:|([\\s\\S]*?)(?:\\n|$))(?: {0,3}\\1[~\`]* *(?=\\n|$)|$)/,Ie=/^ {0,3}((?:-[\\t ]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)/,Bs=/^ {0,3}(#{1,6})(?=\\s|$)(.*)(?:\\n+|$)/,lt=/ {0,3}(?:[*+-]|\\d{1,9}[.)])/,on=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\\n(?!\\s*?\\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\\n {0,3}(=+|-+) *(?:\\n+|$)/,ln=S(on).replace(/bull/g,lt).replace(/blockCode/g,/(?: {4}| {0,3}\\t)/).replace(/fences/g,/ {0,3}(?:\`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\\n>]+>\\n/).replace(/\\|table/g,"").getRegex(),$s=S(on).replace(/bull/g,lt).replace(/blockCode/g,/(?: {4}| {0,3}\\t)/).replace(/fences/g,/ {0,3}(?:\`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\\n>]+>\\n/).replace(/table/g,/ {0,3}\\|?(?:[:\\- ]*\\|)+[\\:\\- ]*\\n/).getRegex(),ct=/^([^\\n]+(?:\\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\\n)[^\\n]+)*)/,Ps=/^[^\\n]+/,ut=/(?!\\s*\\])(?:\\\\[\\s\\S]|[^\\[\\]\\\\])+/,zs=S(/^ {0,3}\\[(label)\\]: *(?:\\n[ \\t]*)?([^<\\s][^\\s]*|<.*?>)(?:(?: +(?:\\n[ \\t]*)?| *\\n[ \\t]*)(title))? *(?:\\n+|$)/).replace("label",ut).replace("title",/(?:"(?:\\\\"?|[^"\\\\])*"|'[^'\\n]*(?:\\n[^'\\n]+)*\\n?'|\\([^()]*\\))/).getRegex(),Us=S(/^(bull)([ \\t][^\\n]+?)?(?:\\n|$)/).replace(/bull/g,lt).getRegex(),Ze="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",dt=/<!--(?:-?>|[\\s\\S]*?(?:-->|$))/,Hs=S("^ {0,3}(?:<(script|pre|style|textarea)[\\\\s>][\\\\s\\\\S]*?(?:</\\\\1>[^\\\\n]*\\\\n+|$)|comment[^\\\\n]*(\\\\n+|$)|<\\\\?[\\\\s\\\\S]*?(?:\\\\?>\\\\n*|$)|<![A-Z][\\\\s\\\\S]*?(?:>\\\\n*|$)|<!\\\\[CDATA\\\\[[\\\\s\\\\S]*?(?:\\\\]\\\\]>\\\\n*|$)|</?(tag)(?: +|\\\\n|/?>)[\\\\s\\\\S]*?(?:(?:\\\\n[ 	]*)+\\\\n|$)|<(?!script|pre|style|textarea)([a-z][\\\\w-]*)(?:attribute)*? */?>(?=[ \\\\t]*(?:\\\\n|$))[\\\\s\\\\S]*?(?:(?:\\\\n[ 	]*)+\\\\n|$)|</(?!script|pre|style|textarea)[a-z][\\\\w-]*\\\\s*>(?=[ \\\\t]*(?:\\\\n|$))[\\\\s\\\\S]*?(?:(?:\\\\n[ 	]*)+\\\\n|$))","i").replace("comment",dt).replace("tag",Ze).replace("attribute",/ +[a-zA-Z:_][\\w.:-]*(?: *= *"[^"\\n]*"| *= *'[^'\\n]*'| *= *[^\\s"'=<>\`]+)?/).getRegex(),cn=S(ct).replace("hr",Ie).replace("heading"," {0,3}#{1,6}(?:\\\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:\`{3,}(?=[^\`\\\\n]*\\\\n)|~{3,})[^\\\\n]*\\\\n").replace("list"," {0,3}(?:[*+-]|1[.)])[ \\\\t]").replace("html","</?(?:tag)(?: +|\\\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",Ze).getRegex(),Fs=S(/^( {0,3}> ?(paragraph|[^\\n]*)(?:\\n|$))+/).replace("paragraph",cn).getRegex(),pt={blockquote:Fs,code:Ls,def:zs,fences:Ds,heading:Bs,hr:Ie,html:Hs,lheading:ln,list:Us,newline:Os,paragraph:cn,table:pe,text:Ps},Jt=S("^ *([^\\\\n ].*)\\\\n {0,3}((?:\\\\| *)?:?-+:? *(?:\\\\| *:?-+:? *)*(?:\\\\| *)?)(?:\\\\n((?:(?! *\\\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\\\n|$))*)\\\\n*|$)").replace("hr",Ie).replace("heading"," {0,3}#{1,6}(?:\\\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\\\n]").replace("fences"," {0,3}(?:\`{3,}(?=[^\`\\\\n]*\\\\n)|~{3,})[^\\\\n]*\\\\n").replace("list"," {0,3}(?:[*+-]|1[.)])[ \\\\t]").replace("html","</?(?:tag)(?: +|\\\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",Ze).getRegex(),Gs={...pt,lheading:$s,table:Jt,paragraph:S(ct).replace("hr",Ie).replace("heading"," {0,3}#{1,6}(?:\\\\s|$)").replace("|lheading","").replace("table",Jt).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:\`{3,}(?=[^\`\\\\n]*\\\\n)|~{3,})[^\\\\n]*\\\\n").replace("list"," {0,3}(?:[*+-]|1[.)])[ \\\\t]").replace("html","</?(?:tag)(?: +|\\\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",Ze).getRegex()},qs={...pt,html:S(\`^ *(?:comment *(?:\\\\n|\\\\s*$)|<(tag)[\\\\s\\\\S]+?</\\\\1> *(?:\\\\n{2,}|\\\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\\\s[^'"/>\\\\s]*)*?/?> *(?:\\\\n{2,}|\\\\s*$))\`).replace("comment",dt).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\\\b)\\\\w+(?!:|[^\\\\w\\\\s@]*@)\\\\b").getRegex(),def:/^ *\\[([^\\]]+)\\]: *<?([^\\s>]+)>?(?: +(["(][^\\n]+[")]))? *(?:\\n+|$)/,heading:/^(#{1,6})(.*)(?:\\n+|$)/,fences:pe,lheading:/^(.+?)\\n {0,3}(=+|-+) *(?:\\n+|$)/,paragraph:S(ct).replace("hr",Ie).replace("heading",\` *#{1,6} *[^
]\`).replace("lheading",ln).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},Zs=/^\\\\([!"#$%&'()*+,\\-./:;<=>?@\\[\\]\\\\^_\`{|}~])/,Ks=/^(\`+)([^\`]|[^\`][\\s\\S]*?[^\`])\\1(?!\`)/,un=/^( {2,}|\\\\)\\n(?!\\s*$)/,Ws=/^(\`+|[^\`])(?:(?= {2,}\\n)|[\\s\\S]*?(?:(?=[\\\\<!\\[\`*_]|\\b_|$)|[^ ](?= {2,}\\n)))/,Ke=/[\\p{P}\\p{S}]/u,gt=/[\\s\\p{P}\\p{S}]/u,dn=/[^\\s\\p{P}\\p{S}]/u,js=S(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,gt).getRegex(),pn=/(?!~)[\\p{P}\\p{S}]/u,Xs=/(?!~)[\\s\\p{P}\\p{S}]/u,Ys=/(?:[^\\s\\p{P}\\p{S}]|~)/u,gn=/(?![*_])[\\p{P}\\p{S}]/u,Qs=/(?![*_])[\\s\\p{P}\\p{S}]/u,Vs=/(?:[^\\s\\p{P}\\p{S}]|[*_])/u,Js=S(/link|precode-code|html/,"g").replace("link",/\\[(?:[^\\[\\]\`]|(?<a>\`+)[^\`]+\\k<a>(?!\`))*?\\]\\((?:\\\\[\\s\\S]|[^\\\\\\(\\)]|\\((?:\\\\[\\s\\S]|[^\\\\\\(\\)])*\\))*\\)/).replace("precode-",Ms?"(?<!\`)()":"(^^|[^\`])").replace("code",/(?<b>\`+)[^\`]+\\k<b>(?!\`)/).replace("html",/<(?! )[^<>]*?>/).getRegex(),hn=/^(?:\\*+(?:((?!\\*)punct)|[^\\s*]))|^_+(?:((?!_)punct)|([^\\s_]))/,er=S(hn,"u").replace(/punct/g,Ke).getRegex(),tr=S(hn,"u").replace(/punct/g,pn).getRegex(),fn="^[^_*]*?__[^_*]*?\\\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\\\*)punct(\\\\*+)(?=[\\\\s]|$)|notPunctSpace(\\\\*+)(?!\\\\*)(?=punctSpace|$)|(?!\\\\*)punctSpace(\\\\*+)(?=notPunctSpace)|[\\\\s](\\\\*+)(?!\\\\*)(?=punct)|(?!\\\\*)punct(\\\\*+)(?!\\\\*)(?=punct)|notPunctSpace(\\\\*+)(?=notPunctSpace)",nr=S(fn,"gu").replace(/notPunctSpace/g,dn).replace(/punctSpace/g,gt).replace(/punct/g,Ke).getRegex(),sr=S(fn,"gu").replace(/notPunctSpace/g,Ys).replace(/punctSpace/g,Xs).replace(/punct/g,pn).getRegex(),rr=S("^[^_*]*?\\\\*\\\\*[^_*]*?_[^_*]*?(?=\\\\*\\\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,dn).replace(/punctSpace/g,gt).replace(/punct/g,Ke).getRegex(),ir=S(/^~~?(?:((?!~)punct)|[^\\s~])/,"u").replace(/punct/g,gn).getRegex(),ar="^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)",or=S(ar,"gu").replace(/notPunctSpace/g,Vs).replace(/punctSpace/g,Qs).replace(/punct/g,gn).getRegex(),lr=S(/\\\\(punct)/,"gu").replace(/punct/g,Ke).getRegex(),cr=S(/^<(scheme:[^\\s\\x00-\\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_\`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),ur=S(dt).replace("(?:-->|$)","-->").getRegex(),dr=S("^comment|^</[a-zA-Z][\\\\w:-]*\\\\s*>|^<[a-zA-Z][\\\\w-]*(?:attribute)*?\\\\s*/?>|^<\\\\?[\\\\s\\\\S]*?\\\\?>|^<![a-zA-Z]+\\\\s[\\\\s\\\\S]*?>|^<!\\\\[CDATA\\\\[[\\\\s\\\\S]*?\\\\]\\\\]>").replace("comment",ur).replace("attribute",/\\s+[a-zA-Z:_][\\w.:-]*(?:\\s*=\\s*"[^"]*"|\\s*=\\s*'[^']*'|\\s*=\\s*[^\\s"'=<>\`]+)?/).getRegex(),Fe=/(?:\\[(?:\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]|\\\\[\\s\\S]|\`+[^\`]*?\`+(?!\`)|[^\\[\\]\\\\\`])*?/,pr=S(/^!?\\[(label)\\]\\(\\s*(href)(?:(?:[ \\t]*(?:\\n[ \\t]*)?)(title))?\\s*\\)/).replace("label",Fe).replace("href",/<(?:\\\\.|[^\\n<>\\\\])+>|[^ \\t\\n\\x00-\\x1f]*/).replace("title",/"(?:\\\\"?|[^"\\\\])*"|'(?:\\\\'?|[^'\\\\])*'|\\((?:\\\\\\)?|[^)\\\\])*\\)/).getRegex(),bn=S(/^!?\\[(label)\\]\\[(ref)\\]/).replace("label",Fe).replace("ref",ut).getRegex(),mn=S(/^!?\\[(ref)\\](?:\\[\\])?/).replace("ref",ut).getRegex(),gr=S("reflink|nolink(?!\\\\()","g").replace("reflink",bn).replace("nolink",mn).getRegex(),en=/[hH][tT][tT][pP][sS]?|[fF][tT][pP]/,ht={_backpedal:pe,anyPunctuation:lr,autolink:cr,blockSkip:Js,br:un,code:Ks,del:pe,delLDelim:pe,delRDelim:pe,emStrongLDelim:er,emStrongRDelimAst:nr,emStrongRDelimUnd:rr,escape:Zs,link:pr,nolink:mn,punctuation:js,reflink:bn,reflinkSearch:gr,tag:dr,text:Ws,url:pe},hr={...ht,link:S(/^!?\\[(label)\\]\\((.*?)\\)/).replace("label",Fe).getRegex(),reflink:S(/^!?\\[(label)\\]\\s*\\[([^\\]]*)\\]/).replace("label",Fe).getRegex()},rt={...ht,emStrongRDelimAst:sr,emStrongLDelim:tr,delLDelim:ir,delRDelim:or,url:S(/^((?:protocol):\\/\\/|www\\.)(?:[a-zA-Z0-9\\-]+\\.?)+[^\\s<]*|^email/).replace("protocol",en).replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\\([^)]*\\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\\s~])((?:\\\\[\\s\\S]|[^\\\\])*?(?:\\\\[\\s\\S]|[^\\s~\\\\]))\\1(?=[^~]|$)/,text:S(/^([\`~]+|[^\`~])(?:(?= {2,}\\n)|(?=[a-zA-Z0-9.!#$%&'*+\\/=?_\`{\\|}~-]+@)|[\\s\\S]*?(?:(?=[\\\\<!\\[\`*~_]|\\b_|protocol:\\/\\/|www\\.|$)|[^ ](?= {2,}\\n)|[^a-zA-Z0-9.!#$%&'*+\\/=?_\`{\\|}~-](?=[a-zA-Z0-9.!#$%&'*+\\/=?_\`{\\|}~-]+@)))/).replace("protocol",en).getRegex()},fr={...rt,br:S(un).replace("{2,}","*").getRegex(),text:S(rt.text).replace("\\\\b_","\\\\b_| {2,}\\\\n").replace(/\\{2,\\}/g,"*").getRegex()},He={normal:pt,gfm:Gs,pedantic:qs},Re={normal:ht,gfm:rt,breaks:fr,pedantic:hr},br={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},tn=e=>br[e];function te(e,t){if(t){if(q.escapeTest.test(e))return e.replace(q.escapeReplace,tn)}else if(q.escapeTestNoEncode.test(e))return e.replace(q.escapeReplaceNoEncode,tn);return e}function nn(e){try{e=encodeURI(e).replace(q.percentDecode,"%")}catch{return null}return e}function sn(e,t){let n=e.replace(q.findPipe,(a,i,l)=>{let o=!1,c=i;for(;--c>=0&&l[c]==="\\\\";)o=!o;return o?"|":" |"}),r=n.split(q.splitPipe),s=0;if(r[0].trim()||r.shift(),r.length>0&&!r.at(-1)?.trim()&&r.pop(),t)if(r.length>t)r.splice(t);else for(;r.length<t;)r.push("");for(;s<r.length;s++)r[s]=r[s].trim().replace(q.slashPipe,"|");return r}function Ne(e,t,n){let r=e.length;if(r===0)return"";let s=0;for(;s<r;){let a=e.charAt(r-s-1);if(a===t&&!n)s++;else if(a!==t&&n)s++;else break}return e.slice(0,r-s)}function mr(e,t){if(e.indexOf(t[1])===-1)return-1;let n=0;for(let r=0;r<e.length;r++)if(e[r]==="\\\\")r++;else if(e[r]===t[0])n++;else if(e[r]===t[1]&&(n--,n<0))return r;return n>0?-2:-1}function kr(e,t=0){let n=t,r="";for(let s of e)if(s==="	"){let a=4-n%4;r+=" ".repeat(a),n+=a}else r+=s,n++;return r}function rn(e,t,n,r,s){let a=t.href,i=t.title||null,l=e[1].replace(s.other.outputLinkReplace,"$1");r.state.inLink=!0;let o={type:e[0].charAt(0)==="!"?"image":"link",raw:n,href:a,title:i,text:l,tokens:r.inlineTokens(l)};return r.state.inLink=!1,o}function xr(e,t,n){let r=e.match(n.other.indentCodeCompensation);if(r===null)return t;let s=r[1];return t.split(\`
\`).map(a=>{let i=a.match(n.other.beginningSpace);if(i===null)return a;let[l]=i;return l.length>=s.length?a.slice(s.length):a}).join(\`
\`)}var Ge=class{options;rules;lexer;constructor(e){this.options=e||he}space(e){let t=this.rules.block.newline.exec(e);if(t&&t[0].length>0)return{type:"space",raw:t[0]}}code(e){let t=this.rules.block.code.exec(e);if(t){let n=t[0].replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:t[0],codeBlockStyle:"indented",text:this.options.pedantic?n:Ne(n,\`
\`)}}}fences(e){let t=this.rules.block.fences.exec(e);if(t){let n=t[0],r=xr(n,t[3]||"",this.rules);return{type:"code",raw:n,lang:t[2]?t[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):t[2],text:r}}}heading(e){let t=this.rules.block.heading.exec(e);if(t){let n=t[2].trim();if(this.rules.other.endingHash.test(n)){let r=Ne(n,"#");(this.options.pedantic||!r||this.rules.other.endingSpaceChar.test(r))&&(n=r.trim())}return{type:"heading",raw:t[0],depth:t[1].length,text:n,tokens:this.lexer.inline(n)}}}hr(e){let t=this.rules.block.hr.exec(e);if(t)return{type:"hr",raw:Ne(t[0],\`
\`)}}blockquote(e){let t=this.rules.block.blockquote.exec(e);if(t){let n=Ne(t[0],\`
\`).split(\`
\`),r="",s="",a=[];for(;n.length>0;){let i=!1,l=[],o;for(o=0;o<n.length;o++)if(this.rules.other.blockquoteStart.test(n[o]))l.push(n[o]),i=!0;else if(!i)l.push(n[o]);else break;n=n.slice(o);let c=l.join(\`
\`),u=c.replace(this.rules.other.blockquoteSetextReplace,\`
    $1\`).replace(this.rules.other.blockquoteSetextReplace2,"");r=r?\`\${r}
\${c}\`:c,s=s?\`\${s}
\${u}\`:u;let h=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(u,a,!0),this.lexer.state.top=h,n.length===0)break;let p=a.at(-1);if(p?.type==="code")break;if(p?.type==="blockquote"){let E=p,m=E.raw+\`
\`+n.join(\`
\`),y=this.blockquote(m);a[a.length-1]=y,r=r.substring(0,r.length-E.raw.length)+y.raw,s=s.substring(0,s.length-E.text.length)+y.text;break}else if(p?.type==="list"){let E=p,m=E.raw+\`
\`+n.join(\`
\`),y=this.list(m);a[a.length-1]=y,r=r.substring(0,r.length-p.raw.length)+y.raw,s=s.substring(0,s.length-E.raw.length)+y.raw,n=m.substring(a.at(-1).raw.length).split(\`
\`);continue}}return{type:"blockquote",raw:r,tokens:a,text:s}}}list(e){let t=this.rules.block.list.exec(e);if(t){let n=t[1].trim(),r=n.length>1,s={type:"list",raw:"",ordered:r,start:r?+n.slice(0,-1):"",loose:!1,items:[]};n=r?\`\\\\d{1,9}\\\\\${n.slice(-1)}\`:\`\\\\\${n}\`,this.options.pedantic&&(n=r?n:"[*+-]");let a=this.rules.other.listItemRegex(n),i=!1;for(;e;){let o=!1,c="",u="";if(!(t=a.exec(e))||this.rules.block.hr.test(e))break;c=t[0],e=e.substring(c.length);let h=kr(t[2].split(\`
\`,1)[0],t[1].length),p=e.split(\`
\`,1)[0],E=!h.trim(),m=0;if(this.options.pedantic?(m=2,u=h.trimStart()):E?m=t[1].length+1:(m=h.search(this.rules.other.nonSpaceChar),m=m>4?1:m,u=h.slice(m),m+=t[1].length),E&&this.rules.other.blankLine.test(p)&&(c+=p+\`
\`,e=e.substring(p.length+1),o=!0),!o){let y=this.rules.other.nextBulletRegex(m),O=this.rules.other.hrRegex(m),L=this.rules.other.fencesBeginRegex(m),M=this.rules.other.headingBeginRegex(m),$=this.rules.other.htmlBeginRegex(m),P=this.rules.other.blockquoteBeginRegex(m);for(;e;){let C=e.split(\`
\`,1)[0],N;if(p=C,this.options.pedantic?(p=p.replace(this.rules.other.listReplaceNesting,"  "),N=p):N=p.replace(this.rules.other.tabCharGlobal,"    "),L.test(p)||M.test(p)||$.test(p)||P.test(p)||y.test(p)||O.test(p))break;if(N.search(this.rules.other.nonSpaceChar)>=m||!p.trim())u+=\`
\`+N.slice(m);else{if(E||h.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||L.test(h)||M.test(h)||O.test(h))break;u+=\`
\`+p}E=!p.trim(),c+=C+\`
\`,e=e.substring(C.length+1),h=N.slice(m)}}s.loose||(i?s.loose=!0:this.rules.other.doubleBlankLine.test(c)&&(i=!0)),s.items.push({type:"list_item",raw:c,task:!!this.options.gfm&&this.rules.other.listIsTask.test(u),loose:!1,text:u,tokens:[]}),s.raw+=c}let l=s.items.at(-1);if(l)l.raw=l.raw.trimEnd(),l.text=l.text.trimEnd();else return;s.raw=s.raw.trimEnd();for(let o of s.items){if(this.lexer.state.top=!1,o.tokens=this.lexer.blockTokens(o.text,[]),o.task){if(o.text=o.text.replace(this.rules.other.listReplaceTask,""),o.tokens[0]?.type==="text"||o.tokens[0]?.type==="paragraph"){o.tokens[0].raw=o.tokens[0].raw.replace(this.rules.other.listReplaceTask,""),o.tokens[0].text=o.tokens[0].text.replace(this.rules.other.listReplaceTask,"");for(let u=this.lexer.inlineQueue.length-1;u>=0;u--)if(this.rules.other.listIsTask.test(this.lexer.inlineQueue[u].src)){this.lexer.inlineQueue[u].src=this.lexer.inlineQueue[u].src.replace(this.rules.other.listReplaceTask,"");break}}let c=this.rules.other.listTaskCheckbox.exec(o.raw);if(c){let u={type:"checkbox",raw:c[0]+" ",checked:c[0]!=="[ ]"};o.checked=u.checked,s.loose?o.tokens[0]&&["paragraph","text"].includes(o.tokens[0].type)&&"tokens"in o.tokens[0]&&o.tokens[0].tokens?(o.tokens[0].raw=u.raw+o.tokens[0].raw,o.tokens[0].text=u.raw+o.tokens[0].text,o.tokens[0].tokens.unshift(u)):o.tokens.unshift({type:"paragraph",raw:u.raw,text:u.raw,tokens:[u]}):o.tokens.unshift(u)}}if(!s.loose){let c=o.tokens.filter(h=>h.type==="space"),u=c.length>0&&c.some(h=>this.rules.other.anyLine.test(h.raw));s.loose=u}}if(s.loose)for(let o of s.items){o.loose=!0;for(let c of o.tokens)c.type==="text"&&(c.type="paragraph")}return s}}html(e){let t=this.rules.block.html.exec(e);if(t)return{type:"html",block:!0,raw:t[0],pre:t[1]==="pre"||t[1]==="script"||t[1]==="style",text:t[0]}}def(e){let t=this.rules.block.def.exec(e);if(t){let n=t[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),r=t[2]?t[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",s=t[3]?t[3].substring(1,t[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):t[3];return{type:"def",tag:n,raw:t[0],href:r,title:s}}}table(e){let t=this.rules.block.table.exec(e);if(!t||!this.rules.other.tableDelimiter.test(t[2]))return;let n=sn(t[1]),r=t[2].replace(this.rules.other.tableAlignChars,"").split("|"),s=t[3]?.trim()?t[3].replace(this.rules.other.tableRowBlankLine,"").split(\`
\`):[],a={type:"table",raw:t[0],header:[],align:[],rows:[]};if(n.length===r.length){for(let i of r)this.rules.other.tableAlignRight.test(i)?a.align.push("right"):this.rules.other.tableAlignCenter.test(i)?a.align.push("center"):this.rules.other.tableAlignLeft.test(i)?a.align.push("left"):a.align.push(null);for(let i=0;i<n.length;i++)a.header.push({text:n[i],tokens:this.lexer.inline(n[i]),header:!0,align:a.align[i]});for(let i of s)a.rows.push(sn(i,a.header.length).map((l,o)=>({text:l,tokens:this.lexer.inline(l),header:!1,align:a.align[o]})));return a}}lheading(e){let t=this.rules.block.lheading.exec(e);if(t)return{type:"heading",raw:t[0],depth:t[2].charAt(0)==="="?1:2,text:t[1],tokens:this.lexer.inline(t[1])}}paragraph(e){let t=this.rules.block.paragraph.exec(e);if(t){let n=t[1].charAt(t[1].length-1)===\`
\`?t[1].slice(0,-1):t[1];return{type:"paragraph",raw:t[0],text:n,tokens:this.lexer.inline(n)}}}text(e){let t=this.rules.block.text.exec(e);if(t)return{type:"text",raw:t[0],text:t[0],tokens:this.lexer.inline(t[0])}}escape(e){let t=this.rules.inline.escape.exec(e);if(t)return{type:"escape",raw:t[0],text:t[1]}}tag(e){let t=this.rules.inline.tag.exec(e);if(t)return!this.lexer.state.inLink&&this.rules.other.startATag.test(t[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(t[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(t[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(t[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:t[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:t[0]}}link(e){let t=this.rules.inline.link.exec(e);if(t){let n=t[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(n)){if(!this.rules.other.endAngleBracket.test(n))return;let a=Ne(n.slice(0,-1),"\\\\");if((n.length-a.length)%2===0)return}else{let a=mr(t[2],"()");if(a===-2)return;if(a>-1){let i=(t[0].indexOf("!")===0?5:4)+t[1].length+a;t[2]=t[2].substring(0,a),t[0]=t[0].substring(0,i).trim(),t[3]=""}}let r=t[2],s="";if(this.options.pedantic){let a=this.rules.other.pedanticHrefTitle.exec(r);a&&(r=a[1],s=a[3])}else s=t[3]?t[3].slice(1,-1):"";return r=r.trim(),this.rules.other.startAngleBracket.test(r)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(n)?r=r.slice(1):r=r.slice(1,-1)),rn(t,{href:r&&r.replace(this.rules.inline.anyPunctuation,"$1"),title:s&&s.replace(this.rules.inline.anyPunctuation,"$1")},t[0],this.lexer,this.rules)}}reflink(e,t){let n;if((n=this.rules.inline.reflink.exec(e))||(n=this.rules.inline.nolink.exec(e))){let r=(n[2]||n[1]).replace(this.rules.other.multipleSpaceGlobal," "),s=t[r.toLowerCase()];if(!s){let a=n[0].charAt(0);return{type:"text",raw:a,text:a}}return rn(n,s,n[0],this.lexer,this.rules)}}emStrong(e,t,n=""){let r=this.rules.inline.emStrongLDelim.exec(e);if(!(!r||r[3]&&n.match(this.rules.other.unicodeAlphaNumeric))&&(!(r[1]||r[2])||!n||this.rules.inline.punctuation.exec(n))){let s=[...r[0]].length-1,a,i,l=s,o=0,c=r[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(c.lastIndex=0,t=t.slice(-1*e.length+s);(r=c.exec(t))!=null;){if(a=r[1]||r[2]||r[3]||r[4]||r[5]||r[6],!a)continue;if(i=[...a].length,r[3]||r[4]){l+=i;continue}else if((r[5]||r[6])&&s%3&&!((s+i)%3)){o+=i;continue}if(l-=i,l>0)continue;i=Math.min(i,i+l+o);let u=[...r[0]][0].length,h=e.slice(0,s+r.index+u+i);if(Math.min(s,i)%2){let E=h.slice(1,-1);return{type:"em",raw:h,text:E,tokens:this.lexer.inlineTokens(E)}}let p=h.slice(2,-2);return{type:"strong",raw:h,text:p,tokens:this.lexer.inlineTokens(p)}}}}codespan(e){let t=this.rules.inline.code.exec(e);if(t){let n=t[2].replace(this.rules.other.newLineCharGlobal," "),r=this.rules.other.nonSpaceChar.test(n),s=this.rules.other.startingSpaceChar.test(n)&&this.rules.other.endingSpaceChar.test(n);return r&&s&&(n=n.substring(1,n.length-1)),{type:"codespan",raw:t[0],text:n}}}br(e){let t=this.rules.inline.br.exec(e);if(t)return{type:"br",raw:t[0]}}del(e,t,n=""){let r=this.rules.inline.delLDelim.exec(e);if(r&&(!r[1]||!n||this.rules.inline.punctuation.exec(n))){let s=[...r[0]].length-1,a,i,l=s,o=this.rules.inline.delRDelim;for(o.lastIndex=0,t=t.slice(-1*e.length+s);(r=o.exec(t))!=null;){if(a=r[1]||r[2]||r[3]||r[4]||r[5]||r[6],!a||(i=[...a].length,i!==s))continue;if(r[3]||r[4]){l+=i;continue}if(l-=i,l>0)continue;i=Math.min(i,i+l);let c=[...r[0]][0].length,u=e.slice(0,s+r.index+c+i),h=u.slice(s,-s);return{type:"del",raw:u,text:h,tokens:this.lexer.inlineTokens(h)}}}}autolink(e){let t=this.rules.inline.autolink.exec(e);if(t){let n,r;return t[2]==="@"?(n=t[1],r="mailto:"+n):(n=t[1],r=n),{type:"link",raw:t[0],text:n,href:r,tokens:[{type:"text",raw:n,text:n}]}}}url(e){let t;if(t=this.rules.inline.url.exec(e)){let n,r;if(t[2]==="@")n=t[0],r="mailto:"+n;else{let s;do s=t[0],t[0]=this.rules.inline._backpedal.exec(t[0])?.[0]??"";while(s!==t[0]);n=t[0],t[1]==="www."?r="http://"+t[0]:r=t[0]}return{type:"link",raw:t[0],text:n,href:r,tokens:[{type:"text",raw:n,text:n}]}}}inlineText(e){let t=this.rules.inline.text.exec(e);if(t){let n=this.lexer.state.inRawBlock;return{type:"text",raw:t[0],text:t[0],escaped:n}}}},X=class it{tokens;options;state;inlineQueue;tokenizer;constructor(t){this.tokens=[],this.tokens.links=Object.create(null),this.options=t||he,this.options.tokenizer=this.options.tokenizer||new Ge,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};let n={other:q,block:He.normal,inline:Re.normal};this.options.pedantic?(n.block=He.pedantic,n.inline=Re.pedantic):this.options.gfm&&(n.block=He.gfm,this.options.breaks?n.inline=Re.breaks:n.inline=Re.gfm),this.tokenizer.rules=n}static get rules(){return{block:He,inline:Re}}static lex(t,n){return new it(n).lex(t)}static lexInline(t,n){return new it(n).inlineTokens(t)}lex(t){t=t.replace(q.carriageReturn,\`
\`),this.blockTokens(t,this.tokens);for(let n=0;n<this.inlineQueue.length;n++){let r=this.inlineQueue[n];this.inlineTokens(r.src,r.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(t,n=[],r=!1){for(this.options.pedantic&&(t=t.replace(q.tabCharGlobal,"    ").replace(q.spaceLine,""));t;){let s;if(this.options.extensions?.block?.some(i=>(s=i.call({lexer:this},t,n))?(t=t.substring(s.raw.length),n.push(s),!0):!1))continue;if(s=this.tokenizer.space(t)){t=t.substring(s.raw.length);let i=n.at(-1);s.raw.length===1&&i!==void 0?i.raw+=\`
\`:n.push(s);continue}if(s=this.tokenizer.code(t)){t=t.substring(s.raw.length);let i=n.at(-1);i?.type==="paragraph"||i?.type==="text"?(i.raw+=(i.raw.endsWith(\`
\`)?"":\`
\`)+s.raw,i.text+=\`
\`+s.text,this.inlineQueue.at(-1).src=i.text):n.push(s);continue}if(s=this.tokenizer.fences(t)){t=t.substring(s.raw.length),n.push(s);continue}if(s=this.tokenizer.heading(t)){t=t.substring(s.raw.length),n.push(s);continue}if(s=this.tokenizer.hr(t)){t=t.substring(s.raw.length),n.push(s);continue}if(s=this.tokenizer.blockquote(t)){t=t.substring(s.raw.length),n.push(s);continue}if(s=this.tokenizer.list(t)){t=t.substring(s.raw.length),n.push(s);continue}if(s=this.tokenizer.html(t)){t=t.substring(s.raw.length),n.push(s);continue}if(s=this.tokenizer.def(t)){t=t.substring(s.raw.length);let i=n.at(-1);i?.type==="paragraph"||i?.type==="text"?(i.raw+=(i.raw.endsWith(\`
\`)?"":\`
\`)+s.raw,i.text+=\`
\`+s.raw,this.inlineQueue.at(-1).src=i.text):this.tokens.links[s.tag]||(this.tokens.links[s.tag]={href:s.href,title:s.title},n.push(s));continue}if(s=this.tokenizer.table(t)){t=t.substring(s.raw.length),n.push(s);continue}if(s=this.tokenizer.lheading(t)){t=t.substring(s.raw.length),n.push(s);continue}let a=t;if(this.options.extensions?.startBlock){let i=1/0,l=t.slice(1),o;this.options.extensions.startBlock.forEach(c=>{o=c.call({lexer:this},l),typeof o=="number"&&o>=0&&(i=Math.min(i,o))}),i<1/0&&i>=0&&(a=t.substring(0,i+1))}if(this.state.top&&(s=this.tokenizer.paragraph(a))){let i=n.at(-1);r&&i?.type==="paragraph"?(i.raw+=(i.raw.endsWith(\`
\`)?"":\`
\`)+s.raw,i.text+=\`
\`+s.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=i.text):n.push(s),r=a.length!==t.length,t=t.substring(s.raw.length);continue}if(s=this.tokenizer.text(t)){t=t.substring(s.raw.length);let i=n.at(-1);i?.type==="text"?(i.raw+=(i.raw.endsWith(\`
\`)?"":\`
\`)+s.raw,i.text+=\`
\`+s.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=i.text):n.push(s);continue}if(t){let i="Infinite loop on byte: "+t.charCodeAt(0);if(this.options.silent){console.error(i);break}else throw new Error(i)}}return this.state.top=!0,n}inline(t,n=[]){return this.inlineQueue.push({src:t,tokens:n}),n}inlineTokens(t,n=[]){let r=t,s=null;if(this.tokens.links){let o=Object.keys(this.tokens.links);if(o.length>0)for(;(s=this.tokenizer.rules.inline.reflinkSearch.exec(r))!=null;)o.includes(s[0].slice(s[0].lastIndexOf("[")+1,-1))&&(r=r.slice(0,s.index)+"["+"a".repeat(s[0].length-2)+"]"+r.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(s=this.tokenizer.rules.inline.anyPunctuation.exec(r))!=null;)r=r.slice(0,s.index)+"++"+r.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);let a;for(;(s=this.tokenizer.rules.inline.blockSkip.exec(r))!=null;)a=s[2]?s[2].length:0,r=r.slice(0,s.index+a)+"["+"a".repeat(s[0].length-a-2)+"]"+r.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);r=this.options.hooks?.emStrongMask?.call({lexer:this},r)??r;let i=!1,l="";for(;t;){i||(l=""),i=!1;let o;if(this.options.extensions?.inline?.some(u=>(o=u.call({lexer:this},t,n))?(t=t.substring(o.raw.length),n.push(o),!0):!1))continue;if(o=this.tokenizer.escape(t)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.tag(t)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.link(t)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.reflink(t,this.tokens.links)){t=t.substring(o.raw.length);let u=n.at(-1);o.type==="text"&&u?.type==="text"?(u.raw+=o.raw,u.text+=o.text):n.push(o);continue}if(o=this.tokenizer.emStrong(t,r,l)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.codespan(t)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.br(t)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.del(t,r,l)){t=t.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.autolink(t)){t=t.substring(o.raw.length),n.push(o);continue}if(!this.state.inLink&&(o=this.tokenizer.url(t))){t=t.substring(o.raw.length),n.push(o);continue}let c=t;if(this.options.extensions?.startInline){let u=1/0,h=t.slice(1),p;this.options.extensions.startInline.forEach(E=>{p=E.call({lexer:this},h),typeof p=="number"&&p>=0&&(u=Math.min(u,p))}),u<1/0&&u>=0&&(c=t.substring(0,u+1))}if(o=this.tokenizer.inlineText(c)){t=t.substring(o.raw.length),o.raw.slice(-1)!=="_"&&(l=o.raw.slice(-1)),i=!0;let u=n.at(-1);u?.type==="text"?(u.raw+=o.raw,u.text+=o.text):n.push(o);continue}if(t){let u="Infinite loop on byte: "+t.charCodeAt(0);if(this.options.silent){console.error(u);break}else throw new Error(u)}}return n}},qe=class{options;parser;constructor(e){this.options=e||he}space(e){return""}code({text:e,lang:t,escaped:n}){let r=(t||"").match(q.notSpaceStart)?.[0],s=e.replace(q.endingNewline,"")+\`
\`;return r?'<pre><code class="language-'+te(r)+'">'+(n?s:te(s,!0))+\`</code></pre>
\`:"<pre><code>"+(n?s:te(s,!0))+\`</code></pre>
\`}blockquote({tokens:e}){return\`<blockquote>
\${this.parser.parse(e)}</blockquote>
\`}html({text:e}){return e}def(e){return""}heading({tokens:e,depth:t}){return\`<h\${t}>\${this.parser.parseInline(e)}</h\${t}>
\`}hr(e){return\`<hr>
\`}list(e){let t=e.ordered,n=e.start,r="";for(let i=0;i<e.items.length;i++){let l=e.items[i];r+=this.listitem(l)}let s=t?"ol":"ul",a=t&&n!==1?' start="'+n+'"':"";return"<"+s+a+\`>
\`+r+"</"+s+\`>
\`}listitem(e){return\`<li>\${this.parser.parse(e.tokens)}</li>
\`}checkbox({checked:e}){return"<input "+(e?'checked="" ':"")+'disabled="" type="checkbox"> '}paragraph({tokens:e}){return\`<p>\${this.parser.parseInline(e)}</p>
\`}table(e){let t="",n="";for(let s=0;s<e.header.length;s++)n+=this.tablecell(e.header[s]);t+=this.tablerow({text:n});let r="";for(let s=0;s<e.rows.length;s++){let a=e.rows[s];n="";for(let i=0;i<a.length;i++)n+=this.tablecell(a[i]);r+=this.tablerow({text:n})}return r&&(r=\`<tbody>\${r}</tbody>\`),\`<table>
<thead>
\`+t+\`</thead>
\`+r+\`</table>
\`}tablerow({text:e}){return\`<tr>
\${e}</tr>
\`}tablecell(e){let t=this.parser.parseInline(e.tokens),n=e.header?"th":"td";return(e.align?\`<\${n} align="\${e.align}">\`:\`<\${n}>\`)+t+\`</\${n}>
\`}strong({tokens:e}){return\`<strong>\${this.parser.parseInline(e)}</strong>\`}em({tokens:e}){return\`<em>\${this.parser.parseInline(e)}</em>\`}codespan({text:e}){return\`<code>\${te(e,!0)}</code>\`}br(e){return"<br>"}del({tokens:e}){return\`<del>\${this.parser.parseInline(e)}</del>\`}link({href:e,title:t,tokens:n}){let r=this.parser.parseInline(n),s=nn(e);if(s===null)return r;e=s;let a='<a href="'+e+'"';return t&&(a+=' title="'+te(t)+'"'),a+=">"+r+"</a>",a}image({href:e,title:t,text:n,tokens:r}){r&&(n=this.parser.parseInline(r,this.parser.textRenderer));let s=nn(e);if(s===null)return te(n);e=s;let a=\`<img src="\${e}" alt="\${te(n)}"\`;return t&&(a+=\` title="\${te(t)}"\`),a+=">",a}text(e){return"tokens"in e&&e.tokens?this.parser.parseInline(e.tokens):"escaped"in e&&e.escaped?e.text:te(e.text)}},ft=class{strong({text:e}){return e}em({text:e}){return e}codespan({text:e}){return e}del({text:e}){return e}html({text:e}){return e}text({text:e}){return e}link({text:e}){return""+e}image({text:e}){return""+e}br(){return""}checkbox({raw:e}){return e}},Y=class at{options;renderer;textRenderer;constructor(t){this.options=t||he,this.options.renderer=this.options.renderer||new qe,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new ft}static parse(t,n){return new at(n).parse(t)}static parseInline(t,n){return new at(n).parseInline(t)}parse(t){let n="";for(let r=0;r<t.length;r++){let s=t[r];if(this.options.extensions?.renderers?.[s.type]){let i=s,l=this.options.extensions.renderers[i.type].call({parser:this},i);if(l!==!1||!["space","hr","heading","code","table","blockquote","list","html","def","paragraph","text"].includes(i.type)){n+=l||"";continue}}let a=s;switch(a.type){case"space":{n+=this.renderer.space(a);break}case"hr":{n+=this.renderer.hr(a);break}case"heading":{n+=this.renderer.heading(a);break}case"code":{n+=this.renderer.code(a);break}case"table":{n+=this.renderer.table(a);break}case"blockquote":{n+=this.renderer.blockquote(a);break}case"list":{n+=this.renderer.list(a);break}case"checkbox":{n+=this.renderer.checkbox(a);break}case"html":{n+=this.renderer.html(a);break}case"def":{n+=this.renderer.def(a);break}case"paragraph":{n+=this.renderer.paragraph(a);break}case"text":{n+=this.renderer.text(a);break}default:{let i='Token with "'+a.type+'" type was not found.';if(this.options.silent)return console.error(i),"";throw new Error(i)}}}return n}parseInline(t,n=this.renderer){let r="";for(let s=0;s<t.length;s++){let a=t[s];if(this.options.extensions?.renderers?.[a.type]){let l=this.options.extensions.renderers[a.type].call({parser:this},a);if(l!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(a.type)){r+=l||"";continue}}let i=a;switch(i.type){case"escape":{r+=n.text(i);break}case"html":{r+=n.html(i);break}case"link":{r+=n.link(i);break}case"image":{r+=n.image(i);break}case"checkbox":{r+=n.checkbox(i);break}case"strong":{r+=n.strong(i);break}case"em":{r+=n.em(i);break}case"codespan":{r+=n.codespan(i);break}case"br":{r+=n.br(i);break}case"del":{r+=n.del(i);break}case"text":{r+=n.text(i);break}default:{let l='Token with "'+i.type+'" type was not found.';if(this.options.silent)return console.error(l),"";throw new Error(l)}}}return r}},Ce=class{options;block;constructor(e){this.options=e||he}static passThroughHooks=new Set(["preprocess","postprocess","processAllTokens","emStrongMask"]);static passThroughHooksRespectAsync=new Set(["preprocess","postprocess","processAllTokens"]);preprocess(e){return e}postprocess(e){return e}processAllTokens(e){return e}emStrongMask(e){return e}provideLexer(){return this.block?X.lex:X.lexInline}provideParser(){return this.block?Y.parse:Y.parseInline}},Er=class{defaults=ot();options=this.setOptions;parse=this.parseMarkdown(!0);parseInline=this.parseMarkdown(!1);Parser=Y;Renderer=qe;TextRenderer=ft;Lexer=X;Tokenizer=Ge;Hooks=Ce;constructor(...e){this.use(...e)}walkTokens(e,t){let n=[];for(let r of e)switch(n=n.concat(t.call(this,r)),r.type){case"table":{let s=r;for(let a of s.header)n=n.concat(this.walkTokens(a.tokens,t));for(let a of s.rows)for(let i of a)n=n.concat(this.walkTokens(i.tokens,t));break}case"list":{let s=r;n=n.concat(this.walkTokens(s.items,t));break}default:{let s=r;this.defaults.extensions?.childTokens?.[s.type]?this.defaults.extensions.childTokens[s.type].forEach(a=>{let i=s[a].flat(1/0);n=n.concat(this.walkTokens(i,t))}):s.tokens&&(n=n.concat(this.walkTokens(s.tokens,t)))}}return n}use(...e){let t=this.defaults.extensions||{renderers:{},childTokens:{}};return e.forEach(n=>{let r={...n};if(r.async=this.defaults.async||r.async||!1,n.extensions&&(n.extensions.forEach(s=>{if(!s.name)throw new Error("extension name required");if("renderer"in s){let a=t.renderers[s.name];a?t.renderers[s.name]=function(...i){let l=s.renderer.apply(this,i);return l===!1&&(l=a.apply(this,i)),l}:t.renderers[s.name]=s.renderer}if("tokenizer"in s){if(!s.level||s.level!=="block"&&s.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");let a=t[s.level];a?a.unshift(s.tokenizer):t[s.level]=[s.tokenizer],s.start&&(s.level==="block"?t.startBlock?t.startBlock.push(s.start):t.startBlock=[s.start]:s.level==="inline"&&(t.startInline?t.startInline.push(s.start):t.startInline=[s.start]))}"childTokens"in s&&s.childTokens&&(t.childTokens[s.name]=s.childTokens)}),r.extensions=t),n.renderer){let s=this.defaults.renderer||new qe(this.defaults);for(let a in n.renderer){if(!(a in s))throw new Error(\`renderer '\${a}' does not exist\`);if(["options","parser"].includes(a))continue;let i=a,l=n.renderer[i],o=s[i];s[i]=(...c)=>{let u=l.apply(s,c);return u===!1&&(u=o.apply(s,c)),u||""}}r.renderer=s}if(n.tokenizer){let s=this.defaults.tokenizer||new Ge(this.defaults);for(let a in n.tokenizer){if(!(a in s))throw new Error(\`tokenizer '\${a}' does not exist\`);if(["options","rules","lexer"].includes(a))continue;let i=a,l=n.tokenizer[i],o=s[i];s[i]=(...c)=>{let u=l.apply(s,c);return u===!1&&(u=o.apply(s,c)),u}}r.tokenizer=s}if(n.hooks){let s=this.defaults.hooks||new Ce;for(let a in n.hooks){if(!(a in s))throw new Error(\`hook '\${a}' does not exist\`);if(["options","block"].includes(a))continue;let i=a,l=n.hooks[i],o=s[i];Ce.passThroughHooks.has(a)?s[i]=c=>{if(this.defaults.async&&Ce.passThroughHooksRespectAsync.has(a))return(async()=>{let h=await l.call(s,c);return o.call(s,h)})();let u=l.call(s,c);return o.call(s,u)}:s[i]=(...c)=>{if(this.defaults.async)return(async()=>{let h=await l.apply(s,c);return h===!1&&(h=await o.apply(s,c)),h})();let u=l.apply(s,c);return u===!1&&(u=o.apply(s,c)),u}}r.hooks=s}if(n.walkTokens){let s=this.defaults.walkTokens,a=n.walkTokens;r.walkTokens=function(i){let l=[];return l.push(a.call(this,i)),s&&(l=l.concat(s.call(this,i))),l}}this.defaults={...this.defaults,...r}}),this}setOptions(e){return this.defaults={...this.defaults,...e},this}lexer(e,t){return X.lex(e,t??this.defaults)}parser(e,t){return Y.parse(e,t??this.defaults)}parseMarkdown(e){return(t,n)=>{let r={...n},s={...this.defaults,...r},a=this.onError(!!s.silent,!!s.async);if(this.defaults.async===!0&&r.async===!1)return a(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof t>"u"||t===null)return a(new Error("marked(): input parameter is undefined or null"));if(typeof t!="string")return a(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(t)+", string expected"));if(s.hooks&&(s.hooks.options=s,s.hooks.block=e),s.async)return(async()=>{let i=s.hooks?await s.hooks.preprocess(t):t,l=await(s.hooks?await s.hooks.provideLexer():e?X.lex:X.lexInline)(i,s),o=s.hooks?await s.hooks.processAllTokens(l):l;s.walkTokens&&await Promise.all(this.walkTokens(o,s.walkTokens));let c=await(s.hooks?await s.hooks.provideParser():e?Y.parse:Y.parseInline)(o,s);return s.hooks?await s.hooks.postprocess(c):c})().catch(a);try{s.hooks&&(t=s.hooks.preprocess(t));let i=(s.hooks?s.hooks.provideLexer():e?X.lex:X.lexInline)(t,s);s.hooks&&(i=s.hooks.processAllTokens(i)),s.walkTokens&&this.walkTokens(i,s.walkTokens);let l=(s.hooks?s.hooks.provideParser():e?Y.parse:Y.parseInline)(i,s);return s.hooks&&(l=s.hooks.postprocess(l)),l}catch(i){return a(i)}}}onError(e,t){return n=>{if(n.message+=\`
Please report this to https://github.com/markedjs/marked.\`,e){let r="<p>An error occurred:</p><pre>"+te(n.message+"",!0)+"</pre>";return t?Promise.resolve(r):r}if(t)return Promise.reject(n);throw n}}},ge=new Er;function T(e,t){return ge.parse(e,t)}T.options=T.setOptions=function(e){return ge.setOptions(e),T.defaults=ge.defaults,an(T.defaults),T};T.getDefaults=ot;T.defaults=he;T.use=function(...e){return ge.use(...e),T.defaults=ge.defaults,an(T.defaults),T};T.walkTokens=function(e,t){return ge.walkTokens(e,t)};T.parseInline=ge.parseInline;T.Parser=Y;T.parser=Y.parse;T.Renderer=qe;T.TextRenderer=ft;T.Lexer=X;T.lexer=X.lex;T.Tokenizer=Ge;T.Hooks=Ce;T.parse=T;var Xi=T.options,Yi=T.setOptions,Qi=T.use,Vi=T.walkTokens,Ji=T.parseInline;var ea=Y.parse,ta=X.lex;var Pn=Is($n(),1);var B=Pn.default;var zn="[A-Za-z$_][0-9A-Za-z$_]*",ui=["as","in","of","if","for","while","finally","var","new","function","do","return","void","else","break","catch","instanceof","with","throw","case","default","try","switch","continue","typeof","delete","let","yield","const","class","debugger","async","await","static","import","from","export","extends","using"],di=["true","false","null","undefined","NaN","Infinity"],Un=["Object","Function","Boolean","Symbol","Math","Date","Number","BigInt","String","RegExp","Array","Float32Array","Float64Array","Int8Array","Uint8Array","Uint8ClampedArray","Int16Array","Int32Array","Uint16Array","Uint32Array","BigInt64Array","BigUint64Array","Set","Map","WeakSet","WeakMap","ArrayBuffer","SharedArrayBuffer","Atomics","DataView","JSON","Promise","Generator","GeneratorFunction","AsyncFunction","Reflect","Proxy","Intl","WebAssembly"],Hn=["Error","EvalError","InternalError","RangeError","ReferenceError","SyntaxError","TypeError","URIError"],Fn=["setInterval","setTimeout","clearInterval","clearTimeout","require","exports","eval","isFinite","isNaN","parseFloat","parseInt","decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape","unescape"],pi=["arguments","this","super","console","window","document","localStorage","sessionStorage","module","global"],gi=[].concat(Fn,Un,Hn);function St(e){let t=e.regex,n=(f,{after:w})=>{let v="</"+f[0].slice(1);return f.input.indexOf(v,w)!==-1},r=zn,s={begin:"<>",end:"</>"},a=/<[A-Za-z0-9\\\\._:-]+\\s*\\/>/,i={begin:/<[A-Za-z0-9\\\\._:-]+/,end:/\\/[A-Za-z0-9\\\\._:-]+>|\\/>/,isTrulyOpeningTag:(f,w)=>{let v=f[0].length+f.index,I=f.input[v];if(I==="<"||I===","){w.ignoreMatch();return}I===">"&&(n(f,{after:v})||w.ignoreMatch());let U,V=f.input.substring(v);if(U=V.match(/^\\s*=/)){w.ignoreMatch();return}if((U=V.match(/^\\s+extends\\s+/))&&U.index===0){w.ignoreMatch();return}}},l={$pattern:zn,keyword:ui,literal:di,built_in:gi,"variable.language":pi},o="[0-9](_?[0-9])*",c=\`\\\\.(\${o})\`,u="0|[1-9](_?[0-9])*|0[0-7]*[89][0-9]*",h={className:"number",variants:[{begin:\`(\\\\b(\${u})((\${c})|\\\\.)?|(\${c}))[eE][+-]?(\${o})\\\\b\`},{begin:\`\\\\b(\${u})\\\\b((\${c})\\\\b|\\\\.)?|(\${c})\\\\b\`},{begin:"\\\\b(0|[1-9](_?[0-9])*)n\\\\b"},{begin:"\\\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*n?\\\\b"},{begin:"\\\\b0[bB][0-1](_?[0-1])*n?\\\\b"},{begin:"\\\\b0[oO][0-7](_?[0-7])*n?\\\\b"},{begin:"\\\\b0[0-7]+n?\\\\b"}],relevance:0},p={className:"subst",begin:"\\\\$\\\\{",end:"\\\\}",keywords:l,contains:[]},E={begin:".?html\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,p],subLanguage:"xml"}},m={begin:".?css\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,p],subLanguage:"css"}},y={begin:".?gql\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,p],subLanguage:"graphql"}},O={className:"string",begin:"\`",end:"\`",contains:[e.BACKSLASH_ESCAPE,p]},M={className:"comment",variants:[e.COMMENT(/\\/\\*\\*(?!\\/)/,"\\\\*/",{relevance:0,contains:[{begin:"(?=@[A-Za-z]+)",relevance:0,contains:[{className:"doctag",begin:"@[A-Za-z]+"},{className:"type",begin:"\\\\{",end:"\\\\}",excludeEnd:!0,excludeBegin:!0,relevance:0},{className:"variable",begin:r+"(?=\\\\s*(-)|$)",endsParent:!0,relevance:0},{begin:/(?=[^\\n])\\s/,relevance:0}]}]}),e.C_BLOCK_COMMENT_MODE,e.C_LINE_COMMENT_MODE]},$=[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,E,m,y,O,{match:/\\$\\d+/},h];p.contains=$.concat({begin:/\\{/,end:/\\}/,keywords:l,contains:["self"].concat($)});let P=[].concat(M,p.contains),C=P.concat([{begin:/(\\s*)\\(/,end:/\\)/,keywords:l,contains:["self"].concat(P)}]),N={className:"params",begin:/(\\s*)\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:C},ce={variants:[{match:[/class/,/\\s+/,r,/\\s+/,/extends/,/\\s+/,t.concat(r,"(",t.concat(/\\./,r),")*")],scope:{1:"keyword",3:"title.class",5:"keyword",7:"title.class.inherited"}},{match:[/class/,/\\s+/,r],scope:{1:"keyword",3:"title.class"}}]},z={relevance:0,match:t.either(/\\bJSON/,/\\b[A-Z][a-z]+([A-Z][a-z]*|\\d)*/,/\\b[A-Z]{2,}([A-Z][a-z]+|\\d)+([A-Z][a-z]*)*/,/\\b[A-Z]{2,}[a-z]+([A-Z][a-z]+|\\d)*([A-Z][a-z]*)*/),className:"title.class",keywords:{_:[...Un,...Hn]}},Z={label:"use_strict",className:"meta",relevance:10,begin:/^\\s*['"]use (strict|asm)['"]/},ke={variants:[{match:[/function/,/\\s+/,r,/(?=\\s*\\()/]},{match:[/function/,/\\s*(?=\\()/]}],className:{1:"keyword",3:"title.function"},label:"func.def",contains:[N],illegal:/%/},Se={relevance:0,match:/\\b[A-Z][A-Z_0-9]+\\b/,className:"variable.constant"};function ve(f){return t.concat("(?!",f.join("|"),")")}let Te={match:t.concat(/\\b/,ve([...Fn,"super","import"].map(f=>\`\${f}\\\\s*\\\\(\`)),r,t.lookahead(/\\s*\\(/)),className:"title.function",relevance:0},re={begin:t.concat(/\\./,t.lookahead(t.concat(r,/(?![0-9A-Za-z$_(])/))),end:r,excludeBegin:!0,keywords:"prototype",className:"property",relevance:0},Ae={match:[/get|set/,/\\s+/,r,/(?=\\()/],className:{1:"keyword",3:"title.function"},contains:[{begin:/\\(\\)/},N]},d="(\\\\([^()]*(\\\\([^()]*(\\\\([^()]*\\\\)[^()]*)*\\\\)[^()]*)*\\\\)|"+e.UNDERSCORE_IDENT_RE+")\\\\s*=>",b={match:[/const|var|let/,/\\s+/,r,/\\s*/,/=\\s*/,/(async\\s*)?/,t.lookahead(d)],keywords:"async",className:{1:"keyword",3:"title.function"},contains:[N]};return{name:"JavaScript",aliases:["js","jsx","mjs","cjs"],keywords:l,exports:{PARAMS_CONTAINS:C,CLASS_REFERENCE:z},illegal:/#(?![$_A-z])/,contains:[e.SHEBANG({label:"shebang",binary:"node",relevance:5}),Z,e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,E,m,y,O,M,{match:/\\$\\d+/},h,z,{scope:"attr",match:r+t.lookahead(":"),relevance:0},b,{begin:"("+e.RE_STARTERS_RE+"|\\\\b(case|return|throw)\\\\b)\\\\s*",keywords:"return throw case",relevance:0,contains:[M,e.REGEXP_MODE,{className:"function",begin:d,returnBegin:!0,end:"\\\\s*=>",contains:[{className:"params",variants:[{begin:e.UNDERSCORE_IDENT_RE,relevance:0},{className:null,begin:/\\(\\s*\\)/,skip:!0},{begin:/(\\s*)\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:C}]}]},{begin:/,/,relevance:0},{match:/\\s+/,relevance:0},{variants:[{begin:s.begin,end:s.end},{match:a},{begin:i.begin,"on:begin":i.isTrulyOpeningTag,end:i.end}],subLanguage:"xml",contains:[{begin:i.begin,end:i.end,skip:!0,contains:["self"]}]}]},ke,{beginKeywords:"while if switch catch for"},{begin:"\\\\b(?!function)"+e.UNDERSCORE_IDENT_RE+"\\\\([^()]*(\\\\([^()]*(\\\\([^()]*\\\\)[^()]*)*\\\\)[^()]*)*\\\\)\\\\s*\\\\{",returnBegin:!0,label:"func.def",contains:[N,e.inherit(e.TITLE_MODE,{begin:r,className:"title.function"})]},{match:/\\.\\.\\./,relevance:0},re,{match:"\\\\$"+r,relevance:0},{match:[/\\bconstructor(?=\\s*\\()/],className:{1:"title.function"},contains:[N]},Te,Se,ce,Ae,{match:/\\$[(.]/}]}}var Qe="[A-Za-z$_][0-9A-Za-z$_]*",Gn=["as","in","of","if","for","while","finally","var","new","function","do","return","void","else","break","catch","instanceof","with","throw","case","default","try","switch","continue","typeof","delete","let","yield","const","class","debugger","async","await","static","import","from","export","extends","using"],qn=["true","false","null","undefined","NaN","Infinity"],Zn=["Object","Function","Boolean","Symbol","Math","Date","Number","BigInt","String","RegExp","Array","Float32Array","Float64Array","Int8Array","Uint8Array","Uint8ClampedArray","Int16Array","Int32Array","Uint16Array","Uint32Array","BigInt64Array","BigUint64Array","Set","Map","WeakSet","WeakMap","ArrayBuffer","SharedArrayBuffer","Atomics","DataView","JSON","Promise","Generator","GeneratorFunction","AsyncFunction","Reflect","Proxy","Intl","WebAssembly"],Kn=["Error","EvalError","InternalError","RangeError","ReferenceError","SyntaxError","TypeError","URIError"],Wn=["setInterval","setTimeout","clearInterval","clearTimeout","require","exports","eval","isFinite","isNaN","parseFloat","parseInt","decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape","unescape"],jn=["arguments","this","super","console","window","document","localStorage","sessionStorage","module","global"],Xn=[].concat(Wn,Zn,Kn);function hi(e){let t=e.regex,n=(f,{after:w})=>{let v="</"+f[0].slice(1);return f.input.indexOf(v,w)!==-1},r=Qe,s={begin:"<>",end:"</>"},a=/<[A-Za-z0-9\\\\._:-]+\\s*\\/>/,i={begin:/<[A-Za-z0-9\\\\._:-]+/,end:/\\/[A-Za-z0-9\\\\._:-]+>|\\/>/,isTrulyOpeningTag:(f,w)=>{let v=f[0].length+f.index,I=f.input[v];if(I==="<"||I===","){w.ignoreMatch();return}I===">"&&(n(f,{after:v})||w.ignoreMatch());let U,V=f.input.substring(v);if(U=V.match(/^\\s*=/)){w.ignoreMatch();return}if((U=V.match(/^\\s+extends\\s+/))&&U.index===0){w.ignoreMatch();return}}},l={$pattern:Qe,keyword:Gn,literal:qn,built_in:Xn,"variable.language":jn},o="[0-9](_?[0-9])*",c=\`\\\\.(\${o})\`,u="0|[1-9](_?[0-9])*|0[0-7]*[89][0-9]*",h={className:"number",variants:[{begin:\`(\\\\b(\${u})((\${c})|\\\\.)?|(\${c}))[eE][+-]?(\${o})\\\\b\`},{begin:\`\\\\b(\${u})\\\\b((\${c})\\\\b|\\\\.)?|(\${c})\\\\b\`},{begin:"\\\\b(0|[1-9](_?[0-9])*)n\\\\b"},{begin:"\\\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*n?\\\\b"},{begin:"\\\\b0[bB][0-1](_?[0-1])*n?\\\\b"},{begin:"\\\\b0[oO][0-7](_?[0-7])*n?\\\\b"},{begin:"\\\\b0[0-7]+n?\\\\b"}],relevance:0},p={className:"subst",begin:"\\\\$\\\\{",end:"\\\\}",keywords:l,contains:[]},E={begin:".?html\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,p],subLanguage:"xml"}},m={begin:".?css\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,p],subLanguage:"css"}},y={begin:".?gql\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,p],subLanguage:"graphql"}},O={className:"string",begin:"\`",end:"\`",contains:[e.BACKSLASH_ESCAPE,p]},M={className:"comment",variants:[e.COMMENT(/\\/\\*\\*(?!\\/)/,"\\\\*/",{relevance:0,contains:[{begin:"(?=@[A-Za-z]+)",relevance:0,contains:[{className:"doctag",begin:"@[A-Za-z]+"},{className:"type",begin:"\\\\{",end:"\\\\}",excludeEnd:!0,excludeBegin:!0,relevance:0},{className:"variable",begin:r+"(?=\\\\s*(-)|$)",endsParent:!0,relevance:0},{begin:/(?=[^\\n])\\s/,relevance:0}]}]}),e.C_BLOCK_COMMENT_MODE,e.C_LINE_COMMENT_MODE]},$=[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,E,m,y,O,{match:/\\$\\d+/},h];p.contains=$.concat({begin:/\\{/,end:/\\}/,keywords:l,contains:["self"].concat($)});let P=[].concat(M,p.contains),C=P.concat([{begin:/(\\s*)\\(/,end:/\\)/,keywords:l,contains:["self"].concat(P)}]),N={className:"params",begin:/(\\s*)\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:C},ce={variants:[{match:[/class/,/\\s+/,r,/\\s+/,/extends/,/\\s+/,t.concat(r,"(",t.concat(/\\./,r),")*")],scope:{1:"keyword",3:"title.class",5:"keyword",7:"title.class.inherited"}},{match:[/class/,/\\s+/,r],scope:{1:"keyword",3:"title.class"}}]},z={relevance:0,match:t.either(/\\bJSON/,/\\b[A-Z][a-z]+([A-Z][a-z]*|\\d)*/,/\\b[A-Z]{2,}([A-Z][a-z]+|\\d)+([A-Z][a-z]*)*/,/\\b[A-Z]{2,}[a-z]+([A-Z][a-z]+|\\d)*([A-Z][a-z]*)*/),className:"title.class",keywords:{_:[...Zn,...Kn]}},Z={label:"use_strict",className:"meta",relevance:10,begin:/^\\s*['"]use (strict|asm)['"]/},ke={variants:[{match:[/function/,/\\s+/,r,/(?=\\s*\\()/]},{match:[/function/,/\\s*(?=\\()/]}],className:{1:"keyword",3:"title.function"},label:"func.def",contains:[N],illegal:/%/},Se={relevance:0,match:/\\b[A-Z][A-Z_0-9]+\\b/,className:"variable.constant"};function ve(f){return t.concat("(?!",f.join("|"),")")}let Te={match:t.concat(/\\b/,ve([...Wn,"super","import"].map(f=>\`\${f}\\\\s*\\\\(\`)),r,t.lookahead(/\\s*\\(/)),className:"title.function",relevance:0},re={begin:t.concat(/\\./,t.lookahead(t.concat(r,/(?![0-9A-Za-z$_(])/))),end:r,excludeBegin:!0,keywords:"prototype",className:"property",relevance:0},Ae={match:[/get|set/,/\\s+/,r,/(?=\\()/],className:{1:"keyword",3:"title.function"},contains:[{begin:/\\(\\)/},N]},d="(\\\\([^()]*(\\\\([^()]*(\\\\([^()]*\\\\)[^()]*)*\\\\)[^()]*)*\\\\)|"+e.UNDERSCORE_IDENT_RE+")\\\\s*=>",b={match:[/const|var|let/,/\\s+/,r,/\\s*/,/=\\s*/,/(async\\s*)?/,t.lookahead(d)],keywords:"async",className:{1:"keyword",3:"title.function"},contains:[N]};return{name:"JavaScript",aliases:["js","jsx","mjs","cjs"],keywords:l,exports:{PARAMS_CONTAINS:C,CLASS_REFERENCE:z},illegal:/#(?![$_A-z])/,contains:[e.SHEBANG({label:"shebang",binary:"node",relevance:5}),Z,e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,E,m,y,O,M,{match:/\\$\\d+/},h,z,{scope:"attr",match:r+t.lookahead(":"),relevance:0},b,{begin:"("+e.RE_STARTERS_RE+"|\\\\b(case|return|throw)\\\\b)\\\\s*",keywords:"return throw case",relevance:0,contains:[M,e.REGEXP_MODE,{className:"function",begin:d,returnBegin:!0,end:"\\\\s*=>",contains:[{className:"params",variants:[{begin:e.UNDERSCORE_IDENT_RE,relevance:0},{className:null,begin:/\\(\\s*\\)/,skip:!0},{begin:/(\\s*)\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:C}]}]},{begin:/,/,relevance:0},{match:/\\s+/,relevance:0},{variants:[{begin:s.begin,end:s.end},{match:a},{begin:i.begin,"on:begin":i.isTrulyOpeningTag,end:i.end}],subLanguage:"xml",contains:[{begin:i.begin,end:i.end,skip:!0,contains:["self"]}]}]},ke,{beginKeywords:"while if switch catch for"},{begin:"\\\\b(?!function)"+e.UNDERSCORE_IDENT_RE+"\\\\([^()]*(\\\\([^()]*(\\\\([^()]*\\\\)[^()]*)*\\\\)[^()]*)*\\\\)\\\\s*\\\\{",returnBegin:!0,label:"func.def",contains:[N,e.inherit(e.TITLE_MODE,{begin:r,className:"title.function"})]},{match:/\\.\\.\\./,relevance:0},re,{match:"\\\\$"+r,relevance:0},{match:[/\\bconstructor(?=\\s*\\()/],className:{1:"title.function"},contains:[N]},Te,Se,ce,Ae,{match:/\\$[(.]/}]}}function vt(e){let t=e.regex,n=hi(e),r=Qe,s=["any","void","number","boolean","string","object","never","symbol","bigint","unknown"],a={begin:[/namespace/,/\\s+/,e.IDENT_RE],beginScope:{1:"keyword",3:"title.class"}},i={beginKeywords:"interface",end:/\\{/,excludeEnd:!0,keywords:{keyword:"interface extends",built_in:s},contains:[n.exports.CLASS_REFERENCE]},l={className:"meta",relevance:10,begin:/^\\s*['"]use strict['"]/},o=["type","interface","public","private","protected","implements","declare","abstract","readonly","enum","override","satisfies"],c={$pattern:Qe,keyword:Gn.concat(o),literal:qn,built_in:Xn.concat(s),"variable.language":jn},u={className:"meta",begin:"@"+r},h=(y,O,L)=>{let M=y.contains.findIndex($=>$.label===O);if(M===-1)throw new Error("can not find mode to replace");y.contains.splice(M,1,L)};Object.assign(n.keywords,c),n.exports.PARAMS_CONTAINS.push(u);let p=n.contains.find(y=>y.scope==="attr"),E=Object.assign({},p,{match:t.concat(r,t.lookahead(/\\s*\\?:/))});n.exports.PARAMS_CONTAINS.push([n.exports.CLASS_REFERENCE,p,E]),n.contains=n.contains.concat([u,a,i,E]),h(n,"shebang",e.SHEBANG()),h(n,"use_strict",l);let m=n.contains.find(y=>y.label==="func.def");return m.relevance=0,Object.assign(n,{name:"TypeScript",aliases:["ts","tsx","mts","cts"]}),n}function Tt(e){let t=e.regex,n=/[\\p{XID_Start}_]\\p{XID_Continue}*/u,r=["and","as","assert","async","await","break","case","class","continue","def","del","elif","else","except","finally","for","from","global","if","import","in","is","lambda","match","nonlocal|10","not","or","pass","raise","return","try","while","with","yield"],l={$pattern:/[A-Za-z]\\w+|__\\w+__/,keyword:r,built_in:["__import__","abs","all","any","ascii","bin","bool","breakpoint","bytearray","bytes","callable","chr","classmethod","compile","complex","delattr","dict","dir","divmod","enumerate","eval","exec","filter","float","format","frozenset","getattr","globals","hasattr","hash","help","hex","id","input","int","isinstance","issubclass","iter","len","list","locals","map","max","memoryview","min","next","object","oct","open","ord","pow","print","property","range","repr","reversed","round","set","setattr","slice","sorted","staticmethod","str","sum","super","tuple","type","vars","zip"],literal:["__debug__","Ellipsis","False","None","NotImplemented","True"],type:["Any","Callable","Coroutine","Dict","List","Literal","Generic","Optional","Sequence","Set","Tuple","Type","Union"]},o={className:"meta",begin:/^(>>>|\\.\\.\\.) /},c={className:"subst",begin:/\\{/,end:/\\}/,keywords:l,illegal:/#/},u={begin:/\\{\\{/,relevance:0},h={className:"string",contains:[e.BACKSLASH_ESCAPE],variants:[{begin:/([uU]|[bB]|[rR]|[bB][rR]|[rR][bB])?'''/,end:/'''/,contains:[e.BACKSLASH_ESCAPE,o],relevance:10},{begin:/([uU]|[bB]|[rR]|[bB][rR]|[rR][bB])?"""/,end:/"""/,contains:[e.BACKSLASH_ESCAPE,o],relevance:10},{begin:/([fF][rR]|[rR][fF]|[fF])'''/,end:/'''/,contains:[e.BACKSLASH_ESCAPE,o,u,c]},{begin:/([fF][rR]|[rR][fF]|[fF])"""/,end:/"""/,contains:[e.BACKSLASH_ESCAPE,o,u,c]},{begin:/([uU]|[rR])'/,end:/'/,relevance:10},{begin:/([uU]|[rR])"/,end:/"/,relevance:10},{begin:/([bB]|[bB][rR]|[rR][bB])'/,end:/'/},{begin:/([bB]|[bB][rR]|[rR][bB])"/,end:/"/},{begin:/([fF][rR]|[rR][fF]|[fF])'/,end:/'/,contains:[e.BACKSLASH_ESCAPE,u,c]},{begin:/([fF][rR]|[rR][fF]|[fF])"/,end:/"/,contains:[e.BACKSLASH_ESCAPE,u,c]},e.APOS_STRING_MODE,e.QUOTE_STRING_MODE]},p="[0-9](_?[0-9])*",E=\`(\\\\b(\${p}))?\\\\.(\${p})|\\\\b(\${p})\\\\.\`,m=\`\\\\b|\${r.join("|")}\`,y={className:"number",relevance:0,variants:[{begin:\`(\\\\b(\${p})|(\${E}))[eE][+-]?(\${p})[jJ]?(?=\${m})\`},{begin:\`(\${E})[jJ]?\`},{begin:\`\\\\b([1-9](_?[0-9])*|0+(_?0)*)[lLjJ]?(?=\${m})\`},{begin:\`\\\\b0[bB](_?[01])+[lL]?(?=\${m})\`},{begin:\`\\\\b0[oO](_?[0-7])+[lL]?(?=\${m})\`},{begin:\`\\\\b0[xX](_?[0-9a-fA-F])+[lL]?(?=\${m})\`},{begin:\`\\\\b(\${p})[jJ](?=\${m})\`}]},O={className:"comment",begin:t.lookahead(/# type:/),end:/$/,keywords:l,contains:[{begin:/# type:/},{begin:/#/,end:/\\b\\B/,endsWithParent:!0}]},L={className:"params",variants:[{className:"",begin:/\\(\\s*\\)/,skip:!0},{begin:/\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:["self",o,y,h,e.HASH_COMMENT_MODE]}]};return c.contains=[h,y,o],{name:"Python",aliases:["py","gyp","ipython"],unicodeRegex:!0,keywords:l,illegal:/(<\\/|\\?)|=>/,contains:[o,y,{scope:"variable.language",match:/\\bself\\b/},{beginKeywords:"if",relevance:0},{match:/\\bor\\b/,scope:"keyword"},h,O,e.HASH_COMMENT_MODE,{match:[/\\bdef/,/\\s+/,n],scope:{1:"keyword",3:"title.function"},contains:[L]},{variants:[{match:[/\\bclass/,/\\s+/,n,/\\s*/,/\\(\\s*/,n,/\\s*\\)/]},{match:[/\\bclass/,/\\s+/,n]}],scope:{1:"keyword",3:"title.class",6:"title.class.inherited"}},{className:"meta",begin:/^[\\t ]*@/,end:/(?=#)|$/,contains:[y,L,h]}]}}function At(e){let t=e.regex,n={},r={begin:/\\$\\{/,end:/\\}/,contains:["self",{begin:/:-/,contains:[n]}]};Object.assign(n,{className:"variable",variants:[{begin:t.concat(/\\$[\\w\\d#@][\\w\\d_]*/,"(?![\\\\w\\\\d])(?![$])")},r]});let s={className:"subst",begin:/\\$\\(/,end:/\\)/,contains:[e.BACKSLASH_ESCAPE]},a=e.inherit(e.COMMENT(),{match:[/(^|\\s)/,/#.*$/],scope:{2:"comment"}}),i={begin:/<<-?\\s*(?=\\w+)/,starts:{contains:[e.END_SAME_AS_BEGIN({begin:/(\\w+)/,end:/(\\w+)/,className:"string"})]}},l={className:"string",begin:/"/,end:/"/,contains:[e.BACKSLASH_ESCAPE,n,s]};s.contains.push(l);let o={match:/\\\\"/},c={className:"string",begin:/'/,end:/'/},u={match:/\\\\'/},h={begin:/\\$?\\(\\(/,end:/\\)\\)/,contains:[{begin:/\\d+#[0-9a-f]+/,className:"number"},e.NUMBER_MODE,n]},p=["fish","bash","zsh","sh","csh","ksh","tcsh","dash","scsh"],E=e.SHEBANG({binary:\`(\${p.join("|")})\`,relevance:10}),m={className:"function",begin:/\\w[\\w\\d_]*\\s*\\(\\s*\\)\\s*\\{/,returnBegin:!0,contains:[e.inherit(e.TITLE_MODE,{begin:/\\w[\\w\\d_]*/})],relevance:0},y=["if","then","else","elif","fi","time","for","while","until","in","do","done","case","esac","coproc","function","select"],O=["true","false"],L={match:/(\\/[a-z._-]+)+/},M=["break","cd","continue","eval","exec","exit","export","getopts","hash","pwd","readonly","return","shift","test","times","trap","umask","unset"],$=["alias","bind","builtin","caller","command","declare","echo","enable","help","let","local","logout","mapfile","printf","read","readarray","source","sudo","type","typeset","ulimit","unalias"],P=["autoload","bg","bindkey","bye","cap","chdir","clone","comparguments","compcall","compctl","compdescribe","compfiles","compgroups","compquote","comptags","comptry","compvalues","dirs","disable","disown","echotc","echoti","emulate","fc","fg","float","functions","getcap","getln","history","integer","jobs","kill","limit","log","noglob","popd","print","pushd","pushln","rehash","sched","setcap","setopt","stat","suspend","ttyctl","unfunction","unhash","unlimit","unsetopt","vared","wait","whence","where","which","zcompile","zformat","zftp","zle","zmodload","zparseopts","zprof","zpty","zregexparse","zsocket","zstyle","ztcp"],C=["chcon","chgrp","chown","chmod","cp","dd","df","dir","dircolors","ln","ls","mkdir","mkfifo","mknod","mktemp","mv","realpath","rm","rmdir","shred","sync","touch","truncate","vdir","b2sum","base32","base64","cat","cksum","comm","csplit","cut","expand","fmt","fold","head","join","md5sum","nl","numfmt","od","paste","ptx","pr","sha1sum","sha224sum","sha256sum","sha384sum","sha512sum","shuf","sort","split","sum","tac","tail","tr","tsort","unexpand","uniq","wc","arch","basename","chroot","date","dirname","du","echo","env","expr","factor","groups","hostid","id","link","logname","nice","nohup","nproc","pathchk","pinky","printenv","printf","pwd","readlink","runcon","seq","sleep","stat","stdbuf","stty","tee","test","timeout","tty","uname","unlink","uptime","users","who","whoami","yes"];return{name:"Bash",aliases:["sh","zsh"],keywords:{$pattern:/\\b[a-z][a-z0-9._-]+\\b/,keyword:y,literal:O,built_in:[...M,...$,"set","shopt",...P,...C]},contains:[E,e.SHEBANG(),m,h,a,i,L,l,o,c,u,n]}}function Yn(e){let t={className:"attr",begin:/"(\\\\.|[^\\\\"\\r\\n])*"(?=\\s*:)/,relevance:1.01},n={match:/[{}[\\],:]/,className:"punctuation",relevance:0},r=["true","false","null"],s={scope:"literal",beginKeywords:r.join(" ")};return{name:"JSON",aliases:["jsonc"],keywords:{literal:r},contains:[t,n,e.QUOTE_STRING_MODE,s,e.C_NUMBER_MODE,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE],illegal:"\\\\S"}}function Rt(e){let t=e.regex,n=t.concat(/[\\p{L}_]/u,t.optional(/[\\p{L}0-9_.-]*:/u),/[\\p{L}0-9_.-]*/u),r=/[\\p{L}0-9._:-]+/u,s={className:"symbol",begin:/&[a-z]+;|&#[0-9]+;|&#x[a-f0-9]+;/},a={begin:/\\s/,contains:[{className:"keyword",begin:/#?[a-z_][a-z1-9_-]+/,illegal:/\\n/}]},i=e.inherit(a,{begin:/\\(/,end:/\\)/}),l=e.inherit(e.APOS_STRING_MODE,{className:"string"}),o=e.inherit(e.QUOTE_STRING_MODE,{className:"string"}),c={endsWithParent:!0,illegal:/</,relevance:0,contains:[{className:"attr",begin:r,relevance:0},{begin:/=\\s*/,relevance:0,contains:[{className:"string",endsParent:!0,variants:[{begin:/"/,end:/"/,contains:[s]},{begin:/'/,end:/'/,contains:[s]},{begin:/[^\\s"'=<>\`]+/}]}]}]};return{name:"HTML, XML",aliases:["html","xhtml","rss","atom","xjb","xsd","xsl","plist","wsf","svg"],case_insensitive:!0,unicodeRegex:!0,contains:[{className:"meta",begin:/<![a-z]/,end:/>/,relevance:10,contains:[a,o,l,i,{begin:/\\[/,end:/\\]/,contains:[{className:"meta",begin:/<![a-z]/,end:/>/,contains:[a,i,o,l]}]}]},e.COMMENT(/<!--/,/-->/,{relevance:10}),{begin:/<!\\[CDATA\\[/,end:/\\]\\]>/,relevance:10},s,{className:"meta",end:/\\?>/,variants:[{begin:/<\\?xml/,relevance:10,contains:[o]},{begin:/<\\?[a-z][a-z0-9]+/}]},{className:"tag",begin:/<style(?=\\s|>)/,end:/>/,keywords:{name:"style"},contains:[c],starts:{end:/<\\/style>/,returnEnd:!0,subLanguage:["css","xml"]}},{className:"tag",begin:/<script(?=\\s|>)/,end:/>/,keywords:{name:"script"},contains:[c],starts:{end:/<\\/script>/,returnEnd:!0,subLanguage:["javascript","handlebars","xml"]}},{className:"tag",begin:/<>|<\\/>/},{className:"tag",begin:t.concat(/</,t.lookahead(t.concat(n,t.either(/\\/>/,/>/,/\\s/)))),end:/\\/?>/,contains:[{className:"name",begin:n,relevance:0,starts:c}]},{className:"tag",begin:t.concat(/<\\//,t.lookahead(t.concat(n,/>/))),contains:[{className:"name",begin:n,relevance:0},{begin:/>/,relevance:0,endsParent:!0}]}]}}var fi=e=>({IMPORTANT:{scope:"meta",begin:"!important"},BLOCK_COMMENT:e.C_BLOCK_COMMENT_MODE,HEXCOLOR:{scope:"number",begin:/#(([0-9a-fA-F]{3,4})|(([0-9a-fA-F]{2}){3,4}))\\b/},FUNCTION_DISPATCH:{className:"built_in",begin:/[\\w-]+(?=\\()/},ATTRIBUTE_SELECTOR_MODE:{scope:"selector-attr",begin:/\\[/,end:/\\]/,illegal:"$",contains:[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE]},CSS_NUMBER_MODE:{scope:"number",begin:e.NUMBER_RE+"(%|em|ex|ch|rem|vw|vh|vmin|vmax|cm|mm|in|pt|pc|px|deg|grad|rad|turn|s|ms|Hz|kHz|dpi|dpcm|dppx)?",relevance:0},CSS_VARIABLE:{className:"attr",begin:/--[A-Za-z_][A-Za-z0-9_-]*/}}),bi=["a","abbr","address","article","aside","audio","b","blockquote","body","button","canvas","caption","cite","code","dd","del","details","dfn","div","dl","dt","em","fieldset","figcaption","figure","footer","form","h1","h2","h3","h4","h5","h6","header","hgroup","html","i","iframe","img","input","ins","kbd","label","legend","li","main","mark","menu","nav","object","ol","optgroup","option","p","picture","q","quote","samp","section","select","source","span","strong","summary","sup","table","tbody","td","textarea","tfoot","th","thead","time","tr","ul","var","video"],mi=["defs","g","marker","mask","pattern","svg","switch","symbol","feBlend","feColorMatrix","feComponentTransfer","feComposite","feConvolveMatrix","feDiffuseLighting","feDisplacementMap","feFlood","feGaussianBlur","feImage","feMerge","feMorphology","feOffset","feSpecularLighting","feTile","feTurbulence","linearGradient","radialGradient","stop","circle","ellipse","image","line","path","polygon","polyline","rect","text","use","textPath","tspan","foreignObject","clipPath"],ki=[...bi,...mi],xi=["any-hover","any-pointer","aspect-ratio","color","color-gamut","color-index","device-aspect-ratio","device-height","device-width","display-mode","forced-colors","grid","height","hover","inverted-colors","monochrome","orientation","overflow-block","overflow-inline","pointer","prefers-color-scheme","prefers-contrast","prefers-reduced-motion","prefers-reduced-transparency","resolution","scan","scripting","update","width","min-width","max-width","min-height","max-height"].sort().reverse(),Ei=["active","any-link","blank","checked","current","default","defined","dir","disabled","drop","empty","enabled","first","first-child","first-of-type","fullscreen","future","focus","focus-visible","focus-within","has","host","host-context","hover","indeterminate","in-range","invalid","is","lang","last-child","last-of-type","left","link","local-link","not","nth-child","nth-col","nth-last-child","nth-last-col","nth-last-of-type","nth-of-type","only-child","only-of-type","optional","out-of-range","past","placeholder-shown","read-only","read-write","required","right","root","scope","target","target-within","user-invalid","valid","visited","where"].sort().reverse(),yi=["after","backdrop","before","cue","cue-region","first-letter","first-line","grammar-error","marker","part","placeholder","selection","slotted","spelling-error"].sort().reverse(),wi=["accent-color","align-content","align-items","align-self","alignment-baseline","all","anchor-name","animation","animation-composition","animation-delay","animation-direction","animation-duration","animation-fill-mode","animation-iteration-count","animation-name","animation-play-state","animation-range","animation-range-end","animation-range-start","animation-timeline","animation-timing-function","appearance","aspect-ratio","backdrop-filter","backface-visibility","background","background-attachment","background-blend-mode","background-clip","background-color","background-image","background-origin","background-position","background-position-x","background-position-y","background-repeat","background-size","baseline-shift","block-size","border","border-block","border-block-color","border-block-end","border-block-end-color","border-block-end-style","border-block-end-width","border-block-start","border-block-start-color","border-block-start-style","border-block-start-width","border-block-style","border-block-width","border-bottom","border-bottom-color","border-bottom-left-radius","border-bottom-right-radius","border-bottom-style","border-bottom-width","border-collapse","border-color","border-end-end-radius","border-end-start-radius","border-image","border-image-outset","border-image-repeat","border-image-slice","border-image-source","border-image-width","border-inline","border-inline-color","border-inline-end","border-inline-end-color","border-inline-end-style","border-inline-end-width","border-inline-start","border-inline-start-color","border-inline-start-style","border-inline-start-width","border-inline-style","border-inline-width","border-left","border-left-color","border-left-style","border-left-width","border-radius","border-right","border-right-color","border-right-style","border-right-width","border-spacing","border-start-end-radius","border-start-start-radius","border-style","border-top","border-top-color","border-top-left-radius","border-top-right-radius","border-top-style","border-top-width","border-width","bottom","box-align","box-decoration-break","box-direction","box-flex","box-flex-group","box-lines","box-ordinal-group","box-orient","box-pack","box-shadow","box-sizing","break-after","break-before","break-inside","caption-side","caret-color","clear","clip","clip-path","clip-rule","color","color-interpolation","color-interpolation-filters","color-profile","color-rendering","color-scheme","column-count","column-fill","column-gap","column-rule","column-rule-color","column-rule-style","column-rule-width","column-span","column-width","columns","contain","contain-intrinsic-block-size","contain-intrinsic-height","contain-intrinsic-inline-size","contain-intrinsic-size","contain-intrinsic-width","container","container-name","container-type","content","content-visibility","counter-increment","counter-reset","counter-set","cue","cue-after","cue-before","cursor","cx","cy","direction","display","dominant-baseline","empty-cells","enable-background","field-sizing","fill","fill-opacity","fill-rule","filter","flex","flex-basis","flex-direction","flex-flow","flex-grow","flex-shrink","flex-wrap","float","flood-color","flood-opacity","flow","font","font-display","font-family","font-feature-settings","font-kerning","font-language-override","font-optical-sizing","font-palette","font-size","font-size-adjust","font-smooth","font-smoothing","font-stretch","font-style","font-synthesis","font-synthesis-position","font-synthesis-small-caps","font-synthesis-style","font-synthesis-weight","font-variant","font-variant-alternates","font-variant-caps","font-variant-east-asian","font-variant-emoji","font-variant-ligatures","font-variant-numeric","font-variant-position","font-variation-settings","font-weight","forced-color-adjust","gap","glyph-orientation-horizontal","glyph-orientation-vertical","grid","grid-area","grid-auto-columns","grid-auto-flow","grid-auto-rows","grid-column","grid-column-end","grid-column-start","grid-gap","grid-row","grid-row-end","grid-row-start","grid-template","grid-template-areas","grid-template-columns","grid-template-rows","hanging-punctuation","height","hyphenate-character","hyphenate-limit-chars","hyphens","icon","image-orientation","image-rendering","image-resolution","ime-mode","initial-letter","initial-letter-align","inline-size","inset","inset-area","inset-block","inset-block-end","inset-block-start","inset-inline","inset-inline-end","inset-inline-start","isolation","justify-content","justify-items","justify-self","kerning","left","letter-spacing","lighting-color","line-break","line-height","line-height-step","list-style","list-style-image","list-style-position","list-style-type","margin","margin-block","margin-block-end","margin-block-start","margin-bottom","margin-inline","margin-inline-end","margin-inline-start","margin-left","margin-right","margin-top","margin-trim","marker","marker-end","marker-mid","marker-start","marks","mask","mask-border","mask-border-mode","mask-border-outset","mask-border-repeat","mask-border-slice","mask-border-source","mask-border-width","mask-clip","mask-composite","mask-image","mask-mode","mask-origin","mask-position","mask-repeat","mask-size","mask-type","masonry-auto-flow","math-depth","math-shift","math-style","max-block-size","max-height","max-inline-size","max-width","min-block-size","min-height","min-inline-size","min-width","mix-blend-mode","nav-down","nav-index","nav-left","nav-right","nav-up","none","normal","object-fit","object-position","offset","offset-anchor","offset-distance","offset-path","offset-position","offset-rotate","opacity","order","orphans","outline","outline-color","outline-offset","outline-style","outline-width","overflow","overflow-anchor","overflow-block","overflow-clip-margin","overflow-inline","overflow-wrap","overflow-x","overflow-y","overlay","overscroll-behavior","overscroll-behavior-block","overscroll-behavior-inline","overscroll-behavior-x","overscroll-behavior-y","padding","padding-block","padding-block-end","padding-block-start","padding-bottom","padding-inline","padding-inline-end","padding-inline-start","padding-left","padding-right","padding-top","page","page-break-after","page-break-before","page-break-inside","paint-order","pause","pause-after","pause-before","perspective","perspective-origin","place-content","place-items","place-self","pointer-events","position","position-anchor","position-visibility","print-color-adjust","quotes","r","resize","rest","rest-after","rest-before","right","rotate","row-gap","ruby-align","ruby-position","scale","scroll-behavior","scroll-margin","scroll-margin-block","scroll-margin-block-end","scroll-margin-block-start","scroll-margin-bottom","scroll-margin-inline","scroll-margin-inline-end","scroll-margin-inline-start","scroll-margin-left","scroll-margin-right","scroll-margin-top","scroll-padding","scroll-padding-block","scroll-padding-block-end","scroll-padding-block-start","scroll-padding-bottom","scroll-padding-inline","scroll-padding-inline-end","scroll-padding-inline-start","scroll-padding-left","scroll-padding-right","scroll-padding-top","scroll-snap-align","scroll-snap-stop","scroll-snap-type","scroll-timeline","scroll-timeline-axis","scroll-timeline-name","scrollbar-color","scrollbar-gutter","scrollbar-width","shape-image-threshold","shape-margin","shape-outside","shape-rendering","speak","speak-as","src","stop-color","stop-opacity","stroke","stroke-dasharray","stroke-dashoffset","stroke-linecap","stroke-linejoin","stroke-miterlimit","stroke-opacity","stroke-width","tab-size","table-layout","text-align","text-align-all","text-align-last","text-anchor","text-combine-upright","text-decoration","text-decoration-color","text-decoration-line","text-decoration-skip","text-decoration-skip-ink","text-decoration-style","text-decoration-thickness","text-emphasis","text-emphasis-color","text-emphasis-position","text-emphasis-style","text-indent","text-justify","text-orientation","text-overflow","text-rendering","text-shadow","text-size-adjust","text-transform","text-underline-offset","text-underline-position","text-wrap","text-wrap-mode","text-wrap-style","timeline-scope","top","touch-action","transform","transform-box","transform-origin","transform-style","transition","transition-behavior","transition-delay","transition-duration","transition-property","transition-timing-function","translate","unicode-bidi","user-modify","user-select","vector-effect","vertical-align","view-timeline","view-timeline-axis","view-timeline-inset","view-timeline-name","view-transition-name","visibility","voice-balance","voice-duration","voice-family","voice-pitch","voice-range","voice-rate","voice-stress","voice-volume","white-space","white-space-collapse","widows","width","will-change","word-break","word-spacing","word-wrap","writing-mode","x","y","z-index","zoom"].sort().reverse();function Qn(e){let t=e.regex,n=fi(e),r={begin:/-(webkit|moz|ms|o)-(?=[a-z])/},s="and or not only",a=/@-?\\w[\\w]*(-\\w+)*/,i="[a-zA-Z-][a-zA-Z0-9_-]*",l=[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE];return{name:"CSS",case_insensitive:!0,illegal:/[=|'\\$]/,keywords:{keyframePosition:"from to"},classNameAliases:{keyframePosition:"selector-tag"},contains:[n.BLOCK_COMMENT,r,n.CSS_NUMBER_MODE,{className:"selector-id",begin:/#[A-Za-z0-9_-]+/,relevance:0},{className:"selector-class",begin:"\\\\."+i,relevance:0},n.ATTRIBUTE_SELECTOR_MODE,{className:"selector-pseudo",variants:[{begin:":("+Ei.join("|")+")"},{begin:":(:)?("+yi.join("|")+")"}]},n.CSS_VARIABLE,{className:"attribute",begin:"\\\\b("+wi.join("|")+")\\\\b"},{begin:/:/,end:/[;}{]/,contains:[n.BLOCK_COMMENT,n.HEXCOLOR,n.IMPORTANT,n.CSS_NUMBER_MODE,...l,{begin:/(url|data-uri)\\(/,end:/\\)/,relevance:0,keywords:{built_in:"url data-uri"},contains:[...l,{className:"string",begin:/[^)]/,endsWithParent:!0,excludeEnd:!0}]},n.FUNCTION_DISPATCH]},{begin:t.lookahead(/@/),end:"[{;]",relevance:0,illegal:/:/,contains:[{className:"keyword",begin:a},{begin:/\\s/,endsWithParent:!0,excludeEnd:!0,relevance:0,keywords:{$pattern:/[a-z-]+/,keyword:s,attribute:xi.join(" ")},contains:[{begin:/[a-z-]+(?=:)/,className:"attribute"},...l,n.CSS_NUMBER_MODE]}]},{className:"selector-tag",begin:"\\\\b("+ki.join("|")+")\\\\b"}]}}function Vn(e){let t=e.regex,n=e.COMMENT("--","$"),r={scope:"string",variants:[{begin:/'/,end:/'/,contains:[{match:/''/}]}]},s={begin:/"/,end:/"/,contains:[{match:/""/}]},a=["true","false","unknown"],i=["double precision","large object","with timezone","without timezone"],l=["bigint","binary","blob","boolean","char","character","clob","date","dec","decfloat","decimal","float","int","integer","interval","nchar","nclob","national","numeric","real","row","smallint","time","timestamp","varchar","varying","varbinary"],o=["add","asc","collation","desc","final","first","last","view"],c=["abs","acos","all","allocate","alter","and","any","are","array","array_agg","array_max_cardinality","as","asensitive","asin","asymmetric","at","atan","atomic","authorization","avg","begin","begin_frame","begin_partition","between","bigint","binary","blob","boolean","both","by","call","called","cardinality","cascaded","case","cast","ceil","ceiling","char","char_length","character","character_length","check","classifier","clob","close","coalesce","collate","collect","column","commit","condition","connect","constraint","contains","convert","copy","corr","corresponding","cos","cosh","count","covar_pop","covar_samp","create","cross","cube","cume_dist","current","current_catalog","current_date","current_default_transform_group","current_path","current_role","current_row","current_schema","current_time","current_timestamp","current_path","current_role","current_transform_group_for_type","current_user","cursor","cycle","date","day","deallocate","dec","decimal","decfloat","declare","default","define","delete","dense_rank","deref","describe","deterministic","disconnect","distinct","double","drop","dynamic","each","element","else","empty","end","end_frame","end_partition","end-exec","equals","escape","every","except","exec","execute","exists","exp","external","extract","false","fetch","filter","first_value","float","floor","for","foreign","frame_row","free","from","full","function","fusion","get","global","grant","group","grouping","groups","having","hold","hour","identity","in","indicator","initial","inner","inout","insensitive","insert","int","integer","intersect","intersection","interval","into","is","join","json_array","json_arrayagg","json_exists","json_object","json_objectagg","json_query","json_table","json_table_primitive","json_value","lag","language","large","last_value","lateral","lead","leading","left","like","like_regex","listagg","ln","local","localtime","localtimestamp","log","log10","lower","match","match_number","match_recognize","matches","max","member","merge","method","min","minute","mod","modifies","module","month","multiset","national","natural","nchar","nclob","new","no","none","normalize","not","nth_value","ntile","null","nullif","numeric","octet_length","occurrences_regex","of","offset","old","omit","on","one","only","open","or","order","out","outer","over","overlaps","overlay","parameter","partition","pattern","per","percent","percent_rank","percentile_cont","percentile_disc","period","portion","position","position_regex","power","precedes","precision","prepare","primary","procedure","ptf","range","rank","reads","real","recursive","ref","references","referencing","regr_avgx","regr_avgy","regr_count","regr_intercept","regr_r2","regr_slope","regr_sxx","regr_sxy","regr_syy","release","result","return","returns","revoke","right","rollback","rollup","row","row_number","rows","running","savepoint","scope","scroll","search","second","seek","select","sensitive","session_user","set","show","similar","sin","sinh","skip","smallint","some","specific","specifictype","sql","sqlexception","sqlstate","sqlwarning","sqrt","start","static","stddev_pop","stddev_samp","submultiset","subset","substring","substring_regex","succeeds","sum","symmetric","system","system_time","system_user","table","tablesample","tan","tanh","then","time","timestamp","timezone_hour","timezone_minute","to","trailing","translate","translate_regex","translation","treat","trigger","trim","trim_array","true","truncate","uescape","union","unique","unknown","unnest","update","upper","user","using","value","values","value_of","var_pop","var_samp","varbinary","varchar","varying","versioning","when","whenever","where","width_bucket","window","with","within","without","year"],u=["abs","acos","array_agg","asin","atan","avg","cast","ceil","ceiling","coalesce","corr","cos","cosh","count","covar_pop","covar_samp","cume_dist","dense_rank","deref","element","exp","extract","first_value","floor","json_array","json_arrayagg","json_exists","json_object","json_objectagg","json_query","json_table","json_table_primitive","json_value","lag","last_value","lead","listagg","ln","log","log10","lower","max","min","mod","nth_value","ntile","nullif","percent_rank","percentile_cont","percentile_disc","position","position_regex","power","rank","regr_avgx","regr_avgy","regr_count","regr_intercept","regr_r2","regr_slope","regr_sxx","regr_sxy","regr_syy","row_number","sin","sinh","sqrt","stddev_pop","stddev_samp","substring","substring_regex","sum","tan","tanh","translate","translate_regex","treat","trim","trim_array","unnest","upper","value_of","var_pop","var_samp","width_bucket"],h=["current_catalog","current_date","current_default_transform_group","current_path","current_role","current_schema","current_transform_group_for_type","current_user","session_user","system_time","system_user","current_time","localtime","current_timestamp","localtimestamp"],p=["create table","insert into","primary key","foreign key","not null","alter table","add constraint","grouping sets","on overflow","character set","respect nulls","ignore nulls","nulls first","nulls last","depth first","breadth first"],E=u,m=[...c,...o].filter(C=>!u.includes(C)),y={scope:"variable",match:/@[a-z0-9][a-z0-9_]*/},O={scope:"operator",match:/[-+*/=%^~]|&&?|\\|\\|?|!=?|<(?:=>?|<|>)?|>[>=]?/,relevance:0},L={match:t.concat(/\\b/,t.either(...E),/\\s*\\(/),relevance:0,keywords:{built_in:E}};function M(C){return t.concat(/\\b/,t.either(...C.map(N=>N.replace(/\\s+/,"\\\\s+"))),/\\b/)}let $={scope:"keyword",match:M(p),relevance:0};function P(C,{exceptions:N,when:ce}={}){let z=ce;return N=N||[],C.map(Z=>Z.match(/\\|\\d+$/)||N.includes(Z)?Z:z(Z)?\`\${Z}|0\`:Z)}return{name:"SQL",case_insensitive:!0,illegal:/[{}]|<\\//,keywords:{$pattern:/\\b[\\w\\.]+/,keyword:P(m,{when:C=>C.length<3}),literal:a,type:l,built_in:h},contains:[{scope:"type",match:M(i)},$,L,y,r,s,e.C_NUMBER_MODE,e.C_BLOCK_COMMENT_MODE,n,O]}}B.registerLanguage("javascript",St);B.registerLanguage("js",St);B.registerLanguage("typescript",vt);B.registerLanguage("ts",vt);B.registerLanguage("python",Tt);B.registerLanguage("py",Tt);B.registerLanguage("bash",At);B.registerLanguage("sh",At);B.registerLanguage("json",Yn);B.registerLanguage("html",Rt);B.registerLanguage("xml",Rt);B.registerLanguage("css",Qn);B.registerLanguage("sql",Vn);function _i(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}var Si={link({href:e,title:t,text:n}){let r=t?\` title="\${t}"\`:"";return\`<a href="\${e}"\${r} target="_blank" rel="noopener noreferrer">\${n}</a>\`},code({text:e,lang:t}){let n=t&&B.getLanguage(t)?t:null,r=n?B.highlight(e,{language:n}).value:B.highlightAuto(e).value,s=n?\` language-\${n}\`:"";return\`<div class="code-block"><button class="copy-btn" data-code="\${_i(e)}">Copy</button><pre><code class="hljs\${s}">\${r}</code></pre></div>\`}};T.use({gfm:!0,breaks:!0,renderer:Si});function Nt(e){return T.parse(e)}var Le=!0;function Jn(){let e=document.getElementById("dash-hdr"),t=document.getElementById("stop-all-btn");e.addEventListener("click",function(){Le=!Le,document.getElementById("dash-body").style.display=Le?"":"none",document.getElementById("dash-icon").textContent=Le?"\\u25B2":"\\u25BC",e.setAttribute("aria-expanded",String(Le))}),e.addEventListener("keydown",function(n){(n.key==="Enter"||n.key===" ")&&(n.preventDefault(),e.click())}),t.addEventListener("click",function(){de({type:"stop-all"})})}function es(e){let t=document.getElementById("dash"),n=document.getElementById("stop-all-btn");if(!e||e.length===0){t.classList.add("hidden"),n.disabled=!0;return}t.classList.remove("hidden");let r=null,s=[];for(let o=0;o<e.length;o++)e[o].type==="master"?r=e[o]:s.push(e[o]);let a=document.getElementById("dash-master");a.innerHTML=r?'<div style="padding:2px 0;color:var(--text-primary)"><strong>Master:</strong> '+(r.model||"unknown")+" \\xA0|\\xA0 "+r.status+"</div>":"";let i=document.getElementById("dash-workers");if(s.length===0)i.innerHTML="",n.disabled=!0;else{n.disabled=!1;let o='<div style="font-weight:500;padding:2px 0">Workers ('+s.length+"):</div>";for(let c=0;c<s.length;c++){let u=s[c],h=u.progress_pct||0,p="s-"+(u.status||"running"),E=u.started_at?Math.floor((Date.now()-new Date(u.started_at).getTime())/1e3)+"s":"",m=String(u.id);o+='<div class="agent-row"><span style="font-family:monospace;color:var(--text-secondary);flex-shrink:0">'+m.slice(0,8)+'</span><span class="abadge '+p+'">'+(u.model||"\\u2014")+'</span><span style="color:var(--text-muted);flex-shrink:0">'+(u.profile||"\\u2014")+'</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary)">'+(u.task_summary||"\\u2014")+'</span><div class="prog-wrap"><div class="prog-bar" style="width:'+h+'%"></div></div><span style="color:var(--text-muted);white-space:nowrap;flex-shrink:0">'+h+'%</span><span style="color:var(--text-muted);white-space:nowrap;flex-shrink:0;min-width:32px;text-align:right">'+E+'</span><button class="stop-btn" title="Stop this worker" aria-label="Stop worker '+m.slice(0,8)+'" data-worker-id="'+m+'">\\u2715</button></div>'}i.innerHTML=o,i.querySelectorAll("[data-worker-id]").forEach(function(c){c.addEventListener("click",function(){de({type:"stop-worker",workerId:c.dataset.workerId})})})}let l=0;for(let o=0;o<e.length;o++)l+=e[o].cost_usd||0;document.getElementById("dash-cost").innerHTML='<div class="dash-cost">Cost: 
</body>
</html>
+l.toFixed(4)+" \\xA0|\\xA0 Active workers: "+s.length+"</div>",document.getElementById("dash-lbl").textContent="Agent Status ("+e.length+" active)"}var Be=!1,ye=null,Q=null,me=null,Ct=null,It=null,Mt=null;function ts(e){It=e}function ns(e){Mt=e}function ae(){return window.innerWidth>=768}function ss(){Be=!0,ye.classList.add("open"),ae()||(Q.classList.add("visible"),Q.removeAttribute("aria-hidden")),me.setAttribute("aria-expanded","true"),me.setAttribute("aria-label","Close sidebar"),ye.setAttribute("aria-hidden","false")}function De(){Be=!1,ye.classList.remove("open"),Q.classList.remove("visible"),Q.setAttribute("aria-hidden","true"),me.setAttribute("aria-expanded","false"),me.setAttribute("aria-label","Open sidebar"),ye.setAttribute("aria-hidden","true")}function vi(){Be?(De(),ae()&&localStorage.setItem("ob-sidebar-open","false")):(ss(),ae()&&localStorage.setItem("ob-sidebar-open","true"))}function rs(e){if(!e)return"";let t=new Date(e),n=Math.floor((Date.now()-t.getTime())/1e3);return n<60?"just now":n<3600?Math.floor(n/60)+"m ago":n<86400?Math.floor(n/3600)+"h ago":n<86400*7?Math.floor(n/86400)+"d ago":t.toLocaleDateString(void 0,{month:"short",day:"numeric"})}function Ti(e,t){let n=document.createElement("div");n.className="sidebar-session-item"+(t?" active":""),n.setAttribute("role","listitem"),n.setAttribute("tabindex","0"),n.dataset.sessionId=e.session_id;let r=document.createElement("div");r.className="sidebar-session-title",r.textContent=e.title||"Conversation";let s=document.createElement("div");s.className="sidebar-session-meta";let a=document.createElement("span");a.textContent=rs(e.last_message_at);let i=document.createElement("span"),l=e.message_count||0;return i.textContent=l+(l===1?" msg":" msgs"),s.appendChild(a),s.appendChild(i),n.appendChild(r),n.appendChild(s),n}async function $e(e){let t=document.getElementById("sidebar-sessions");if(!t)return;let n;try{let a=await fetch("/api/sessions?limit=50");if(!a.ok)return;n=await a.json()}catch{return}if(!Array.isArray(n)||n.length===0){t.innerHTML='<div class="sidebar-empty">No conversations yet.</div>';return}let r=e??n[0].session_id;Ct=r;let s=document.createDocumentFragment();for(let a of n){let i=Ti(a,a.session_id===r);s.appendChild(i)}t.replaceChildren(s)}function Ot(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function Ai(e,t,n){if(!e)return"";n=n||120;let r=t.trim().split(/\\s+/).filter(Boolean),s=-1;for(let o=0;o<r.length;o++){let c=e.toLowerCase().indexOf(r[o].toLowerCase());if(c!==-1){s=c;break}}if(s===-1)return e.slice(0,n)+(e.length>n?"\\u2026":"");let a=Math.max(0,s-30),i=Math.min(e.length,a+n),l=e.slice(a,i);return(a>0?"\\u2026":"")+l+(i<e.length?"\\u2026":"")}function Ri(e,t){if(!e)return"";let n=Ot(e),r=t.trim().split(/\\s+/).filter(Boolean);if(r.length===0)return n;let s=r.map(function(i){return Ot(i).replace(/[.*+?^\${}()|[\\]\\\\]/g,"\\\\<script src="js/app.js" type="module"></script>")}).join("|"),a=new RegExp("("+s+")","gi");return n.replace(a,'<mark class="sidebar-match">$1</mark>')}function Ni(e,t){let n=document.createElement("div");n.className="sidebar-session-item sidebar-search-result",n.setAttribute("role","listitem"),n.setAttribute("tabindex","0"),n.dataset.sessionId=e.session_id;let r=Ai(e.content,t),s=Ri(r,t),a=document.createElement("div");a.className="sidebar-search-snippet",a.innerHTML=s;let i=document.createElement("div");i.className="sidebar-session-meta";let l=document.createElement("span");l.textContent=e.role==="user"?"You":"AI";let o=document.createElement("span");return o.textContent=rs(e.created_at),i.appendChild(l),i.appendChild(o),n.appendChild(a),n.appendChild(i),n}async function Ci(e){let t=document.getElementById("sidebar-sessions");if(!t)return;t.innerHTML='<div class="sidebar-empty">Searching\\u2026</div>';let n;try{let s=await fetch("/api/sessions/search?q="+encodeURIComponent(e)+"&limit=20");if(!s.ok){t.innerHTML='<div class="sidebar-empty">Search failed.</div>';return}n=await s.json()}catch{t.innerHTML='<div class="sidebar-empty">Search failed.</div>';return}if(!Array.isArray(n)||n.length===0){t.innerHTML='<div class="sidebar-empty">No results for \\u201C'+Ot(e)+"\\u201D.</div>";return}let r=document.createDocumentFragment();for(let s of n)r.appendChild(Ni(s,e));t.replaceChildren(r)}function is(){if(ye=document.getElementById("sidebar"),Q=document.getElementById("sidebar-overlay"),me=document.getElementById("sidebar-toggle"),!ye||!Q||!me)return;me.addEventListener("click",vi);let e=document.getElementById("new-conversation-btn");e&&e.addEventListener("click",function(){Mt&&Mt(),ae()||De()}),Q.addEventListener("click",function(){De()}),document.addEventListener("keydown",function(s){s.key==="Escape"&&Be&&!ae()&&De()}),window.addEventListener("resize",function(){Be&&(ae()?(Q.classList.remove("visible"),Q.setAttribute("aria-hidden","true")):(Q.classList.add("visible"),Q.removeAttribute("aria-hidden")))});let t=document.getElementById("sidebar-sessions");t&&(t.addEventListener("click",function(s){let a=s.target.closest(".sidebar-session-item");if(!a)return;let i=a.dataset.sessionId;i&&(t.querySelectorAll(".sidebar-session-item").forEach(function(l){l.classList.toggle("active",l===a)}),Ct=i,ae()||De(),It&&It(i))}),t.addEventListener("keydown",function(s){if(s.key!=="Enter"&&s.key!==" ")return;let a=s.target.closest(".sidebar-session-item");a&&(s.preventDefault(),a.click())}));let n=document.getElementById("sidebar-search-input"),r=null;n&&n.addEventListener("input",function(){clearTimeout(r);let s=n.value.trim();if(!s){$e(Ct);return}r=setTimeout(function(){Ci(s)},300)}),ae()&&localStorage.getItem("ob-sidebar-open")!=="false"&&ss()}var G=document.getElementById("msgs"),us=document.getElementById("form"),W=document.getElementById("inp"),Ii=document.getElementById("send"),Mi=document.getElementById("dot"),Lt=document.getElementById("connLabel"),ds=document.getElementById("status-bar"),ps=document.getElementById("status-text"),$t=document.getElementById("status-timer"),we=null,Pt=null;(function(){let t=window.__OB_PUBLIC_URL__;if(!t)return;let n=document.getElementById("public-url-bar"),r=document.getElementById("public-url-text"),s=document.getElementById("url-copy-btn");!n||!r||!s||(r.textContent=t,n.classList.remove("hidden"),n.classList.add("visible"),s.addEventListener("click",function(){navigator.clipboard.writeText(t).then(function(){s.textContent="Copied!",s.classList.add("copied"),setTimeout(function(){s.textContent="Copy",s.classList.remove("copied")},2e3)},function(){let a=document.createElement("textarea");a.value=t,a.style.position="fixed",a.style.opacity="0",document.body.appendChild(a),a.select(),document.execCommand("copy"),document.body.removeChild(a),s.textContent="Copied!",s.classList.add("copied"),setTimeout(function(){s.textContent="Copy",s.classList.remove("copied")},2e3)})}))})();(function(){let t=document.getElementById("share-btn"),n=document.getElementById("share-toast");if(!t||!n)return;let r=null;function s(){r&&clearTimeout(r),n.classList.add("visible"),r=setTimeout(function(){n.classList.remove("visible"),r=null},2e3)}t.addEventListener("click",function(){let a=window.location.href;navigator.clipboard.writeText(a).then(function(){s()},function(){let i=document.createElement("textarea");i.value=a,i.style.position="fixed",i.style.opacity="0",document.body.appendChild(i),i.select(),document.execCommand("copy"),document.body.removeChild(i),s()})})})();var Pe=localStorage.getItem("ob-ts")!=="false";function Ht(e){let t=Math.floor((Date.now()-e.getTime())/1e3);return t<60?"just now":t<3600?Math.floor(t/60)+"m ago":t<86400?Math.floor(t/3600)+"h ago":Math.floor(t/86400)+"d ago"}function as(){let e=document.getElementById("ts-toggle");e&&(e.textContent=Pe?"Hide times":"Show times"),document.documentElement.setAttribute("data-ts",Pe?"show":"hide")}(function(){as();let t=document.getElementById("ts-toggle");t&&t.addEventListener("click",function(){Pe=!Pe,localStorage.setItem("ob-ts",Pe?"true":"false"),as()}),setInterval(function(){G.querySelectorAll("time.bubble-ts").forEach(function(n){n.textContent=Ht(new Date(n.dateTime))})},6e4)})();(function(){let t=document.getElementById("theme-toggle");function n(r){document.documentElement.setAttribute("data-theme",r),t.textContent=r==="dark"?"Light":"Dark",localStorage.setItem("ob-theme",r)}n(localStorage.getItem("ob-theme")||"light"),t.addEventListener("click",function(){let r=document.documentElement.getAttribute("data-theme");n(r==="dark"?"light":"dark")})})();var Ft="ob-conversation",zt=100,oe=[],_e=!0;function Oi(){try{localStorage.setItem(Ft,JSON.stringify(oe))}catch{}}function Li(e,t,n){_e&&(oe.push({content:e,cls:t,ts:(n instanceof Date?n:new Date).toISOString()}),oe.length>zt&&(oe=oe.slice(-zt)),Oi())}function gs(){oe=[];try{localStorage.removeItem(Ft)}catch{}}function Di(){try{let e=localStorage.getItem(Ft);if(!e)return;let t=JSON.parse(e);if(!Array.isArray(t)||t.length===0)return;_e=!1,oe=t.slice(-zt);for(let n of oe)(n.cls==="user"||n.cls==="ai")&&F(n.content,n.cls,n.ts?new Date(n.ts):new Date);_e=!0}catch{_e=!0}}function hs(e){let t=document.createElement("div");return t.className="avatar avatar-"+e,t.setAttribute("aria-hidden","true"),t.textContent=e==="user"?"You":"AI",t}function F(e,t,n){let r=document.createElement("div");if(r.className="bubble "+t,t==="ai"){let s=Nt(e);if(e.length>500){let a=document.createElement("div");a.className="collapsible-wrap";let i=document.createElement("div");i.className="collapsible-inner",i.style.maxHeight="120px",i.innerHTML=s;let l=document.createElement("div");l.className="collapsible-fade";let o=document.createElement("button");o.className="show-more-btn",o.textContent="Show more",o.setAttribute("aria-expanded","false"),o.addEventListener("click",function(){o.getAttribute("aria-expanded")==="false"?(i.style.maxHeight=i.scrollHeight+"px",l.style.display="none",o.textContent="Show less",o.setAttribute("aria-expanded","true")):(i.style.maxHeight="120px",l.style.display="",o.textContent="Show more",o.setAttribute("aria-expanded","false"))}),a.appendChild(i),a.appendChild(l),r.appendChild(a),r.appendChild(o)}else r.innerHTML=s}else r.textContent=e;if(t!=="sys"){let s=n instanceof Date?n:new Date,a=document.createElement("time");a.className="bubble-ts",a.dateTime=s.toISOString(),a.title=s.toLocaleString(),a.textContent=Ht(s),r.appendChild(a);let i=document.createElement("div");i.className="msg-row "+t,i.appendChild(hs(t)),i.appendChild(r),G.appendChild(i)}else G.appendChild(r);return G.scrollTop=G.scrollHeight,(t==="user"||t==="ai")&&Li(e,t,n instanceof Date?n:new Date),r}G.addEventListener("click",function(e){let t=e.target.closest(".copy-btn");if(!t)return;let n=t.dataset.code;n&&navigator.clipboard.writeText(n).then(function(){t.textContent="Copied!",t.classList.add("copied"),setTimeout(function(){t.textContent="Copy",t.classList.remove("copied")},2e3)})});function Bi(){we||(Pt=Date.now(),$t.textContent="0s",we=setInterval(function(){let e=Math.floor((Date.now()-Pt)/1e3);$t.textContent=e+"s"},1e3))}function $i(){we&&(clearInterval(we),we=null),Pt=null,$t.textContent=""}function Ut(e){ds.classList.remove("hidden"),ps.innerHTML=e,we||Bi()}function Ve(){ds.classList.add("hidden"),ps.innerHTML="",$i()}function Pi(e){if(e.type==="classifying")return'\\u{1F50D} Analyzing request<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>';if(e.type==="planning")return'\\u{1F4CB} Planning subtasks<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>';if(e.type==="spawning"){let t=e.workerCount;return"\\u{1F4CB} Breaking into "+t+" subtask"+(t!==1?"s":"")+'<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>'}return e.type==="worker-progress"?(e.workerName?"\\u2699\\uFE0F "+e.workerName+": ":"\\u2699\\uFE0F ")+e.completed+"/"+e.total+' workers done<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>':e.type==="synthesizing"?'\\u{1F4DD} Preparing final response<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>':e.type==="exploring"?"\\u{1F5FA}\\uFE0F "+e.phase+'<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>':e.type==="exploring-directory"?"\\u{1F4C2} Exploring directories: "+e.completed+"/"+e.total+(e.directory?" ("+e.directory+")":"")+'<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>':null}function os(e,t){Mi.className="conn-dot"+(e?" online":""),e?Lt.textContent="Connected":t?Lt.textContent="Reconnecting...":Lt.textContent="Disconnected",W.disabled=!e,Ii.disabled=!e;let n=document.getElementById("upload-btn");n&&(n.disabled=!e);let r=document.getElementById("mic-btn");r&&(r.disabled=!e)}function zi(e){if(e.type==="response")Ve(),F(e.content,"ai",e.timestamp?new Date(e.timestamp):new Date),Hi(),Gi(e.content),bs(),$e();else if(e.type==="download"){Ve();let t=e.timestamp?new Date(e.timestamp):new Date,n=document.createElement("div");n.className="bubble ai",e.content&&(n.innerHTML=Nt(e.content)+"<br>");let r=document.createElement("a");r.href=e.url,r.download=e.filename||"download",r.className="download-link",r.textContent="\\u2B07\\uFE0F Download "+(e.filename||"file"),r.setAttribute("aria-label","Download "+(e.filename||"file")),n.appendChild(r);let s=document.createElement("time");s.className="bubble-ts",s.dateTime=t.toISOString(),s.title=t.toLocaleString(),s.textContent=Ht(t),n.appendChild(s);let a=document.createElement("div");a.className="msg-row ai",a.appendChild(hs("ai")),a.appendChild(n),G.appendChild(a),G.scrollTop=G.scrollHeight}else if(e.type==="typing")Ut('\\u{1F914} Thinking<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>');else if(e.type==="progress"){if(e.event&&e.event.type==="complete")Ve();else if(e.event&&e.event.type==="worker-result"){let t=e.event.success?"\\u2705":"\\u274C",n=e.event.tool?" \\xB7 "+e.event.tool:"",r=t+" **Subtask "+e.event.workerIndex+"/"+e.event.total+"** ("+e.event.profile+n+\`):

\`;F(r+e.event.content,"ai",new Date)}else if(e.event&&e.event.type==="worker-cancelled")F("\\u{1F6D1} Worker "+e.event.workerId+" was stopped by "+e.event.cancelledBy+".","sys");else if(e.event){let t=Pi(e.event);t&&Ut(t)}}else e.type==="agent-status"&&es(e.agents)}var Dt=document.getElementById("char-count");function Gt(){W.style.height="auto",W.style.height=W.scrollHeight+"px"}function qt(){let e=W.value.length;e>500?(Dt.textContent=e.toLocaleString()+" chars",Dt.classList.remove("hidden")):Dt.classList.add("hidden")}W.addEventListener("input",function(){Gt(),qt()});W.addEventListener("keydown",function(e){e.key==="Enter"&&!e.shiftKey?(e.preventDefault(),us.requestSubmit()):e.key==="Escape"&&(W.value="",Gt(),qt())});us.addEventListener("submit",function(e){e.preventDefault();let t=W.value.trim(),n=se.length>0;if(!t&&!n||!Vt())return;let r=se.slice();if(se=[],Je(),F(t||"(\\u{1F4CE} file upload)","user",new Date),W.value="",Gt(),qt(),Ut('\\u{1F914} Thinking<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>'),r.length===0){de({type:"message",content:t});return}Promise.all(r.map(function(a){let i=new FormData;return i.append("file",a,a.name),fetch("/api/upload",{method:"POST",body:i}).then(function(l){return l.ok?l.json():null}).catch(function(){return null})})).then(function(a){let i=a.filter(function(o){return o&&o.fileId}).map(function(o){return"- "+o.filename+" (path: "+o.path+")"}),l=t;i.length>0&&(l&&(l+=\`

\`),l+=\`[Attached files]
\`+i.join(\`
\`)),l||(l="[File upload failed \\u2014 no files were saved]"),de({type:"message",content:l})})});var se=[];function Ui(e){return e<1024?e+" B":e<1024*1024?(e/1024).toFixed(1)+" KB":(e/(1024*1024)).toFixed(1)+" MB"}function Je(){let e=document.getElementById("file-preview");if(e){if(se.length===0){e.classList.add("hidden"),e.replaceChildren();return}e.classList.remove("hidden"),e.replaceChildren();for(let t=0;t<se.length;t++){let n=se[t],r=document.createElement("div");r.className="file-chip";let s=document.createElement("span");s.className="file-chip-icon",s.setAttribute("aria-hidden","true"),s.textContent="\\u{1F4C4}";let a=document.createElement("span");a.className="file-chip-info";let i=document.createElement("span");i.className="file-chip-name",i.textContent=n.name;let l=document.createElement("span");l.className="file-chip-meta",l.textContent=Ui(n.size)+(n.type?" \\xB7 "+n.type:""),a.appendChild(i),a.appendChild(l);let o=document.createElement("button");o.type="button",o.className="file-chip-remove",o.setAttribute("aria-label","Remove "+n.name),o.textContent="\\xD7";let c=t;o.addEventListener("click",function(){se.splice(c,1),Je()}),r.appendChild(s),r.appendChild(a),r.appendChild(o),e.appendChild(r)}}}(function(){let t=document.getElementById("upload-btn"),n=document.getElementById("file-input"),r=document.querySelector(".chat-wrap");!t||!n||(t.addEventListener("click",function(){n.click()}),n.addEventListener("change",function(){let s=Array.from(n.files||[]);for(let a of s)se.push(a);n.value="",Je()}),r&&(r.addEventListener("dragover",function(s){s.preventDefault(),r.classList.add("drag-over")}),r.addEventListener("dragleave",function(s){r.contains(s.relatedTarget)||r.classList.remove("drag-over")}),r.addEventListener("drop",function(s){s.preventDefault(),r.classList.remove("drag-over");let a=Array.from(s.dataTransfer?s.dataTransfer.files:[]);for(let i of a)se.push(i);Je()})))})();(function(){let t=document.getElementById("mic-btn");if(!t)return;if(typeof MediaRecorder>"u"||!navigator.mediaDevices){t.style.display="none";return}let n=null,r=[],s=null;function a(){if(s)return;let c=document.getElementById("file-preview");c&&(s=document.createElement("div"),s.className="recording-indicator",s.innerHTML='<span class="recording-dot"></span>Recording\\u2026',c.classList.remove("hidden"),c.appendChild(s))}function i(){if(!s)return;let c=document.getElementById("file-preview");s.remove(),s=null,c&&c.children.length===0&&c.classList.add("hidden")}function l(){r=[],navigator.mediaDevices.getUserMedia({audio:!0}).then(function(c){let u=MediaRecorder.isTypeSupported("audio/webm")?"audio/webm":"audio/ogg";n=new MediaRecorder(c,{mimeType:u}),n.addEventListener("dataavailable",function(h){h.data&&h.data.size>0&&r.push(h.data)}),n.addEventListener("stop",function(){c.getTracks().forEach(function(m){m.stop()});let h=new Blob(r,{type:u});r=[],i(),t.classList.remove("recording"),t.title="Record voice message",t.setAttribute("aria-label","Record voice message");let p=u==="audio/webm"?".webm":".ogg",E=new FormData;E.append("file",h,"voice"+p),F("\\u{1F3A4} Transcribing voice\\u2026","sys"),fetch("/api/transcribe",{method:"POST",body:E}).then(function(m){return m.ok?m.json():Promise.reject(m.status)}).then(function(m){if(m&&m.text){W.value=m.text,W.dispatchEvent(new Event("input")),W.focus();let y=G.querySelector(".bubble.sys:last-of-type");y&&y.textContent.includes("Transcribing")&&(y.closest(".bubble.sys")&&y.remove(),G.querySelectorAll(".bubble.sys").forEach(function(L){L.textContent.includes("Transcribing")&&L.remove()}))}}).catch(function(){F("\\u26A0\\uFE0F Voice transcription failed.","sys")})}),n.start(),t.classList.add("recording"),t.title="Stop recording",t.setAttribute("aria-label","Stop recording"),a()}).catch(function(){F("\\u26A0\\uFE0F Microphone access denied. Please allow microphone permissions.","sys")})}function o(){n&&n.state!=="inactive"&&n.stop()}t.addEventListener("click",function(){t.classList.contains("recording")?o():l()})})();var et=0,ls="OpenBridge";function fs(){document.title=et>0?"("+et+") "+ls:ls}function Hi(){document.visibilityState!=="visible"&&(et++,fs())}function Fi(){et=0,fs()}document.addEventListener("visibilitychange",function(){document.visibilityState==="visible"&&Fi()});function Gi(e){if(document.visibilityState!=="visible"&&"Notification"in window&&Notification.permission==="granted"){var t=e.length>100?e.slice(0,97)+"...":e;new Notification("OpenBridge",{body:t,icon:"/icons/icon-192.png"})}}(function(){"Notification"in window&&Notification.permission==="default"&&setTimeout(function(){Notification.requestPermission()},3e3)})();var le=localStorage.getItem("ob-sound")==="false",Bt=null;function qi(){return Bt||(Bt=new(window.AudioContext||window.webkitAudioContext)),Bt}function bs(){if(!le&&!(!window.AudioContext&&!window.webkitAudioContext))try{let e=qi(),t=e.createOscillator(),n=e.createGain();t.connect(n),n.connect(e.destination),t.type="sine",t.frequency.setValueAtTime(880,e.currentTime),t.frequency.exponentialRampToValueAtTime(660,e.currentTime+.15),n.gain.setValueAtTime(.3,e.currentTime),n.gain.exponentialRampToValueAtTime(.001,e.currentTime+.25),t.start(e.currentTime),t.stop(e.currentTime+.25)}catch{}}function cs(){let e=document.getElementById("sound-toggle");e&&(e.textContent=le?"\\u{1F507}":"\\u{1F50A}",e.setAttribute("aria-label",le?"Unmute notifications":"Mute notifications"),e.setAttribute("aria-pressed",le?"true":"false"))}(function(){cs();let t=document.getElementById("sound-toggle");t&&t.addEventListener("click",function(){le=!le,localStorage.setItem("ob-sound",le?"false":"true"),cs(),le||bs()})})();(function(){if(!(window.matchMedia("(max-width: 767px)").matches||("ontouchstart"in window||navigator.maxTouchPoints>0)&&screen.width<=1024)||window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===!0||localStorage.getItem("ob-pwa-dismissed")==="1")return;let r=document.getElementById("pwa-banner"),s=document.getElementById("pwa-install-btn"),a=document.getElementById("pwa-dismiss-btn"),i=document.getElementById("pwa-banner-hint");if(!r||!s||!a)return;let l=null,o=/iphone|ipad|ipod/i.test(navigator.userAgent),c=/safari/i.test(navigator.userAgent)&&!/chrome|crios|fxios/i.test(navigator.userAgent);function u(){r.classList.remove("hidden")}function h(){r.classList.add("hidden"),localStorage.setItem("ob-pwa-dismissed","1")}a.addEventListener("click",h),o&&c?(i&&(i.textContent="Tap Share \\u238E then \\u201CAdd to Home Screen\\u201D"),s.style.display="none",setTimeout(u,2e3)):(window.addEventListener("beforeinstallprompt",function(p){p.preventDefault(),l=p,setTimeout(u,2e3)}),s.addEventListener("click",function(){l&&(l.prompt(),l.userChoice.then(function(p){p.outcome==="accepted"&&localStorage.setItem("ob-pwa-dismissed","1"),l=null,r.classList.add("hidden")}))}),window.addEventListener("appinstalled",function(){r.classList.add("hidden"),localStorage.setItem("ob-pwa-dismissed","1"),l=null}))})();(function(){"serviceWorker"in navigator&&navigator.serviceWorker.register("/sw.js").catch(function(t){typeof console<"u"&&console.warn("SW registration failed:",t)})})();async function Zi(e){gs(),_e=!1,G.replaceChildren(),F("Loading conversation\\u2026","sys");try{let t=await fetch("/api/sessions/"+encodeURIComponent(e));if(!t.ok){G.replaceChildren(),F("Failed to load conversation.","sys");return}let r=(await t.json()).messages;if(G.replaceChildren(),!Array.isArray(r)||r.length===0){F("No messages in this conversation.","sys");return}for(let s of r){let a=s.role==="user"?"user":s.role==="system"?"sys":"ai",i=s.created_at?new Date(s.created_at):new Date;F(s.content,a,i)}}catch{G.replaceChildren(),F("Failed to load conversation.","sys")}finally{_e=!0}}function Ki(){gs(),G.replaceChildren(),F("New conversation started.","sys"),de({type:"new-session"}),$e()}Di();is();ts(Zi);ns(Ki);$e();Jn();Qt({onOpen:function(){os(!0),F("Connected to OpenBridge","sys")},onClose:function(){os(!1,!0),Ve(),F("Disconnected \\u2014 reconnecting...","sys")},onMessage:zi});})();

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
