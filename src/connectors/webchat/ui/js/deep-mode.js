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

/** Phases where /focus N is applicable */
const FOCUS_PHASES = new Set(['investigate', 'report']);

/** Phases where /skip N is applicable */
const SKIP_PHASES = new Set(['plan']);

let _bar = null;

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
 * Initialize the Deep Mode stepper bar. Must be called after DOM is ready.
 */
export function initDeepMode() {
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
 * @param {{ sessionId: string, phase: string, status: 'started'|'completed'|'skipped'|'aborted' }} event
 */
export function handleDeepPhaseEvent(event) {
  const { sessionId, phase, status } = event;

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
}
