/**
 * OpenBridge WebChat — Deep Mode stepper UI.
 * Shows a horizontal progress bar with 5 phase dots when Deep Mode is active.
 * Phases: Investigate, Report, Plan, Execute, Verify.
 * Active phase is highlighted; completed phases show a checkmark.
 * Hidden when Deep Mode is inactive.
 */

const PHASES = ['investigate', 'report', 'plan', 'execute', 'verify'];

const PHASE_LABELS = {
  investigate: 'Investigate',
  report: 'Report',
  plan: 'Plan',
  execute: 'Execute',
  verify: 'Verify',
};

let _bar = null;

/** @type {Map<string, Set<string>>} sessionId -> Set of completed phase names */
const _completedPhases = new Map();

/** @type {Map<string, string>} sessionId -> current phase name */
const _currentPhases = new Map();

/** @type {string|null} */
let _activeSession = null;

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
}

/**
 * Handle a deep-phase progress event from the WebSocket.
 * @param {{ sessionId: string, phase: string, status: 'started'|'completed'|'skipped'|'aborted' }} event
 */
export function handleDeepPhaseEvent(event) {
  const { sessionId, phase, status } = event;

  if (status === 'started') {
    _activeSession = sessionId;
    if (!_completedPhases.has(sessionId)) _completedPhases.set(sessionId, new Set());
    _currentPhases.set(sessionId, phase);
    render();
  } else if (status === 'completed' || status === 'skipped') {
    _activeSession = sessionId;
    if (!_completedPhases.has(sessionId)) _completedPhases.set(sessionId, new Set());
    _completedPhases.get(sessionId).add(phase);
    if (_currentPhases.get(sessionId) === phase) _currentPhases.delete(sessionId);
    render();
    // After the final phase, hide the bar after a short delay
    if (phase === 'verify') {
      setTimeout(function () {
        _completedPhases.delete(sessionId);
        _currentPhases.delete(sessionId);
        if (_activeSession === sessionId) _activeSession = null;
        render();
      }, 3000);
    }
  } else if (status === 'aborted') {
    _completedPhases.delete(sessionId);
    _currentPhases.delete(sessionId);
    if (_activeSession === sessionId) _activeSession = null;
    render();
  }
}
