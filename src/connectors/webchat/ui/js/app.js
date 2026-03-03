/**
 * OpenBridge WebChat — main application entry point.
 * Coordinates WebSocket, markdown rendering, and dashboard modules.
 */

import { initWebSocket, sendMessage, isConnected } from './websocket.js';
import { renderMarkdown } from './markdown.js';
import { initDashboard, updateDashboard } from './dashboard.js';
import { initSidebar, loadSessions, setOnSessionSelect, setOnNewConversation } from './sidebar.js';
import { initAutocomplete } from './autocomplete.js';
import { initSettings, setOnThemeChange, setOnSoundChange } from './settings.js';
import { initDeepMode, handleDeepPhaseEvent } from './deep-mode.js';

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

const _pageSessionId =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
let _feedbackMsgCounter = 0;

// --- Public URL bar (shown when tunnel is active) ---

(function initPublicUrlBar() {
  const url = window.__OB_PUBLIC_URL__;
  if (!url) return;
  const bar = document.getElementById('public-url-bar');
  const text = document.getElementById('public-url-text');
  const btn = document.getElementById('url-copy-btn');
  if (!bar || !text || !btn) return;
  text.textContent = url;
  bar.classList.remove('hidden');
  bar.classList.add('visible');
  btn.addEventListener('click', function () {
    navigator.clipboard.writeText(url).then(
      function () {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(function () {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 2000);
      },
      function () {
        // Fallback for browsers without clipboard API
        const el = document.createElement('textarea');
        el.value = url;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(function () {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 2000);
      },
    );
  });
})();

// --- Share this link button ---

(function initShareBtn() {
  const btn = document.getElementById('share-btn');
  const toast = document.getElementById('share-toast');
  if (!btn || !toast) return;

  let toastTimeout = null;

  function showToast() {
    if (toastTimeout) clearTimeout(toastTimeout);
    toast.classList.add('visible');
    toastTimeout = setTimeout(function () {
      toast.classList.remove('visible');
      toastTimeout = null;
    }, 2000);
  }

  btn.addEventListener('click', function () {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(
      function () {
        showToast();
      },
      function () {
        // Fallback for browsers without clipboard API
        const el = document.createElement('textarea');
        el.value = url;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        showToast();
      },
    );
  });
})();

// --- Timestamps ---

let tsVisible = localStorage.getItem('ob-ts') !== 'false';

function formatRelativeTime(date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function applyTsVisibility() {
  const btn = document.getElementById('ts-toggle');
  if (btn) btn.textContent = tsVisible ? 'Hide times' : 'Show times';
  document.documentElement.setAttribute('data-ts', tsVisible ? 'show' : 'hide');
}

(function initTs() {
  applyTsVisibility();
  const btn = document.getElementById('ts-toggle');
  if (btn) {
    btn.addEventListener('click', function () {
      tsVisible = !tsVisible;
      localStorage.setItem('ob-ts', tsVisible ? 'true' : 'false');
      applyTsVisibility();
    });
  }
  setInterval(function () {
    msgs.querySelectorAll('time.bubble-ts').forEach(function (el) {
      el.textContent = formatRelativeTime(new Date(el.dateTime));
    });
  }, 60000);
})();

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
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    // Keep settings panel theme select in sync
    const settingsSelect = document.getElementById('settings-theme-select');
    if (settingsSelect) settingsSelect.value = next;
  });
})();

// --- Conversation Persistence ---

const CONV_STORAGE_KEY = 'ob-conversation';
const CONV_MAX_MESSAGES = 100;
let _convLog = [];
let _convPersistEnabled = true;

function _saveConv() {
  try {
    localStorage.setItem(CONV_STORAGE_KEY, JSON.stringify(_convLog));
  } catch (_) {
    // localStorage full or unavailable — non-critical
  }
}

function _trackMsg(content, cls, timestamp) {
  if (!_convPersistEnabled) return;
  _convLog.push({ content, cls, ts: (timestamp instanceof Date ? timestamp : new Date()).toISOString() });
  if (_convLog.length > CONV_MAX_MESSAGES) {
    _convLog = _convLog.slice(-CONV_MAX_MESSAGES);
  }
  _saveConv();
}

function clearConversation() {
  _convLog = [];
  try {
    localStorage.removeItem(CONV_STORAGE_KEY);
  } catch (_) {}
}

