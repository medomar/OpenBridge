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

/**
 * Register a callback invoked when the theme changes via settings.
 * @param {function(string): void} fn
 */
export function setOnThemeChange(fn) {
  _onThemeChange = fn;
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

function loadDiscoveredTools() {
  const select = document.getElementById('settings-tool-select');
  if (!select) return;
  fetch('/api/discovery')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !Array.isArray(data.tools)) return;
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
      // Discovery API unavailable — silently skip, keep placeholder
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
