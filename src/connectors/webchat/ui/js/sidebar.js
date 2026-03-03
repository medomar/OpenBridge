/**
 * OpenBridge WebChat — Sidebar component.
 * Slide-out panel (left). Hidden on mobile, toggleable via hamburger.
 * Desktop: optionally always visible (300px), persisted to localStorage.
 */

const BREAKPOINT_DESKTOP = 768;

let _open = false;
let _sidebar = null;
let _overlay = null;
let _toggle = null;
let _currentSessionId = null;
let _onSessionSelect = null;

/**
 * Register a callback invoked when the user clicks a session card.
 * @param {function(string): void} fn
 */
export function setOnSessionSelect(fn) {
  _onSessionSelect = fn;
}

function isDesktop() {
  return window.innerWidth >= BREAKPOINT_DESKTOP;
}

export function isSidebarOpen() {
  return _open;
}

function openSidebar() {
  _open = true;
  _sidebar.classList.add('open');
  if (!isDesktop()) {
    _overlay.classList.add('visible');
    _overlay.removeAttribute('aria-hidden');
  }
  _toggle.setAttribute('aria-expanded', 'true');
  _toggle.setAttribute('aria-label', 'Close sidebar');
  _sidebar.setAttribute('aria-hidden', 'false');
}

function closeSidebar() {
  _open = false;
  _sidebar.classList.remove('open');
  _overlay.classList.remove('visible');
  _overlay.setAttribute('aria-hidden', 'true');
  _toggle.setAttribute('aria-expanded', 'false');
  _toggle.setAttribute('aria-label', 'Open sidebar');
  _sidebar.setAttribute('aria-hidden', 'true');
}

export function toggleSidebar() {
  if (_open) {
    closeSidebar();
    if (isDesktop()) {
      localStorage.setItem('ob-sidebar-open', 'false');
    }
  } else {
    openSidebar();
    if (isDesktop()) {
      localStorage.setItem('ob-sidebar-open', 'true');
    }
  }
}

// ---------------------------------------------------------------------------
// Session list
// ---------------------------------------------------------------------------

/**
 * Format a timestamp string as a short relative date for sidebar cards.
 * @param {string} isoString
 * @returns {string}
 */
function formatSessionDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + 'd ago';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Build a session card element.
 * @param {{ session_id: string, title: string|null, last_message_at: string, message_count: number }} session
 * @param {boolean} isActive
 * @returns {HTMLElement}
 */
function buildSessionCard(session, isActive) {
  const item = document.createElement('div');
  item.className = 'sidebar-session-item' + (isActive ? ' active' : '');
  item.setAttribute('role', 'listitem');
  item.setAttribute('tabindex', '0');
  item.dataset.sessionId = session.session_id;

  const titleEl = document.createElement('div');
  titleEl.className = 'sidebar-session-title';
  titleEl.textContent = session.title || 'Conversation';

  const metaEl = document.createElement('div');
  metaEl.className = 'sidebar-session-meta';

  const dateSpan = document.createElement('span');
  dateSpan.textContent = formatSessionDate(session.last_message_at);

  const countSpan = document.createElement('span');
  const count = session.message_count || 0;
  countSpan.textContent = count + (count === 1 ? ' msg' : ' msgs');

  metaEl.appendChild(dateSpan);
  metaEl.appendChild(countSpan);

  item.appendChild(titleEl);
  item.appendChild(metaEl);

  return item;
}

/**
 * Fetch /api/sessions and render the list into #sidebar-sessions.
 * The most recent session (first in list) is highlighted as the current session.
 * Pass an explicit sessionId to override which item is highlighted.
 *
 * @param {string|null} [activeSessionId]
 */
export async function loadSessions(activeSessionId) {
  const container = document.getElementById('sidebar-sessions');
  if (!container) return;

  let sessions;
  try {
    const res = await fetch('/api/sessions?limit=50');
    if (!res.ok) return;
    sessions = await res.json();
  } catch (_) {
    return;
  }

  if (!Array.isArray(sessions) || sessions.length === 0) {
    container.innerHTML = '<div class="sidebar-empty">No conversations yet.</div>';
    return;
  }

  // Default: highlight the most recent session (first in list)
  const effectiveId = activeSessionId != null ? activeSessionId : sessions[0].session_id;
  _currentSessionId = effectiveId;

  const frag = document.createDocumentFragment();
  for (const session of sessions) {
    const card = buildSessionCard(session, session.session_id === effectiveId);
    frag.appendChild(card);
  }
  container.replaceChildren(frag);
}

// ---------------------------------------------------------------------------

export function initSidebar() {
  _sidebar = document.getElementById('sidebar');
  _overlay = document.getElementById('sidebar-overlay');
  _toggle = document.getElementById('sidebar-toggle');
  if (!_sidebar || !_overlay || !_toggle) return;

  _toggle.addEventListener('click', toggleSidebar);

  // Overlay click closes sidebar on mobile
  _overlay.addEventListener('click', function () {
    closeSidebar();
  });

  // Escape closes sidebar on mobile
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && _open && !isDesktop()) {
      closeSidebar();
    }
  });

  // On resize: update overlay visibility (no overlay on desktop)
  window.addEventListener('resize', function () {
    if (_open) {
      if (isDesktop()) {
        _overlay.classList.remove('visible');
        _overlay.setAttribute('aria-hidden', 'true');
      } else {
        _overlay.classList.add('visible');
        _overlay.removeAttribute('aria-hidden');
      }
    }
  });

  // Event delegation for session card clicks
  const sessionsContainer = document.getElementById('sidebar-sessions');
  if (sessionsContainer) {
    sessionsContainer.addEventListener('click', function (e) {
      const item = e.target.closest('.sidebar-session-item');
      if (!item) return;
      const sessionId = item.dataset.sessionId;
      if (!sessionId) return;
      // Update active highlight
      sessionsContainer.querySelectorAll('.sidebar-session-item').forEach(function (el) {
        el.classList.toggle('active', el === item);
      });
      _currentSessionId = sessionId;
      // Close sidebar on mobile after selection
      if (!isDesktop()) {
        closeSidebar();
      }
      if (_onSessionSelect) {
        _onSessionSelect(sessionId);
      }
    });

    // Keyboard: Enter or Space activates a focused card
    sessionsContainer.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const item = e.target.closest('.sidebar-session-item');
      if (!item) return;
      e.preventDefault();
      item.click();
    });
  }

  // Initial state: open on desktop unless user explicitly closed it
  if (isDesktop()) {
    const saved = localStorage.getItem('ob-sidebar-open');
    if (saved !== 'false') {
      openSidebar();
    }
  }
}