function restoreConversation() {
  try {
    const raw = localStorage.getItem(CONV_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved) || saved.length === 0) return;
    _convPersistEnabled = false;
    _convLog = saved.slice(-CONV_MAX_MESSAGES);
    for (const msg of _convLog) {
      if (msg.cls === 'user' || msg.cls === 'ai') {
        addBubble(msg.content, msg.cls, msg.ts ? new Date(msg.ts) : new Date());
      }
    }
    _convPersistEnabled = true;
  } catch (_) {
    _convPersistEnabled = true;
  }
}

// --- Messages ---

function makeAvatar(cls) {
  const av = document.createElement('div');
  av.className = 'avatar avatar-' + cls;
  av.setAttribute('aria-hidden', 'true');
  av.textContent = cls === 'user' ? 'You' : 'AI';
  return av;
}

function addBubble(content, cls, timestamp) {
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
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', function () {
        const isCollapsed = btn.getAttribute('aria-expanded') === 'false';
        if (isCollapsed) {
          inner.style.maxHeight = inner.scrollHeight + 'px';
          fade.style.display = 'none';
          btn.textContent = 'Show less';
          btn.setAttribute('aria-expanded', 'true');
        } else {
          inner.style.maxHeight = '120px';
          fade.style.display = '';
          btn.textContent = 'Show more';
          btn.setAttribute('aria-expanded', 'false');
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
  if (cls !== 'sys') {
    const tsDate = timestamp instanceof Date ? timestamp : new Date();
    const ts = document.createElement('time');
    ts.className = 'bubble-ts';
    ts.dateTime = tsDate.toISOString();
    ts.title = tsDate.toLocaleString();
    ts.textContent = formatRelativeTime(tsDate);
    div.appendChild(ts);
    if (cls === 'ai') {
      _feedbackMsgCounter++;
      const feedbackRow = document.createElement('div');
      feedbackRow.className = 'feedback-row';
      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'feedback-btn';
      upBtn.setAttribute('aria-label', 'Good response');
      upBtn.dataset.rating = 'up';
      upBtn.dataset.msgIdx = String(_feedbackMsgCounter);
      upBtn.textContent = '\uD83D\uDC4D';
      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'feedback-btn';
      downBtn.setAttribute('aria-label', 'Poor response');
      downBtn.dataset.rating = 'down';
      downBtn.dataset.msgIdx = String(_feedbackMsgCounter);
      downBtn.textContent = '\uD83D\uDC4E';
      feedbackRow.appendChild(upBtn);
      feedbackRow.appendChild(downBtn);
      div.appendChild(feedbackRow);
    }
    const row = document.createElement('div');
    row.className = 'msg-row ' + cls;
    row.appendChild(makeAvatar(cls));
    row.appendChild(div);
    msgs.appendChild(row);
  } else {
    msgs.appendChild(div);
  }
  msgs.scrollTop = msgs.scrollHeight;
  if (cls === 'user' || cls === 'ai') {
    _trackMsg(content, cls, timestamp instanceof Date ? timestamp : new Date());
  }
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

// --- Feedback buttons ---

const _feedbackToastEl = (function () {
  const el = document.createElement('div');
  el.className = 'feedback-toast';
  el.textContent = 'Thanks!';
  document.body.appendChild(el);
  return el;
})();

let _feedbackToastTimer = null;

function showFeedbackToast() {
  if (_feedbackToastTimer) clearTimeout(_feedbackToastTimer);
  _feedbackToastEl.classList.add('visible');
  _feedbackToastTimer = setTimeout(function () {
    _feedbackToastEl.classList.remove('visible');
    _feedbackToastTimer = null;
  }, 2000);
}

msgs.addEventListener('click', function (e) {
  const btn = e.target.closest('.feedback-btn');
  if (!btn || btn.disabled) return;
  const rating = btn.dataset.rating;
  const msgIdx = btn.dataset.msgIdx;
  const feedbackRow = btn.closest('.feedback-row');
  if (feedbackRow) {
    feedbackRow.querySelectorAll('.feedback-btn').forEach(function (b) {
      b.disabled = true;
      if (b.dataset.rating === rating) {
        b.classList.add(rating === 'up' ? 'active-up' : 'active-down');
      }
    });
  }
  showFeedbackToast();
  fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: _pageSessionId, message: msgIdx, rating: rating }),
  }).catch(function () {
    // Feedback failed — non-critical
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

function setOnline(online, reconnecting) {
  dot.className = 'conn-dot' + (online ? ' online' : '');
  if (online) {
    connLabel.textContent = 'Connected';
  } else if (reconnecting) {
    connLabel.textContent = 'Reconnecting...';
  } else {
    connLabel.textContent = 'Disconnected';
  }
  inp.disabled = !online;
  send.disabled = !online;
  const uploadBtn = document.getElementById('upload-btn');
  if (uploadBtn) uploadBtn.disabled = !online;
  const micBtn = document.getElementById('mic-btn');
  if (micBtn) micBtn.disabled = !online;
}

// --- WebSocket message handler ---

function handleMessage(data) {
  if (data.type === 'response') {
    hideStatus();
    addBubble(data.content, 'ai', data.timestamp ? new Date(data.timestamp) : new Date());
    incrementUnread();
    showTaskNotification(data.content);
    playNotificationSound();
    void loadSessions();
  } else if (data.type === 'download') {
    hideStatus();
    const tsDate = data.timestamp ? new Date(data.timestamp) : new Date();
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
    link.setAttribute('aria-label', 'Download ' + (data.filename || 'file'));
    div.appendChild(link);
    const ts = document.createElement('time');
    ts.className = 'bubble-ts';
    ts.dateTime = tsDate.toISOString();
    ts.title = tsDate.toLocaleString();
    ts.textContent = formatRelativeTime(tsDate);
    div.appendChild(ts);
    const dlRow = document.createElement('div');
    dlRow.className = 'msg-row ai';
    dlRow.appendChild(makeAvatar('ai'));
    dlRow.appendChild(div);
    msgs.appendChild(dlRow);
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
      addBubble(header + data.event.content, 'ai', new Date());
    } else if (data.event && data.event.type === 'worker-cancelled') {
      addBubble(
        '\uD83D\uDED1 Worker ' +
          data.event.workerId +
          ' was stopped by ' +
          data.event.cancelledBy +
          '.',
        'sys',
      );
    } else if (data.event && data.event.type === 'deep-phase') {
      handleDeepPhaseEvent(data.event);
    } else if (data.event) {
      const label = progressLabel(data.event);
      if (label) showStatus(label);
    }
  } else if (data.type === 'agent-status') {
    updateDashboard(data.agents);
  }
}

// --- Textarea auto-resize and character count ---

const charCount = document.getElementById('char-count');

function autoResize() {
  inp.style.height = 'auto';
  inp.style.height = inp.scrollHeight + 'px';
}

function updateCharCount() {
  const len = inp.value.length;
  if (len > 500) {
    charCount.textContent = len.toLocaleString() + ' chars';
    charCount.classList.remove('hidden');
  } else {
    charCount.classList.add('hidden');
  }
}

inp.addEventListener('input', function () {
  autoResize();
  updateCharCount();
});

// --- Keyboard navigation ---

inp.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  } else if (e.key === 'Escape') {
    inp.value = '';
    autoResize();
    updateCharCount();
  }
});

