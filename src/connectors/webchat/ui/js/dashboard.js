/**
 * Agent dashboard module.
 * Renders live Master + worker status and provides stop controls.
 */

import { sendMessage } from './websocket.js';

let dashOpen = true;

/**
 * Initialize the dashboard collapse toggle and stop-all button.
 * Must be called after the DOM is ready.
 */
export function initDashboard() {
  const hdr = document.getElementById('dash-hdr');
  const stopAllBtn = document.getElementById('stop-all-btn');

  hdr.addEventListener('click', function () {
    dashOpen = !dashOpen;
    document.getElementById('dash-body').style.display = dashOpen ? '' : 'none';
    document.getElementById('dash-icon').textContent = dashOpen ? '\u25B2' : '\u25BC';
    hdr.setAttribute('aria-expanded', String(dashOpen));
  });

  hdr.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      hdr.click();
    }
  });

  stopAllBtn.addEventListener('click', function () {
    sendMessage({ type: 'stop-all' });
  });
}

/**
 * Update the dashboard with the current list of agents.
 *
 * @param {Array} agents - array of ActivityRecord objects from the server
 */
export function updateDashboard(agents) {
  const dash = document.getElementById('dash');
  const stopAllBtn = document.getElementById('stop-all-btn');

  if (!agents || agents.length === 0) {
    dash.classList.add('hidden');
    stopAllBtn.disabled = true;
    return;
  }

  dash.classList.remove('hidden');

  let master = null;
  const workers = [];
  for (let i = 0; i < agents.length; i++) {
    if (agents[i].type === 'master') master = agents[i];
    else workers.push(agents[i]);
  }

  const masterDiv = document.getElementById('dash-master');
  masterDiv.innerHTML = master
    ? '<div style="padding:2px 0;color:var(--text-primary)"><strong>Master:</strong> ' +
      (master.model || 'unknown') +
      ' \u00a0|\u00a0 ' +
      master.status +
      '</div>'
    : '';

  const workersDiv = document.getElementById('dash-workers');
  if (workers.length === 0) {
    workersDiv.innerHTML = '';
    stopAllBtn.disabled = true;
  } else {
    stopAllBtn.disabled = false;
    let h = '<div style="font-weight:500;padding:2px 0">Workers (' + workers.length + '):</div>';
    for (let j = 0; j < workers.length; j++) {
      const w = workers[j];
      const pct = w.progress_pct || 0;
      const sc = 's-' + (w.status || 'running');
      const elapsed = w.started_at
        ? Math.floor((Date.now() - new Date(w.started_at).getTime()) / 1000) + 's'
        : '';
      const wid = String(w.id);
      h +=
        '<div class="agent-row">' +
        '<span style="font-family:monospace;color:var(--text-secondary);flex-shrink:0">' +
        wid.slice(0, 8) +
        '</span>' +
        '<span class="abadge ' +
        sc +
        '">' +
        (w.model || '\u2014') +
        '</span>' +
        '<span style="color:var(--text-muted);flex-shrink:0">' +
        (w.profile || '\u2014') +
        '</span>' +
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary)">' +
        (w.task_summary || '\u2014') +
        '</span>' +
        '<div class="prog-wrap"><div class="prog-bar" style="width:' +
        pct +
        '%"></div></div>' +
        '<span style="color:var(--text-muted);white-space:nowrap;flex-shrink:0">' +
        pct +
        '%</span>' +
        '<span style="color:var(--text-muted);white-space:nowrap;flex-shrink:0;min-width:32px;text-align:right">' +
        elapsed +
        '</span>' +
        '<button class="stop-btn" title="Stop this worker" aria-label="Stop worker ' +
        wid.slice(0, 8) +
        '" data-worker-id="' +
        wid +
        '">\u2715</button>' +
        '</div>';
    }
    workersDiv.innerHTML = h;

    // Wire stop buttons via event delegation (avoids inline onclick)
    workersDiv.querySelectorAll('[data-worker-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        sendMessage({ type: 'stop-worker', workerId: btn.dataset.workerId });
      });
    });
  }

  let totalCost = 0;
  for (let k = 0; k < agents.length; k++) {
    totalCost += agents[k].cost_usd || 0;
  }

  document.getElementById('dash-cost').innerHTML =
    '<div class="dash-cost">Cost: $' +
    totalCost.toFixed(4) +
    ' \u00a0|\u00a0 Active workers: ' +
    workers.length +
    '</div>';

  document.getElementById('dash-lbl').textContent = 'Agent Status (' + agents.length + ' active)';
}
