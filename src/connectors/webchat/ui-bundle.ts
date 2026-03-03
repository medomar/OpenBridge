// AUTO-GENERATED — do not edit manually. Run: npm run build:webchat
// Generated: 2026-03-03T18:54:17.351Z
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
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

#inp {
  flex: 1;
  padding: 10px 16px;
  border: 1.5px solid var(--border-input);
  border-radius: 24px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
  background: var(--bg-surface);
}

#inp:focus {
  border-color: var(--accent);
}

#inp:disabled {
  background: var(--bg-muted);
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
  }

  /* Larger send button with 44px tap target */
  #send {
    padding: 11px 24px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
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
      <form id="form">
        <input
          id="inp"
          type="text"
          placeholder="Type a message..."
          autocomplete="off"
          disabled
          aria-label="Message input"
        />
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
"use strict";(()=>{var ir=Object.create;var Bt=Object.defineProperty;var ar=Object.getOwnPropertyDescriptor;var or=Object.getOwnPropertyNames;var lr=Object.getPrototypeOf,cr=Object.prototype.hasOwnProperty;var ur=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports);var dr=(e,t,n,s)=>{if(t&&typeof t=="object"||typeof t=="function")for(let r of or(t))!cr.call(e,r)&&r!==n&&Bt(e,r,{get:()=>t[r],enumerable:!(s=ar(t,r))||s.enumerable});return e};var pr=(e,t,n)=>(n=e!=null?ir(lr(e)):{},dr(t||!e||!e.__esModule?Bt(n,"default",{value:e,enumerable:!0}):n,e));var yn=ur((Mi,_n)=>{function un(e){return e instanceof Map?e.clear=e.delete=e.set=function(){throw new Error("map is read-only")}:e instanceof Set&&(e.add=e.clear=e.delete=function(){throw new Error("set is read-only")}),Object.freeze(e),Object.getOwnPropertyNames(e).forEach(t=>{let n=e[t],s=typeof n;(s==="object"||s==="function")&&!Object.isFrozen(n)&&un(n)}),e}var Fe=class{constructor(t){t.data===void 0&&(t.data={}),this.data=t.data,this.isMatchIgnored=!1}ignoreMatch(){this.isMatchIgnored=!0}};function dn(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;")}function ne(e,...t){let n=Object.create(null);for(let s in e)n[s]=e[s];return t.forEach(function(s){for(let r in s)n[r]=s[r]}),n}var ns="</span>",rn=e=>!!e.scope,rs=(e,{prefix:t})=>{if(e.startsWith("language:"))return e.replace("language:","language-");if(e.includes(".")){let n=e.split(".");return[\`\${t}\${n.shift()}\`,...n.map((s,r)=>\`\${s}\${"_".repeat(r+1)}\`)].join(" ")}return\`\${t}\${e}\`},dt=class{constructor(t,n){this.buffer="",this.classPrefix=n.classPrefix,t.walk(this)}addText(t){this.buffer+=dn(t)}openNode(t){if(!rn(t))return;let n=rs(t.scope,{prefix:this.classPrefix});this.span(n)}closeNode(t){rn(t)&&(this.buffer+=ns)}value(){return this.buffer}span(t){this.buffer+=\`<span class="\${t}">\`}},sn=(e={})=>{let t={children:[]};return Object.assign(t,e),t},pt=class e{constructor(){this.rootNode=sn(),this.stack=[this.rootNode]}get top(){return this.stack[this.stack.length-1]}get root(){return this.rootNode}add(t){this.top.children.push(t)}openNode(t){let n=sn({scope:t});this.add(n),this.stack.push(n)}closeNode(){if(this.stack.length>1)return this.stack.pop()}closeAllNodes(){for(;this.closeNode(););}toJSON(){return JSON.stringify(this.rootNode,null,4)}walk(t){return this.constructor._walk(t,this.rootNode)}static _walk(t,n){return typeof n=="string"?t.addText(n):n.children&&(t.openNode(n),n.children.forEach(s=>this._walk(t,s)),t.closeNode(n)),t}static _collapse(t){typeof t!="string"&&t.children&&(t.children.every(n=>typeof n=="string")?t.children=[t.children.join("")]:t.children.forEach(n=>{e._collapse(n)}))}},gt=class extends pt{constructor(t){super(),this.options=t}addText(t){t!==""&&this.add(t)}startScope(t){this.openNode(t)}endScope(){this.closeNode()}__addSublanguage(t,n){let s=t.root;n&&(s.scope=\`language:\${n}\`),this.add(s)}toHTML(){return new dt(this,this.options).value()}finalize(){return this.closeAllNodes(),!0}};function Re(e){return e?typeof e=="string"?e:e.source:null}function pn(e){return ue("(?=",e,")")}function ss(e){return ue("(?:",e,")*")}function is(e){return ue("(?:",e,")?")}function ue(...e){return e.map(n=>Re(n)).join("")}function as(e){let t=e[e.length-1];return typeof t=="object"&&t.constructor===Object?(e.splice(e.length-1,1),t):{}}function ft(...e){return"("+(as(e).capture?"":"?:")+e.map(s=>Re(s)).join("|")+")"}function gn(e){return new RegExp(e.toString()+"|").exec("").length-1}function os(e,t){let n=e&&e.exec(t);return n&&n.index===0}var ls=/\\[(?:[^\\\\\\]]|\\\\.)*\\]|\\(\\??|\\\\([1-9][0-9]*)|\\\\./;function bt(e,{joinWith:t}){let n=0;return e.map(s=>{n+=1;let r=n,o=Re(s),i="";for(;o.length>0;){let l=ls.exec(o);if(!l){i+=o;break}i+=o.substring(0,l.index),o=o.substring(l.index+l[0].length),l[0][0]==="\\\\"&&l[1]?i+="\\\\"+String(Number(l[1])+r):(i+=l[0],l[0]==="("&&n++)}return i}).map(s=>\`(\${s})\`).join(t)}var cs=/\\b\\B/,hn="[a-zA-Z]\\\\w*",mt="[a-zA-Z_]\\\\w*",fn="\\\\b\\\\d+(\\\\.\\\\d+)?",bn="(-?)(\\\\b0[xX][a-fA-F0-9]+|(\\\\b\\\\d+(\\\\.\\\\d*)?|\\\\.\\\\d+)([eE][-+]?\\\\d+)?)",mn="\\\\b(0b[01]+)",us="!|!=|!==|%|%=|&|&&|&=|\\\\*|\\\\*=|\\\\+|\\\\+=|,|-|-=|/=|/|:|;|<<|<<=|<=|<|===|==|=|>>>=|>>=|>=|>>>|>>|>|\\\\?|\\\\[|\\\\{|\\\\(|\\\\^|\\\\^=|\\\\||\\\\|=|\\\\|\\\\||~",ds=(e={})=>{let t=/^#![ ]*\\//;return e.binary&&(e.begin=ue(t,/.*\\b/,e.binary,/\\b.*/)),ne({scope:"meta",begin:t,end:/$/,relevance:0,"on:begin":(n,s)=>{n.index!==0&&s.ignoreMatch()}},e)},Ne={begin:"\\\\\\\\[\\\\s\\\\S]",relevance:0},ps={scope:"string",begin:"'",end:"'",illegal:"\\\\n",contains:[Ne]},gs={scope:"string",begin:'"',end:'"',illegal:"\\\\n",contains:[Ne]},hs={begin:/\\b(a|an|the|are|I'm|isn't|don't|doesn't|won't|but|just|should|pretty|simply|enough|gonna|going|wtf|so|such|will|you|your|they|like|more)\\b/},qe=function(e,t,n={}){let s=ne({scope:"comment",begin:e,end:t,contains:[]},n);s.contains.push({scope:"doctag",begin:"[ ]*(?=(TODO|FIXME|NOTE|BUG|OPTIMIZE|HACK|XXX):)",end:/(TODO|FIXME|NOTE|BUG|OPTIMIZE|HACK|XXX):/,excludeBegin:!0,relevance:0});let r=ft("I","a","is","so","us","to","at","if","in","it","on",/[A-Za-z]+['](d|ve|re|ll|t|s|n)/,/[A-Za-z]+[-][a-z]+/,/[A-Za-z][a-z]{2,}/);return s.contains.push({begin:ue(/[ ]+/,"(",r,/[.]?[:]?([.][ ]|[ ])/,"){3}")}),s},fs=qe("//","$"),bs=qe("/\\\\*","\\\\*/"),ms=qe("#","$"),ks={scope:"number",begin:fn,relevance:0},xs={scope:"number",begin:bn,relevance:0},ws={scope:"number",begin:mn,relevance:0},Es={scope:"regexp",begin:/\\/(?=[^/\\n]*\\/)/,end:/\\/[gimuy]*/,contains:[Ne,{begin:/\\[/,end:/\\]/,relevance:0,contains:[Ne]}]},_s={scope:"title",begin:hn,relevance:0},ys={scope:"title",begin:mt,relevance:0},Ss={begin:"\\\\.\\\\s*"+mt,relevance:0},vs=function(e){return Object.assign(e,{"on:begin":(t,n)=>{n.data._beginMatch=t[1]},"on:end":(t,n)=>{n.data._beginMatch!==t[1]&&n.ignoreMatch()}})},Ge=Object.freeze({__proto__:null,APOS_STRING_MODE:ps,BACKSLASH_ESCAPE:Ne,BINARY_NUMBER_MODE:ws,BINARY_NUMBER_RE:mn,COMMENT:qe,C_BLOCK_COMMENT_MODE:bs,C_LINE_COMMENT_MODE:fs,C_NUMBER_MODE:xs,C_NUMBER_RE:bn,END_SAME_AS_BEGIN:vs,HASH_COMMENT_MODE:ms,IDENT_RE:hn,MATCH_NOTHING_RE:cs,METHOD_GUARD:Ss,NUMBER_MODE:ks,NUMBER_RE:fn,PHRASAL_WORDS_MODE:hs,QUOTE_STRING_MODE:gs,REGEXP_MODE:Es,RE_STARTERS_RE:us,SHEBANG:ds,TITLE_MODE:_s,UNDERSCORE_IDENT_RE:mt,UNDERSCORE_TITLE_MODE:ys});function Ts(e,t){e.input[e.index-1]==="."&&t.ignoreMatch()}function As(e,t){e.className!==void 0&&(e.scope=e.className,delete e.className)}function Rs(e,t){t&&e.beginKeywords&&(e.begin="\\\\b("+e.beginKeywords.split(" ").join("|")+")(?!\\\\.)(?=\\\\b|\\\\s)",e.__beforeBegin=Ts,e.keywords=e.keywords||e.beginKeywords,delete e.beginKeywords,e.relevance===void 0&&(e.relevance=0))}function Ns(e,t){Array.isArray(e.illegal)&&(e.illegal=ft(...e.illegal))}function Is(e,t){if(e.match){if(e.begin||e.end)throw new Error("begin & end are not supported with match");e.begin=e.match,delete e.match}}function Os(e,t){e.relevance===void 0&&(e.relevance=1)}var Cs=(e,t)=>{if(!e.beforeMatch)return;if(e.starts)throw new Error("beforeMatch cannot be used with starts");let n=Object.assign({},e);Object.keys(e).forEach(s=>{delete e[s]}),e.keywords=n.keywords,e.begin=ue(n.beforeMatch,pn(n.begin)),e.starts={relevance:0,contains:[Object.assign(n,{endsParent:!0})]},e.relevance=0,delete n.beforeMatch},Ms=["of","and","for","in","not","or","if","then","parent","list","value"],Ls="keyword";function kn(e,t,n=Ls){let s=Object.create(null);return typeof e=="string"?r(n,e.split(" ")):Array.isArray(e)?r(n,e):Object.keys(e).forEach(function(o){Object.assign(s,kn(e[o],t,o))}),s;function r(o,i){t&&(i=i.map(l=>l.toLowerCase())),i.forEach(function(l){let a=l.split("|");s[a[0]]=[o,Ds(a[0],a[1])]})}}function Ds(e,t){return t?Number(t):Bs(e)?0:1}function Bs(e){return Ms.includes(e.toLowerCase())}var an={},ce=e=>{console.error(e)},on=(e,...t)=>{console.log(\`WARN: \${e}\`,...t)},ge=(e,t)=>{an[\`\${e}/\${t}\`]||(console.log(\`Deprecated as of \${e}. \${t}\`),an[\`\${e}/\${t}\`]=!0)},Ze=new Error;function xn(e,t,{key:n}){let s=0,r=e[n],o={},i={};for(let l=1;l<=t.length;l++)i[l+s]=r[l],o[l+s]=!0,s+=gn(t[l-1]);e[n]=i,e[n]._emit=o,e[n]._multi=!0}function $s(e){if(Array.isArray(e.begin)){if(e.skip||e.excludeBegin||e.returnBegin)throw ce("skip, excludeBegin, returnBegin not compatible with beginScope: {}"),Ze;if(typeof e.beginScope!="object"||e.beginScope===null)throw ce("beginScope must be object"),Ze;xn(e,e.begin,{key:"beginScope"}),e.begin=bt(e.begin,{joinWith:""})}}function Ps(e){if(Array.isArray(e.end)){if(e.skip||e.excludeEnd||e.returnEnd)throw ce("skip, excludeEnd, returnEnd not compatible with endScope: {}"),Ze;if(typeof e.endScope!="object"||e.endScope===null)throw ce("endScope must be object"),Ze;xn(e,e.end,{key:"endScope"}),e.end=bt(e.end,{joinWith:""})}}function zs(e){e.scope&&typeof e.scope=="object"&&e.scope!==null&&(e.beginScope=e.scope,delete e.scope)}function Us(e){zs(e),typeof e.beginScope=="string"&&(e.beginScope={_wrap:e.beginScope}),typeof e.endScope=="string"&&(e.endScope={_wrap:e.endScope}),$s(e),Ps(e)}function Hs(e){function t(i,l){return new RegExp(Re(i),"m"+(e.case_insensitive?"i":"")+(e.unicodeRegex?"u":"")+(l?"g":""))}class n{constructor(){this.matchIndexes={},this.regexes=[],this.matchAt=1,this.position=0}addRule(l,a){a.position=this.position++,this.matchIndexes[this.matchAt]=a,this.regexes.push([a,l]),this.matchAt+=gn(l)+1}compile(){this.regexes.length===0&&(this.exec=()=>null);let l=this.regexes.map(a=>a[1]);this.matcherRe=t(bt(l,{joinWith:"|"}),!0),this.lastIndex=0}exec(l){this.matcherRe.lastIndex=this.lastIndex;let a=this.matcherRe.exec(l);if(!a)return null;let u=a.findIndex((f,g)=>g>0&&f!==void 0),c=this.matchIndexes[u];return a.splice(0,u),Object.assign(a,c)}}class s{constructor(){this.rules=[],this.multiRegexes=[],this.count=0,this.lastIndex=0,this.regexIndex=0}getMatcher(l){if(this.multiRegexes[l])return this.multiRegexes[l];let a=new n;return this.rules.slice(l).forEach(([u,c])=>a.addRule(u,c)),a.compile(),this.multiRegexes[l]=a,a}resumingScanAtSamePosition(){return this.regexIndex!==0}considerAll(){this.regexIndex=0}addRule(l,a){this.rules.push([l,a]),a.type==="begin"&&this.count++}exec(l){let a=this.getMatcher(this.regexIndex);a.lastIndex=this.lastIndex;let u=a.exec(l);if(this.resumingScanAtSamePosition()&&!(u&&u.index===this.lastIndex)){let c=this.getMatcher(0);c.lastIndex=this.lastIndex+1,u=c.exec(l)}return u&&(this.regexIndex+=u.position+1,this.regexIndex===this.count&&this.considerAll()),u}}function r(i){let l=new s;return i.contains.forEach(a=>l.addRule(a.begin,{rule:a,type:"begin"})),i.terminatorEnd&&l.addRule(i.terminatorEnd,{type:"end"}),i.illegal&&l.addRule(i.illegal,{type:"illegal"}),l}function o(i,l){let a=i;if(i.isCompiled)return a;[As,Is,Us,Cs].forEach(c=>c(i,l)),e.compilerExtensions.forEach(c=>c(i,l)),i.__beforeBegin=null,[Rs,Ns,Os].forEach(c=>c(i,l)),i.isCompiled=!0;let u=null;return typeof i.keywords=="object"&&i.keywords.$pattern&&(i.keywords=Object.assign({},i.keywords),u=i.keywords.$pattern,delete i.keywords.$pattern),u=u||/\\w+/,i.keywords&&(i.keywords=kn(i.keywords,e.case_insensitive)),a.keywordPatternRe=t(u,!0),l&&(i.begin||(i.begin=/\\B|\\b/),a.beginRe=t(a.begin),!i.end&&!i.endsWithParent&&(i.end=/\\B|\\b/),i.end&&(a.endRe=t(a.end)),a.terminatorEnd=Re(a.end)||"",i.endsWithParent&&l.terminatorEnd&&(a.terminatorEnd+=(i.end?"|":"")+l.terminatorEnd)),i.illegal&&(a.illegalRe=t(i.illegal)),i.contains||(i.contains=[]),i.contains=[].concat(...i.contains.map(function(c){return Gs(c==="self"?i:c)})),i.contains.forEach(function(c){o(c,a)}),i.starts&&o(i.starts,l),a.matcher=r(a),a}if(e.compilerExtensions||(e.compilerExtensions=[]),e.contains&&e.contains.includes("self"))throw new Error("ERR: contains \`self\` is not supported at the top-level of a language.  See documentation.");return e.classNameAliases=ne(e.classNameAliases||{}),o(e)}function wn(e){return e?e.endsWithParent||wn(e.starts):!1}function Gs(e){return e.variants&&!e.cachedVariants&&(e.cachedVariants=e.variants.map(function(t){return ne(e,{variants:null},t)})),e.cachedVariants?e.cachedVariants:wn(e)?ne(e,{starts:e.starts?ne(e.starts):null}):Object.isFrozen(e)?ne(e):e}var Fs="11.11.1",ht=class extends Error{constructor(t,n){super(t),this.name="HTMLInjectionError",this.html=n}},ut=dn,ln=ne,cn=Symbol("nomatch"),Zs=7,En=function(e){let t=Object.create(null),n=Object.create(null),s=[],r=!0,o="Could not find the language '{}', did you forget to load/include a language module?",i={disableAutodetect:!0,name:"Plain text",contains:[]},l={ignoreUnescapedHTML:!1,throwUnescapedHTML:!1,noHighlightRe:/^(no-?highlight)$/i,languageDetectRe:/\\blang(?:uage)?-([\\w-]+)\\b/i,classPrefix:"hljs-",cssSelector:"pre code",languages:null,__emitter:gt};function a(d){return l.noHighlightRe.test(d)}function u(d){let b=d.className+" ";b+=d.parentNode?d.parentNode.className:"";let h=l.languageDetectRe.exec(b);if(h){let w=P(h[1]);return w||(on(o.replace("{}",h[1])),on("Falling back to no-highlight mode for this block.",d)),w?h[1]:"no-highlight"}return b.split(/\\s+/).find(w=>a(w)||P(w))}function c(d,b,h){let w="",v="";typeof b=="object"?(w=d,h=b.ignoreIllegals,v=b.language):(ge("10.7.0","highlight(lang, code, ...args) has been deprecated."),ge("10.7.0",\`Please use highlight(code, options) instead.
https://github.com/highlightjs/highlight.js/issues/2277\`),v=d,w=b),h===void 0&&(h=!0);let O={code:w,language:v};te("before:highlight",O);let z=O.result?O.result:f(O.language,O.code,h);return z.code=O.code,te("after:highlight",z),z}function f(d,b,h,w){let v=Object.create(null);function O(p,m){return p.keywords[m]}function z(){if(!x.keywords){L.addText(R);return}let p=0;x.keywordPatternRe.lastIndex=0;let m=x.keywordPatternRe.exec(R),_="";for(;m;){_+=R.substring(p,m.index);let A=Q.case_insensitive?m[0].toLowerCase():m[0],U=O(x,A);if(U){let[J,rr]=U;if(L.addText(_),_="",v[A]=(v[A]||0)+1,v[A]<=Zs&&(De+=rr),J.startsWith("_"))_+=m[0];else{let sr=Q.classNameAliases[J]||J;Y(m[0],sr)}}else _+=m[0];p=x.keywordPatternRe.lastIndex,m=x.keywordPatternRe.exec(R)}_+=R.substring(p),L.addText(_)}function X(){if(R==="")return;let p=null;if(typeof x.subLanguage=="string"){if(!t[x.subLanguage]){L.addText(R);return}p=f(x.subLanguage,R,!0,Dt[x.subLanguage]),Dt[x.subLanguage]=p._top}else p=E(R,x.subLanguage.length?x.subLanguage:null);x.relevance>0&&(De+=p.relevance),L.__addSublanguage(p._emitter,p.language)}function Z(){x.subLanguage!=null?X():z(),R=""}function Y(p,m){p!==""&&(L.startScope(m),L.addText(p),L.endScope())}function Ot(p,m){let _=1,A=m.length-1;for(;_<=A;){if(!p._emit[_]){_++;continue}let U=Q.classNameAliases[p[_]]||p[_],J=m[_];U?Y(J,U):(R=J,z(),R=""),_++}}function Ct(p,m){return p.scope&&typeof p.scope=="string"&&L.openNode(Q.classNameAliases[p.scope]||p.scope),p.beginScope&&(p.beginScope._wrap?(Y(R,Q.classNameAliases[p.beginScope._wrap]||p.beginScope._wrap),R=""):p.beginScope._multi&&(Ot(p.beginScope,m),R="")),x=Object.create(p,{parent:{value:x}}),x}function Mt(p,m,_){let A=os(p.endRe,_);if(A){if(p["on:end"]){let U=new Fe(p);p["on:end"](m,U),U.isMatchIgnored&&(A=!1)}if(A){for(;p.endsParent&&p.parent;)p=p.parent;return p}}if(p.endsWithParent)return Mt(p.parent,m,_)}function Vn(p){return x.matcher.regexIndex===0?(R+=p[0],1):(Qe=!0,0)}function Jn(p){let m=p[0],_=p.rule,A=new Fe(_),U=[_.__beforeBegin,_["on:begin"]];for(let J of U)if(J&&(J(p,A),A.isMatchIgnored))return Vn(m);return _.skip?R+=m:(_.excludeBegin&&(R+=m),Z(),!_.returnBegin&&!_.excludeBegin&&(R=m)),Ct(_,p),_.returnBegin?0:m.length}function er(p){let m=p[0],_=b.substring(p.index),A=Mt(x,p,_);if(!A)return cn;let U=x;x.endScope&&x.endScope._wrap?(Z(),Y(m,x.endScope._wrap)):x.endScope&&x.endScope._multi?(Z(),Ot(x.endScope,p)):U.skip?R+=m:(U.returnEnd||U.excludeEnd||(R+=m),Z(),U.excludeEnd&&(R=m));do x.scope&&L.closeNode(),!x.skip&&!x.subLanguage&&(De+=x.relevance),x=x.parent;while(x!==A.parent);return A.starts&&Ct(A.starts,p),U.returnEnd?0:m.length}function tr(){let p=[];for(let m=x;m!==Q;m=m.parent)m.scope&&p.unshift(m.scope);p.forEach(m=>L.openNode(m))}let Le={};function Lt(p,m){let _=m&&m[0];if(R+=p,_==null)return Z(),0;if(Le.type==="begin"&&m.type==="end"&&Le.index===m.index&&_===""){if(R+=b.slice(m.index,m.index+1),!r){let A=new Error(\`0 width match regex (\${d})\`);throw A.languageName=d,A.badRule=Le.rule,A}return 1}if(Le=m,m.type==="begin")return Jn(m);if(m.type==="illegal"&&!h){let A=new Error('Illegal lexeme "'+_+'" for mode "'+(x.scope||"<unnamed>")+'"');throw A.mode=x,A}else if(m.type==="end"){let A=er(m);if(A!==cn)return A}if(m.type==="illegal"&&_==="")return R+=\`
\`,1;if(Ye>1e5&&Ye>m.index*3)throw new Error("potential infinite loop, way more iterations than matches");return R+=_,_.length}let Q=P(d);if(!Q)throw ce(o.replace("{}",d)),new Error('Unknown language: "'+d+'"');let nr=Hs(Q),Xe="",x=w||nr,Dt={},L=new l.__emitter(l);tr();let R="",De=0,ie=0,Ye=0,Qe=!1;try{if(Q.__emitTokens)Q.__emitTokens(b,L);else{for(x.matcher.considerAll();;){Ye++,Qe?Qe=!1:x.matcher.considerAll(),x.matcher.lastIndex=ie;let p=x.matcher.exec(b);if(!p)break;let m=b.substring(ie,p.index),_=Lt(m,p);ie=p.index+_}Lt(b.substring(ie))}return L.finalize(),Xe=L.toHTML(),{language:d,value:Xe,relevance:De,illegal:!1,_emitter:L,_top:x}}catch(p){if(p.message&&p.message.includes("Illegal"))return{language:d,value:ut(b),illegal:!0,relevance:0,_illegalBy:{message:p.message,index:ie,context:b.slice(ie-100,ie+100),mode:p.mode,resultSoFar:Xe},_emitter:L};if(r)return{language:d,value:ut(b),illegal:!1,relevance:0,errorRaised:p,_emitter:L,_top:x};throw p}}function g(d){let b={value:ut(d),illegal:!1,relevance:0,_top:i,_emitter:new l.__emitter(l)};return b._emitter.addText(d),b}function E(d,b){b=b||l.languages||Object.keys(t);let h=g(d),w=b.filter(P).filter(pe).map(Z=>f(Z,d,!1));w.unshift(h);let v=w.sort((Z,Y)=>{if(Z.relevance!==Y.relevance)return Y.relevance-Z.relevance;if(Z.language&&Y.language){if(P(Z.language).supersetOf===Y.language)return 1;if(P(Y.language).supersetOf===Z.language)return-1}return 0}),[O,z]=v,X=O;return X.secondBest=z,X}function k(d,b,h){let w=b&&n[b]||h;d.classList.add("hljs"),d.classList.add(\`language-\${w}\`)}function y(d){let b=null,h=u(d);if(a(h))return;if(te("before:highlightElement",{el:d,language:h}),d.dataset.highlighted){console.log("Element previously highlighted. To highlight again, first unset \`dataset.highlighted\`.",d);return}if(d.children.length>0&&(l.ignoreUnescapedHTML||(console.warn("One of your code blocks includes unescaped HTML. This is a potentially serious security risk."),console.warn("https://github.com/highlightjs/highlight.js/wiki/security"),console.warn("The element with unescaped HTML:"),console.warn(d)),l.throwUnescapedHTML))throw new ht("One of your code blocks includes unescaped HTML.",d.innerHTML);b=d;let w=b.textContent,v=h?c(w,{language:h,ignoreIllegals:!0}):E(w);d.innerHTML=v.value,d.dataset.highlighted="yes",k(d,h,v.language),d.result={language:v.language,re:v.relevance,relevance:v.relevance},v.secondBest&&(d.secondBest={language:v.secondBest.language,relevance:v.secondBest.relevance}),te("after:highlightElement",{el:d,result:v,text:w})}function M(d){l=ln(l,d)}let H=()=>{$(),ge("10.6.0","initHighlighting() deprecated.  Use highlightAll() now.")};function C(){$(),ge("10.6.0","initHighlightingOnLoad() deprecated.  Use highlightAll() now.")}let B=!1;function $(){function d(){$()}if(document.readyState==="loading"){B||window.addEventListener("DOMContentLoaded",d,!1),B=!0;return}document.querySelectorAll(l.cssSelector).forEach(y)}function I(d,b){let h=null;try{h=b(e)}catch(w){if(ce("Language definition for '{}' could not be registered.".replace("{}",d)),r)ce(w);else throw w;h=i}h.name||(h.name=d),t[d]=h,h.rawDefinition=b.bind(null,e),h.aliases&&F(h.aliases,{languageName:d})}function N(d){delete t[d];for(let b of Object.keys(n))n[b]===d&&delete n[b]}function se(){return Object.keys(t)}function P(d){return d=(d||"").toLowerCase(),t[d]||t[n[d]]}function F(d,{languageName:b}){typeof d=="string"&&(d=[d]),d.forEach(h=>{n[h.toLowerCase()]=b})}function pe(d){let b=P(d);return b&&!b.disableAutodetect}function xe(d){d["before:highlightBlock"]&&!d["before:highlightElement"]&&(d["before:highlightElement"]=b=>{d["before:highlightBlock"](Object.assign({block:b.el},b))}),d["after:highlightBlock"]&&!d["after:highlightElement"]&&(d["after:highlightElement"]=b=>{d["after:highlightBlock"](Object.assign({block:b.el},b))})}function we(d){xe(d),s.push(d)}function Ee(d){let b=s.indexOf(d);b!==-1&&s.splice(b,1)}function te(d,b){let h=d;s.forEach(function(w){w[h]&&w[h](b)})}function _e(d){return ge("10.7.0","highlightBlock will be removed entirely in v12.0"),ge("10.7.0","Please use highlightElement now."),y(d)}Object.assign(e,{highlight:c,highlightAuto:E,highlightAll:$,highlightElement:y,highlightBlock:_e,configure:M,initHighlighting:H,initHighlightingOnLoad:C,registerLanguage:I,unregisterLanguage:N,listLanguages:se,getLanguage:P,registerAliases:F,autoDetection:pe,inherit:ln,addPlugin:we,removePlugin:Ee}),e.debugMode=function(){r=!1},e.safeMode=function(){r=!0},e.versionString=Fs,e.regex={concat:ue,lookahead:pn,either:ft,optional:is,anyNumberOfTimes:ss};for(let d in Ge)typeof Ge[d]=="object"&&un(Ge[d]);return Object.assign(e,Ge),e},he=En({});he.newInstance=()=>En({});_n.exports=he;he.HighlightJS=he;he.default=he});var q=null;function $t(e){function t(){q=new WebSocket("ws://"+location.host),q.onopen=function(){e.onOpen()},q.onclose=function(){q=null,e.onClose(),setTimeout(t,2e3)},q.onmessage=function(n){try{let s=JSON.parse(n.data);e.onMessage(s)}catch{}},q.onerror=function(){}}t()}function ye(e){q&&q.readyState===WebSocket.OPEN&&q.send(JSON.stringify(e))}function Pt(){return q!==null&&q.readyState===WebSocket.OPEN}function tt(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var le=tt();function qt(e){le=e}var ae={exec:()=>null};function S(e,t=""){let n=typeof e=="string"?e:e.source,s={replace:(r,o)=>{let i=typeof o=="string"?o:o.source;return i=i.replace(G.caret,"$1"),n=n.replace(r,i),s},getRegex:()=>new RegExp(n,t)};return s}var gr=(()=>{try{return!!new RegExp("(?<=1)(?<!1)")}catch{return!1}})(),G={codeRemoveIndent:/^(?: {1,4}| {0,3}\\t)/gm,outputLinkReplace:/\\\\([\\[\\]])/g,indentCodeCompensation:/^(\\s+)(?:\`\`\`)/,beginningSpace:/^\\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\\n/g,tabCharGlobal:/\\t/g,multipleSpaceGlobal:/\\s+/g,blankLine:/^[ \\t]*$/,doubleBlankLine:/\\n[ \\t]*\\n[ \\t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\\n {0,3}((?:=+|-+) *)(?=\\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \\t]?/gm,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\\[[ xX]\\] +\\S/,listReplaceTask:/^\\[[ xX]\\] +/,listTaskCheckbox:/\\[[ xX]\\]/,anyLine:/\\n.*\\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\\||\\| *$/g,tableRowBlankLine:/\\n[ \\t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\\s|>)/i,endPreScriptTag:/^<\\/(pre|code|kbd|script)(\\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\\s])\\s+(['"])(.*)\\2/,unicodeAlphaNumeric:/[\\p{L}\\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\\w+);)/g,unescapeTest:/&(#(?:\\d+)|(?:#x[0-9A-Fa-f]+)|(?:\\w+));?/ig,caret:/(^|[^\\[])\\^/g,percentDecode:/%25/g,findPipe:/\\|/g,splitPipe:/ \\|/,slashPipe:/\\\\\\|/g,carriageReturn:/\\r\\n|\\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\\S*/,endingNewline:/\\n$/,listItemRegex:e=>new RegExp(\`^( {0,3}\${e})((?:[	 ][^\\\\n]*)?(?:\\\\n|$))\`),nextBulletRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}(?:[*+-]|\\\\d{1,9}[.)])((?:[ 	][^\\\\n]*)?(?:\\\\n|$))\`),hrRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\\\* *){3,})(?:\\\\n+|$)\`),fencesBeginRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}(?:\\\`\\\`\\\`|~~~)\`),headingBeginRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}#\`),htmlBeginRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}<(?:[a-z].*>|!--)\`,"i"),blockquoteBeginRegex:e=>new RegExp(\`^ {0,\${Math.min(3,e-1)}}>\`)},hr=/^(?:[ \\t]*(?:\\n|$))+/,fr=/^((?: {4}| {0,3}\\t)[^\\n]+(?:\\n(?:[ \\t]*(?:\\n|$))*)?)+/,br=/^ {0,3}(\`{3,}(?=[^\`\\n]*(?:\\n|$))|~{3,})([^\\n]*)(?:\\n|$)(?:|([\\s\\S]*?)(?:\\n|$))(?: {0,3}\\1[~\`]* *(?=\\n|$)|$)/,Ae=/^ {0,3}((?:-[\\t ]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)/,mr=/^ {0,3}(#{1,6})(?=\\s|$)(.*)(?:\\n+|$)/,nt=/ {0,3}(?:[*+-]|\\d{1,9}[.)])/,Kt=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\\n(?!\\s*?\\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\\n {0,3}(=+|-+) *(?:\\n+|$)/,Wt=S(Kt).replace(/bull/g,nt).replace(/blockCode/g,/(?: {4}| {0,3}\\t)/).replace(/fences/g,/ {0,3}(?:\`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\\n>]+>\\n/).replace(/\\|table/g,"").getRegex(),kr=S(Kt).replace(/bull/g,nt).replace(/blockCode/g,/(?: {4}| {0,3}\\t)/).replace(/fences/g,/ {0,3}(?:\`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\\n>]+>\\n/).replace(/table/g,/ {0,3}\\|?(?:[:\\- ]*\\|)+[\\:\\- ]*\\n/).getRegex(),rt=/^([^\\n]+(?:\\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\\n)[^\\n]+)*)/,xr=/^[^\\n]+/,st=/(?!\\s*\\])(?:\\\\[\\s\\S]|[^\\[\\]\\\\])+/,wr=S(/^ {0,3}\\[(label)\\]: *(?:\\n[ \\t]*)?([^<\\s][^\\s]*|<.*?>)(?:(?: +(?:\\n[ \\t]*)?| *\\n[ \\t]*)(title))? *(?:\\n+|$)/).replace("label",st).replace("title",/(?:"(?:\\\\"?|[^"\\\\])*"|'[^'\\n]*(?:\\n[^'\\n]+)*\\n?'|\\([^()]*\\))/).getRegex(),Er=S(/^(bull)([ \\t][^\\n]+?)?(?:\\n|$)/).replace(/bull/g,nt).getRegex(),Ue="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",it=/<!--(?:-?>|[\\s\\S]*?(?:-->|$))/,_r=S("^ {0,3}(?:<(script|pre|style|textarea)[\\\\s>][\\\\s\\\\S]*?(?:</\\\\1>[^\\\\n]*\\\\n+|$)|comment[^\\\\n]*(\\\\n+|$)|<\\\\?[\\\\s\\\\S]*?(?:\\\\?>\\\\n*|$)|<![A-Z][\\\\s\\\\S]*?(?:>\\\\n*|$)|<!\\\\[CDATA\\\\[[\\\\s\\\\S]*?(?:\\\\]\\\\]>\\\\n*|$)|</?(tag)(?: +|\\\\n|/?>)[\\\\s\\\\S]*?(?:(?:\\\\n[ 	]*)+\\\\n|$)|<(?!script|pre|style|textarea)([a-z][\\\\w-]*)(?:attribute)*? */?>(?=[ \\\\t]*(?:\\\\n|$))[\\\\s\\\\S]*?(?:(?:\\\\n[ 	]*)+\\\\n|$)|</(?!script|pre|style|textarea)[a-z][\\\\w-]*\\\\s*>(?=[ \\\\t]*(?:\\\\n|$))[\\\\s\\\\S]*?(?:(?:\\\\n[ 	]*)+\\\\n|$))","i").replace("comment",it).replace("tag",Ue).replace("attribute",/ +[a-zA-Z:_][\\w.:-]*(?: *= *"[^"\\n]*"| *= *'[^'\\n]*'| *= *[^\\s"'=<>\`]+)?/).getRegex(),jt=S(rt).replace("hr",Ae).replace("heading"," {0,3}#{1,6}(?:\\\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:\`{3,}(?=[^\`\\\\n]*\\\\n)|~{3,})[^\\\\n]*\\\\n").replace("list"," {0,3}(?:[*+-]|1[.)])[ \\\\t]").replace("html","</?(?:tag)(?: +|\\\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",Ue).getRegex(),yr=S(/^( {0,3}> ?(paragraph|[^\\n]*)(?:\\n|$))+/).replace("paragraph",jt).getRegex(),at={blockquote:yr,code:fr,def:wr,fences:br,heading:mr,hr:Ae,html:_r,lheading:Wt,list:Er,newline:hr,paragraph:jt,table:ae,text:xr},zt=S("^ *([^\\\\n ].*)\\\\n {0,3}((?:\\\\| *)?:?-+:? *(?:\\\\| *:?-+:? *)*(?:\\\\| *)?)(?:\\\\n((?:(?! *\\\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\\\n|$))*)\\\\n*|$)").replace("hr",Ae).replace("heading"," {0,3}#{1,6}(?:\\\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\\\n]").replace("fences"," {0,3}(?:\`{3,}(?=[^\`\\\\n]*\\\\n)|~{3,})[^\\\\n]*\\\\n").replace("list"," {0,3}(?:[*+-]|1[.)])[ \\\\t]").replace("html","</?(?:tag)(?: +|\\\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",Ue).getRegex(),Sr={...at,lheading:kr,table:zt,paragraph:S(rt).replace("hr",Ae).replace("heading"," {0,3}#{1,6}(?:\\\\s|$)").replace("|lheading","").replace("table",zt).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:\`{3,}(?=[^\`\\\\n]*\\\\n)|~{3,})[^\\\\n]*\\\\n").replace("list"," {0,3}(?:[*+-]|1[.)])[ \\\\t]").replace("html","</?(?:tag)(?: +|\\\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",Ue).getRegex()},vr={...at,html:S(\`^ *(?:comment *(?:\\\\n|\\\\s*$)|<(tag)[\\\\s\\\\S]+?</\\\\1> *(?:\\\\n{2,}|\\\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\\\s[^'"/>\\\\s]*)*?/?> *(?:\\\\n{2,}|\\\\s*$))\`).replace("comment",it).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\\\b)\\\\w+(?!:|[^\\\\w\\\\s@]*@)\\\\b").getRegex(),def:/^ *\\[([^\\]]+)\\]: *<?([^\\s>]+)>?(?: +(["(][^\\n]+[")]))? *(?:\\n+|$)/,heading:/^(#{1,6})(.*)(?:\\n+|$)/,fences:ae,lheading:/^(.+?)\\n {0,3}(=+|-+) *(?:\\n+|$)/,paragraph:S(rt).replace("hr",Ae).replace("heading",\` *#{1,6} *[^
]\`).replace("lheading",Wt).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},Tr=/^\\\\([!"#$%&'()*+,\\-./:;<=>?@\\[\\]\\\\^_\`{|}~])/,Ar=/^(\`+)([^\`]|[^\`][\\s\\S]*?[^\`])\\1(?!\`)/,Xt=/^( {2,}|\\\\)\\n(?!\\s*$)/,Rr=/^(\`+|[^\`])(?:(?= {2,}\\n)|[\\s\\S]*?(?:(?=[\\\\<!\\[\`*_]|\\b_|$)|[^ ](?= {2,}\\n)))/,He=/[\\p{P}\\p{S}]/u,ot=/[\\s\\p{P}\\p{S}]/u,Yt=/[^\\s\\p{P}\\p{S}]/u,Nr=S(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,ot).getRegex(),Qt=/(?!~)[\\p{P}\\p{S}]/u,Ir=/(?!~)[\\s\\p{P}\\p{S}]/u,Or=/(?:[^\\s\\p{P}\\p{S}]|~)/u,Vt=/(?![*_])[\\p{P}\\p{S}]/u,Cr=/(?![*_])[\\s\\p{P}\\p{S}]/u,Mr=/(?:[^\\s\\p{P}\\p{S}]|[*_])/u,Lr=S(/link|precode-code|html/,"g").replace("link",/\\[(?:[^\\[\\]\`]|(?<a>\`+)[^\`]+\\k<a>(?!\`))*?\\]\\((?:\\\\[\\s\\S]|[^\\\\\\(\\)]|\\((?:\\\\[\\s\\S]|[^\\\\\\(\\)])*\\))*\\)/).replace("precode-",gr?"(?<!\`)()":"(^^|[^\`])").replace("code",/(?<b>\`+)[^\`]+\\k<b>(?!\`)/).replace("html",/<(?! )[^<>]*?>/).getRegex(),Jt=/^(?:\\*+(?:((?!\\*)punct)|[^\\s*]))|^_+(?:((?!_)punct)|([^\\s_]))/,Dr=S(Jt,"u").replace(/punct/g,He).getRegex(),Br=S(Jt,"u").replace(/punct/g,Qt).getRegex(),en="^[^_*]*?__[^_*]*?\\\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\\\*)punct(\\\\*+)(?=[\\\\s]|$)|notPunctSpace(\\\\*+)(?!\\\\*)(?=punctSpace|$)|(?!\\\\*)punctSpace(\\\\*+)(?=notPunctSpace)|[\\\\s](\\\\*+)(?!\\\\*)(?=punct)|(?!\\\\*)punct(\\\\*+)(?!\\\\*)(?=punct)|notPunctSpace(\\\\*+)(?=notPunctSpace)",$r=S(en,"gu").replace(/notPunctSpace/g,Yt).replace(/punctSpace/g,ot).replace(/punct/g,He).getRegex(),Pr=S(en,"gu").replace(/notPunctSpace/g,Or).replace(/punctSpace/g,Ir).replace(/punct/g,Qt).getRegex(),zr=S("^[^_*]*?\\\\*\\\\*[^_*]*?_[^_*]*?(?=\\\\*\\\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,Yt).replace(/punctSpace/g,ot).replace(/punct/g,He).getRegex(),Ur=S(/^~~?(?:((?!~)punct)|[^\\s~])/,"u").replace(/punct/g,Vt).getRegex(),Hr="^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)",Gr=S(Hr,"gu").replace(/notPunctSpace/g,Mr).replace(/punctSpace/g,Cr).replace(/punct/g,Vt).getRegex(),Fr=S(/\\\\(punct)/,"gu").replace(/punct/g,He).getRegex(),Zr=S(/^<(scheme:[^\\s\\x00-\\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_\`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),qr=S(it).replace("(?:-->|$)","-->").getRegex(),Kr=S("^comment|^</[a-zA-Z][\\\\w:-]*\\\\s*>|^<[a-zA-Z][\\\\w-]*(?:attribute)*?\\\\s*/?>|^<\\\\?[\\\\s\\\\S]*?\\\\?>|^<![a-zA-Z]+\\\\s[\\\\s\\\\S]*?>|^<!\\\\[CDATA\\\\[[\\\\s\\\\S]*?\\\\]\\\\]>").replace("comment",qr).replace("attribute",/\\s+[a-zA-Z:_][\\w.:-]*(?:\\s*=\\s*"[^"]*"|\\s*=\\s*'[^']*'|\\s*=\\s*[^\\s"'=<>\`]+)?/).getRegex(),$e=/(?:\\[(?:\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]|\\\\[\\s\\S]|\`+[^\`]*?\`+(?!\`)|[^\\[\\]\\\\\`])*?/,Wr=S(/^!?\\[(label)\\]\\(\\s*(href)(?:(?:[ \\t]*(?:\\n[ \\t]*)?)(title))?\\s*\\)/).replace("label",$e).replace("href",/<(?:\\\\.|[^\\n<>\\\\])+>|[^ \\t\\n\\x00-\\x1f]*/).replace("title",/"(?:\\\\"?|[^"\\\\])*"|'(?:\\\\'?|[^'\\\\])*'|\\((?:\\\\\\)?|[^)\\\\])*\\)/).getRegex(),tn=S(/^!?\\[(label)\\]\\[(ref)\\]/).replace("label",$e).replace("ref",st).getRegex(),nn=S(/^!?\\[(ref)\\](?:\\[\\])?/).replace("ref",st).getRegex(),jr=S("reflink|nolink(?!\\\\()","g").replace("reflink",tn).replace("nolink",nn).getRegex(),Ut=/[hH][tT][tT][pP][sS]?|[fF][tT][pP]/,lt={_backpedal:ae,anyPunctuation:Fr,autolink:Zr,blockSkip:Lr,br:Xt,code:Ar,del:ae,delLDelim:ae,delRDelim:ae,emStrongLDelim:Dr,emStrongRDelimAst:$r,emStrongRDelimUnd:zr,escape:Tr,link:Wr,nolink:nn,punctuation:Nr,reflink:tn,reflinkSearch:jr,tag:Kr,text:Rr,url:ae},Xr={...lt,link:S(/^!?\\[(label)\\]\\((.*?)\\)/).replace("label",$e).getRegex(),reflink:S(/^!?\\[(label)\\]\\s*\\[([^\\]]*)\\]/).replace("label",$e).getRegex()},Ve={...lt,emStrongRDelimAst:Pr,emStrongLDelim:Br,delLDelim:Ur,delRDelim:Gr,url:S(/^((?:protocol):\\/\\/|www\\.)(?:[a-zA-Z0-9\\-]+\\.?)+[^\\s<]*|^email/).replace("protocol",Ut).replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\\([^)]*\\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\\s~])((?:\\\\[\\s\\S]|[^\\\\])*?(?:\\\\[\\s\\S]|[^\\s~\\\\]))\\1(?=[^~]|$)/,text:S(/^([\`~]+|[^\`~])(?:(?= {2,}\\n)|(?=[a-zA-Z0-9.!#$%&'*+\\/=?_\`{\\|}~-]+@)|[\\s\\S]*?(?:(?=[\\\\<!\\[\`*~_]|\\b_|protocol:\\/\\/|www\\.|$)|[^ ](?= {2,}\\n)|[^a-zA-Z0-9.!#$%&'*+\\/=?_\`{\\|}~-](?=[a-zA-Z0-9.!#$%&'*+\\/=?_\`{\\|}~-]+@)))/).replace("protocol",Ut).getRegex()},Yr={...Ve,br:S(Xt).replace("{2,}","*").getRegex(),text:S(Ve.text).replace("\\\\b_","\\\\b_| {2,}\\\\n").replace(/\\{2,\\}/g,"*").getRegex()},Be={normal:at,gfm:Sr,pedantic:vr},Se={normal:lt,gfm:Ve,breaks:Yr,pedantic:Xr},Qr={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},Ht=e=>Qr[e];function V(e,t){if(t){if(G.escapeTest.test(e))return e.replace(G.escapeReplace,Ht)}else if(G.escapeTestNoEncode.test(e))return e.replace(G.escapeReplaceNoEncode,Ht);return e}function Gt(e){try{e=encodeURI(e).replace(G.percentDecode,"%")}catch{return null}return e}function Ft(e,t){let n=e.replace(G.findPipe,(o,i,l)=>{let a=!1,u=i;for(;--u>=0&&l[u]==="\\\\";)a=!a;return a?"|":" |"}),s=n.split(G.splitPipe),r=0;if(s[0].trim()||s.shift(),s.length>0&&!s.at(-1)?.trim()&&s.pop(),t)if(s.length>t)s.splice(t);else for(;s.length<t;)s.push("");for(;r<s.length;r++)s[r]=s[r].trim().replace(G.slashPipe,"|");return s}function ve(e,t,n){let s=e.length;if(s===0)return"";let r=0;for(;r<s;){let o=e.charAt(s-r-1);if(o===t&&!n)r++;else if(o!==t&&n)r++;else break}return e.slice(0,s-r)}function Vr(e,t){if(e.indexOf(t[1])===-1)return-1;let n=0;for(let s=0;s<e.length;s++)if(e[s]==="\\\\")s++;else if(e[s]===t[0])n++;else if(e[s]===t[1]&&(n--,n<0))return s;return n>0?-2:-1}function Jr(e,t=0){let n=t,s="";for(let r of e)if(r==="	"){let o=4-n%4;s+=" ".repeat(o),n+=o}else s+=r,n++;return s}function Zt(e,t,n,s,r){let o=t.href,i=t.title||null,l=e[1].replace(r.other.outputLinkReplace,"$1");s.state.inLink=!0;let a={type:e[0].charAt(0)==="!"?"image":"link",raw:n,href:o,title:i,text:l,tokens:s.inlineTokens(l)};return s.state.inLink=!1,a}function es(e,t,n){let s=e.match(n.other.indentCodeCompensation);if(s===null)return t;let r=s[1];return t.split(\`
\`).map(o=>{let i=o.match(n.other.beginningSpace);if(i===null)return o;let[l]=i;return l.length>=r.length?o.slice(r.length):o}).join(\`
\`)}var Pe=class{options;rules;lexer;constructor(e){this.options=e||le}space(e){let t=this.rules.block.newline.exec(e);if(t&&t[0].length>0)return{type:"space",raw:t[0]}}code(e){let t=this.rules.block.code.exec(e);if(t){let n=t[0].replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:t[0],codeBlockStyle:"indented",text:this.options.pedantic?n:ve(n,\`
\`)}}}fences(e){let t=this.rules.block.fences.exec(e);if(t){let n=t[0],s=es(n,t[3]||"",this.rules);return{type:"code",raw:n,lang:t[2]?t[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):t[2],text:s}}}heading(e){let t=this.rules.block.heading.exec(e);if(t){let n=t[2].trim();if(this.rules.other.endingHash.test(n)){let s=ve(n,"#");(this.options.pedantic||!s||this.rules.other.endingSpaceChar.test(s))&&(n=s.trim())}return{type:"heading",raw:t[0],depth:t[1].length,text:n,tokens:this.lexer.inline(n)}}}hr(e){let t=this.rules.block.hr.exec(e);if(t)return{type:"hr",raw:ve(t[0],\`
\`)}}blockquote(e){let t=this.rules.block.blockquote.exec(e);if(t){let n=ve(t[0],\`
\`).split(\`
\`),s="",r="",o=[];for(;n.length>0;){let i=!1,l=[],a;for(a=0;a<n.length;a++)if(this.rules.other.blockquoteStart.test(n[a]))l.push(n[a]),i=!0;else if(!i)l.push(n[a]);else break;n=n.slice(a);let u=l.join(\`
\`),c=u.replace(this.rules.other.blockquoteSetextReplace,\`
    $1\`).replace(this.rules.other.blockquoteSetextReplace2,"");s=s?\`\${s}
\${u}\`:u,r=r?\`\${r}
\${c}\`:c;let f=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(c,o,!0),this.lexer.state.top=f,n.length===0)break;let g=o.at(-1);if(g?.type==="code")break;if(g?.type==="blockquote"){let E=g,k=E.raw+\`
\`+n.join(\`
\`),y=this.blockquote(k);o[o.length-1]=y,s=s.substring(0,s.length-E.raw.length)+y.raw,r=r.substring(0,r.length-E.text.length)+y.text;break}else if(g?.type==="list"){let E=g,k=E.raw+\`
\`+n.join(\`
\`),y=this.list(k);o[o.length-1]=y,s=s.substring(0,s.length-g.raw.length)+y.raw,r=r.substring(0,r.length-E.raw.length)+y.raw,n=k.substring(o.at(-1).raw.length).split(\`
\`);continue}}return{type:"blockquote",raw:s,tokens:o,text:r}}}list(e){let t=this.rules.block.list.exec(e);if(t){let n=t[1].trim(),s=n.length>1,r={type:"list",raw:"",ordered:s,start:s?+n.slice(0,-1):"",loose:!1,items:[]};n=s?\`\\\\d{1,9}\\\\\${n.slice(-1)}\`:\`\\\\\${n}\`,this.options.pedantic&&(n=s?n:"[*+-]");let o=this.rules.other.listItemRegex(n),i=!1;for(;e;){let a=!1,u="",c="";if(!(t=o.exec(e))||this.rules.block.hr.test(e))break;u=t[0],e=e.substring(u.length);let f=Jr(t[2].split(\`
\`,1)[0],t[1].length),g=e.split(\`
\`,1)[0],E=!f.trim(),k=0;if(this.options.pedantic?(k=2,c=f.trimStart()):E?k=t[1].length+1:(k=f.search(this.rules.other.nonSpaceChar),k=k>4?1:k,c=f.slice(k),k+=t[1].length),E&&this.rules.other.blankLine.test(g)&&(u+=g+\`
\`,e=e.substring(g.length+1),a=!0),!a){let y=this.rules.other.nextBulletRegex(k),M=this.rules.other.hrRegex(k),H=this.rules.other.fencesBeginRegex(k),C=this.rules.other.headingBeginRegex(k),B=this.rules.other.htmlBeginRegex(k),$=this.rules.other.blockquoteBeginRegex(k);for(;e;){let I=e.split(\`
\`,1)[0],N;if(g=I,this.options.pedantic?(g=g.replace(this.rules.other.listReplaceNesting,"  "),N=g):N=g.replace(this.rules.other.tabCharGlobal,"    "),H.test(g)||C.test(g)||B.test(g)||$.test(g)||y.test(g)||M.test(g))break;if(N.search(this.rules.other.nonSpaceChar)>=k||!g.trim())c+=\`
\`+N.slice(k);else{if(E||f.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||H.test(f)||C.test(f)||M.test(f))break;c+=\`
\`+g}E=!g.trim(),u+=I+\`
\`,e=e.substring(I.length+1),f=N.slice(k)}}r.loose||(i?r.loose=!0:this.rules.other.doubleBlankLine.test(u)&&(i=!0)),r.items.push({type:"list_item",raw:u,task:!!this.options.gfm&&this.rules.other.listIsTask.test(c),loose:!1,text:c,tokens:[]}),r.raw+=u}let l=r.items.at(-1);if(l)l.raw=l.raw.trimEnd(),l.text=l.text.trimEnd();else return;r.raw=r.raw.trimEnd();for(let a of r.items){if(this.lexer.state.top=!1,a.tokens=this.lexer.blockTokens(a.text,[]),a.task){if(a.text=a.text.replace(this.rules.other.listReplaceTask,""),a.tokens[0]?.type==="text"||a.tokens[0]?.type==="paragraph"){a.tokens[0].raw=a.tokens[0].raw.replace(this.rules.other.listReplaceTask,""),a.tokens[0].text=a.tokens[0].text.replace(this.rules.other.listReplaceTask,"");for(let c=this.lexer.inlineQueue.length-1;c>=0;c--)if(this.rules.other.listIsTask.test(this.lexer.inlineQueue[c].src)){this.lexer.inlineQueue[c].src=this.lexer.inlineQueue[c].src.replace(this.rules.other.listReplaceTask,"");break}}let u=this.rules.other.listTaskCheckbox.exec(a.raw);if(u){let c={type:"checkbox",raw:u[0]+" ",checked:u[0]!=="[ ]"};a.checked=c.checked,r.loose?a.tokens[0]&&["paragraph","text"].includes(a.tokens[0].type)&&"tokens"in a.tokens[0]&&a.tokens[0].tokens?(a.tokens[0].raw=c.raw+a.tokens[0].raw,a.tokens[0].text=c.raw+a.tokens[0].text,a.tokens[0].tokens.unshift(c)):a.tokens.unshift({type:"paragraph",raw:c.raw,text:c.raw,tokens:[c]}):a.tokens.unshift(c)}}if(!r.loose){let u=a.tokens.filter(f=>f.type==="space"),c=u.length>0&&u.some(f=>this.rules.other.anyLine.test(f.raw));r.loose=c}}if(r.loose)for(let a of r.items){a.loose=!0;for(let u of a.tokens)u.type==="text"&&(u.type="paragraph")}return r}}html(e){let t=this.rules.block.html.exec(e);if(t)return{type:"html",block:!0,raw:t[0],pre:t[1]==="pre"||t[1]==="script"||t[1]==="style",text:t[0]}}def(e){let t=this.rules.block.def.exec(e);if(t){let n=t[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),s=t[2]?t[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",r=t[3]?t[3].substring(1,t[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):t[3];return{type:"def",tag:n,raw:t[0],href:s,title:r}}}table(e){let t=this.rules.block.table.exec(e);if(!t||!this.rules.other.tableDelimiter.test(t[2]))return;let n=Ft(t[1]),s=t[2].replace(this.rules.other.tableAlignChars,"").split("|"),r=t[3]?.trim()?t[3].replace(this.rules.other.tableRowBlankLine,"").split(\`
\`):[],o={type:"table",raw:t[0],header:[],align:[],rows:[]};if(n.length===s.length){for(let i of s)this.rules.other.tableAlignRight.test(i)?o.align.push("right"):this.rules.other.tableAlignCenter.test(i)?o.align.push("center"):this.rules.other.tableAlignLeft.test(i)?o.align.push("left"):o.align.push(null);for(let i=0;i<n.length;i++)o.header.push({text:n[i],tokens:this.lexer.inline(n[i]),header:!0,align:o.align[i]});for(let i of r)o.rows.push(Ft(i,o.header.length).map((l,a)=>({text:l,tokens:this.lexer.inline(l),header:!1,align:o.align[a]})));return o}}lheading(e){let t=this.rules.block.lheading.exec(e);if(t)return{type:"heading",raw:t[0],depth:t[2].charAt(0)==="="?1:2,text:t[1],tokens:this.lexer.inline(t[1])}}paragraph(e){let t=this.rules.block.paragraph.exec(e);if(t){let n=t[1].charAt(t[1].length-1)===\`
\`?t[1].slice(0,-1):t[1];return{type:"paragraph",raw:t[0],text:n,tokens:this.lexer.inline(n)}}}text(e){let t=this.rules.block.text.exec(e);if(t)return{type:"text",raw:t[0],text:t[0],tokens:this.lexer.inline(t[0])}}escape(e){let t=this.rules.inline.escape.exec(e);if(t)return{type:"escape",raw:t[0],text:t[1]}}tag(e){let t=this.rules.inline.tag.exec(e);if(t)return!this.lexer.state.inLink&&this.rules.other.startATag.test(t[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(t[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(t[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(t[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:t[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:t[0]}}link(e){let t=this.rules.inline.link.exec(e);if(t){let n=t[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(n)){if(!this.rules.other.endAngleBracket.test(n))return;let o=ve(n.slice(0,-1),"\\\\");if((n.length-o.length)%2===0)return}else{let o=Vr(t[2],"()");if(o===-2)return;if(o>-1){let i=(t[0].indexOf("!")===0?5:4)+t[1].length+o;t[2]=t[2].substring(0,o),t[0]=t[0].substring(0,i).trim(),t[3]=""}}let s=t[2],r="";if(this.options.pedantic){let o=this.rules.other.pedanticHrefTitle.exec(s);o&&(s=o[1],r=o[3])}else r=t[3]?t[3].slice(1,-1):"";return s=s.trim(),this.rules.other.startAngleBracket.test(s)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(n)?s=s.slice(1):s=s.slice(1,-1)),Zt(t,{href:s&&s.replace(this.rules.inline.anyPunctuation,"$1"),title:r&&r.replace(this.rules.inline.anyPunctuation,"$1")},t[0],this.lexer,this.rules)}}reflink(e,t){let n;if((n=this.rules.inline.reflink.exec(e))||(n=this.rules.inline.nolink.exec(e))){let s=(n[2]||n[1]).replace(this.rules.other.multipleSpaceGlobal," "),r=t[s.toLowerCase()];if(!r){let o=n[0].charAt(0);return{type:"text",raw:o,text:o}}return Zt(n,r,n[0],this.lexer,this.rules)}}emStrong(e,t,n=""){let s=this.rules.inline.emStrongLDelim.exec(e);if(!(!s||s[3]&&n.match(this.rules.other.unicodeAlphaNumeric))&&(!(s[1]||s[2])||!n||this.rules.inline.punctuation.exec(n))){let r=[...s[0]].length-1,o,i,l=r,a=0,u=s[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(u.lastIndex=0,t=t.slice(-1*e.length+r);(s=u.exec(t))!=null;){if(o=s[1]||s[2]||s[3]||s[4]||s[5]||s[6],!o)continue;if(i=[...o].length,s[3]||s[4]){l+=i;continue}else if((s[5]||s[6])&&r%3&&!((r+i)%3)){a+=i;continue}if(l-=i,l>0)continue;i=Math.min(i,i+l+a);let c=[...s[0]][0].length,f=e.slice(0,r+s.index+c+i);if(Math.min(r,i)%2){let E=f.slice(1,-1);return{type:"em",raw:f,text:E,tokens:this.lexer.inlineTokens(E)}}let g=f.slice(2,-2);return{type:"strong",raw:f,text:g,tokens:this.lexer.inlineTokens(g)}}}}codespan(e){let t=this.rules.inline.code.exec(e);if(t){let n=t[2].replace(this.rules.other.newLineCharGlobal," "),s=this.rules.other.nonSpaceChar.test(n),r=this.rules.other.startingSpaceChar.test(n)&&this.rules.other.endingSpaceChar.test(n);return s&&r&&(n=n.substring(1,n.length-1)),{type:"codespan",raw:t[0],text:n}}}br(e){let t=this.rules.inline.br.exec(e);if(t)return{type:"br",raw:t[0]}}del(e,t,n=""){let s=this.rules.inline.delLDelim.exec(e);if(s&&(!s[1]||!n||this.rules.inline.punctuation.exec(n))){let r=[...s[0]].length-1,o,i,l=r,a=this.rules.inline.delRDelim;for(a.lastIndex=0,t=t.slice(-1*e.length+r);(s=a.exec(t))!=null;){if(o=s[1]||s[2]||s[3]||s[4]||s[5]||s[6],!o||(i=[...o].length,i!==r))continue;if(s[3]||s[4]){l+=i;continue}if(l-=i,l>0)continue;i=Math.min(i,i+l);let u=[...s[0]][0].length,c=e.slice(0,r+s.index+u+i),f=c.slice(r,-r);return{type:"del",raw:c,text:f,tokens:this.lexer.inlineTokens(f)}}}}autolink(e){let t=this.rules.inline.autolink.exec(e);if(t){let n,s;return t[2]==="@"?(n=t[1],s="mailto:"+n):(n=t[1],s=n),{type:"link",raw:t[0],text:n,href:s,tokens:[{type:"text",raw:n,text:n}]}}}url(e){let t;if(t=this.rules.inline.url.exec(e)){let n,s;if(t[2]==="@")n=t[0],s="mailto:"+n;else{let r;do r=t[0],t[0]=this.rules.inline._backpedal.exec(t[0])?.[0]??"";while(r!==t[0]);n=t[0],t[1]==="www."?s="http://"+t[0]:s=t[0]}return{type:"link",raw:t[0],text:n,href:s,tokens:[{type:"text",raw:n,text:n}]}}}inlineText(e){let t=this.rules.inline.text.exec(e);if(t){let n=this.lexer.state.inRawBlock;return{type:"text",raw:t[0],text:t[0],escaped:n}}}},K=class Je{tokens;options;state;inlineQueue;tokenizer;constructor(t){this.tokens=[],this.tokens.links=Object.create(null),this.options=t||le,this.options.tokenizer=this.options.tokenizer||new Pe,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};let n={other:G,block:Be.normal,inline:Se.normal};this.options.pedantic?(n.block=Be.pedantic,n.inline=Se.pedantic):this.options.gfm&&(n.block=Be.gfm,this.options.breaks?n.inline=Se.breaks:n.inline=Se.gfm),this.tokenizer.rules=n}static get rules(){return{block:Be,inline:Se}}static lex(t,n){return new Je(n).lex(t)}static lexInline(t,n){return new Je(n).inlineTokens(t)}lex(t){t=t.replace(G.carriageReturn,\`
\`),this.blockTokens(t,this.tokens);for(let n=0;n<this.inlineQueue.length;n++){let s=this.inlineQueue[n];this.inlineTokens(s.src,s.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(t,n=[],s=!1){for(this.options.pedantic&&(t=t.replace(G.tabCharGlobal,"    ").replace(G.spaceLine,""));t;){let r;if(this.options.extensions?.block?.some(i=>(r=i.call({lexer:this},t,n))?(t=t.substring(r.raw.length),n.push(r),!0):!1))continue;if(r=this.tokenizer.space(t)){t=t.substring(r.raw.length);let i=n.at(-1);r.raw.length===1&&i!==void 0?i.raw+=\`
\`:n.push(r);continue}if(r=this.tokenizer.code(t)){t=t.substring(r.raw.length);let i=n.at(-1);i?.type==="paragraph"||i?.type==="text"?(i.raw+=(i.raw.endsWith(\`
\`)?"":\`
\`)+r.raw,i.text+=\`
\`+r.text,this.inlineQueue.at(-1).src=i.text):n.push(r);continue}if(r=this.tokenizer.fences(t)){t=t.substring(r.raw.length),n.push(r);continue}if(r=this.tokenizer.heading(t)){t=t.substring(r.raw.length),n.push(r);continue}if(r=this.tokenizer.hr(t)){t=t.substring(r.raw.length),n.push(r);continue}if(r=this.tokenizer.blockquote(t)){t=t.substring(r.raw.length),n.push(r);continue}if(r=this.tokenizer.list(t)){t=t.substring(r.raw.length),n.push(r);continue}if(r=this.tokenizer.html(t)){t=t.substring(r.raw.length),n.push(r);continue}if(r=this.tokenizer.def(t)){t=t.substring(r.raw.length);let i=n.at(-1);i?.type==="paragraph"||i?.type==="text"?(i.raw+=(i.raw.endsWith(\`
\`)?"":\`
\`)+r.raw,i.text+=\`
\`+r.raw,this.inlineQueue.at(-1).src=i.text):this.tokens.links[r.tag]||(this.tokens.links[r.tag]={href:r.href,title:r.title},n.push(r));continue}if(r=this.tokenizer.table(t)){t=t.substring(r.raw.length),n.push(r);continue}if(r=this.tokenizer.lheading(t)){t=t.substring(r.raw.length),n.push(r);continue}let o=t;if(this.options.extensions?.startBlock){let i=1/0,l=t.slice(1),a;this.options.extensions.startBlock.forEach(u=>{a=u.call({lexer:this},l),typeof a=="number"&&a>=0&&(i=Math.min(i,a))}),i<1/0&&i>=0&&(o=t.substring(0,i+1))}if(this.state.top&&(r=this.tokenizer.paragraph(o))){let i=n.at(-1);s&&i?.type==="paragraph"?(i.raw+=(i.raw.endsWith(\`
\`)?"":\`
\`)+r.raw,i.text+=\`
\`+r.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=i.text):n.push(r),s=o.length!==t.length,t=t.substring(r.raw.length);continue}if(r=this.tokenizer.text(t)){t=t.substring(r.raw.length);let i=n.at(-1);i?.type==="text"?(i.raw+=(i.raw.endsWith(\`
\`)?"":\`
\`)+r.raw,i.text+=\`
\`+r.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=i.text):n.push(r);continue}if(t){let i="Infinite loop on byte: "+t.charCodeAt(0);if(this.options.silent){console.error(i);break}else throw new Error(i)}}return this.state.top=!0,n}inline(t,n=[]){return this.inlineQueue.push({src:t,tokens:n}),n}inlineTokens(t,n=[]){let s=t,r=null;if(this.tokens.links){let a=Object.keys(this.tokens.links);if(a.length>0)for(;(r=this.tokenizer.rules.inline.reflinkSearch.exec(s))!=null;)a.includes(r[0].slice(r[0].lastIndexOf("[")+1,-1))&&(s=s.slice(0,r.index)+"["+"a".repeat(r[0].length-2)+"]"+s.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(r=this.tokenizer.rules.inline.anyPunctuation.exec(s))!=null;)s=s.slice(0,r.index)+"++"+s.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);let o;for(;(r=this.tokenizer.rules.inline.blockSkip.exec(s))!=null;)o=r[2]?r[2].length:0,s=s.slice(0,r.index+o)+"["+"a".repeat(r[0].length-o-2)+"]"+s.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);s=this.options.hooks?.emStrongMask?.call({lexer:this},s)??s;let i=!1,l="";for(;t;){i||(l=""),i=!1;let a;if(this.options.extensions?.inline?.some(c=>(a=c.call({lexer:this},t,n))?(t=t.substring(a.raw.length),n.push(a),!0):!1))continue;if(a=this.tokenizer.escape(t)){t=t.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.tag(t)){t=t.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.link(t)){t=t.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.reflink(t,this.tokens.links)){t=t.substring(a.raw.length);let c=n.at(-1);a.type==="text"&&c?.type==="text"?(c.raw+=a.raw,c.text+=a.text):n.push(a);continue}if(a=this.tokenizer.emStrong(t,s,l)){t=t.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.codespan(t)){t=t.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.br(t)){t=t.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.del(t,s,l)){t=t.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.autolink(t)){t=t.substring(a.raw.length),n.push(a);continue}if(!this.state.inLink&&(a=this.tokenizer.url(t))){t=t.substring(a.raw.length),n.push(a);continue}let u=t;if(this.options.extensions?.startInline){let c=1/0,f=t.slice(1),g;this.options.extensions.startInline.forEach(E=>{g=E.call({lexer:this},f),typeof g=="number"&&g>=0&&(c=Math.min(c,g))}),c<1/0&&c>=0&&(u=t.substring(0,c+1))}if(a=this.tokenizer.inlineText(u)){t=t.substring(a.raw.length),a.raw.slice(-1)!=="_"&&(l=a.raw.slice(-1)),i=!0;let c=n.at(-1);c?.type==="text"?(c.raw+=a.raw,c.text+=a.text):n.push(a);continue}if(t){let c="Infinite loop on byte: "+t.charCodeAt(0);if(this.options.silent){console.error(c);break}else throw new Error(c)}}return n}},ze=class{options;parser;constructor(e){this.options=e||le}space(e){return""}code({text:e,lang:t,escaped:n}){let s=(t||"").match(G.notSpaceStart)?.[0],r=e.replace(G.endingNewline,"")+\`
\`;return s?'<pre><code class="language-'+V(s)+'">'+(n?r:V(r,!0))+\`</code></pre>
\`:"<pre><code>"+(n?r:V(r,!0))+\`</code></pre>
\`}blockquote({tokens:e}){return\`<blockquote>
\${this.parser.parse(e)}</blockquote>
\`}html({text:e}){return e}def(e){return""}heading({tokens:e,depth:t}){return\`<h\${t}>\${this.parser.parseInline(e)}</h\${t}>
\`}hr(e){return\`<hr>
\`}list(e){let t=e.ordered,n=e.start,s="";for(let i=0;i<e.items.length;i++){let l=e.items[i];s+=this.listitem(l)}let r=t?"ol":"ul",o=t&&n!==1?' start="'+n+'"':"";return"<"+r+o+\`>
\`+s+"</"+r+\`>
\`}listitem(e){return\`<li>\${this.parser.parse(e.tokens)}</li>
\`}checkbox({checked:e}){return"<input "+(e?'checked="" ':"")+'disabled="" type="checkbox"> '}paragraph({tokens:e}){return\`<p>\${this.parser.parseInline(e)}</p>
\`}table(e){let t="",n="";for(let r=0;r<e.header.length;r++)n+=this.tablecell(e.header[r]);t+=this.tablerow({text:n});let s="";for(let r=0;r<e.rows.length;r++){let o=e.rows[r];n="";for(let i=0;i<o.length;i++)n+=this.tablecell(o[i]);s+=this.tablerow({text:n})}return s&&(s=\`<tbody>\${s}</tbody>\`),\`<table>
<thead>
\`+t+\`</thead>
\`+s+\`</table>
\`}tablerow({text:e}){return\`<tr>
\${e}</tr>
\`}tablecell(e){let t=this.parser.parseInline(e.tokens),n=e.header?"th":"td";return(e.align?\`<\${n} align="\${e.align}">\`:\`<\${n}>\`)+t+\`</\${n}>
\`}strong({tokens:e}){return\`<strong>\${this.parser.parseInline(e)}</strong>\`}em({tokens:e}){return\`<em>\${this.parser.parseInline(e)}</em>\`}codespan({text:e}){return\`<code>\${V(e,!0)}</code>\`}br(e){return"<br>"}del({tokens:e}){return\`<del>\${this.parser.parseInline(e)}</del>\`}link({href:e,title:t,tokens:n}){let s=this.parser.parseInline(n),r=Gt(e);if(r===null)return s;e=r;let o='<a href="'+e+'"';return t&&(o+=' title="'+V(t)+'"'),o+=">"+s+"</a>",o}image({href:e,title:t,text:n,tokens:s}){s&&(n=this.parser.parseInline(s,this.parser.textRenderer));let r=Gt(e);if(r===null)return V(n);e=r;let o=\`<img src="\${e}" alt="\${V(n)}"\`;return t&&(o+=\` title="\${V(t)}"\`),o+=">",o}text(e){return"tokens"in e&&e.tokens?this.parser.parseInline(e.tokens):"escaped"in e&&e.escaped?e.text:V(e.text)}},ct=class{strong({text:e}){return e}em({text:e}){return e}codespan({text:e}){return e}del({text:e}){return e}html({text:e}){return e}text({text:e}){return e}link({text:e}){return""+e}image({text:e}){return""+e}br(){return""}checkbox({raw:e}){return e}},W=class et{options;renderer;textRenderer;constructor(t){this.options=t||le,this.options.renderer=this.options.renderer||new ze,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new ct}static parse(t,n){return new et(n).parse(t)}static parseInline(t,n){return new et(n).parseInline(t)}parse(t){let n="";for(let s=0;s<t.length;s++){let r=t[s];if(this.options.extensions?.renderers?.[r.type]){let i=r,l=this.options.extensions.renderers[i.type].call({parser:this},i);if(l!==!1||!["space","hr","heading","code","table","blockquote","list","html","def","paragraph","text"].includes(i.type)){n+=l||"";continue}}let o=r;switch(o.type){case"space":{n+=this.renderer.space(o);break}case"hr":{n+=this.renderer.hr(o);break}case"heading":{n+=this.renderer.heading(o);break}case"code":{n+=this.renderer.code(o);break}case"table":{n+=this.renderer.table(o);break}case"blockquote":{n+=this.renderer.blockquote(o);break}case"list":{n+=this.renderer.list(o);break}case"checkbox":{n+=this.renderer.checkbox(o);break}case"html":{n+=this.renderer.html(o);break}case"def":{n+=this.renderer.def(o);break}case"paragraph":{n+=this.renderer.paragraph(o);break}case"text":{n+=this.renderer.text(o);break}default:{let i='Token with "'+o.type+'" type was not found.';if(this.options.silent)return console.error(i),"";throw new Error(i)}}}return n}parseInline(t,n=this.renderer){let s="";for(let r=0;r<t.length;r++){let o=t[r];if(this.options.extensions?.renderers?.[o.type]){let l=this.options.extensions.renderers[o.type].call({parser:this},o);if(l!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(o.type)){s+=l||"";continue}}let i=o;switch(i.type){case"escape":{s+=n.text(i);break}case"html":{s+=n.html(i);break}case"link":{s+=n.link(i);break}case"image":{s+=n.image(i);break}case"checkbox":{s+=n.checkbox(i);break}case"strong":{s+=n.strong(i);break}case"em":{s+=n.em(i);break}case"codespan":{s+=n.codespan(i);break}case"br":{s+=n.br(i);break}case"del":{s+=n.del(i);break}case"text":{s+=n.text(i);break}default:{let l='Token with "'+i.type+'" type was not found.';if(this.options.silent)return console.error(l),"";throw new Error(l)}}}return s}},Te=class{options;block;constructor(e){this.options=e||le}static passThroughHooks=new Set(["preprocess","postprocess","processAllTokens","emStrongMask"]);static passThroughHooksRespectAsync=new Set(["preprocess","postprocess","processAllTokens"]);preprocess(e){return e}postprocess(e){return e}processAllTokens(e){return e}emStrongMask(e){return e}provideLexer(){return this.block?K.lex:K.lexInline}provideParser(){return this.block?W.parse:W.parseInline}},ts=class{defaults=tt();options=this.setOptions;parse=this.parseMarkdown(!0);parseInline=this.parseMarkdown(!1);Parser=W;Renderer=ze;TextRenderer=ct;Lexer=K;Tokenizer=Pe;Hooks=Te;constructor(...e){this.use(...e)}walkTokens(e,t){let n=[];for(let s of e)switch(n=n.concat(t.call(this,s)),s.type){case"table":{let r=s;for(let o of r.header)n=n.concat(this.walkTokens(o.tokens,t));for(let o of r.rows)for(let i of o)n=n.concat(this.walkTokens(i.tokens,t));break}case"list":{let r=s;n=n.concat(this.walkTokens(r.items,t));break}default:{let r=s;this.defaults.extensions?.childTokens?.[r.type]?this.defaults.extensions.childTokens[r.type].forEach(o=>{let i=r[o].flat(1/0);n=n.concat(this.walkTokens(i,t))}):r.tokens&&(n=n.concat(this.walkTokens(r.tokens,t)))}}return n}use(...e){let t=this.defaults.extensions||{renderers:{},childTokens:{}};return e.forEach(n=>{let s={...n};if(s.async=this.defaults.async||s.async||!1,n.extensions&&(n.extensions.forEach(r=>{if(!r.name)throw new Error("extension name required");if("renderer"in r){let o=t.renderers[r.name];o?t.renderers[r.name]=function(...i){let l=r.renderer.apply(this,i);return l===!1&&(l=o.apply(this,i)),l}:t.renderers[r.name]=r.renderer}if("tokenizer"in r){if(!r.level||r.level!=="block"&&r.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");let o=t[r.level];o?o.unshift(r.tokenizer):t[r.level]=[r.tokenizer],r.start&&(r.level==="block"?t.startBlock?t.startBlock.push(r.start):t.startBlock=[r.start]:r.level==="inline"&&(t.startInline?t.startInline.push(r.start):t.startInline=[r.start]))}"childTokens"in r&&r.childTokens&&(t.childTokens[r.name]=r.childTokens)}),s.extensions=t),n.renderer){let r=this.defaults.renderer||new ze(this.defaults);for(let o in n.renderer){if(!(o in r))throw new Error(\`renderer '\${o}' does not exist\`);if(["options","parser"].includes(o))continue;let i=o,l=n.renderer[i],a=r[i];r[i]=(...u)=>{let c=l.apply(r,u);return c===!1&&(c=a.apply(r,u)),c||""}}s.renderer=r}if(n.tokenizer){let r=this.defaults.tokenizer||new Pe(this.defaults);for(let o in n.tokenizer){if(!(o in r))throw new Error(\`tokenizer '\${o}' does not exist\`);if(["options","rules","lexer"].includes(o))continue;let i=o,l=n.tokenizer[i],a=r[i];r[i]=(...u)=>{let c=l.apply(r,u);return c===!1&&(c=a.apply(r,u)),c}}s.tokenizer=r}if(n.hooks){let r=this.defaults.hooks||new Te;for(let o in n.hooks){if(!(o in r))throw new Error(\`hook '\${o}' does not exist\`);if(["options","block"].includes(o))continue;let i=o,l=n.hooks[i],a=r[i];Te.passThroughHooks.has(o)?r[i]=u=>{if(this.defaults.async&&Te.passThroughHooksRespectAsync.has(o))return(async()=>{let f=await l.call(r,u);return a.call(r,f)})();let c=l.call(r,u);return a.call(r,c)}:r[i]=(...u)=>{if(this.defaults.async)return(async()=>{let f=await l.apply(r,u);return f===!1&&(f=await a.apply(r,u)),f})();let c=l.apply(r,u);return c===!1&&(c=a.apply(r,u)),c}}s.hooks=r}if(n.walkTokens){let r=this.defaults.walkTokens,o=n.walkTokens;s.walkTokens=function(i){let l=[];return l.push(o.call(this,i)),r&&(l=l.concat(r.call(this,i))),l}}this.defaults={...this.defaults,...s}}),this}setOptions(e){return this.defaults={...this.defaults,...e},this}lexer(e,t){return K.lex(e,t??this.defaults)}parser(e,t){return W.parse(e,t??this.defaults)}parseMarkdown(e){return(t,n)=>{let s={...n},r={...this.defaults,...s},o=this.onError(!!r.silent,!!r.async);if(this.defaults.async===!0&&s.async===!1)return o(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof t>"u"||t===null)return o(new Error("marked(): input parameter is undefined or null"));if(typeof t!="string")return o(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(t)+", string expected"));if(r.hooks&&(r.hooks.options=r,r.hooks.block=e),r.async)return(async()=>{let i=r.hooks?await r.hooks.preprocess(t):t,l=await(r.hooks?await r.hooks.provideLexer():e?K.lex:K.lexInline)(i,r),a=r.hooks?await r.hooks.processAllTokens(l):l;r.walkTokens&&await Promise.all(this.walkTokens(a,r.walkTokens));let u=await(r.hooks?await r.hooks.provideParser():e?W.parse:W.parseInline)(a,r);return r.hooks?await r.hooks.postprocess(u):u})().catch(o);try{r.hooks&&(t=r.hooks.preprocess(t));let i=(r.hooks?r.hooks.provideLexer():e?K.lex:K.lexInline)(t,r);r.hooks&&(i=r.hooks.processAllTokens(i)),r.walkTokens&&this.walkTokens(i,r.walkTokens);let l=(r.hooks?r.hooks.provideParser():e?W.parse:W.parseInline)(i,r);return r.hooks&&(l=r.hooks.postprocess(l)),l}catch(i){return o(i)}}}onError(e,t){return n=>{if(n.message+=\`
Please report this to https://github.com/markedjs/marked.\`,e){let s="<p>An error occurred:</p><pre>"+V(n.message+"",!0)+"</pre>";return t?Promise.resolve(s):s}if(t)return Promise.reject(n);throw n}}},oe=new ts;function T(e,t){return oe.parse(e,t)}T.options=T.setOptions=function(e){return oe.setOptions(e),T.defaults=oe.defaults,qt(T.defaults),T};T.getDefaults=tt;T.defaults=le;T.use=function(...e){return oe.use(...e),T.defaults=oe.defaults,qt(T.defaults),T};T.walkTokens=function(e,t){return oe.walkTokens(e,t)};T.parseInline=oe.parseInline;T.Parser=W;T.parser=W.parse;T.Renderer=ze;T.TextRenderer=ct;T.Lexer=K;T.lexer=K.lex;T.Tokenizer=Pe;T.Hooks=Te;T.parse=T;var wi=T.options,Ei=T.setOptions,_i=T.use,yi=T.walkTokens,Si=T.parseInline;var vi=W.parse,Ti=K.lex;var Sn=pr(yn(),1);var D=Sn.default;var vn="[A-Za-z$_][0-9A-Za-z$_]*",qs=["as","in","of","if","for","while","finally","var","new","function","do","return","void","else","break","catch","instanceof","with","throw","case","default","try","switch","continue","typeof","delete","let","yield","const","class","debugger","async","await","static","import","from","export","extends","using"],Ks=["true","false","null","undefined","NaN","Infinity"],Tn=["Object","Function","Boolean","Symbol","Math","Date","Number","BigInt","String","RegExp","Array","Float32Array","Float64Array","Int8Array","Uint8Array","Uint8ClampedArray","Int16Array","Int32Array","Uint16Array","Uint32Array","BigInt64Array","BigUint64Array","Set","Map","WeakSet","WeakMap","ArrayBuffer","SharedArrayBuffer","Atomics","DataView","JSON","Promise","Generator","GeneratorFunction","AsyncFunction","Reflect","Proxy","Intl","WebAssembly"],An=["Error","EvalError","InternalError","RangeError","ReferenceError","SyntaxError","TypeError","URIError"],Rn=["setInterval","setTimeout","clearInterval","clearTimeout","require","exports","eval","isFinite","isNaN","parseFloat","parseInt","decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape","unescape"],Ws=["arguments","this","super","console","window","document","localStorage","sessionStorage","module","global"],js=[].concat(Rn,Tn,An);function kt(e){let t=e.regex,n=(h,{after:w})=>{let v="</"+h[0].slice(1);return h.input.indexOf(v,w)!==-1},s=vn,r={begin:"<>",end:"</>"},o=/<[A-Za-z0-9\\\\._:-]+\\s*\\/>/,i={begin:/<[A-Za-z0-9\\\\._:-]+/,end:/\\/[A-Za-z0-9\\\\._:-]+>|\\/>/,isTrulyOpeningTag:(h,w)=>{let v=h[0].length+h.index,O=h.input[v];if(O==="<"||O===","){w.ignoreMatch();return}O===">"&&(n(h,{after:v})||w.ignoreMatch());let z,X=h.input.substring(v);if(z=X.match(/^\\s*=/)){w.ignoreMatch();return}if((z=X.match(/^\\s+extends\\s+/))&&z.index===0){w.ignoreMatch();return}}},l={$pattern:vn,keyword:qs,literal:Ks,built_in:js,"variable.language":Ws},a="[0-9](_?[0-9])*",u=\`\\\\.(\${a})\`,c="0|[1-9](_?[0-9])*|0[0-7]*[89][0-9]*",f={className:"number",variants:[{begin:\`(\\\\b(\${c})((\${u})|\\\\.)?|(\${u}))[eE][+-]?(\${a})\\\\b\`},{begin:\`\\\\b(\${c})\\\\b((\${u})\\\\b|\\\\.)?|(\${u})\\\\b\`},{begin:"\\\\b(0|[1-9](_?[0-9])*)n\\\\b"},{begin:"\\\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*n?\\\\b"},{begin:"\\\\b0[bB][0-1](_?[0-1])*n?\\\\b"},{begin:"\\\\b0[oO][0-7](_?[0-7])*n?\\\\b"},{begin:"\\\\b0[0-7]+n?\\\\b"}],relevance:0},g={className:"subst",begin:"\\\\$\\\\{",end:"\\\\}",keywords:l,contains:[]},E={begin:".?html\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,g],subLanguage:"xml"}},k={begin:".?css\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,g],subLanguage:"css"}},y={begin:".?gql\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,g],subLanguage:"graphql"}},M={className:"string",begin:"\`",end:"\`",contains:[e.BACKSLASH_ESCAPE,g]},C={className:"comment",variants:[e.COMMENT(/\\/\\*\\*(?!\\/)/,"\\\\*/",{relevance:0,contains:[{begin:"(?=@[A-Za-z]+)",relevance:0,contains:[{className:"doctag",begin:"@[A-Za-z]+"},{className:"type",begin:"\\\\{",end:"\\\\}",excludeEnd:!0,excludeBegin:!0,relevance:0},{className:"variable",begin:s+"(?=\\\\s*(-)|$)",endsParent:!0,relevance:0},{begin:/(?=[^\\n])\\s/,relevance:0}]}]}),e.C_BLOCK_COMMENT_MODE,e.C_LINE_COMMENT_MODE]},B=[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,E,k,y,M,{match:/\\$\\d+/},f];g.contains=B.concat({begin:/\\{/,end:/\\}/,keywords:l,contains:["self"].concat(B)});let $=[].concat(C,g.contains),I=$.concat([{begin:/(\\s*)\\(/,end:/\\)/,keywords:l,contains:["self"].concat($)}]),N={className:"params",begin:/(\\s*)\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:I},se={variants:[{match:[/class/,/\\s+/,s,/\\s+/,/extends/,/\\s+/,t.concat(s,"(",t.concat(/\\./,s),")*")],scope:{1:"keyword",3:"title.class",5:"keyword",7:"title.class.inherited"}},{match:[/class/,/\\s+/,s],scope:{1:"keyword",3:"title.class"}}]},P={relevance:0,match:t.either(/\\bJSON/,/\\b[A-Z][a-z]+([A-Z][a-z]*|\\d)*/,/\\b[A-Z]{2,}([A-Z][a-z]+|\\d)+([A-Z][a-z]*)*/,/\\b[A-Z]{2,}[a-z]+([A-Z][a-z]+|\\d)*([A-Z][a-z]*)*/),className:"title.class",keywords:{_:[...Tn,...An]}},F={label:"use_strict",className:"meta",relevance:10,begin:/^\\s*['"]use (strict|asm)['"]/},pe={variants:[{match:[/function/,/\\s+/,s,/(?=\\s*\\()/]},{match:[/function/,/\\s*(?=\\()/]}],className:{1:"keyword",3:"title.function"},label:"func.def",contains:[N],illegal:/%/},xe={relevance:0,match:/\\b[A-Z][A-Z_0-9]+\\b/,className:"variable.constant"};function we(h){return t.concat("(?!",h.join("|"),")")}let Ee={match:t.concat(/\\b/,we([...Rn,"super","import"].map(h=>\`\${h}\\\\s*\\\\(\`)),s,t.lookahead(/\\s*\\(/)),className:"title.function",relevance:0},te={begin:t.concat(/\\./,t.lookahead(t.concat(s,/(?![0-9A-Za-z$_(])/))),end:s,excludeBegin:!0,keywords:"prototype",className:"property",relevance:0},_e={match:[/get|set/,/\\s+/,s,/(?=\\()/],className:{1:"keyword",3:"title.function"},contains:[{begin:/\\(\\)/},N]},d="(\\\\([^()]*(\\\\([^()]*(\\\\([^()]*\\\\)[^()]*)*\\\\)[^()]*)*\\\\)|"+e.UNDERSCORE_IDENT_RE+")\\\\s*=>",b={match:[/const|var|let/,/\\s+/,s,/\\s*/,/=\\s*/,/(async\\s*)?/,t.lookahead(d)],keywords:"async",className:{1:"keyword",3:"title.function"},contains:[N]};return{name:"JavaScript",aliases:["js","jsx","mjs","cjs"],keywords:l,exports:{PARAMS_CONTAINS:I,CLASS_REFERENCE:P},illegal:/#(?![$_A-z])/,contains:[e.SHEBANG({label:"shebang",binary:"node",relevance:5}),F,e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,E,k,y,M,C,{match:/\\$\\d+/},f,P,{scope:"attr",match:s+t.lookahead(":"),relevance:0},b,{begin:"("+e.RE_STARTERS_RE+"|\\\\b(case|return|throw)\\\\b)\\\\s*",keywords:"return throw case",relevance:0,contains:[C,e.REGEXP_MODE,{className:"function",begin:d,returnBegin:!0,end:"\\\\s*=>",contains:[{className:"params",variants:[{begin:e.UNDERSCORE_IDENT_RE,relevance:0},{className:null,begin:/\\(\\s*\\)/,skip:!0},{begin:/(\\s*)\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:I}]}]},{begin:/,/,relevance:0},{match:/\\s+/,relevance:0},{variants:[{begin:r.begin,end:r.end},{match:o},{begin:i.begin,"on:begin":i.isTrulyOpeningTag,end:i.end}],subLanguage:"xml",contains:[{begin:i.begin,end:i.end,skip:!0,contains:["self"]}]}]},pe,{beginKeywords:"while if switch catch for"},{begin:"\\\\b(?!function)"+e.UNDERSCORE_IDENT_RE+"\\\\([^()]*(\\\\([^()]*(\\\\([^()]*\\\\)[^()]*)*\\\\)[^()]*)*\\\\)\\\\s*\\\\{",returnBegin:!0,label:"func.def",contains:[N,e.inherit(e.TITLE_MODE,{begin:s,className:"title.function"})]},{match:/\\.\\.\\./,relevance:0},te,{match:"\\\\$"+s,relevance:0},{match:[/\\bconstructor(?=\\s*\\()/],className:{1:"title.function"},contains:[N]},Ee,xe,se,_e,{match:/\\$[(.]/}]}}var Ke="[A-Za-z$_][0-9A-Za-z$_]*",Nn=["as","in","of","if","for","while","finally","var","new","function","do","return","void","else","break","catch","instanceof","with","throw","case","default","try","switch","continue","typeof","delete","let","yield","const","class","debugger","async","await","static","import","from","export","extends","using"],In=["true","false","null","undefined","NaN","Infinity"],On=["Object","Function","Boolean","Symbol","Math","Date","Number","BigInt","String","RegExp","Array","Float32Array","Float64Array","Int8Array","Uint8Array","Uint8ClampedArray","Int16Array","Int32Array","Uint16Array","Uint32Array","BigInt64Array","BigUint64Array","Set","Map","WeakSet","WeakMap","ArrayBuffer","SharedArrayBuffer","Atomics","DataView","JSON","Promise","Generator","GeneratorFunction","AsyncFunction","Reflect","Proxy","Intl","WebAssembly"],Cn=["Error","EvalError","InternalError","RangeError","ReferenceError","SyntaxError","TypeError","URIError"],Mn=["setInterval","setTimeout","clearInterval","clearTimeout","require","exports","eval","isFinite","isNaN","parseFloat","parseInt","decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape","unescape"],Ln=["arguments","this","super","console","window","document","localStorage","sessionStorage","module","global"],Dn=[].concat(Mn,On,Cn);function Xs(e){let t=e.regex,n=(h,{after:w})=>{let v="</"+h[0].slice(1);return h.input.indexOf(v,w)!==-1},s=Ke,r={begin:"<>",end:"</>"},o=/<[A-Za-z0-9\\\\._:-]+\\s*\\/>/,i={begin:/<[A-Za-z0-9\\\\._:-]+/,end:/\\/[A-Za-z0-9\\\\._:-]+>|\\/>/,isTrulyOpeningTag:(h,w)=>{let v=h[0].length+h.index,O=h.input[v];if(O==="<"||O===","){w.ignoreMatch();return}O===">"&&(n(h,{after:v})||w.ignoreMatch());let z,X=h.input.substring(v);if(z=X.match(/^\\s*=/)){w.ignoreMatch();return}if((z=X.match(/^\\s+extends\\s+/))&&z.index===0){w.ignoreMatch();return}}},l={$pattern:Ke,keyword:Nn,literal:In,built_in:Dn,"variable.language":Ln},a="[0-9](_?[0-9])*",u=\`\\\\.(\${a})\`,c="0|[1-9](_?[0-9])*|0[0-7]*[89][0-9]*",f={className:"number",variants:[{begin:\`(\\\\b(\${c})((\${u})|\\\\.)?|(\${u}))[eE][+-]?(\${a})\\\\b\`},{begin:\`\\\\b(\${c})\\\\b((\${u})\\\\b|\\\\.)?|(\${u})\\\\b\`},{begin:"\\\\b(0|[1-9](_?[0-9])*)n\\\\b"},{begin:"\\\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*n?\\\\b"},{begin:"\\\\b0[bB][0-1](_?[0-1])*n?\\\\b"},{begin:"\\\\b0[oO][0-7](_?[0-7])*n?\\\\b"},{begin:"\\\\b0[0-7]+n?\\\\b"}],relevance:0},g={className:"subst",begin:"\\\\$\\\\{",end:"\\\\}",keywords:l,contains:[]},E={begin:".?html\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,g],subLanguage:"xml"}},k={begin:".?css\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,g],subLanguage:"css"}},y={begin:".?gql\`",end:"",starts:{end:"\`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,g],subLanguage:"graphql"}},M={className:"string",begin:"\`",end:"\`",contains:[e.BACKSLASH_ESCAPE,g]},C={className:"comment",variants:[e.COMMENT(/\\/\\*\\*(?!\\/)/,"\\\\*/",{relevance:0,contains:[{begin:"(?=@[A-Za-z]+)",relevance:0,contains:[{className:"doctag",begin:"@[A-Za-z]+"},{className:"type",begin:"\\\\{",end:"\\\\}",excludeEnd:!0,excludeBegin:!0,relevance:0},{className:"variable",begin:s+"(?=\\\\s*(-)|$)",endsParent:!0,relevance:0},{begin:/(?=[^\\n])\\s/,relevance:0}]}]}),e.C_BLOCK_COMMENT_MODE,e.C_LINE_COMMENT_MODE]},B=[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,E,k,y,M,{match:/\\$\\d+/},f];g.contains=B.concat({begin:/\\{/,end:/\\}/,keywords:l,contains:["self"].concat(B)});let $=[].concat(C,g.contains),I=$.concat([{begin:/(\\s*)\\(/,end:/\\)/,keywords:l,contains:["self"].concat($)}]),N={className:"params",begin:/(\\s*)\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:I},se={variants:[{match:[/class/,/\\s+/,s,/\\s+/,/extends/,/\\s+/,t.concat(s,"(",t.concat(/\\./,s),")*")],scope:{1:"keyword",3:"title.class",5:"keyword",7:"title.class.inherited"}},{match:[/class/,/\\s+/,s],scope:{1:"keyword",3:"title.class"}}]},P={relevance:0,match:t.either(/\\bJSON/,/\\b[A-Z][a-z]+([A-Z][a-z]*|\\d)*/,/\\b[A-Z]{2,}([A-Z][a-z]+|\\d)+([A-Z][a-z]*)*/,/\\b[A-Z]{2,}[a-z]+([A-Z][a-z]+|\\d)*([A-Z][a-z]*)*/),className:"title.class",keywords:{_:[...On,...Cn]}},F={label:"use_strict",className:"meta",relevance:10,begin:/^\\s*['"]use (strict|asm)['"]/},pe={variants:[{match:[/function/,/\\s+/,s,/(?=\\s*\\()/]},{match:[/function/,/\\s*(?=\\()/]}],className:{1:"keyword",3:"title.function"},label:"func.def",contains:[N],illegal:/%/},xe={relevance:0,match:/\\b[A-Z][A-Z_0-9]+\\b/,className:"variable.constant"};function we(h){return t.concat("(?!",h.join("|"),")")}let Ee={match:t.concat(/\\b/,we([...Mn,"super","import"].map(h=>\`\${h}\\\\s*\\\\(\`)),s,t.lookahead(/\\s*\\(/)),className:"title.function",relevance:0},te={begin:t.concat(/\\./,t.lookahead(t.concat(s,/(?![0-9A-Za-z$_(])/))),end:s,excludeBegin:!0,keywords:"prototype",className:"property",relevance:0},_e={match:[/get|set/,/\\s+/,s,/(?=\\()/],className:{1:"keyword",3:"title.function"},contains:[{begin:/\\(\\)/},N]},d="(\\\\([^()]*(\\\\([^()]*(\\\\([^()]*\\\\)[^()]*)*\\\\)[^()]*)*\\\\)|"+e.UNDERSCORE_IDENT_RE+")\\\\s*=>",b={match:[/const|var|let/,/\\s+/,s,/\\s*/,/=\\s*/,/(async\\s*)?/,t.lookahead(d)],keywords:"async",className:{1:"keyword",3:"title.function"},contains:[N]};return{name:"JavaScript",aliases:["js","jsx","mjs","cjs"],keywords:l,exports:{PARAMS_CONTAINS:I,CLASS_REFERENCE:P},illegal:/#(?![$_A-z])/,contains:[e.SHEBANG({label:"shebang",binary:"node",relevance:5}),F,e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,E,k,y,M,C,{match:/\\$\\d+/},f,P,{scope:"attr",match:s+t.lookahead(":"),relevance:0},b,{begin:"("+e.RE_STARTERS_RE+"|\\\\b(case|return|throw)\\\\b)\\\\s*",keywords:"return throw case",relevance:0,contains:[C,e.REGEXP_MODE,{className:"function",begin:d,returnBegin:!0,end:"\\\\s*=>",contains:[{className:"params",variants:[{begin:e.UNDERSCORE_IDENT_RE,relevance:0},{className:null,begin:/\\(\\s*\\)/,skip:!0},{begin:/(\\s*)\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:I}]}]},{begin:/,/,relevance:0},{match:/\\s+/,relevance:0},{variants:[{begin:r.begin,end:r.end},{match:o},{begin:i.begin,"on:begin":i.isTrulyOpeningTag,end:i.end}],subLanguage:"xml",contains:[{begin:i.begin,end:i.end,skip:!0,contains:["self"]}]}]},pe,{beginKeywords:"while if switch catch for"},{begin:"\\\\b(?!function)"+e.UNDERSCORE_IDENT_RE+"\\\\([^()]*(\\\\([^()]*(\\\\([^()]*\\\\)[^()]*)*\\\\)[^()]*)*\\\\)\\\\s*\\\\{",returnBegin:!0,label:"func.def",contains:[N,e.inherit(e.TITLE_MODE,{begin:s,className:"title.function"})]},{match:/\\.\\.\\./,relevance:0},te,{match:"\\\\$"+s,relevance:0},{match:[/\\bconstructor(?=\\s*\\()/],className:{1:"title.function"},contains:[N]},Ee,xe,se,_e,{match:/\\$[(.]/}]}}function xt(e){let t=e.regex,n=Xs(e),s=Ke,r=["any","void","number","boolean","string","object","never","symbol","bigint","unknown"],o={begin:[/namespace/,/\\s+/,e.IDENT_RE],beginScope:{1:"keyword",3:"title.class"}},i={beginKeywords:"interface",end:/\\{/,excludeEnd:!0,keywords:{keyword:"interface extends",built_in:r},contains:[n.exports.CLASS_REFERENCE]},l={className:"meta",relevance:10,begin:/^\\s*['"]use strict['"]/},a=["type","interface","public","private","protected","implements","declare","abstract","readonly","enum","override","satisfies"],u={$pattern:Ke,keyword:Nn.concat(a),literal:In,built_in:Dn.concat(r),"variable.language":Ln},c={className:"meta",begin:"@"+s},f=(y,M,H)=>{let C=y.contains.findIndex(B=>B.label===M);if(C===-1)throw new Error("can not find mode to replace");y.contains.splice(C,1,H)};Object.assign(n.keywords,u),n.exports.PARAMS_CONTAINS.push(c);let g=n.contains.find(y=>y.scope==="attr"),E=Object.assign({},g,{match:t.concat(s,t.lookahead(/\\s*\\?:/))});n.exports.PARAMS_CONTAINS.push([n.exports.CLASS_REFERENCE,g,E]),n.contains=n.contains.concat([c,o,i,E]),f(n,"shebang",e.SHEBANG()),f(n,"use_strict",l);let k=n.contains.find(y=>y.label==="func.def");return k.relevance=0,Object.assign(n,{name:"TypeScript",aliases:["ts","tsx","mts","cts"]}),n}function wt(e){let t=e.regex,n=/[\\p{XID_Start}_]\\p{XID_Continue}*/u,s=["and","as","assert","async","await","break","case","class","continue","def","del","elif","else","except","finally","for","from","global","if","import","in","is","lambda","match","nonlocal|10","not","or","pass","raise","return","try","while","with","yield"],l={$pattern:/[A-Za-z]\\w+|__\\w+__/,keyword:s,built_in:["__import__","abs","all","any","ascii","bin","bool","breakpoint","bytearray","bytes","callable","chr","classmethod","compile","complex","delattr","dict","dir","divmod","enumerate","eval","exec","filter","float","format","frozenset","getattr","globals","hasattr","hash","help","hex","id","input","int","isinstance","issubclass","iter","len","list","locals","map","max","memoryview","min","next","object","oct","open","ord","pow","print","property","range","repr","reversed","round","set","setattr","slice","sorted","staticmethod","str","sum","super","tuple","type","vars","zip"],literal:["__debug__","Ellipsis","False","None","NotImplemented","True"],type:["Any","Callable","Coroutine","Dict","List","Literal","Generic","Optional","Sequence","Set","Tuple","Type","Union"]},a={className:"meta",begin:/^(>>>|\\.\\.\\.) /},u={className:"subst",begin:/\\{/,end:/\\}/,keywords:l,illegal:/#/},c={begin:/\\{\\{/,relevance:0},f={className:"string",contains:[e.BACKSLASH_ESCAPE],variants:[{begin:/([uU]|[bB]|[rR]|[bB][rR]|[rR][bB])?'''/,end:/'''/,contains:[e.BACKSLASH_ESCAPE,a],relevance:10},{begin:/([uU]|[bB]|[rR]|[bB][rR]|[rR][bB])?"""/,end:/"""/,contains:[e.BACKSLASH_ESCAPE,a],relevance:10},{begin:/([fF][rR]|[rR][fF]|[fF])'''/,end:/'''/,contains:[e.BACKSLASH_ESCAPE,a,c,u]},{begin:/([fF][rR]|[rR][fF]|[fF])"""/,end:/"""/,contains:[e.BACKSLASH_ESCAPE,a,c,u]},{begin:/([uU]|[rR])'/,end:/'/,relevance:10},{begin:/([uU]|[rR])"/,end:/"/,relevance:10},{begin:/([bB]|[bB][rR]|[rR][bB])'/,end:/'/},{begin:/([bB]|[bB][rR]|[rR][bB])"/,end:/"/},{begin:/([fF][rR]|[rR][fF]|[fF])'/,end:/'/,contains:[e.BACKSLASH_ESCAPE,c,u]},{begin:/([fF][rR]|[rR][fF]|[fF])"/,end:/"/,contains:[e.BACKSLASH_ESCAPE,c,u]},e.APOS_STRING_MODE,e.QUOTE_STRING_MODE]},g="[0-9](_?[0-9])*",E=\`(\\\\b(\${g}))?\\\\.(\${g})|\\\\b(\${g})\\\\.\`,k=\`\\\\b|\${s.join("|")}\`,y={className:"number",relevance:0,variants:[{begin:\`(\\\\b(\${g})|(\${E}))[eE][+-]?(\${g})[jJ]?(?=\${k})\`},{begin:\`(\${E})[jJ]?\`},{begin:\`\\\\b([1-9](_?[0-9])*|0+(_?0)*)[lLjJ]?(?=\${k})\`},{begin:\`\\\\b0[bB](_?[01])+[lL]?(?=\${k})\`},{begin:\`\\\\b0[oO](_?[0-7])+[lL]?(?=\${k})\`},{begin:\`\\\\b0[xX](_?[0-9a-fA-F])+[lL]?(?=\${k})\`},{begin:\`\\\\b(\${g})[jJ](?=\${k})\`}]},M={className:"comment",begin:t.lookahead(/# type:/),end:/$/,keywords:l,contains:[{begin:/# type:/},{begin:/#/,end:/\\b\\B/,endsWithParent:!0}]},H={className:"params",variants:[{className:"",begin:/\\(\\s*\\)/,skip:!0},{begin:/\\(/,end:/\\)/,excludeBegin:!0,excludeEnd:!0,keywords:l,contains:["self",a,y,f,e.HASH_COMMENT_MODE]}]};return u.contains=[f,y,a],{name:"Python",aliases:["py","gyp","ipython"],unicodeRegex:!0,keywords:l,illegal:/(<\\/|\\?)|=>/,contains:[a,y,{scope:"variable.language",match:/\\bself\\b/},{beginKeywords:"if",relevance:0},{match:/\\bor\\b/,scope:"keyword"},f,M,e.HASH_COMMENT_MODE,{match:[/\\bdef/,/\\s+/,n],scope:{1:"keyword",3:"title.function"},contains:[H]},{variants:[{match:[/\\bclass/,/\\s+/,n,/\\s*/,/\\(\\s*/,n,/\\s*\\)/]},{match:[/\\bclass/,/\\s+/,n]}],scope:{1:"keyword",3:"title.class",6:"title.class.inherited"}},{className:"meta",begin:/^[\\t ]*@/,end:/(?=#)|$/,contains:[y,H,f]}]}}function Et(e){let t=e.regex,n={},s={begin:/\\$\\{/,end:/\\}/,contains:["self",{begin:/:-/,contains:[n]}]};Object.assign(n,{className:"variable",variants:[{begin:t.concat(/\\$[\\w\\d#@][\\w\\d_]*/,"(?![\\\\w\\\\d])(?![$])")},s]});let r={className:"subst",begin:/\\$\\(/,end:/\\)/,contains:[e.BACKSLASH_ESCAPE]},o=e.inherit(e.COMMENT(),{match:[/(^|\\s)/,/#.*$/],scope:{2:"comment"}}),i={begin:/<<-?\\s*(?=\\w+)/,starts:{contains:[e.END_SAME_AS_BEGIN({begin:/(\\w+)/,end:/(\\w+)/,className:"string"})]}},l={className:"string",begin:/"/,end:/"/,contains:[e.BACKSLASH_ESCAPE,n,r]};r.contains.push(l);let a={match:/\\\\"/},u={className:"string",begin:/'/,end:/'/},c={match:/\\\\'/},f={begin:/\\$?\\(\\(/,end:/\\)\\)/,contains:[{begin:/\\d+#[0-9a-f]+/,className:"number"},e.NUMBER_MODE,n]},g=["fish","bash","zsh","sh","csh","ksh","tcsh","dash","scsh"],E=e.SHEBANG({binary:\`(\${g.join("|")})\`,relevance:10}),k={className:"function",begin:/\\w[\\w\\d_]*\\s*\\(\\s*\\)\\s*\\{/,returnBegin:!0,contains:[e.inherit(e.TITLE_MODE,{begin:/\\w[\\w\\d_]*/})],relevance:0},y=["if","then","else","elif","fi","time","for","while","until","in","do","done","case","esac","coproc","function","select"],M=["true","false"],H={match:/(\\/[a-z._-]+)+/},C=["break","cd","continue","eval","exec","exit","export","getopts","hash","pwd","readonly","return","shift","test","times","trap","umask","unset"],B=["alias","bind","builtin","caller","command","declare","echo","enable","help","let","local","logout","mapfile","printf","read","readarray","source","sudo","type","typeset","ulimit","unalias"],$=["autoload","bg","bindkey","bye","cap","chdir","clone","comparguments","compcall","compctl","compdescribe","compfiles","compgroups","compquote","comptags","comptry","compvalues","dirs","disable","disown","echotc","echoti","emulate","fc","fg","float","functions","getcap","getln","history","integer","jobs","kill","limit","log","noglob","popd","print","pushd","pushln","rehash","sched","setcap","setopt","stat","suspend","ttyctl","unfunction","unhash","unlimit","unsetopt","vared","wait","whence","where","which","zcompile","zformat","zftp","zle","zmodload","zparseopts","zprof","zpty","zregexparse","zsocket","zstyle","ztcp"],I=["chcon","chgrp","chown","chmod","cp","dd","df","dir","dircolors","ln","ls","mkdir","mkfifo","mknod","mktemp","mv","realpath","rm","rmdir","shred","sync","touch","truncate","vdir","b2sum","base32","base64","cat","cksum","comm","csplit","cut","expand","fmt","fold","head","join","md5sum","nl","numfmt","od","paste","ptx","pr","sha1sum","sha224sum","sha256sum","sha384sum","sha512sum","shuf","sort","split","sum","tac","tail","tr","tsort","unexpand","uniq","wc","arch","basename","chroot","date","dirname","du","echo","env","expr","factor","groups","hostid","id","link","logname","nice","nohup","nproc","pathchk","pinky","printenv","printf","pwd","readlink","runcon","seq","sleep","stat","stdbuf","stty","tee","test","timeout","tty","uname","unlink","uptime","users","who","whoami","yes"];return{name:"Bash",aliases:["sh","zsh"],keywords:{$pattern:/\\b[a-z][a-z0-9._-]+\\b/,keyword:y,literal:M,built_in:[...C,...B,"set","shopt",...$,...I]},contains:[E,e.SHEBANG(),k,f,o,i,H,l,a,u,c,n]}}function Bn(e){let t={className:"attr",begin:/"(\\\\.|[^\\\\"\\r\\n])*"(?=\\s*:)/,relevance:1.01},n={match:/[{}[\\],:]/,className:"punctuation",relevance:0},s=["true","false","null"],r={scope:"literal",beginKeywords:s.join(" ")};return{name:"JSON",aliases:["jsonc"],keywords:{literal:s},contains:[t,n,e.QUOTE_STRING_MODE,r,e.C_NUMBER_MODE,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE],illegal:"\\\\S"}}function _t(e){let t=e.regex,n=t.concat(/[\\p{L}_]/u,t.optional(/[\\p{L}0-9_.-]*:/u),/[\\p{L}0-9_.-]*/u),s=/[\\p{L}0-9._:-]+/u,r={className:"symbol",begin:/&[a-z]+;|&#[0-9]+;|&#x[a-f0-9]+;/},o={begin:/\\s/,contains:[{className:"keyword",begin:/#?[a-z_][a-z1-9_-]+/,illegal:/\\n/}]},i=e.inherit(o,{begin:/\\(/,end:/\\)/}),l=e.inherit(e.APOS_STRING_MODE,{className:"string"}),a=e.inherit(e.QUOTE_STRING_MODE,{className:"string"}),u={endsWithParent:!0,illegal:/</,relevance:0,contains:[{className:"attr",begin:s,relevance:0},{begin:/=\\s*/,relevance:0,contains:[{className:"string",endsParent:!0,variants:[{begin:/"/,end:/"/,contains:[r]},{begin:/'/,end:/'/,contains:[r]},{begin:/[^\\s"'=<>\`]+/}]}]}]};return{name:"HTML, XML",aliases:["html","xhtml","rss","atom","xjb","xsd","xsl","plist","wsf","svg"],case_insensitive:!0,unicodeRegex:!0,contains:[{className:"meta",begin:/<![a-z]/,end:/>/,relevance:10,contains:[o,a,l,i,{begin:/\\[/,end:/\\]/,contains:[{className:"meta",begin:/<![a-z]/,end:/>/,contains:[o,i,a,l]}]}]},e.COMMENT(/<!--/,/-->/,{relevance:10}),{begin:/<!\\[CDATA\\[/,end:/\\]\\]>/,relevance:10},r,{className:"meta",end:/\\?>/,variants:[{begin:/<\\?xml/,relevance:10,contains:[a]},{begin:/<\\?[a-z][a-z0-9]+/}]},{className:"tag",begin:/<style(?=\\s|>)/,end:/>/,keywords:{name:"style"},contains:[u],starts:{end:/<\\/style>/,returnEnd:!0,subLanguage:["css","xml"]}},{className:"tag",begin:/<script(?=\\s|>)/,end:/>/,keywords:{name:"script"},contains:[u],starts:{end:/<\\/script>/,returnEnd:!0,subLanguage:["javascript","handlebars","xml"]}},{className:"tag",begin:/<>|<\\/>/},{className:"tag",begin:t.concat(/</,t.lookahead(t.concat(n,t.either(/\\/>/,/>/,/\\s/)))),end:/\\/?>/,contains:[{className:"name",begin:n,relevance:0,starts:u}]},{className:"tag",begin:t.concat(/<\\//,t.lookahead(t.concat(n,/>/))),contains:[{className:"name",begin:n,relevance:0},{begin:/>/,relevance:0,endsParent:!0}]}]}}var Ys=e=>({IMPORTANT:{scope:"meta",begin:"!important"},BLOCK_COMMENT:e.C_BLOCK_COMMENT_MODE,HEXCOLOR:{scope:"number",begin:/#(([0-9a-fA-F]{3,4})|(([0-9a-fA-F]{2}){3,4}))\\b/},FUNCTION_DISPATCH:{className:"built_in",begin:/[\\w-]+(?=\\()/},ATTRIBUTE_SELECTOR_MODE:{scope:"selector-attr",begin:/\\[/,end:/\\]/,illegal:"$",contains:[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE]},CSS_NUMBER_MODE:{scope:"number",begin:e.NUMBER_RE+"(%|em|ex|ch|rem|vw|vh|vmin|vmax|cm|mm|in|pt|pc|px|deg|grad|rad|turn|s|ms|Hz|kHz|dpi|dpcm|dppx)?",relevance:0},CSS_VARIABLE:{className:"attr",begin:/--[A-Za-z_][A-Za-z0-9_-]*/}}),Qs=["a","abbr","address","article","aside","audio","b","blockquote","body","button","canvas","caption","cite","code","dd","del","details","dfn","div","dl","dt","em","fieldset","figcaption","figure","footer","form","h1","h2","h3","h4","h5","h6","header","hgroup","html","i","iframe","img","input","ins","kbd","label","legend","li","main","mark","menu","nav","object","ol","optgroup","option","p","picture","q","quote","samp","section","select","source","span","strong","summary","sup","table","tbody","td","textarea","tfoot","th","thead","time","tr","ul","var","video"],Vs=["defs","g","marker","mask","pattern","svg","switch","symbol","feBlend","feColorMatrix","feComponentTransfer","feComposite","feConvolveMatrix","feDiffuseLighting","feDisplacementMap","feFlood","feGaussianBlur","feImage","feMerge","feMorphology","feOffset","feSpecularLighting","feTile","feTurbulence","linearGradient","radialGradient","stop","circle","ellipse","image","line","path","polygon","polyline","rect","text","use","textPath","tspan","foreignObject","clipPath"],Js=[...Qs,...Vs],ei=["any-hover","any-pointer","aspect-ratio","color","color-gamut","color-index","device-aspect-ratio","device-height","device-width","display-mode","forced-colors","grid","height","hover","inverted-colors","monochrome","orientation","overflow-block","overflow-inline","pointer","prefers-color-scheme","prefers-contrast","prefers-reduced-motion","prefers-reduced-transparency","resolution","scan","scripting","update","width","min-width","max-width","min-height","max-height"].sort().reverse(),ti=["active","any-link","blank","checked","current","default","defined","dir","disabled","drop","empty","enabled","first","first-child","first-of-type","fullscreen","future","focus","focus-visible","focus-within","has","host","host-context","hover","indeterminate","in-range","invalid","is","lang","last-child","last-of-type","left","link","local-link","not","nth-child","nth-col","nth-last-child","nth-last-col","nth-last-of-type","nth-of-type","only-child","only-of-type","optional","out-of-range","past","placeholder-shown","read-only","read-write","required","right","root","scope","target","target-within","user-invalid","valid","visited","where"].sort().reverse(),ni=["after","backdrop","before","cue","cue-region","first-letter","first-line","grammar-error","marker","part","placeholder","selection","slotted","spelling-error"].sort().reverse(),ri=["accent-color","align-content","align-items","align-self","alignment-baseline","all","anchor-name","animation","animation-composition","animation-delay","animation-direction","animation-duration","animation-fill-mode","animation-iteration-count","animation-name","animation-play-state","animation-range","animation-range-end","animation-range-start","animation-timeline","animation-timing-function","appearance","aspect-ratio","backdrop-filter","backface-visibility","background","background-attachment","background-blend-mode","background-clip","background-color","background-image","background-origin","background-position","background-position-x","background-position-y","background-repeat","background-size","baseline-shift","block-size","border","border-block","border-block-color","border-block-end","border-block-end-color","border-block-end-style","border-block-end-width","border-block-start","border-block-start-color","border-block-start-style","border-block-start-width","border-block-style","border-block-width","border-bottom","border-bottom-color","border-bottom-left-radius","border-bottom-right-radius","border-bottom-style","border-bottom-width","border-collapse","border-color","border-end-end-radius","border-end-start-radius","border-image","border-image-outset","border-image-repeat","border-image-slice","border-image-source","border-image-width","border-inline","border-inline-color","border-inline-end","border-inline-end-color","border-inline-end-style","border-inline-end-width","border-inline-start","border-inline-start-color","border-inline-start-style","border-inline-start-width","border-inline-style","border-inline-width","border-left","border-left-color","border-left-style","border-left-width","border-radius","border-right","border-right-color","border-right-style","border-right-width","border-spacing","border-start-end-radius","border-start-start-radius","border-style","border-top","border-top-color","border-top-left-radius","border-top-right-radius","border-top-style","border-top-width","border-width","bottom","box-align","box-decoration-break","box-direction","box-flex","box-flex-group","box-lines","box-ordinal-group","box-orient","box-pack","box-shadow","box-sizing","break-after","break-before","break-inside","caption-side","caret-color","clear","clip","clip-path","clip-rule","color","color-interpolation","color-interpolation-filters","color-profile","color-rendering","color-scheme","column-count","column-fill","column-gap","column-rule","column-rule-color","column-rule-style","column-rule-width","column-span","column-width","columns","contain","contain-intrinsic-block-size","contain-intrinsic-height","contain-intrinsic-inline-size","contain-intrinsic-size","contain-intrinsic-width","container","container-name","container-type","content","content-visibility","counter-increment","counter-reset","counter-set","cue","cue-after","cue-before","cursor","cx","cy","direction","display","dominant-baseline","empty-cells","enable-background","field-sizing","fill","fill-opacity","fill-rule","filter","flex","flex-basis","flex-direction","flex-flow","flex-grow","flex-shrink","flex-wrap","float","flood-color","flood-opacity","flow","font","font-display","font-family","font-feature-settings","font-kerning","font-language-override","font-optical-sizing","font-palette","font-size","font-size-adjust","font-smooth","font-smoothing","font-stretch","font-style","font-synthesis","font-synthesis-position","font-synthesis-small-caps","font-synthesis-style","font-synthesis-weight","font-variant","font-variant-alternates","font-variant-caps","font-variant-east-asian","font-variant-emoji","font-variant-ligatures","font-variant-numeric","font-variant-position","font-variation-settings","font-weight","forced-color-adjust","gap","glyph-orientation-horizontal","glyph-orientation-vertical","grid","grid-area","grid-auto-columns","grid-auto-flow","grid-auto-rows","grid-column","grid-column-end","grid-column-start","grid-gap","grid-row","grid-row-end","grid-row-start","grid-template","grid-template-areas","grid-template-columns","grid-template-rows","hanging-punctuation","height","hyphenate-character","hyphenate-limit-chars","hyphens","icon","image-orientation","image-rendering","image-resolution","ime-mode","initial-letter","initial-letter-align","inline-size","inset","inset-area","inset-block","inset-block-end","inset-block-start","inset-inline","inset-inline-end","inset-inline-start","isolation","justify-content","justify-items","justify-self","kerning","left","letter-spacing","lighting-color","line-break","line-height","line-height-step","list-style","list-style-image","list-style-position","list-style-type","margin","margin-block","margin-block-end","margin-block-start","margin-bottom","margin-inline","margin-inline-end","margin-inline-start","margin-left","margin-right","margin-top","margin-trim","marker","marker-end","marker-mid","marker-start","marks","mask","mask-border","mask-border-mode","mask-border-outset","mask-border-repeat","mask-border-slice","mask-border-source","mask-border-width","mask-clip","mask-composite","mask-image","mask-mode","mask-origin","mask-position","mask-repeat","mask-size","mask-type","masonry-auto-flow","math-depth","math-shift","math-style","max-block-size","max-height","max-inline-size","max-width","min-block-size","min-height","min-inline-size","min-width","mix-blend-mode","nav-down","nav-index","nav-left","nav-right","nav-up","none","normal","object-fit","object-position","offset","offset-anchor","offset-distance","offset-path","offset-position","offset-rotate","opacity","order","orphans","outline","outline-color","outline-offset","outline-style","outline-width","overflow","overflow-anchor","overflow-block","overflow-clip-margin","overflow-inline","overflow-wrap","overflow-x","overflow-y","overlay","overscroll-behavior","overscroll-behavior-block","overscroll-behavior-inline","overscroll-behavior-x","overscroll-behavior-y","padding","padding-block","padding-block-end","padding-block-start","padding-bottom","padding-inline","padding-inline-end","padding-inline-start","padding-left","padding-right","padding-top","page","page-break-after","page-break-before","page-break-inside","paint-order","pause","pause-after","pause-before","perspective","perspective-origin","place-content","place-items","place-self","pointer-events","position","position-anchor","position-visibility","print-color-adjust","quotes","r","resize","rest","rest-after","rest-before","right","rotate","row-gap","ruby-align","ruby-position","scale","scroll-behavior","scroll-margin","scroll-margin-block","scroll-margin-block-end","scroll-margin-block-start","scroll-margin-bottom","scroll-margin-inline","scroll-margin-inline-end","scroll-margin-inline-start","scroll-margin-left","scroll-margin-right","scroll-margin-top","scroll-padding","scroll-padding-block","scroll-padding-block-end","scroll-padding-block-start","scroll-padding-bottom","scroll-padding-inline","scroll-padding-inline-end","scroll-padding-inline-start","scroll-padding-left","scroll-padding-right","scroll-padding-top","scroll-snap-align","scroll-snap-stop","scroll-snap-type","scroll-timeline","scroll-timeline-axis","scroll-timeline-name","scrollbar-color","scrollbar-gutter","scrollbar-width","shape-image-threshold","shape-margin","shape-outside","shape-rendering","speak","speak-as","src","stop-color","stop-opacity","stroke","stroke-dasharray","stroke-dashoffset","stroke-linecap","stroke-linejoin","stroke-miterlimit","stroke-opacity","stroke-width","tab-size","table-layout","text-align","text-align-all","text-align-last","text-anchor","text-combine-upright","text-decoration","text-decoration-color","text-decoration-line","text-decoration-skip","text-decoration-skip-ink","text-decoration-style","text-decoration-thickness","text-emphasis","text-emphasis-color","text-emphasis-position","text-emphasis-style","text-indent","text-justify","text-orientation","text-overflow","text-rendering","text-shadow","text-size-adjust","text-transform","text-underline-offset","text-underline-position","text-wrap","text-wrap-mode","text-wrap-style","timeline-scope","top","touch-action","transform","transform-box","transform-origin","transform-style","transition","transition-behavior","transition-delay","transition-duration","transition-property","transition-timing-function","translate","unicode-bidi","user-modify","user-select","vector-effect","vertical-align","view-timeline","view-timeline-axis","view-timeline-inset","view-timeline-name","view-transition-name","visibility","voice-balance","voice-duration","voice-family","voice-pitch","voice-range","voice-rate","voice-stress","voice-volume","white-space","white-space-collapse","widows","width","will-change","word-break","word-spacing","word-wrap","writing-mode","x","y","z-index","zoom"].sort().reverse();function $n(e){let t=e.regex,n=Ys(e),s={begin:/-(webkit|moz|ms|o)-(?=[a-z])/},r="and or not only",o=/@-?\\w[\\w]*(-\\w+)*/,i="[a-zA-Z-][a-zA-Z0-9_-]*",l=[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE];return{name:"CSS",case_insensitive:!0,illegal:/[=|'\\$]/,keywords:{keyframePosition:"from to"},classNameAliases:{keyframePosition:"selector-tag"},contains:[n.BLOCK_COMMENT,s,n.CSS_NUMBER_MODE,{className:"selector-id",begin:/#[A-Za-z0-9_-]+/,relevance:0},{className:"selector-class",begin:"\\\\."+i,relevance:0},n.ATTRIBUTE_SELECTOR_MODE,{className:"selector-pseudo",variants:[{begin:":("+ti.join("|")+")"},{begin:":(:)?("+ni.join("|")+")"}]},n.CSS_VARIABLE,{className:"attribute",begin:"\\\\b("+ri.join("|")+")\\\\b"},{begin:/:/,end:/[;}{]/,contains:[n.BLOCK_COMMENT,n.HEXCOLOR,n.IMPORTANT,n.CSS_NUMBER_MODE,...l,{begin:/(url|data-uri)\\(/,end:/\\)/,relevance:0,keywords:{built_in:"url data-uri"},contains:[...l,{className:"string",begin:/[^)]/,endsWithParent:!0,excludeEnd:!0}]},n.FUNCTION_DISPATCH]},{begin:t.lookahead(/@/),end:"[{;]",relevance:0,illegal:/:/,contains:[{className:"keyword",begin:o},{begin:/\\s/,endsWithParent:!0,excludeEnd:!0,relevance:0,keywords:{$pattern:/[a-z-]+/,keyword:r,attribute:ei.join(" ")},contains:[{begin:/[a-z-]+(?=:)/,className:"attribute"},...l,n.CSS_NUMBER_MODE]}]},{className:"selector-tag",begin:"\\\\b("+Js.join("|")+")\\\\b"}]}}function Pn(e){let t=e.regex,n=e.COMMENT("--","$"),s={scope:"string",variants:[{begin:/'/,end:/'/,contains:[{match:/''/}]}]},r={begin:/"/,end:/"/,contains:[{match:/""/}]},o=["true","false","unknown"],i=["double precision","large object","with timezone","without timezone"],l=["bigint","binary","blob","boolean","char","character","clob","date","dec","decfloat","decimal","float","int","integer","interval","nchar","nclob","national","numeric","real","row","smallint","time","timestamp","varchar","varying","varbinary"],a=["add","asc","collation","desc","final","first","last","view"],u=["abs","acos","all","allocate","alter","and","any","are","array","array_agg","array_max_cardinality","as","asensitive","asin","asymmetric","at","atan","atomic","authorization","avg","begin","begin_frame","begin_partition","between","bigint","binary","blob","boolean","both","by","call","called","cardinality","cascaded","case","cast","ceil","ceiling","char","char_length","character","character_length","check","classifier","clob","close","coalesce","collate","collect","column","commit","condition","connect","constraint","contains","convert","copy","corr","corresponding","cos","cosh","count","covar_pop","covar_samp","create","cross","cube","cume_dist","current","current_catalog","current_date","current_default_transform_group","current_path","current_role","current_row","current_schema","current_time","current_timestamp","current_path","current_role","current_transform_group_for_type","current_user","cursor","cycle","date","day","deallocate","dec","decimal","decfloat","declare","default","define","delete","dense_rank","deref","describe","deterministic","disconnect","distinct","double","drop","dynamic","each","element","else","empty","end","end_frame","end_partition","end-exec","equals","escape","every","except","exec","execute","exists","exp","external","extract","false","fetch","filter","first_value","float","floor","for","foreign","frame_row","free","from","full","function","fusion","get","global","grant","group","grouping","groups","having","hold","hour","identity","in","indicator","initial","inner","inout","insensitive","insert","int","integer","intersect","intersection","interval","into","is","join","json_array","json_arrayagg","json_exists","json_object","json_objectagg","json_query","json_table","json_table_primitive","json_value","lag","language","large","last_value","lateral","lead","leading","left","like","like_regex","listagg","ln","local","localtime","localtimestamp","log","log10","lower","match","match_number","match_recognize","matches","max","member","merge","method","min","minute","mod","modifies","module","month","multiset","national","natural","nchar","nclob","new","no","none","normalize","not","nth_value","ntile","null","nullif","numeric","octet_length","occurrences_regex","of","offset","old","omit","on","one","only","open","or","order","out","outer","over","overlaps","overlay","parameter","partition","pattern","per","percent","percent_rank","percentile_cont","percentile_disc","period","portion","position","position_regex","power","precedes","precision","prepare","primary","procedure","ptf","range","rank","reads","real","recursive","ref","references","referencing","regr_avgx","regr_avgy","regr_count","regr_intercept","regr_r2","regr_slope","regr_sxx","regr_sxy","regr_syy","release","result","return","returns","revoke","right","rollback","rollup","row","row_number","rows","running","savepoint","scope","scroll","search","second","seek","select","sensitive","session_user","set","show","similar","sin","sinh","skip","smallint","some","specific","specifictype","sql","sqlexception","sqlstate","sqlwarning","sqrt","start","static","stddev_pop","stddev_samp","submultiset","subset","substring","substring_regex","succeeds","sum","symmetric","system","system_time","system_user","table","tablesample","tan","tanh","then","time","timestamp","timezone_hour","timezone_minute","to","trailing","translate","translate_regex","translation","treat","trigger","trim","trim_array","true","truncate","uescape","union","unique","unknown","unnest","update","upper","user","using","value","values","value_of","var_pop","var_samp","varbinary","varchar","varying","versioning","when","whenever","where","width_bucket","window","with","within","without","year"],c=["abs","acos","array_agg","asin","atan","avg","cast","ceil","ceiling","coalesce","corr","cos","cosh","count","covar_pop","covar_samp","cume_dist","dense_rank","deref","element","exp","extract","first_value","floor","json_array","json_arrayagg","json_exists","json_object","json_objectagg","json_query","json_table","json_table_primitive","json_value","lag","last_value","lead","listagg","ln","log","log10","lower","max","min","mod","nth_value","ntile","nullif","percent_rank","percentile_cont","percentile_disc","position","position_regex","power","rank","regr_avgx","regr_avgy","regr_count","regr_intercept","regr_r2","regr_slope","regr_sxx","regr_sxy","regr_syy","row_number","sin","sinh","sqrt","stddev_pop","stddev_samp","substring","substring_regex","sum","tan","tanh","translate","translate_regex","treat","trim","trim_array","unnest","upper","value_of","var_pop","var_samp","width_bucket"],f=["current_catalog","current_date","current_default_transform_group","current_path","current_role","current_schema","current_transform_group_for_type","current_user","session_user","system_time","system_user","current_time","localtime","current_timestamp","localtimestamp"],g=["create table","insert into","primary key","foreign key","not null","alter table","add constraint","grouping sets","on overflow","character set","respect nulls","ignore nulls","nulls first","nulls last","depth first","breadth first"],E=c,k=[...u,...a].filter(I=>!c.includes(I)),y={scope:"variable",match:/@[a-z0-9][a-z0-9_]*/},M={scope:"operator",match:/[-+*/=%^~]|&&?|\\|\\|?|!=?|<(?:=>?|<|>)?|>[>=]?/,relevance:0},H={match:t.concat(/\\b/,t.either(...E),/\\s*\\(/),relevance:0,keywords:{built_in:E}};function C(I){return t.concat(/\\b/,t.either(...I.map(N=>N.replace(/\\s+/,"\\\\s+"))),/\\b/)}let B={scope:"keyword",match:C(g),relevance:0};function $(I,{exceptions:N,when:se}={}){let P=se;return N=N||[],I.map(F=>F.match(/\\|\\d+$/)||N.includes(F)?F:P(F)?\`\${F}|0\`:F)}return{name:"SQL",case_insensitive:!0,illegal:/[{}]|<\\//,keywords:{$pattern:/\\b[\\w\\.]+/,keyword:$(k,{when:I=>I.length<3}),literal:o,type:l,built_in:f},contains:[{scope:"type",match:C(i)},B,H,y,s,r,e.C_NUMBER_MODE,e.C_BLOCK_COMMENT_MODE,n,M]}}D.registerLanguage("javascript",kt);D.registerLanguage("js",kt);D.registerLanguage("typescript",xt);D.registerLanguage("ts",xt);D.registerLanguage("python",wt);D.registerLanguage("py",wt);D.registerLanguage("bash",Et);D.registerLanguage("sh",Et);D.registerLanguage("json",Bn);D.registerLanguage("html",_t);D.registerLanguage("xml",_t);D.registerLanguage("css",$n);D.registerLanguage("sql",Pn);function si(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}var ii={link({href:e,title:t,text:n}){let s=t?\` title="\${t}"\`:"";return\`<a href="\${e}"\${s} target="_blank" rel="noopener noreferrer">\${n}</a>\`},code({text:e,lang:t}){let n=t&&D.getLanguage(t)?t:null,s=n?D.highlight(e,{language:n}).value:D.highlightAuto(e).value,r=n?\` language-\${n}\`:"";return\`<div class="code-block"><button class="copy-btn" data-code="\${si(e)}">Copy</button><pre><code class="hljs\${r}">\${s}</code></pre></div>\`}};T.use({gfm:!0,breaks:!0,renderer:ii});function yt(e){return T.parse(e)}var Ie=!0;function zn(){let e=document.getElementById("dash-hdr"),t=document.getElementById("stop-all-btn");e.addEventListener("click",function(){Ie=!Ie,document.getElementById("dash-body").style.display=Ie?"":"none",document.getElementById("dash-icon").textContent=Ie?"\\u25B2":"\\u25BC",e.setAttribute("aria-expanded",String(Ie))}),e.addEventListener("keydown",function(n){(n.key==="Enter"||n.key===" ")&&(n.preventDefault(),e.click())}),t.addEventListener("click",function(){ye({type:"stop-all"})})}function Un(e){let t=document.getElementById("dash"),n=document.getElementById("stop-all-btn");if(!e||e.length===0){t.classList.add("hidden"),n.disabled=!0;return}t.classList.remove("hidden");let s=null,r=[];for(let a=0;a<e.length;a++)e[a].type==="master"?s=e[a]:r.push(e[a]);let o=document.getElementById("dash-master");o.innerHTML=s?'<div style="padding:2px 0;color:var(--text-primary)"><strong>Master:</strong> '+(s.model||"unknown")+" \\xA0|\\xA0 "+s.status+"</div>":"";let i=document.getElementById("dash-workers");if(r.length===0)i.innerHTML="",n.disabled=!0;else{n.disabled=!1;let a='<div style="font-weight:500;padding:2px 0">Workers ('+r.length+"):</div>";for(let u=0;u<r.length;u++){let c=r[u],f=c.progress_pct||0,g="s-"+(c.status||"running"),E=c.started_at?Math.floor((Date.now()-new Date(c.started_at).getTime())/1e3)+"s":"",k=String(c.id);a+='<div class="agent-row"><span style="font-family:monospace;color:var(--text-secondary);flex-shrink:0">'+k.slice(0,8)+'</span><span class="abadge '+g+'">'+(c.model||"\\u2014")+'</span><span style="color:var(--text-muted);flex-shrink:0">'+(c.profile||"\\u2014")+'</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary)">'+(c.task_summary||"\\u2014")+'</span><div class="prog-wrap"><div class="prog-bar" style="width:'+f+'%"></div></div><span style="color:var(--text-muted);white-space:nowrap;flex-shrink:0">'+f+'%</span><span style="color:var(--text-muted);white-space:nowrap;flex-shrink:0;min-width:32px;text-align:right">'+E+'</span><button class="stop-btn" title="Stop this worker" aria-label="Stop worker '+k.slice(0,8)+'" data-worker-id="'+k+'">\\u2715</button></div>'}i.innerHTML=a,i.querySelectorAll("[data-worker-id]").forEach(function(u){u.addEventListener("click",function(){ye({type:"stop-worker",workerId:u.dataset.workerId})})})}let l=0;for(let a=0;a<e.length;a++)l+=e[a].cost_usd||0;document.getElementById("dash-cost").innerHTML='<div class="dash-cost">Cost: 
</body>
</html>
+l.toFixed(4)+" \\xA0|\\xA0 Active workers: "+r.length+"</div>",document.getElementById("dash-lbl").textContent="Agent Status ("+e.length+" active)"}var Oe=!1,be=null,j=null,de=null;function fe(){return window.innerWidth>=768}function Hn(){Oe=!0,be.classList.add("open"),fe()||(j.classList.add("visible"),j.removeAttribute("aria-hidden")),de.setAttribute("aria-expanded","true"),de.setAttribute("aria-label","Close sidebar"),be.setAttribute("aria-hidden","false")}function St(){Oe=!1,be.classList.remove("open"),j.classList.remove("visible"),j.setAttribute("aria-hidden","true"),de.setAttribute("aria-expanded","false"),de.setAttribute("aria-label","Open sidebar"),be.setAttribute("aria-hidden","true")}function ai(){Oe?(St(),fe()&&localStorage.setItem("ob-sidebar-open","false")):(Hn(),fe()&&localStorage.setItem("ob-sidebar-open","true"))}function Gn(){be=document.getElementById("sidebar"),j=document.getElementById("sidebar-overlay"),de=document.getElementById("sidebar-toggle"),!(!be||!j||!de)&&(de.addEventListener("click",ai),j.addEventListener("click",function(){St()}),document.addEventListener("keydown",function(e){e.key==="Escape"&&Oe&&!fe()&&St()}),window.addEventListener("resize",function(){Oe&&(fe()?(j.classList.remove("visible"),j.setAttribute("aria-hidden","true")):(j.classList.add("visible"),j.removeAttribute("aria-hidden")))}),fe()&&localStorage.getItem("ob-sidebar-open")!=="false"&&Hn())}var ee=document.getElementById("msgs"),oi=document.getElementById("form"),Me=document.getElementById("inp"),li=document.getElementById("send"),ci=document.getElementById("dot"),vt=document.getElementById("connLabel"),Wn=document.getElementById("status-bar"),jn=document.getElementById("status-text"),At=document.getElementById("status-timer"),me=null,Rt=null;(function(){let t=window.__OB_PUBLIC_URL__;if(!t)return;let n=document.getElementById("public-url-bar"),s=document.getElementById("public-url-text"),r=document.getElementById("url-copy-btn");!n||!s||!r||(s.textContent=t,n.classList.remove("hidden"),n.classList.add("visible"),r.addEventListener("click",function(){navigator.clipboard.writeText(t).then(function(){r.textContent="Copied!",r.classList.add("copied"),setTimeout(function(){r.textContent="Copy",r.classList.remove("copied")},2e3)},function(){let o=document.createElement("textarea");o.value=t,o.style.position="fixed",o.style.opacity="0",document.body.appendChild(o),o.select(),document.execCommand("copy"),document.body.removeChild(o),r.textContent="Copied!",r.classList.add("copied"),setTimeout(function(){r.textContent="Copy",r.classList.remove("copied")},2e3)})}))})();(function(){let t=document.getElementById("share-btn"),n=document.getElementById("share-toast");if(!t||!n)return;let s=null;function r(){s&&clearTimeout(s),n.classList.add("visible"),s=setTimeout(function(){n.classList.remove("visible"),s=null},2e3)}t.addEventListener("click",function(){let o=window.location.href;navigator.clipboard.writeText(o).then(function(){r()},function(){let i=document.createElement("textarea");i.value=o,i.style.position="fixed",i.style.opacity="0",document.body.appendChild(i),i.select(),document.execCommand("copy"),document.body.removeChild(i),r()})})})();var Ce=localStorage.getItem("ob-ts")!=="false";function It(e){let t=Math.floor((Date.now()-e.getTime())/1e3);return t<60?"just now":t<3600?Math.floor(t/60)+"m ago":t<86400?Math.floor(t/3600)+"h ago":Math.floor(t/86400)+"d ago"}function Fn(){let e=document.getElementById("ts-toggle");e&&(e.textContent=Ce?"Hide times":"Show times"),document.documentElement.setAttribute("data-ts",Ce?"show":"hide")}(function(){Fn();let t=document.getElementById("ts-toggle");t&&t.addEventListener("click",function(){Ce=!Ce,localStorage.setItem("ob-ts",Ce?"true":"false"),Fn()}),setInterval(function(){ee.querySelectorAll("time.bubble-ts").forEach(function(n){n.textContent=It(new Date(n.dateTime))})},6e4)})();(function(){let t=document.getElementById("theme-toggle");function n(s){document.documentElement.setAttribute("data-theme",s),t.textContent=s==="dark"?"Light":"Dark",localStorage.setItem("ob-theme",s)}n(localStorage.getItem("ob-theme")||"light"),t.addEventListener("click",function(){let s=document.documentElement.getAttribute("data-theme");n(s==="dark"?"light":"dark")})})();function Xn(e){let t=document.createElement("div");return t.className="avatar avatar-"+e,t.setAttribute("aria-hidden","true"),t.textContent=e==="user"?"You":"AI",t}function ke(e,t,n){let s=document.createElement("div");if(s.className="bubble "+t,t==="ai"){let r=yt(e);if(e.length>500){let o=document.createElement("div");o.className="collapsible-wrap";let i=document.createElement("div");i.className="collapsible-inner",i.style.maxHeight="120px",i.innerHTML=r;let l=document.createElement("div");l.className="collapsible-fade";let a=document.createElement("button");a.className="show-more-btn",a.textContent="Show more",a.setAttribute("aria-expanded","false"),a.addEventListener("click",function(){a.getAttribute("aria-expanded")==="false"?(i.style.maxHeight=i.scrollHeight+"px",l.style.display="none",a.textContent="Show less",a.setAttribute("aria-expanded","true")):(i.style.maxHeight="120px",l.style.display="",a.textContent="Show more",a.setAttribute("aria-expanded","false"))}),o.appendChild(i),o.appendChild(l),s.appendChild(o),s.appendChild(a)}else s.innerHTML=r}else s.textContent=e;if(t!=="sys"){let r=n instanceof Date?n:new Date,o=document.createElement("time");o.className="bubble-ts",o.dateTime=r.toISOString(),o.title=r.toLocaleString(),o.textContent=It(r),s.appendChild(o);let i=document.createElement("div");i.className="msg-row "+t,i.appendChild(Xn(t)),i.appendChild(s),ee.appendChild(i)}else ee.appendChild(s);return ee.scrollTop=ee.scrollHeight,s}ee.addEventListener("click",function(e){let t=e.target.closest(".copy-btn");if(!t)return;let n=t.dataset.code;n&&navigator.clipboard.writeText(n).then(function(){t.textContent="Copied!",t.classList.add("copied"),setTimeout(function(){t.textContent="Copy",t.classList.remove("copied")},2e3)})});function ui(){me||(Rt=Date.now(),At.textContent="0s",me=setInterval(function(){let e=Math.floor((Date.now()-Rt)/1e3);At.textContent=e+"s"},1e3))}function di(){me&&(clearInterval(me),me=null),Rt=null,At.textContent=""}function Nt(e){Wn.classList.remove("hidden"),jn.innerHTML=e,me||ui()}function We(){Wn.classList.add("hidden"),jn.innerHTML="",di()}function pi(e){if(e.type==="classifying")return'\\u{1F50D} Analyzing request<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>';if(e.type==="planning")return'\\u{1F4CB} Planning subtasks<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>';if(e.type==="spawning"){let t=e.workerCount;return"\\u{1F4CB} Breaking into "+t+" subtask"+(t!==1?"s":"")+'<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>'}return e.type==="worker-progress"?(e.workerName?"\\u2699\\uFE0F "+e.workerName+": ":"\\u2699\\uFE0F ")+e.completed+"/"+e.total+' workers done<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>':e.type==="synthesizing"?'\\u{1F4DD} Preparing final response<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>':e.type==="exploring"?"\\u{1F5FA}\\uFE0F "+e.phase+'<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>':e.type==="exploring-directory"?"\\u{1F4C2} Exploring directories: "+e.completed+"/"+e.total+(e.directory?" ("+e.directory+")":"")+'<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>':null}function Zn(e,t){ci.className="conn-dot"+(e?" online":""),e?vt.textContent="Connected":t?vt.textContent="Reconnecting...":vt.textContent="Disconnected",Me.disabled=!e,li.disabled=!e}function gi(e){if(e.type==="response")We(),ke(e.content,"ai",e.timestamp?new Date(e.timestamp):new Date),hi(),bi(e.content),Qn();else if(e.type==="download"){We();let t=e.timestamp?new Date(e.timestamp):new Date,n=document.createElement("div");n.className="bubble ai",e.content&&(n.innerHTML=yt(e.content)+"<br>");let s=document.createElement("a");s.href=e.url,s.download=e.filename||"download",s.className="download-link",s.textContent="\\u2B07\\uFE0F Download "+(e.filename||"file"),s.setAttribute("aria-label","Download "+(e.filename||"file")),n.appendChild(s);let r=document.createElement("time");r.className="bubble-ts",r.dateTime=t.toISOString(),r.title=t.toLocaleString(),r.textContent=It(t),n.appendChild(r);let o=document.createElement("div");o.className="msg-row ai",o.appendChild(Xn("ai")),o.appendChild(n),ee.appendChild(o),ee.scrollTop=ee.scrollHeight}else if(e.type==="typing")Nt('\\u{1F914} Thinking<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>');else if(e.type==="progress"){if(e.event&&e.event.type==="complete")We();else if(e.event&&e.event.type==="worker-result"){let t=e.event.success?"\\u2705":"\\u274C",n=e.event.tool?" \\xB7 "+e.event.tool:"",s=t+" **Subtask "+e.event.workerIndex+"/"+e.event.total+"** ("+e.event.profile+n+\`):

\`;ke(s+e.event.content,"ai",new Date)}else if(e.event&&e.event.type==="worker-cancelled")ke("\\u{1F6D1} Worker "+e.event.workerId+" was stopped by "+e.event.cancelledBy+".","sys");else if(e.event){let t=pi(e.event);t&&Nt(t)}}else e.type==="agent-status"&&Un(e.agents)}Me.addEventListener("keydown",function(e){e.key==="Escape"&&(Me.value="")});oi.addEventListener("submit",function(e){e.preventDefault();let t=Me.value.trim();!t||!Pt()||(ke(t,"user",new Date),ye({type:"message",content:t}),Me.value="",Nt('\\u{1F914} Thinking<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>'))});var je=0,qn="OpenBridge";function Yn(){document.title=je>0?"("+je+") "+qn:qn}function hi(){document.visibilityState!=="visible"&&(je++,Yn())}function fi(){je=0,Yn()}document.addEventListener("visibilitychange",function(){document.visibilityState==="visible"&&fi()});function bi(e){if(document.visibilityState!=="visible"&&"Notification"in window&&Notification.permission==="granted"){var t=e.length>100?e.slice(0,97)+"...":e;new Notification("OpenBridge",{body:t,icon:"/icons/icon-192.png"})}}(function(){"Notification"in window&&Notification.permission==="default"&&setTimeout(function(){Notification.requestPermission()},3e3)})();var re=localStorage.getItem("ob-sound")==="false",Tt=null;function mi(){return Tt||(Tt=new(window.AudioContext||window.webkitAudioContext)),Tt}function Qn(){if(!re&&!(!window.AudioContext&&!window.webkitAudioContext))try{let e=mi(),t=e.createOscillator(),n=e.createGain();t.connect(n),n.connect(e.destination),t.type="sine",t.frequency.setValueAtTime(880,e.currentTime),t.frequency.exponentialRampToValueAtTime(660,e.currentTime+.15),n.gain.setValueAtTime(.3,e.currentTime),n.gain.exponentialRampToValueAtTime(.001,e.currentTime+.25),t.start(e.currentTime),t.stop(e.currentTime+.25)}catch{}}function Kn(){let e=document.getElementById("sound-toggle");e&&(e.textContent=re?"\\u{1F507}":"\\u{1F50A}",e.setAttribute("aria-label",re?"Unmute notifications":"Mute notifications"),e.setAttribute("aria-pressed",re?"true":"false"))}(function(){Kn();let t=document.getElementById("sound-toggle");t&&t.addEventListener("click",function(){re=!re,localStorage.setItem("ob-sound",re?"false":"true"),Kn(),re||Qn()})})();(function(){if(!(window.matchMedia("(max-width: 767px)").matches||("ontouchstart"in window||navigator.maxTouchPoints>0)&&screen.width<=1024)||window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===!0||localStorage.getItem("ob-pwa-dismissed")==="1")return;let s=document.getElementById("pwa-banner"),r=document.getElementById("pwa-install-btn"),o=document.getElementById("pwa-dismiss-btn"),i=document.getElementById("pwa-banner-hint");if(!s||!r||!o)return;let l=null,a=/iphone|ipad|ipod/i.test(navigator.userAgent),u=/safari/i.test(navigator.userAgent)&&!/chrome|crios|fxios/i.test(navigator.userAgent);function c(){s.classList.remove("hidden")}function f(){s.classList.add("hidden"),localStorage.setItem("ob-pwa-dismissed","1")}o.addEventListener("click",f),a&&u?(i&&(i.textContent="Tap Share \\u238E then \\u201CAdd to Home Screen\\u201D"),r.style.display="none",setTimeout(c,2e3)):(window.addEventListener("beforeinstallprompt",function(g){g.preventDefault(),l=g,setTimeout(c,2e3)}),r.addEventListener("click",function(){l&&(l.prompt(),l.userChoice.then(function(g){g.outcome==="accepted"&&localStorage.setItem("ob-pwa-dismissed","1"),l=null,s.classList.add("hidden")}))}),window.addEventListener("appinstalled",function(){s.classList.add("hidden"),localStorage.setItem("ob-pwa-dismissed","1"),l=null}))})();(function(){"serviceWorker"in navigator&&navigator.serviceWorker.register("/sw.js").catch(function(t){typeof console<"u"&&console.warn("SW registration failed:",t)})})();Gn();zn();$t({onOpen:function(){Zn(!0),ke("Connected to OpenBridge","sys")},onClose:function(){Zn(!1,!0),We(),ke("Disconnected \\u2014 reconnecting...","sys")},onMessage:gi});})();

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