// --- Form submit ---

form.addEventListener('submit', function (e) {
  e.preventDefault();
  const text = inp.value.trim();
  const hasFiles = _selectedFiles.length > 0;
  if ((!text && !hasFiles) || !isConnected()) return;

  // Snapshot and clear selected files immediately
  const filesToUpload = _selectedFiles.slice();
  _selectedFiles = [];
  renderFilePreviews();

  const displayText = text || '(\uD83D\uDCCE file upload)';
  addBubble(displayText, 'user', new Date());
  inp.value = '';
  autoResize();
  updateCharCount();
  showStatus(
    '\uD83E\uDD14 Thinking<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>',
  );

  if (filesToUpload.length === 0) {
    sendMessage({ type: 'message', content: text });
    return;
  }

  // Upload files first, then send message with file paths appended
  Promise.all(
    filesToUpload.map(function (file) {
      const fd = new FormData();
      fd.append('file', file, file.name);
      return fetch('/api/upload', { method: 'POST', body: fd })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .catch(function () {
          return null;
        });
    }),
  ).then(function (results) {
    const fileLines = results
      .filter(function (r) {
        return r && r.fileId;
      })
      .map(function (r) {
        return '- ' + r.filename + ' (path: ' + r.path + ')';
      });

    let content = text;
    if (fileLines.length > 0) {
      if (content) content += '\n\n';
      content += '[Attached files]\n' + fileLines.join('\n');
    }
    if (!content) content = '[File upload failed — no files were saved]';
    sendMessage({ type: 'message', content: content });
  });
});

// --- File Upload ---

