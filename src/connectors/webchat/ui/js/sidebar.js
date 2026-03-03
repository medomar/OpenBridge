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
let _onNewConversation = null;

/**
 * Register a callback invoked when the user clicks a session card.
 * @param {function(string): void} fn
 */
export function setOnSessionSelect(fn) {
  _onSessionSelect = fn;
}

/**
 * Register a callback invoked when the user clicks "New conversation".
 * @param {function(): void} fn
 */
export function setOnNewConversation(fn) {
  _onNewConversation = fn;
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
// Search
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe insertion as HTML text content.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Extract a short snippet from `content` centred around the first query term.
 * @param {string} content
 * @param {string} query
 * @param {number} [maxLen=120]
 * @returns {string}
 */
function truncateSnippet(content, query, maxLen) {
  if (!content) return '';
  maxLen = maxLen || 120;
  const terms = query.trim().split(/\s+/).filter(Boolean);
  let pos = -1;
  for (let i = 0; i < terms.length; i++) {
    const idx = content.toLowerCase().indexOf(terms[i].toLowerCase());
    if (idx !== -1) { pos = idx; break; }
  }
  if (pos === -1) {
    return content.slice(0, maxLen) + (content.length > maxLen ? '\u2026' : '');
  }
  const start = Math.max(0, pos - 30);
  const end = Math.min(content.length, start + maxLen);
  const snippet = content.slice(start, end);
  return (start > 0 ? '\u2026' : '') + snippet + (end < content.length ? '\u2026' : '');
}

/**
 * HTML-escape `text` then wrap each query term occurrence in a `<mark>`.
 * @param {string} text
 * @param {string} query
 * @returns {string} HTML string safe for innerHTML
 */
function highlightTerms(text, query) {
  if (!text) return '';
  const escaped = escapeHtml(text);
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return escaped;
  const pattern = terms
    .map(function (t) { return escapeHtml(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); })
    .join('|');
  const re = new RegExp('(' + pattern + ')', 'gi');
  return escaped.replace(re, '<mark class="sidebar-match">$1</mark>');
}

/**
 * Build a search result card element.
 * @param {{ session_id: string, role: string, content: string, created_at: string }} result
 * @param {string} query
 * @returns {HTMLElement}
 */
function buildSearchResultCard(result, query) {
  const item = document.createElement('div');
  item.className = 'sidebar-session-item sidebar-search-result';
  item.setAttribute('role', 'listitem');
  item.setAttribute('tabindex', '0');
  item.dataset.sessionId = result.session_id;

  const snippet = truncateSnippet(result.content, query);
  const highlighted = highlightTerms(snippet, query);

  const snippetEl = document.createElement('div');
  snippetEl.className = 'sidebar-search-snippet';
  snippetEl.innerHTML = highlighted;

  const metaEl = document.createElement('div');
  metaEl.className = 'sidebar-session-meta';

  const roleSpan = document.createElement('span');
  roleSpan.textContent = result.role === 'user' ? 'You' : 'AI';

  const dateSpan = document.createElement('span');
  dateSpan.textContent = formatSessionDate(result.created_at);

  metaEl.appendChild(roleSpan);
  metaEl.appendChild(dateSpan);

  item.appendChild(snippetEl);
  item.appendChild(metaEl);

  return item;
}

/**
 * Fetch /api/sessions/search?q={query} and render matching messages.
 * @param {string} query
 */
async function runSearch(query) {
  const container = document.getElementById('sidebar-sessions');
  if (!container) return;

  container.innerHTML = '<div class="sidebar-empty">Searching\u2026</div>';

  let results;
  try {
    const res = await fetch('/api/sessions/search?q=' + encodeURIComponent(query) + '&limit=20');
    if (!res.ok) {
      container.innerHTML = '<div class="sidebar-empty">Search failed.</div>';
      return;
    }
    results = await res.json();
  } catch (_) {
    container.innerHTML = '<div class="sidebar-empty">Search failed.</div>';
    return;
  }

  if (!Array.isArray(results) || results.length === 0) {
    container.innerHTML = '<div class="sidebar-empty">No results for \u201c' + escapeHtml(query) + '\u201d.</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  for (const result of results) {
    frag.appendChild(buildSearchResultCard(result, query));
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

  // New conversation button
  const newConvBtn = document.getElementById('new-conversation-btn');
  if (newConvBtn) {
    newConvBtn.addEventListener('click', function () {
      if (_onNewConversation) {
        _onNewConversation();
      }
      if (!isDesktop()) {
        closeSidebar();
      }
    });
  }

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

  // Search input — debounced 300ms
  const searchInput = document.getElementById('sidebar-search-input');
  let _searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      clearTimeout(_searchTimer);
      const query = searchInput.value.trim();
      if (!query) {
        void loadSessions(_currentSessionId);
        return;
      }
      _searchTimer = setTimeout(function () {
        void runSearch(query);
      }, 300);
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
