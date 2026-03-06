/**
 * OpenBridge WebChat — Settings panel component.
 * Slide-out panel (right). Opened via gear icon in header.
 * Closes on outside click or Escape.
 * Contains: AI tool selector, execution profile, notifications, theme.
 */

let _panel = null;
let _overlay = null;
let _open = false;
let _onThemeChange = null;
let _onSoundChange = null;

/**
 * Register a callback invoked when the theme changes via settings.
 * @param {function(string): void} fn
 */
export function setOnThemeChange(fn) {
  _onThemeChange = fn;
}

/**
 * Register a callback invoked when the sound preference changes via settings.
 * @param {function(boolean): void} fn - called with true if sound is enabled, false if muted
 */
export function setOnSoundChange(fn) {
  _onSoundChange = fn;
}

function isOpen() {
  return _open;
}

function openSettings() {
  if (!_panel || !_overlay) return;
  _open = true;
  _panel.classList.add('open');
  _overlay.classList.add('visible');
  _panel.setAttribute('aria-hidden', 'false');
  // Sync theme select with current theme (may have changed via header toggle)
  const settingsThemeSelect = document.getElementById('settings-theme-select');
  if (settingsThemeSelect) {
    settingsThemeSelect.value = document.documentElement.getAttribute('data-theme') || 'light';
  }
  const closeBtn = _panel.querySelector('.settings-close-btn');
  if (closeBtn) closeBtn.focus();
}

function closeSettings() {
  if (!_panel || !_overlay) return;
  _open = false;
  _panel.classList.remove('open');
  _overlay.classList.remove('visible');
  _panel.setAttribute('aria-hidden', 'true');
  const gearBtn = document.getElementById('settings-btn');
  if (gearBtn) gearBtn.focus();
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('ob-theme', theme);
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) themeToggle.textContent = theme === 'dark' ? 'Light' : 'Dark';
  const settingsTheme = document.getElementById('settings-theme-select');
  if (settingsTheme) settingsTheme.value = theme;
  if (_onThemeChange) _onThemeChange(theme);
}

function loadDiscoveredTools(retryCount) {
  const select = document.getElementById('settings-tool-select');
  if (!select) return;
  const attempt = retryCount || 0;
  fetch('/api/discovery')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !Array.isArray(data.tools)) return;
      // If no tools yet and we haven't retried too many times, retry after a delay
      // (tools may not be wired yet during startup)
      if (data.tools.length === 0 && attempt < 3) {
        setTimeout(function () { loadDiscoveredTools(attempt + 1); }, 2000);
        return;
      }
      // Clear existing options except the first placeholder
      while (select.options.length > 1) {
        select.remove(1);
      }
      for (const tool of data.tools) {
        const opt = document.createElement('option');
        opt.value = tool.name || tool.id || '';
        opt.textContent = (tool.name || tool.id || 'Unknown') + (tool.version ? ' v' + tool.version : '');
        select.appendChild(opt);
      }
      // Restore saved preference
      const saved = localStorage.getItem('ob-preferred-tool');
      if (saved) select.value = saved;
    })
    .catch(function () {
      // Discovery API unavailable — retry after a delay if early in startup
      if (attempt < 3) {
        setTimeout(function () { loadDiscoveredTools(attempt + 1); }, 2000);
      }
    });
}

function initToolSelector() {
  const select = document.getElementById('settings-tool-select');
  if (!select) return;
  const saved = localStorage.getItem('ob-preferred-tool');
  if (saved) select.value = saved;
  select.addEventListener('change', function () {
    localStorage.setItem('ob-preferred-tool', select.value);
  });
}

function syncProfileToServer(profile) {
  fetch('/api/webchat/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile }),
  }).catch(function () {
    // Server sync failed — localStorage is the source of truth, ignore error
  });
}

function initExecutionProfile() {
  const radios = document.querySelectorAll('input[name="settings-profile"]');
  if (!radios.length) return;
  const saved = localStorage.getItem('ob-exec-profile') || 'thorough';
  for (const radio of radios) {
    if (radio.value === saved) {
      radio.checked = true;
      break;
    }
  }
  for (const radio of radios) {
    radio.addEventListener('change', function () {
      if (radio.checked) {
        localStorage.setItem('ob-exec-profile', radio.value);
        syncProfileToServer(radio.value);
      }
    });
  }
}

function initNotifications() {
  const soundCheck = document.getElementById('settings-sound-check');
  const browserCheck = document.getElementById('settings-browser-notify-check');
  if (soundCheck) {
    soundCheck.checked = localStorage.getItem('ob-sound') !== 'false';
    soundCheck.addEventListener('change', function () {
      const muted = !soundCheck.checked;
      localStorage.setItem('ob-sound', muted ? 'false' : 'true');
      // Sync header sound toggle button state
      const soundBtn = document.getElementById('sound-toggle');
      if (soundBtn) {
        soundBtn.textContent = muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
        soundBtn.setAttribute('aria-label', muted ? 'Unmute notifications' : 'Mute notifications');
        soundBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
      }
      // Notify app so soundMuted module variable is updated immediately
      if (_onSoundChange) _onSoundChange(!muted);
    });
  }
  if (browserCheck) {
    browserCheck.checked = Notification && Notification.permission === 'granted';
    browserCheck.addEventListener('change', function () {
      if (browserCheck.checked && 'Notification' in window) {
        Notification.requestPermission().then(function (perm) {
          browserCheck.checked = perm === 'granted';
        });
      }
    });
  }
}

