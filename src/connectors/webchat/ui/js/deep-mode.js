/**
 * OpenBridge WebChat — Deep Mode stepper UI.
 * Shows a horizontal progress bar with 5 phase dots when Deep Mode is active.
 * Phases: Investigate, Report, Plan, Execute, Verify.
 * Active phase is highlighted; completed phases show a checkmark.
 * Hidden when Deep Mode is inactive.
 *
 * Also renders phase action buttons:
 *   - Proceed (green) — sends /proceed via WebSocket
 *   - Focus on # dropdown — sends /focus N via WebSocket (enabled after investigate/report)
 *   - Skip # dropdown    — sends /skip N  via WebSocket (enabled after plan)
 * All buttons are disabled while a phase is running or no session is active.
 *
 * Phase transition cards are rendered into the msgs container to show
 * phase progress inline in the conversation flow.
 */

import { sendMessage } from './websocket.js';

const PHASES = ['investigate', 'report', 'plan', 'execute', 'verify'];

const PHASE_LABELS = {
  investigate: 'Investigate',
  report: 'Report',
  plan: 'Plan',
  execute: 'Execute',
  verify: 'Verify',
};

const PHASE_ICONS = {
  investigate: '🔍',
  report: '📋',
  plan: '📝',
  execute: '⚙️',
  verify: '✅',
};

const PHASE_COLORS = {
  investigate: 'blue',
  report: 'purple',
  plan: 'orange',
  execute: 'green',
  verify: 'teal',
};

/** Phases where /focus N is applicable */
const FOCUS_PHASES = new Set(['investigate', 'report']);

/** Phases where /skip N is applicable */
const SKIP_PHASES = new Set(['plan']);

let _bar = null;

/** @type {HTMLElement|null} The msgs container for rendering phase cards */
let _msgsContainer = null;

/** @type {Map<string, HTMLElement>} "sessionId:phase" -> card DOM element */
const _phaseCards = new Map();

/** @type {Map<string, Set<string>>} sessionId -> Set of completed phase names */
const _completedPhases = new Map();

/** @type {Map<string, string>} sessionId -> current phase name */
const _currentPhases = new Map();

/** @type {string|null} */
let _activeSession = null;

/** Whether the current phase is still running (started but not yet completed/skipped) */
let _phaseRunning = false;

/** The last phase that completed — used to determine which action buttons to enable */
let _lastCompletedPhase = null;

// ── Reconnection state persistence ───────────────────────────────────────────

/** sessionStorage key for persisting received deep-phase events across reconnects */
const SESSION_KEY = 'ob-deep-mode-events';

/**
 * Flat log of all deep-phase events received (deduplicated per sessionId+phase,
 * keeping the latest status). Persisted to sessionStorage for reconnect recovery.
 * @type {Array<{sessionId: string, phase: string, status: string, result?: string}>}
 */
let _eventLog = [];

/**
 * True while replaying a stored event log — suppresses card rendering and
 * prevents recursive sessionStorage writes.
 */
let _restoringState = false;

function _persistEventLog() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(_eventLog));
  } catch (_) {
    // sessionStorage unavailable or full — non-critical
  }
}

function _loadEventLog() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function _resetInMemoryState() {
  _completedPhases.clear();
  _currentPhases.clear();
  _phaseCards.clear();
  _activeSession = null;
  _phaseRunning = false;
  _lastCompletedPhase = null;
}

// Action button DOM references
let _proceedBtn = null;
let _focusSelect = null;
let _focusBtn = null;
let _skipSelect = null;
let _skipBtn = null;

function getBar() {
  if (!_bar) _bar = document.getElementById('deep-mode-bar');
  return _bar;
}

function render() {
  const bar = getBar();
  if (!bar) return;
  if (!_activeSession) {
    bar.classList.add('hidden');
    return;
  }
  const completed = _completedPhases.get(_activeSession) || new Set();
  const current = _currentPhases.get(_activeSession) || null;
  bar.classList.remove('hidden');
  const dots = bar.querySelectorAll('.dm-phase-dot');
  dots.forEach(function (dot) {
    const phase = dot.dataset.phase;
    dot.classList.remove('dm-phase-current', 'dm-phase-done', 'dm-phase-pending');
    const icon = dot.querySelector('.dm-phase-icon');
    if (completed.has(phase)) {
      dot.classList.add('dm-phase-done');
      if (icon) icon.textContent = '\u2713';
      dot.setAttribute('aria-label', (PHASE_LABELS[phase] || phase) + ' \u2014 completed');
    } else if (phase === current) {
      dot.classList.add('dm-phase-current');
      if (icon) icon.textContent = '\u25CF';
      dot.setAttribute('aria-label', (PHASE_LABELS[phase] || phase) + ' \u2014 in progress');
    } else {
      dot.classList.add('dm-phase-pending');
      if (icon) icon.textContent = '\u25CB';
      dot.setAttribute('aria-label', (PHASE_LABELS[phase] || phase) + ' \u2014 pending');
    }
  });
}