let _selectedFiles = [];

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function renderFilePreviews() {
  const preview = document.getElementById('file-preview');
  if (!preview) return;
  if (_selectedFiles.length === 0) {
    preview.classList.add('hidden');
    preview.replaceChildren();
    return;
  }
  preview.classList.remove('hidden');
  preview.replaceChildren();
  for (let i = 0; i < _selectedFiles.length; i++) {
    const file = _selectedFiles[i];
    const chip = document.createElement('div');
    chip.className = 'file-chip';

    const icon = document.createElement('span');
    icon.className = 'file-chip-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '\uD83D\uDCC4';

    const info = document.createElement('span');
    info.className = 'file-chip-info';

    const name = document.createElement('span');
    name.className = 'file-chip-name';
    name.textContent = file.name;

    const meta = document.createElement('span');
    meta.className = 'file-chip-meta';
    meta.textContent = formatFileSize(file.size) + (file.type ? ' \u00b7 ' + file.type : '');

    info.appendChild(name);
    info.appendChild(meta);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'file-chip-remove';
    removeBtn.setAttribute('aria-label', 'Remove ' + file.name);
    removeBtn.textContent = '\u00d7';
    const idx = i;
    removeBtn.addEventListener('click', function () {
      _selectedFiles.splice(idx, 1);
      renderFilePreviews();
    });

    chip.appendChild(icon);
    chip.appendChild(info);
    chip.appendChild(removeBtn);
    preview.appendChild(chip);
  }
}

(function initFileUpload() {
  const uploadBtn = document.getElementById('upload-btn');
  const fileInput = document.getElementById('file-input');
  const chatWrap = document.querySelector('.chat-wrap');
  if (!uploadBtn || !fileInput) return;

  uploadBtn.addEventListener('click', function () {
    fileInput.click();
  });

  fileInput.addEventListener('change', function () {
    const files = Array.from(fileInput.files || []);
    for (const f of files) {
      _selectedFiles.push(f);
    }
    fileInput.value = '';
    renderFilePreviews();
  });

  if (chatWrap) {
    chatWrap.addEventListener('dragover', function (e) {
      e.preventDefault();
      chatWrap.classList.add('drag-over');
    });

    chatWrap.addEventListener('dragleave', function (e) {
      if (!chatWrap.contains(/** @type {Node} */ (e.relatedTarget))) {
        chatWrap.classList.remove('drag-over');
      }
    });

    chatWrap.addEventListener('drop', function (e) {
      e.preventDefault();
      chatWrap.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer ? e.dataTransfer.files : []);
      for (const f of files) {
        _selectedFiles.push(f);
      }
      renderFilePreviews();
    });
  }
})();

// --- Voice Input ---

(function initVoiceInput() {
  const micBtn = document.getElementById('mic-btn');
  if (!micBtn) return;

  // Check for MediaRecorder support
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices) {
    micBtn.style.display = 'none';
    return;
  }

  let mediaRecorder = null;
  let audioChunks = [];
  let recordingIndicator = null;

  function showRecordingIndicator() {
    if (recordingIndicator) return;
    const filePreview = document.getElementById('file-preview');
    if (!filePreview) return;
    recordingIndicator = document.createElement('div');
    recordingIndicator.className = 'recording-indicator';
    recordingIndicator.innerHTML = '<span class="recording-dot"></span>Recording\u2026';
    filePreview.classList.remove('hidden');
    filePreview.appendChild(recordingIndicator);
  }

  function hideRecordingIndicator() {
    if (!recordingIndicator) return;
    const filePreview = document.getElementById('file-preview');
    recordingIndicator.remove();
    recordingIndicator = null;
    // Hide preview row if no file chips remain
    if (filePreview && filePreview.children.length === 0) {
      filePreview.classList.add('hidden');
    }
  }

  function startRecording() {
    audioChunks = [];
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(function (stream) {
        const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
        mediaRecorder = new MediaRecorder(stream, { mimeType });

        mediaRecorder.addEventListener('dataavailable', function (e) {
          if (e.data && e.data.size > 0) audioChunks.push(e.data);
        });

        mediaRecorder.addEventListener('stop', function () {
          // Stop all mic tracks to release the mic
          stream.getTracks().forEach(function (t) { t.stop(); });

          const blob = new Blob(audioChunks, { type: mimeType });
          audioChunks = [];

          hideRecordingIndicator();
          micBtn.classList.remove('recording');
          micBtn.title = 'Record voice message';
          micBtn.setAttribute('aria-label', 'Record voice message');

          // Upload blob to /api/transcribe
          const ext = mimeType === 'audio/webm' ? '.webm' : '.ogg';
          const fd = new FormData();
          fd.append('file', blob, 'voice' + ext);

          addBubble(
            '\uD83C\uDFA4 Transcribing voice\u2026',
            'sys',
          );

          fetch('/api/transcribe', { method: 'POST', body: fd })
            .then(function (r) {
              return r.ok ? r.json() : Promise.reject(r.status);
            })
            .then(function (data) {
              if (data && data.text) {
                inp.value = data.text;
                inp.dispatchEvent(new Event('input'));
                inp.focus();
                // Remove the "Transcribing…" sys bubble
                const lastSys = msgs.querySelector('.bubble.sys:last-of-type');
                if (lastSys && lastSys.textContent.includes('Transcribing')) {
                  lastSys.closest('.bubble.sys') && lastSys.remove();
                  // also handle when it's the bubble itself
                  const sysBubbles = msgs.querySelectorAll('.bubble.sys');
                  sysBubbles.forEach(function (el) {
                    if (el.textContent.includes('Transcribing')) el.remove();
                  });
                }
              }
            })
            .catch(function () {
              addBubble('\u26A0\uFE0F Voice transcription failed.', 'sys');
            });
        });

        mediaRecorder.start();
        micBtn.classList.add('recording');
        micBtn.title = 'Stop recording';
        micBtn.setAttribute('aria-label', 'Stop recording');
        showRecordingIndicator();
      })
      .catch(function () {
        addBubble(
          '\u26A0\uFE0F Microphone access denied. Please allow microphone permissions.',
          'sys',
        );
      });
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  }

  micBtn.addEventListener('click', function () {
    if (micBtn.classList.contains('recording')) {
      stopRecording();
    } else {
      startRecording();
    }
  });
})();

