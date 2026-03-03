/**
 * OpenBridge WebChat — Slash command autocomplete.
 * Shows a filtered dropdown when "/" is typed at the start of the input.
 * Arrow keys and Enter/Tab to navigate and select. Escape to close.
 *
 * Commands are fetched from GET /api/commands on first use and cached in
 * module-level state so all autocomplete instances share the same list.
 */

const FALLBACK_COMMANDS = [
  { name: '/history', description: 'Show conversation history' },
  { name: '/stop', description: 'Stop the current worker' },
  { name: '/status', description: 'Show agent status' },
  { name: '/deep', description: 'Enable deep mode for complex tasks' },
  { name: '/audit', description: 'Run a workspace audit' },
  { name: '/scope', description: 'Show or change task scope' },
  { name: '/apps', description: 'List connected apps' },
  { name: '/help', description: 'Show available commands' },
  { name: '/doctor', description: 'Run system health diagnostics' },
  { name: '/confirm', description: 'Confirm a pending action' },
  { name: '/skip', description: 'Skip a pending confirmation' },
];

/** Module-level command cache — populated by fetchCommands() */
let cachedCommands = null;
/** In-flight fetch promise — prevents duplicate requests */
let fetchPromise = null;

/**
 * Fetch the command list from /api/commands.
 * Returns the cached list on subsequent calls.
 * Falls back to FALLBACK_COMMANDS on network/parse errors.
 * @returns {Promise<Array<{name: string, description: string}>>}
 */
export async function fetchCommands() {
  if (cachedCommands !== null) return cachedCommands;
  if (fetchPromise !== null) return fetchPromise;

  fetchPromise = fetch('/api/commands')
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      if (Array.isArray(data) && data.length > 0) {
        cachedCommands = data;
      } else {
        cachedCommands = FALLBACK_COMMANDS;
      }
      fetchPromise = null;
      return cachedCommands;
    })
    .catch(function () {
      cachedCommands = FALLBACK_COMMANDS;
      fetchPromise = null;
      return cachedCommands;
    });

  return fetchPromise;
}

/**
 * Initialize slash command autocomplete for a textarea element.
 * Kicks off a background fetch of /api/commands immediately so the list
 * is ready before the user types.
 * @param {HTMLTextAreaElement} input
 */
export function initAutocomplete(input) {
  if (!input) return;

  const inpWrap = input.closest('.inp-wrap');
  if (!inpWrap) return;

  // Pre-fetch commands in the background so the list is warm before first use
  void fetchCommands();

  // Create dropdown element
  const dropdown = document.createElement('ul');
  dropdown.className = 'autocomplete-dropdown';
  dropdown.setAttribute('role', 'listbox');
  dropdown.setAttribute('aria-label', 'Command suggestions');
  dropdown.id = 'autocomplete-dropdown';
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'autocomplete-dropdown');
  inpWrap.appendChild(dropdown);

  let activeIndex = -1;
  let visible = false;
  let filteredCommands = [];

  function show(commands) {
    filteredCommands = commands;
    activeIndex = -1;
    visible = true;

    dropdown.replaceChildren();
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      const li = document.createElement('li');
      li.className = 'autocomplete-item';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.dataset.index = String(i);

      const name = document.createElement('span');
      name.className = 'autocomplete-cmd';
      name.textContent = cmd.name;

      const desc = document.createElement('span');
      desc.className = 'autocomplete-desc';
      desc.textContent = cmd.description;

      li.appendChild(name);
      li.appendChild(desc);

      // Use mousedown so it fires before the blur event on the input
      li.addEventListener('mousedown', function (e) {
        e.preventDefault();
        selectCommand(i);
      });

      dropdown.appendChild(li);
    }
    dropdown.classList.add('visible');
    input.setAttribute('aria-expanded', 'true');
  }

  function hide() {
    visible = false;
    activeIndex = -1;
    dropdown.classList.remove('visible');
    dropdown.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
  }

  function setActive(index) {
    const items = dropdown.querySelectorAll('.autocomplete-item');
    items.forEach(function (el, i) {
      if (i === index) {
        el.classList.add('active');
        el.setAttribute('aria-selected', 'true');
        el.scrollIntoView({ block: 'nearest' });
      } else {
        el.classList.remove('active');
        el.setAttribute('aria-selected', 'false');
      }
    });
    activeIndex = index;
  }

  function selectCommand(index) {
    const cmd = filteredCommands[index];
    if (!cmd) return;
    // Replace the current slash query with the command name + trailing space
    input.value = cmd.name + ' ';
    // Trigger input event so textarea resizes and char count updates
    input.dispatchEvent(new Event('input'));
    input.focus();
    hide();
  }

  /**
   * Returns the current slash query if the input starts with "/" and the
   * cursor hasn't moved past the first word yet (no space typed), otherwise null.
   */
  function getQuery() {
    const val = input.value;
    if (!val.startsWith('/')) return null;
    // Stop showing if the user has typed a space (command word is complete)
    if (val.includes(' ')) return null;
    return val;
  }

  input.addEventListener('input', function () {
    const query = getQuery();
    if (query === null) {
      hide();
      return;
    }
    const lower = query.toLowerCase();
    // Use cached commands if available, fall back to FALLBACK_COMMANDS synchronously
    const commands = cachedCommands !== null ? cachedCommands : FALLBACK_COMMANDS;
    const matches = commands.filter(function (cmd) {
      return cmd.name.startsWith(lower);
    });
    if (matches.length === 0) {
      hide();
    } else {
      show(matches);
    }
  });

  input.addEventListener('keydown', function (e) {
    if (!visible) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(activeIndex + 1, filteredCommands.length - 1);
      setActive(next);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(activeIndex - 1, 0);
      setActive(prev);
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0) {
        // Prevent form submission and select the highlighted item
        e.preventDefault();
        e.stopPropagation();
        selectCommand(activeIndex);
      }
    } else if (e.key === 'Tab') {
      if (filteredCommands.length > 0) {
        e.preventDefault();
        const idx = activeIndex >= 0 ? activeIndex : 0;
        selectCommand(idx);
      }
    } else if (e.key === 'Escape') {
      hide();
    }
  });

  // Hide on blur (delay allows mousedown on dropdown item to fire first)
  input.addEventListener('blur', function () {
    setTimeout(hide, 150);
  });
}