function initThemeSelector() {
  const select = document.getElementById('settings-theme-select');
  if (!select) return;
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  select.value = current;
  select.addEventListener('change', function () {
    applyTheme(select.value);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Load and render the MCP server list from /api/mcp/servers.
 */
function loadMcpServers() {
  const list = document.getElementById('mcp-server-list');
  if (!list) return;
  fetch('/api/mcp/servers')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !Array.isArray(data.servers)) return;
      list.innerHTML = '';
      if (data.servers.length === 0) {
        list.innerHTML = '<p class="settings-hint">No MCP servers configured.</p>';
        return;
      }
      for (const server of data.servers) {
        const item = document.createElement('div');
        item.className = 'mcp-server-item';
        const statusClass = server.status === 'healthy' ? 'mcp-status-healthy'
          : server.status === 'error' ? 'mcp-status-error' : 'mcp-status-unknown';
        const toggleChecked = server.enabled ? 'checked' : '';
        item.innerHTML =
          '<div class="mcp-server-info">'
          + '<span class="mcp-status-dot ' + statusClass + '" aria-hidden="true"></span>'
          + '<span class="mcp-server-name">' + escapeHtml(server.name) + '</span>'
          + '</div>'
          + '<div class="mcp-server-actions">'
          + '<label class="mcp-toggle" aria-label="Enable ' + escapeHtml(server.name) + '">'
          + '<input type="checkbox" class="mcp-toggle-input" ' + toggleChecked + ' data-name="' + escapeHtml(server.name) + '" />'
          + '<span class="mcp-toggle-slider"></span>'
          + '</label>'
          + '<button class="mcp-remove-btn" data-name="' + escapeHtml(server.name) + '" aria-label="Remove ' + escapeHtml(server.name) + '">\u2715</button>'
          + '</div>';
        list.appendChild(item);
      }
      list.querySelectorAll('.mcp-toggle-input').forEach(function (input) {
        input.addEventListener('change', function () {
          const name = input.getAttribute('data-name');
          fetch('/api/mcp/servers/' + encodeURIComponent(name) + '/toggle', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: input.checked }),
          }).catch(function () {});
        });
      });
      list.querySelectorAll('.mcp-remove-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const name = btn.getAttribute('data-name');
          if (!confirm('Remove MCP server "' + name + '"?')) return;
          fetch('/api/mcp/servers/' + encodeURIComponent(name), { method: 'DELETE' })
            .then(function (r) { if (r.ok) loadMcpServers(); })
            .catch(function () {});
        });
      });
    })
    .catch(function () {});
}

function initMcpPanel() {
  const addBtn = document.getElementById('mcp-add-btn');
  const form = document.getElementById('mcp-add-form');
  const submitBtn = document.getElementById('mcp-add-submit');
  const cancelBtn = document.getElementById('mcp-add-cancel');
  if (!addBtn || !form) return;

  addBtn.addEventListener('click', function () {
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      form.style.display = 'none';
    });
  }
  if (submitBtn) {
    submitBtn.addEventListener('click', function () {
      const nameInput = document.getElementById('mcp-new-name');
      const cmdInput = document.getElementById('mcp-new-command');
      if (!nameInput || !cmdInput) return;
      const name = nameInput.value.trim();
      const command = cmdInput.value.trim();
      if (!name || !command) return;
      fetch('/api/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, command }),
      })
        .then(function (r) {
          if (r.ok) {
            form.style.display = 'none';
            nameInput.value = '';
            cmdInput.value = '';
            loadMcpServers();
          }
        })
        .catch(function () {});
    });
  }
}

/**
 * Initialize the settings panel. Must be called after DOM is ready.
 */
export function initSettings() {
  _panel = document.getElementById('settings-panel');
  _overlay = document.getElementById('settings-overlay');
  const gearBtn = document.getElementById('settings-btn');
  const closeBtn = _panel && _panel.querySelector('.settings-close-btn');

  if (!_panel || !_overlay || !gearBtn) return;

  // Gear button opens panel
  gearBtn.addEventListener('click', function () {
    if (isOpen()) {
      closeSettings();
    } else {
      loadDiscoveredTools();
      loadMcpServers();
      openSettings();
    }
  });

  // Close button
  if (closeBtn) {
    closeBtn.addEventListener('click', closeSettings);
  }

  // Overlay click closes panel
  _overlay.addEventListener('click', closeSettings);

  // Escape key closes panel
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) {
      closeSettings();
    }
  });

  // Init sub-components
  initToolSelector();
  initExecutionProfile();
  initNotifications();
  initThemeSelector();
  initMcpPanel();
}

/**
 * Returns the currently saved execution profile.
 * @returns {'fast'|'thorough'|'manual'}
 */
export function getExecutionProfile() {
  return localStorage.getItem('ob-exec-profile') || 'thorough';
}

/**
 * Returns the currently saved preferred AI tool name.
 * @returns {string|null}
 */
export function getPreferredTool() {
  return localStorage.getItem('ob-preferred-tool') || null;
}