// --- Tab Title Unread Count ---

let unreadCount = 0;
const baseTitle = 'OpenBridge';

function updateTabTitle() {
  document.title = unreadCount > 0 ? '(' + unreadCount + ') ' + baseTitle : baseTitle;
}

function incrementUnread() {
  if (document.visibilityState === 'visible') return;
  unreadCount++;
  updateTabTitle();
}

function resetUnread() {
  unreadCount = 0;
  updateTabTitle();
}

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') {
    resetUnread();
  }
});

// --- Browser Notifications ---

function showTaskNotification(content) {
  if (document.visibilityState === 'visible') return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  var preview = content.length > 100 ? content.slice(0, 97) + '...' : content;
  new Notification('OpenBridge', {
    body: preview,
    icon: '/icons/icon-192.png',
  });
}

(function initNotifications() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    // Delay the permission request so it doesn't interrupt the initial page load
    setTimeout(function () {
      Notification.requestPermission();
    }, 3000);
  }
})();

// --- Sound Notifications ---

let soundMuted = localStorage.getItem('ob-sound') === 'false';
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playNotificationSound() {
  if (soundMuted) return;
  if (!window.AudioContext && !window.webkitAudioContext) return;
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15);
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.25);
  } catch (_) {
    // Web Audio API unavailable or blocked — non-critical
  }
}

function applySoundToggle() {
  const btn = document.getElementById('sound-toggle');
  if (!btn) return;
  btn.textContent = soundMuted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
  btn.setAttribute('aria-label', soundMuted ? 'Unmute notifications' : 'Mute notifications');
  btn.setAttribute('aria-pressed', soundMuted ? 'true' : 'false');
}

(function initSoundToggle() {
  applySoundToggle();
  const btn = document.getElementById('sound-toggle');
  if (!btn) return;
  btn.addEventListener('click', function () {
    soundMuted = !soundMuted;
    localStorage.setItem('ob-sound', soundMuted ? 'false' : 'true');
    applySoundToggle();
    // Play a preview tone when unmuting so the user knows it works
    if (!soundMuted) playNotificationSound();
  });
})();

// --- Add to Home Screen Banner ---

