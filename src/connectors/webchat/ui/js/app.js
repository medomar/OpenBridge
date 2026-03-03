/**
 * OpenBridge WebChat — main application entry point.
 * Coordinates WebSocket, markdown rendering, and dashboard modules.
 */

import { initWebSocket, sendMessage, isConnected } from './websocket.js';
import { renderMarkdown } from './markdown.js';
import { initDashboard, updateDashboard } from './dashboard.js';

const msgs = document.getElementById('msgs');
const form = document.getElementById('form');
const inp = document.getElementById('inp');
const send = document.getElementById('send');
const dot = document.getElementById('dot');
const connLabel = document.getElementById('connLabel');
const statusBar = document.getElementById('status-bar');
const statusText = document.getElementById('status-text');
const statusTimer = document.getElementById('status-timer');

let timerInterval = null;
let timerStart = null;

// --- Theme toggle ---

(function initTheme() {
  const btn = document.getElementById('theme-toggle');

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    btn.textContent = theme === 'dark' ? 'Light' : 'Dark';
    localStorage.setItem('ob-theme', theme);
  }

  applyTheme(localStorage.getItem('ob-theme') || 'light');

  btn.addEventListener('click', function () {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
})();

// --- Messages ---

function addBubble(content, cls) {
  const div = document.createElement('div');
  div.className = 'bubble ' + cls;
  if (cls === 'ai') {
    const html = renderMarkdown(content);
    if (content.length > 500) {
      const wrap = document.createElement('div');
      wrap.className = 'collapsible-wrap';

      const inner = document.createElement('div');
      inner.className = 'collapsible-inner';
      inner.style.maxHeight = '120px';
      inner.innerHTML = html;

      const fade = document.createElement('div');
      fade.className = 'collapsible-fade';

      const btn = document.createElement('button');
      btn.className = 'show-more-btn';
      btn.textContent = 'Show more';
      btn.addEventListener('click', function () {
        const isCollapsed = btn.textContent === 'Show more';
        if (isCollapsed) {
          inner.style.maxHeight = inner.scrollHeight + 'px';
          fade.style.display = 'none';
          btn.textContent = 'Show less';
        } else {
          inner.style.maxHeight = '120px';
          fade.style.display = '';
          btn.textContent = 'Show more';
        }
      });

      wrap.appendChild(inner);
      wrap.appendChild(fade);
      div.appendChild(wrap);
      div.appendChild(btn);
    } else {
      div.innerHTML = html;
    }
  } else {
    div.textContent = content;
  }
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

// --- Copy button for code blocks ---

msgs.addEventListener('click', function (e) {
  const btn = e.target.closest('.copy-btn');
  if (!btn) return;
  const code = btn.dataset.code;
  if (!code) return;
  navigator.clipboard.writeText(code).then(function () {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(function () {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 2000);
  });
});

// --- Status bar ---

function startTimer() {
  if (timerInterval) return;
  timerStart = Date.now();
  statusTimer.textContent = '0s';
  timerInterval = setInterval(function () {
    const elapsed = Math.floor((Date.now() - timerStart) / 1000);
    statusTimer.textContent = elapsed + 's';
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerStart = null;
  statusTimer.textContent = '';
}

function showStatus(html) {
  statusBar.classList.remove('hidden');
  statusText.innerHTML = html;
  if (!timerInterval) startTimer();
}

function hideStatus() {
  statusBar.classList.add('hidden');
  statusText.innerHTML = '';
  stopTimer();
}

// --- Progress event labels ---

function progressLabel(event) {
  if (event.type === 'classifying') {
    return '\uD83D\uDD0D Analyzing request<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>';
  }
  if (event.type === 'planning') {
    return '\uD83D\uDCCB Planning subtasks<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>';
  }
  if (event.type === 'spawning') {
    const n = event.workerCount;
    return (
      '\uD83D\uDCCB Breaking into ' +
      n +
      ' subtask' +
      (n !== 1 ? 's' : '') +
      '<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>'
    );
  }
  if (event.type === 'worker-progress') {
    const label = event.workerName ? '\u2699\uFE0F ' + event.workerName + ': ' : '\u2699\uFE0F ';
    return (
      label +
      event.completed +
      '/' +
      event.total +
      ' workers done<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>'
    );
  }
  if (event.type === 'synthesizing') {
    return '\uD83D\uDCDD Preparing final response<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>';
  }
  if (event.type === 'exploring') {
    return (
      '\uD83D\uDDFA\uFE0F ' +
      event.phase +
      '<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>'
    );
  }
  if (event.type === 'exploring-directory') {
    return (
      '\uD83D\uDCC2 Exploring directories: ' +
      event.completed +
      '/' +
      event.total +
      (event.directory ? ' (' + event.directory + ')' : '') +
      '<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>'
    );
  }
  return null;
}

// --- Connection state ---

function setOnline(online) {
  dot.className = 'conn-dot' + (online ? ' online' : '');
  connLabel.textContent = online ? 'Connected' : 'Disconnected';
  inp.disabled = !online;
  send.disabled = !online;
}

// --- WebSocket message handler ---

function handleMessage(data) {
  if (data.type === 'response') {
    hideStatus();
    addBubble(data.content, 'ai');
  } else if (data.type === 'download') {
    hideStatus();
    const div = document.createElement('div');
    div.className = 'bubble ai';
    if (data.content) {
      div.innerHTML = renderMarkdown(data.content) + '<br>';
    }
    const link = document.createElement('a');
    link.href = data.url;
    link.download = data.filename || 'download';
    link.className = 'download-link';
    link.textContent = '\u2B07\uFE0F Download ' + (data.filename || 'file');
    div.appendChild(link);
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  } else if (data.type === 'typing') {
    showStatus(
      '\uD83E\uDD14 Thinking<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>',
    );
  } else if (data.type === 'progress') {
    if (data.event && data.event.type === 'complete') {
      hideStatus();
    } else if (data.event && data.event.type === 'worker-result') {
      const icon = data.event.success ? '\u2705' : '\u274C';
      const toolLabel = data.event.tool ? ' \u00b7 ' + data.event.tool : '';
      const header =
        icon +
        ' **Subtask ' +
        data.event.workerIndex +
        '/' +
        data.event.total +
        '** (' +
        data.event.profile +
        toolLabel +
        '):\n\n';
      addBubble(header + data.event.content, 'ai');
    } else if (data.event && data.event.type === 'worker-cancelled') {
      addBubble(
        '\uD83D\uDED1 Worker ' +
          data.event.workerId +
          ' was stopped by ' +
          data.event.cancelledBy +
          '.',
        'sys',
      );
    } else if (data.event) {
      const label = progressLabel(data.event);
      if (label) showStatus(label);
    }
  } else if (data.type === 'agent-status') {
    updateDashboard(data.agents);
  }
}

// --- Form submit ---

form.addEventListener('submit', function (e) {
  e.preventDefault();
  const text = inp.value.trim();
  if (!text || !isConnected()) return;
  addBubble(text, 'user');
  sendMessage({ type: 'message', content: text });
  inp.value = '';
  showStatus(
    '\uD83E\uDD14 Thinking<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>',
  );
});

// --- Boot ---

initDashboard();
initWebSocket({
  onOpen: function () {
    setOnline(true);
    addBubble('Connected to OpenBridge', 'sys');
  },
  onClose: function () {
    setOnline(false);
    hideStatus();
    addBubble('Disconnected \u2014 reconnecting...', 'sys');
  },
  onMessage: handleMessage,
});