/** Enable/disable action buttons based on current Deep Mode state */
function updateActionButtons() {
  if (!_proceedBtn) return;
  const active = !!_activeSession;
  const canAct = active && !_phaseRunning;

  _proceedBtn.disabled = !canAct;

  const canFocus = canAct && FOCUS_PHASES.has(_lastCompletedPhase);
  _focusBtn.disabled = !canFocus;
  _focusSelect.disabled = !canFocus;

  const canSkip = canAct && SKIP_PHASES.has(_lastCompletedPhase);
  _skipBtn.disabled = !canSkip;
  _skipSelect.disabled = !canSkip;
}

/** Build a numeric <select> (1–10) for item picking */
function buildNumSelect(ariaLabel) {
  const sel = document.createElement('select');
  sel.className = 'dm-num-select';
  sel.setAttribute('aria-label', ariaLabel);
  for (let i = 1; i <= 10; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = String(i);
    sel.appendChild(opt);
  }
  return sel;
}

/**
 * Build a phase transition card element.
 * @param {string} phase
 * @param {'started'|'completed'|'skipped'|'aborted'} status
 * @param {string} [result]
 * @returns {HTMLElement}
 */
function buildPhaseCard(phase, status, result) {
  const color = PHASE_COLORS[phase] || 'blue';
  const icon = PHASE_ICONS[phase] || '◉';
  const label = PHASE_LABELS[phase] || phase;

  const card = document.createElement('div');
  card.className = 'dm-phase-card dm-phase-card--' + color + ' dm-phase-card--' + status;
  card.dataset.phase = phase;
  card.dataset.status = status;

  const header = document.createElement('div');
  header.className = 'dm-card-header';

  const iconEl = document.createElement('span');
  iconEl.className = 'dm-card-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;

  const nameEl = document.createElement('span');
  nameEl.className = 'dm-card-name';
  nameEl.textContent = label;

  const statusEl = document.createElement('span');
  statusEl.className = 'dm-card-status';
  if (status === 'started') {
    statusEl.textContent = 'In progress…';
    const spinner = document.createElement('span');
    spinner.className = 'dm-card-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    header.appendChild(iconEl);
    header.appendChild(nameEl);
    header.appendChild(statusEl);
    header.appendChild(spinner);
  } else if (status === 'completed') {
    statusEl.textContent = 'Completed';
    header.appendChild(iconEl);
    header.appendChild(nameEl);
    header.appendChild(statusEl);
  } else if (status === 'skipped') {
    statusEl.textContent = 'Skipped';
    header.appendChild(iconEl);
    header.appendChild(nameEl);
    header.appendChild(statusEl);
  } else {
    statusEl.textContent = 'Aborted';
    header.appendChild(iconEl);
    header.appendChild(nameEl);
    header.appendChild(statusEl);
  }

  card.appendChild(header);

  if (result && (status === 'completed' || status === 'skipped')) {
    const body = document.createElement('div');
    body.className = 'dm-card-body';

    const summary = document.createElement('div');
    summary.className = 'dm-card-summary';
    summary.textContent = result;
    body.appendChild(summary);

    // Collapsible toggle if result is long
    if (result.length > 200) {
      summary.classList.add('dm-card-summary--collapsed');
      const toggle = document.createElement('button');
      toggle.className = 'dm-card-toggle';
      toggle.textContent = 'Show more';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', function () {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        if (expanded) {
          summary.classList.add('dm-card-summary--collapsed');
          toggle.textContent = 'Show more';
          toggle.setAttribute('aria-expanded', 'false');
        } else {
          summary.classList.remove('dm-card-summary--collapsed');
          toggle.textContent = 'Show less';
          toggle.setAttribute('aria-expanded', 'true');
        }
      });
      body.appendChild(toggle);
    }

    card.appendChild(body);
  }

  return card;
}

/**
 * Render or update a phase card in the msgs container.
 * @param {string} sessionId
 * @param {string} phase
 * @param {'started'|'completed'|'skipped'|'aborted'} status
 * @param {string} [result]
 */