(function initPwaBanner() {
  // Only show on mobile devices
  const isMobile =
    window.matchMedia('(max-width: 767px)').matches ||
    (('ontouchstart' in window || navigator.maxTouchPoints > 0) && screen.width <= 1024);
  if (!isMobile) return;

  // Already running as installed PWA (standalone mode)
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (isStandalone) return;

  // User already dismissed permanently
  if (localStorage.getItem('ob-pwa-dismissed') === '1') return;

  const banner = document.getElementById('pwa-banner');
  const installBtn = document.getElementById('pwa-install-btn');
  const dismissBtn = document.getElementById('pwa-dismiss-btn');
  const hint = document.getElementById('pwa-banner-hint');
  if (!banner || !installBtn || !dismissBtn) return;

  let deferredPrompt = null;

  // Detect iOS Safari (no beforeinstallprompt — must use manual instructions)
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isSafari = /safari/i.test(navigator.userAgent) && !/chrome|crios|fxios/i.test(navigator.userAgent);

  function showBanner() {
    banner.classList.remove('hidden');
  }

  function hideBanner() {
    banner.classList.add('hidden');
    localStorage.setItem('ob-pwa-dismissed', '1');
  }

  dismissBtn.addEventListener('click', hideBanner);

  if (isIos && isSafari) {
    // iOS Safari: show manual share-sheet instructions
    if (hint) hint.textContent = 'Tap Share \u238e then \u201cAdd to Home Screen\u201d';
    installBtn.style.display = 'none';
    setTimeout(showBanner, 2000);
  } else {
    // Chrome / Android: use the native beforeinstallprompt event
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      setTimeout(showBanner, 2000);
    });

    installBtn.addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choiceResult) {
        if (choiceResult.outcome === 'accepted') {
          localStorage.setItem('ob-pwa-dismissed', '1');
        }
        deferredPrompt = null;
        banner.classList.add('hidden');
      });
    });

    // If app is installed later (appinstalled event), hide and dismiss
    window.addEventListener('appinstalled', function () {
      banner.classList.add('hidden');
      localStorage.setItem('ob-pwa-dismissed', '1');
      deferredPrompt = null;
    });
  }
})();

// --- Service Worker Registration ---

(function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(function (err) {
    // Registration failed — non-critical, app functions without it
    if (typeof console !== 'undefined') console.warn('SW registration failed:', err);
  });
})();

// --- Session transcript loader ---

/**
 * Fetch a past session from /api/sessions/{id} and render it in the message area.
 * Clears existing messages before rendering.
 * @param {string} sessionId
 */
async function loadSessionTranscript(sessionId) {
  clearConversation();
  _convPersistEnabled = false;
  msgs.replaceChildren();
  addBubble('Loading conversation\u2026', 'sys');
  try {
    const res = await fetch('/api/sessions/' + encodeURIComponent(sessionId));
    if (!res.ok) {
      msgs.replaceChildren();
      addBubble('Failed to load conversation.', 'sys');
      return;
    }
    const data = await res.json();
    const messages = data.messages;
    msgs.replaceChildren();
    if (!Array.isArray(messages) || messages.length === 0) {
      addBubble('No messages in this conversation.', 'sys');
      return;
    }
    for (const msg of messages) {
      const cls = msg.role === 'user' ? 'user' : msg.role === 'system' ? 'sys' : 'ai';
      const ts = msg.created_at ? new Date(msg.created_at) : new Date();
      addBubble(msg.content, cls, ts);
    }
  } catch (_) {
    msgs.replaceChildren();
    addBubble('Failed to load conversation.', 'sys');
  } finally {
    _convPersistEnabled = true;
  }
}

// --- New conversation ---

/**
 * Start a fresh conversation: clear the message area, notify the backend,
 * and reload the session list so the new session appears in the sidebar.
 */
function startNewConversation() {
  clearConversation();
  msgs.replaceChildren();
  addBubble('New conversation started.', 'sys');
  sendMessage({ type: 'new-session' });
  void loadSessions();
}

// --- Boot ---

initAutocomplete(inp);
restoreConversation();
initSidebar();
setOnSessionSelect(loadSessionTranscript);
setOnNewConversation(startNewConversation);
void loadSessions();
initDashboard();
initDeepMode(msgs);
initSettings();
setOnThemeChange(function (theme) {
  // Keep header theme-toggle button label in sync when theme changes via settings
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? 'Light' : 'Dark';
});
setOnSoundChange(function (enabled) {
  // Apply immediately: update soundMuted and sync header button
  soundMuted = !enabled;
  applySoundToggle();
  // Play preview tone when unmuting so the user knows it works
  if (!soundMuted) playNotificationSound();
});
initWebSocket({
  onOpen: function () {
    setOnline(true);
    addBubble('Connected to OpenBridge', 'sys');
  },
  onClose: function () {
    setOnline(false, true);
    hideStatus();
    addBubble('Disconnected \u2014 reconnecting...', 'sys');
  },
  onMessage: handleMessage,
});
