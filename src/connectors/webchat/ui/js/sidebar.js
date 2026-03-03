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

  // Initial state: open on desktop unless user explicitly closed it
  if (isDesktop()) {
    const saved = localStorage.getItem('ob-sidebar-open');
    if (saved !== 'false') {
      openSidebar();
    }
  }
}