function renderPhaseCard(sessionId, phase, status, result) {
  if (!_msgsContainer) return;

  const key = sessionId + ':' + phase;

  if (status === 'started') {
    // Create new card
    const card = buildPhaseCard(phase, status, result);
    // Trigger enter animation on next frame
    requestAnimationFrame(function () {
      card.classList.add('dm-phase-card--enter');
    });
    _phaseCards.set(key, card);
    _msgsContainer.appendChild(card);
    _msgsContainer.scrollTop = _msgsContainer.scrollHeight;
  } else {
    // Update existing card if present
    const existing = _phaseCards.get(key);
    if (existing) {
      const updated = buildPhaseCard(phase, status, result);
      existing.replaceWith(updated);
      requestAnimationFrame(function () {
        updated.classList.add('dm-phase-card--enter');
      });
      _phaseCards.set(key, updated);
      _msgsContainer.scrollTop = _msgsContainer.scrollHeight;
    } else {
      // No existing card — create one directly with final status
      const card = buildPhaseCard(phase, status, result);
      requestAnimationFrame(function () {
        card.classList.add('dm-phase-card--enter');
      });
      _phaseCards.set(key, card);
      _msgsContainer.appendChild(card);
      _msgsContainer.scrollTop = _msgsContainer.scrollHeight;
    }
    // Clean up card reference after aborted/completed to avoid memory leak on very long sessions
    if (status === 'aborted') {
      _phaseCards.delete(key);
    }
  }
}

/**
 * Initialize the Deep Mode stepper bar. Must be called after DOM is ready.
 * @param {HTMLElement} [msgsContainer] - The msgs container for phase card rendering
 */
export function initDeepMode(msgsContainer) {
  if (msgsContainer) _msgsContainer = msgsContainer;
  const bar = document.getElementById('deep-mode-bar');
  if (!bar) return;
  _bar = bar;

  const track = bar.querySelector('.dm-track');
  if (!track) return;

  // Build phase dots dynamically so the JS is the single source of truth
  track.replaceChildren();
  for (let i = 0; i < PHASES.length; i++) {
    const phase = PHASES[i];

    const item = document.createElement('div');
    item.className = 'dm-phase-item';

    const dot = document.createElement('div');
    dot.className = 'dm-phase-dot dm-phase-pending';
    dot.dataset.phase = phase;
    dot.setAttribute('aria-label', (PHASE_LABELS[phase] || phase) + ' \u2014 pending');

    const icon = document.createElement('span');
    icon.className = 'dm-phase-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '\u25CB';

    const label = document.createElement('span');
    label.className = 'dm-phase-label';
    label.textContent = PHASE_LABELS[phase] || phase;

    dot.appendChild(icon);
    item.appendChild(dot);
    item.appendChild(label);
    track.appendChild(item);

    // Add connector line between phases (not after the last one)
    if (i < PHASES.length - 1) {
      const connector = document.createElement('div');
      connector.className = 'dm-connector';
      connector.setAttribute('aria-hidden', 'true');
      track.appendChild(connector);
    }
  }

  // ── Action buttons ──────────────────────────────────────────────

  const actions = document.createElement('div');
  actions.className = 'dm-actions';

  // Proceed button
  _proceedBtn = document.createElement('button');
  _proceedBtn.className = 'dm-proceed-btn';
  _proceedBtn.textContent = 'Proceed';
  _proceedBtn.setAttribute('aria-label', 'Proceed to next Deep Mode phase');
  _proceedBtn.disabled = true;
  _proceedBtn.addEventListener('click', function () {
    sendMessage({ type: 'message', content: '/proceed' });
  });
  actions.appendChild(_proceedBtn);

  // Focus on # group
  const focusGroup = document.createElement('div');
  focusGroup.className = 'dm-action-group';

  _focusSelect = buildNumSelect('Finding number to focus on');
  _focusSelect.disabled = true;

  _focusBtn = document.createElement('button');
  _focusBtn.className = 'dm-action-btn';
  _focusBtn.textContent = 'Focus on #';
  _focusBtn.setAttribute('aria-label', 'Focus investigation on a specific finding');
  _focusBtn.disabled = true;
  _focusBtn.addEventListener('click', function () {
    sendMessage({ type: 'message', content: '/focus ' + _focusSelect.value });
  });

  focusGroup.appendChild(_focusSelect);
  focusGroup.appendChild(_focusBtn);
  actions.appendChild(focusGroup);

  // Skip # group
  const skipGroup = document.createElement('div');
  skipGroup.className = 'dm-action-group';

  _skipSelect = buildNumSelect('Task number to skip');
  _skipSelect.disabled = true;

  _skipBtn = document.createElement('button');
  _skipBtn.className = 'dm-action-btn';
  _skipBtn.textContent = 'Skip #';
  _skipBtn.setAttribute('aria-label', 'Skip a specific task in the plan');
  _skipBtn.disabled = true;
  _skipBtn.addEventListener('click', function () {
    sendMessage({ type: 'message', content: '/skip ' + _skipSelect.value });
  });

  skipGroup.appendChild(_skipSelect);
  skipGroup.appendChild(_skipBtn);
  actions.appendChild(skipGroup);

  bar.appendChild(actions);
}

