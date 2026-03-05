/**
 * WebSocket connection module.
 * Handles connection lifecycle, auto-reconnection, and message sending.
 */

/** @type {WebSocket|null} */
let ws = null;

/**
 * Initialize the WebSocket connection with auto-reconnect.
 *
 * @param {{ onOpen: Function, onClose: Function, onMessage: Function }} handlers
 */
export function initWebSocket(handlers) {
  function connect() {
    // Pass auth token from page URL to WebSocket upgrade request
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsUrl = proto + '//' + location.host;
    var params = new URLSearchParams(location.search);
    var token = params.get('token');
    if (token) wsUrl += '?token=' + encodeURIComponent(token);
    ws = new WebSocket(wsUrl);

    ws.onopen = function () {
      handlers.onOpen();
    };

    ws.onclose = function () {
      ws = null;
      handlers.onClose();
      setTimeout(connect, 2000);
    };

    ws.onmessage = function (e) {
      try {
        const data = JSON.parse(e.data);
        handlers.onMessage(data);
      } catch (_) {
        // ignore malformed messages
      }
    };

    ws.onerror = function () {
      // onclose will fire next and trigger reconnect
    };
  }

  connect();
}

/**
 * Send a JSON message over the WebSocket.
 * No-ops if the connection is not open.
 *
 * @param {Object} data
 */
export function sendMessage(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * Returns true if the WebSocket is currently open.
 *
 * @returns {boolean}
 */
export function isConnected() {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}
