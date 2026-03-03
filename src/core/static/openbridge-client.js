/**
 * openbridge-client.js — Browser SDK for OpenBridge served apps.
 *
 * Auto-injected into apps served by the AppServer.
 * Provides bidirectional communication between the app and Master AI via the
 * InteractionRelay WebSocket server (default port 3099).
 *
 * Usage:
 *   openbridge.submit({ action: 'search', query: 'hello' });
 *   openbridge.onUpdate(function(data) { console.log('update:', data); });
 *   openbridge.request({ action: 'lookup', id: 42 }).then(function(result) {
 *     console.log('response:', result);
 *   });
 *
 * URL detection order:
 *   1. window.OPENBRIDGE_RELAY_URL  — explicit override
 *   2. <meta name="openbridge-relay" content="ws://...">  — meta tag
 *   3. ws://<current-host>:3099  — same host, relay port
 *   4. ws://localhost:3099  — local fallback
 */
(function (global) {
  'use strict';

  var RELAY_PORT = 3099;
  var RECONNECT_BASE_MS = 1000;
  var RECONNECT_MAX_MS = 30000;
  var RECONNECT_FACTOR = 2;
  var REQUEST_TIMEOUT_MS = 30000;

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Generate a UUID v4 without Node.js crypto (browser-compatible). */
  function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // ── URL detection ──────────────────────────────────────────────────────────

  function detectRelayUrl() {
    // 1. Explicit window variable override
    if (global.OPENBRIDGE_RELAY_URL) {
      return String(global.OPENBRIDGE_RELAY_URL);
    }

    // 2. Meta tag: <meta name="openbridge-relay" content="ws://...">
    if (typeof document !== 'undefined') {
      var meta = document.querySelector('meta[name="openbridge-relay"]');
      if (meta) {
        var content = meta.getAttribute('content');
        if (content) return content;
      }
    }

    // 3. Same host as the page, relay port
    if (typeof location !== 'undefined' && location.hostname) {
      return 'ws://' + location.hostname + ':' + RELAY_PORT;
    }

    // 4. Local fallback
    return 'ws://localhost:' + RELAY_PORT;
  }

  // ── Client class ───────────────────────────────────────────────────────────

  function OpenBridgeClient() {
    this._relayUrl = detectRelayUrl();
    this._handlers = [];
    this._pendingMessages = [];
    this._pendingRequests = {}; // { [requestId]: { resolve, reject, timer } }
    this._ws = null;
    this._reconnectDelay = RECONNECT_BASE_MS;
    this._stopped = false;
    this._connect();
  }

  OpenBridgeClient.prototype._connect = function () {
    if (this._stopped) return;
    var self = this;

    try {
      var ws = new WebSocket(self._relayUrl);
      self._ws = ws;

      ws.onopen = function () {
        self._reconnectDelay = RECONNECT_BASE_MS;
        // Flush messages that arrived before connection was ready
        while (self._pendingMessages.length > 0) {
          var pending = self._pendingMessages.shift();
          self._sendRaw(pending);
        }
      };

      ws.onmessage = function (event) {
        var message;
        try {
          message = JSON.parse(event.data);
        } catch (_e) {
          return;
        }

        // Resolve pending request() calls that match by requestId
        if (message && message.requestId && self._pendingRequests[message.requestId]) {
          var pending = self._pendingRequests[message.requestId];
          delete self._pendingRequests[message.requestId];
          clearTimeout(pending.timer);
          pending.resolve(message.data !== undefined ? message.data : message);
          // Fall through — also dispatch to onUpdate handlers
        }

        var payload = message && message.data !== undefined ? message.data : message;
        for (var i = 0; i < self._handlers.length; i++) {
          try {
            self._handlers[i](payload, message);
          } catch (handlerErr) {
            console.error('[openbridge] onUpdate handler threw', handlerErr);
          }
        }
      };

      ws.onclose = function () {
        self._ws = null;
        if (!self._stopped) {
          setTimeout(function () {
            self._reconnectDelay = Math.min(
              self._reconnectDelay * RECONNECT_FACTOR,
              RECONNECT_MAX_MS,
            );
            self._connect();
          }, self._reconnectDelay);
        }
      };

      ws.onerror = function (_err) {
        // onclose fires immediately after onerror — reconnect is handled there
        console.warn('[openbridge] WebSocket error — will reconnect');
      };
    } catch (e) {
      console.error('[openbridge] Failed to open WebSocket', e);
    }
  };

  OpenBridgeClient.prototype._sendRaw = function (payload) {
    if (this._ws && this._ws.readyState === 1 /* OPEN */) {
      this._ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  };

  /**
   * Send data to Master AI via the relay.
   * If the connection is not yet open the message is queued and sent on connect.
   *
   * @param {*} data - Any JSON-serialisable value.
   */
  OpenBridgeClient.prototype.submit = function (data) {
    var payload = {
      type: 'submit',
      data: data,
      timestamp: new Date().toISOString(),
    };
    if (!this._sendRaw(payload)) {
      this._pendingMessages.push(payload);
    }
  };

  /**
   * Register a callback invoked whenever Master AI sends an update.
   *
   * @param {function} callback - Called with (data, rawMessage).
   * @returns {function} Call the returned function to unsubscribe.
   */
  OpenBridgeClient.prototype.onUpdate = function (callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('[openbridge] onUpdate expects a function');
    }
    this._handlers.push(callback);
    var self = this;
    return function unsubscribe() {
      var idx = self._handlers.indexOf(callback);
      if (idx !== -1) self._handlers.splice(idx, 1);
    };
  };

  /**
   * Send a request to Master AI and wait for a matching response.
   * The relay matches responses by requestId. Rejects if no response arrives
   * within the timeout window.
   *
   * @param {*} data - Any JSON-serialisable value.
   * @param {number} [timeout] - Timeout in ms (default: 30000).
   * @returns {Promise<*>} Resolves with the response data from Master AI.
   */
  OpenBridgeClient.prototype.request = function (data, timeout) {
    var self = this;
    var requestId = generateId();
    var timeoutMs = typeof timeout === 'number' ? timeout : REQUEST_TIMEOUT_MS;

    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        if (self._pendingRequests[requestId]) {
          delete self._pendingRequests[requestId];
          reject(new Error('[openbridge] request timed out after ' + timeoutMs + 'ms'));
        }
      }, timeoutMs);

      self._pendingRequests[requestId] = { resolve: resolve, reject: reject, timer: timer };

      var payload = {
        type: 'request',
        requestId: requestId,
        data: data,
        timestamp: new Date().toISOString(),
      };

      if (!self._sendRaw(payload)) {
        self._pendingMessages.push(payload);
      }
    });
  };

  /**
   * Disconnect from the relay and stop all reconnect attempts.
   * Outstanding request() promises are rejected.
   */
  OpenBridgeClient.prototype.stop = function () {
    this._stopped = true;
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._handlers = [];
    this._pendingMessages = [];

    // Reject any in-flight request() calls
    var ids = Object.keys(this._pendingRequests);
    for (var i = 0; i < ids.length; i++) {
      var pending = this._pendingRequests[ids[i]];
      clearTimeout(pending.timer);
      pending.reject(new Error('[openbridge] connection stopped'));
    }
    this._pendingRequests = {};
  };

  // ── Expose global ──────────────────────────────────────────────────────────

  global.openbridge = new OpenBridgeClient();
})(typeof window !== 'undefined' ? window : this);