/**
 * Handle a deep-phase progress event from the WebSocket.
 * @param {{ sessionId: string, phase: string, status: 'started'|'completed'|'skipped'|'aborted', result?: string }} event
 * @param {boolean} [skipCardRender=false] - When true, only updates state machine (used during restore)
 */
export function handleDeepPhaseEvent(event, skipCardRender) {
  const { sessionId, phase, status, result } = event;

  // Render phase card in conversation flow (skipped during state restore)
  if (!skipCardRender) {
    renderPhaseCard(sessionId, phase, status, result);
  }

  if (status === 'started') {
    _activeSession = sessionId;
    _phaseRunning = true;
    if (!_completedPhases.has(sessionId)) _completedPhases.set(sessionId, new Set());
    _currentPhases.set(sessionId, phase);
    render();
    updateActionButtons();
  } else if (status === 'completed' || status === 'skipped') {
    _activeSession = sessionId;
    _phaseRunning = false;
    _lastCompletedPhase = phase;
    if (!_completedPhases.has(sessionId)) _completedPhases.set(sessionId, new Set());
    _completedPhases.get(sessionId).add(phase);
    if (_currentPhases.get(sessionId) === phase) _currentPhases.delete(sessionId);
    render();
    updateActionButtons();
    // After the final phase, hide the bar after a short delay
    if (phase === 'verify') {
      setTimeout(function () {
        _completedPhases.delete(sessionId);
        _currentPhases.delete(sessionId);
        if (_activeSession === sessionId) _activeSession = null;
        _lastCompletedPhase = null;
        _phaseRunning = false;
        render();
        updateActionButtons();
      }, 3000);
    }
  } else if (status === 'aborted') {
    _completedPhases.delete(sessionId);
    _currentPhases.delete(sessionId);
    if (_activeSession === sessionId) _activeSession = null;
    _lastCompletedPhase = null;
    _phaseRunning = false;
    render();
    updateActionButtons();
  }

  // Persist event log to sessionStorage for reconnect recovery (not during restore)
  if (!_restoringState) {
    const idx = _eventLog.findIndex(function (e) {
      return e.sessionId === sessionId && e.phase === phase;
    });
    if (idx >= 0) {
      _eventLog[idx] = event;
    } else {
      _eventLog.push(event);
    }
    // Remove session from log once it has fully ended
    if (status === 'aborted') {
      _eventLog = _eventLog.filter(function (e) {
        return e.sessionId !== sessionId;
      });
    } else if (phase === 'verify' && (status === 'completed' || status === 'skipped')) {
      // Delay removal so a just-reconnected client can still receive the completed state
      setTimeout(function () {
        _eventLog = _eventLog.filter(function (e) {
          return e.sessionId !== sessionId;
        });
        _persistEventLog();
      }, 5000);
    }
    _persistEventLog();
  }
}

/**
 * Restore Deep Mode stepper state from sessionStorage.
 * Call this on page load (after initDeepMode) and on every WebSocket reconnect.
 * Only restores the stepper and action buttons — phase cards are NOT re-rendered
 * (they are part of the conversation transcript, not the stepper).
 */
export function restoreDeepModeState() {
  const events = _loadEventLog();
  if (events.length === 0) return;
  _resetInMemoryState();
  _restoringState = true;
  for (var i = 0; i < events.length; i++) {
    handleDeepPhaseEvent(events[i], true);
  }
  _restoringState = false;
  render();
  updateActionButtons();
}

/**
 * Apply a canonical list of deep-phase events sent by the server on reconnect.
 * Replaces the local event log with the server's authoritative snapshot and
 * re-renders the stepper.
 * @param {Array<{sessionId: string, phase: string, status: string, result?: string}>} events
 */
export function handleDeepModeStateSnapshot(events) {
  if (!Array.isArray(events)) return;
  // Replace local log with server's authoritative snapshot
  _eventLog = events;
  _persistEventLog();
  _resetInMemoryState();
  if (events.length === 0) {
    // No active session — just clear and hide stepper
    render();
    updateActionButtons();
    return;
  }
  _restoringState = true;
  for (var i = 0; i < events.length; i++) {
    handleDeepPhaseEvent(events[i], true);
  }
  _restoringState = false;
  render();
  updateActionButtons();
}
