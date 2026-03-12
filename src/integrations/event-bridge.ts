import { EventEmitter } from 'node:events';
import { createLogger } from '../core/logger.js';
import type { WebhookRouter } from './webhook-router.js';

const logger = createLogger('event-bridge');

// ── Types ────────────────────────────────────────────────────────

/** Supported event source types */
export type EventSourceType = 'websocket' | 'sse' | 'polling' | 'webhook';

/** Configuration for an event source */
export interface EventSourceConfig {
  /** Unique identifier for this event source */
  id: string;
  /** Type of event source */
  type: EventSourceType;
  /** URL to connect to (WebSocket, SSE, or polling endpoint) */
  url: string;
  /** Event patterns to listen for (glob-style, e.g. "order.*") */
  events: string[];
  /** Authentication configuration */
  auth?: EventSourceAuth;
  /** Polling interval in milliseconds (only for 'polling' type, default 30000) */
  pollingInterval?: number;
  /** Integration name this source belongs to */
  integration: string;
}

/** Authentication for event sources */
export interface EventSourceAuth {
  type: 'bearer' | 'basic' | 'header' | 'query';
  /** Token value (for bearer), password (for basic), header/query value */
  value: string;
  /** Username (for basic auth) or header/query param name */
  key?: string;
}

/** A normalized event emitted by any source */
export interface BridgeEvent {
  /** Auto-generated event ID */
  id: string;
  /** Source ID that produced this event */
  sourceId: string;
  /** Integration name */
  integration: string;
  /** Event name/type */
  event: string;
  /** Event payload */
  payload: Record<string, unknown>;
  /** When the event was received (ISO 8601) */
  receivedAt: string;
}

/** Callback for event notifications */
export type EventNotificationHandler = (event: BridgeEvent) => void | Promise<void>;

/** Internal state for an active event source */
interface ActiveSource {
  config: EventSourceConfig;
  /** Cleanup function to stop this source */
  cleanup: () => void;
  /** Whether the source is currently connected/active */
  active: boolean;
}

// ── EventBridge ──────────────────────────────────────────────────

/**
 * Generic real-time event bridge.
 *
 * Supports multiple event source types:
 * 1. WebSocket — persistent connection, receives JSON messages
 * 2. Server-Sent Events (SSE) — HTTP streaming, receives named events
 * 3. Polling — periodic HTTP GET, diffs for new data
 * 4. Webhook — delegates to WebhookRouter (already exists)
 *
 * On event: match to event pattern, normalize payload, route to handlers.
 */
export class EventBridge extends EventEmitter {
  private readonly sources = new Map<string, ActiveSource>();
  private readonly handlers = new Map<string, EventNotificationHandler[]>();
  private readonly webhookRouter: WebhookRouter | null;
  private eventCounter = 0;

  constructor(webhookRouter?: WebhookRouter) {
    super();
    this.webhookRouter = webhookRouter ?? null;
  }

  /**
   * Register an event source. Starts listening immediately.
   */
  addSource(config: EventSourceConfig): void {
    if (this.sources.has(config.id)) {
      logger.warn(
        { sourceId: config.id },
        'Event source already registered — removing old one first',
      );
      this.removeSource(config.id);
    }

    logger.info(
      { sourceId: config.id, type: config.type, integration: config.integration },
      'Adding event source',
    );

    let cleanup: () => void;

    switch (config.type) {
      case 'websocket':
        cleanup = this.startWebSocket(config);
        break;
      case 'sse':
        cleanup = this.startSSE(config);
        break;
      case 'polling':
        cleanup = this.startPolling(config);
        break;
      case 'webhook':
        cleanup = this.startWebhook(config);
        break;
      default:
        throw new Error(`Unsupported event source type: ${config.type as string}`);
    }

    this.sources.set(config.id, { config, cleanup, active: true });
  }

  /**
   * Remove and stop an event source.
   */
  removeSource(id: string): void {
    const source = this.sources.get(id);
    if (!source) return;

    source.cleanup();
    source.active = false;
    this.sources.delete(id);
    logger.info({ sourceId: id }, 'Event source removed');
  }

  /**
   * Register a handler for events matching a pattern.
   * Pattern supports glob-style: "order.*" matches "order.created", "order.updated".
   * Use "*" to match all events.
   */
  onEvent(pattern: string, handler: EventNotificationHandler): void {
    const handlers = this.handlers.get(pattern) ?? [];
    handlers.push(handler);
    this.handlers.set(pattern, handlers);
    logger.debug({ pattern }, 'Event handler registered');
  }

  /**
   * Remove a handler for a specific pattern.
   */
  offEvent(pattern: string, handler: EventNotificationHandler): void {
    const handlers = this.handlers.get(pattern);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx !== -1) handlers.splice(idx, 1);
    if (handlers.length === 0) this.handlers.delete(pattern);
  }

  /**
   * List all registered event sources with their status.
   */
  listSources(): Array<{
    id: string;
    type: EventSourceType;
    integration: string;
    active: boolean;
  }> {
    return [...this.sources.values()].map((s) => ({
      id: s.config.id,
      type: s.config.type,
      integration: s.config.integration,
      active: s.active,
    }));
  }

  /**
   * Shut down all event sources.
   */
  shutdown(): void {
    logger.info({ count: this.sources.size }, 'Shutting down event bridge');
    for (const [id] of this.sources) {
      this.removeSource(id);
    }
  }

  // ── Internal: event dispatch ─────────────────────────────────

  private generateEventId(): string {
    return `evt_${Date.now()}_${++this.eventCounter}`;
  }

  /**
   * Dispatch a raw event through the bridge. Matches against registered
   * patterns and invokes handlers.
   */
  private async dispatchEvent(
    sourceId: string,
    integration: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const bridgeEvent: BridgeEvent = {
      id: this.generateEventId(),
      sourceId,
      integration,
      event,
      payload,
      receivedAt: new Date().toISOString(),
    };

    logger.debug({ eventId: bridgeEvent.id, integration, event }, 'Dispatching event');

    // Emit on the EventEmitter for generic listeners
    this.emit('event', bridgeEvent);

    // Match against registered patterns
    const matchedHandlers: EventNotificationHandler[] = [];
    for (const [pattern, handlers] of this.handlers) {
      if (
        this.matchPattern(pattern, event) ||
        this.matchPattern(pattern, `${integration}.${event}`)
      ) {
        matchedHandlers.push(...handlers);
      }
    }

    // Invoke all matched handlers
    for (const handler of matchedHandlers) {
      try {
        await handler(bridgeEvent);
      } catch (err) {
        logger.error({ eventId: bridgeEvent.id, err }, 'Event handler threw an error');
      }
    }
  }

  /**
   * Simple glob-style pattern matching.
   * Supports: "*" (match everything), "prefix.*" (match prefix), exact match.
   */
  private matchPattern(pattern: string, value: string): boolean {
    if (pattern === '*') return true;
    if (pattern === value) return true;
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      return value.startsWith(prefix + '.');
    }
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return value.startsWith(prefix);
    }
    return false;
  }

  // ── Internal: build auth headers ─────────────────────────────

  private buildAuthHeaders(auth?: EventSourceAuth): Record<string, string> {
    if (!auth) return {};
    switch (auth.type) {
      case 'bearer':
        return { Authorization: `Bearer ${auth.value}` };
      case 'basic': {
        const encoded = Buffer.from(`${auth.key ?? ''}:${auth.value}`).toString('base64');
        return { Authorization: `Basic ${encoded}` };
      }
      case 'header':
        return auth.key ? { [auth.key]: auth.value } : {};
      default:
        return {};
    }
  }

  private buildAuthUrl(url: string, auth?: EventSourceAuth): string {
    if (!auth || auth.type !== 'query' || !auth.key) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${encodeURIComponent(auth.key)}=${encodeURIComponent(auth.value)}`;
  }

  // ── Internal: WebSocket source ───────────────────────────────

  private startWebSocket(config: EventSourceConfig): () => void {
    let socket: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = (): void => {
      if (closed) return;

      try {
        const finalUrl = this.buildAuthUrl(config.url, config.auth);

        // Node 22+ has native WebSocket global
        const ws = new WebSocket(finalUrl);
        socket = ws;

        ws.onopen = (): void => {
          logger.info({ sourceId: config.id }, 'WebSocket connected');
          const source = this.sources.get(config.id);
          if (source) source.active = true;
        };

        ws.onmessage = (msg: MessageEvent): void => {
          try {
            const data = typeof msg.data === 'string' ? msg.data : String(msg.data);
            let parsed: unknown;
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = { raw: data };
            }
            const payload =
              parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
                ? (parsed as Record<string, unknown>)
                : { data: parsed };

            const eventName =
              (typeof payload['event'] === 'string' ? payload['event'] : undefined) ??
              (typeof payload['type'] === 'string' ? payload['type'] : undefined) ??
              'message';

            if (this.shouldHandle(config, eventName)) {
              void this.dispatchEvent(config.id, config.integration, eventName, payload);
            }
          } catch (err) {
            logger.error({ sourceId: config.id, err }, 'Error processing WebSocket message');
          }
        };

        ws.onclose = (): void => {
          logger.info({ sourceId: config.id }, 'WebSocket disconnected');
          const source = this.sources.get(config.id);
          if (source) source.active = false;
          if (!closed) {
            reconnectTimer = setTimeout(connect, 5000);
          }
        };

        ws.onerror = (): void => {
          logger.error({ sourceId: config.id }, 'WebSocket error');
        };
      } catch (err) {
        logger.error({ sourceId: config.id, err }, 'Failed to create WebSocket connection');
        if (!closed) {
          reconnectTimer = setTimeout(connect, 5000);
        }
      }
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) {
        try {
          socket.close();
        } catch {
          // ignore
        }
      }
    };
  }

  // ── Internal: SSE source ─────────────────────────────────────

  private startSSE(config: EventSourceConfig): () => void {
    let abortController: AbortController | null = null;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = (): void => {
      if (closed) return;

      abortController = new AbortController();
      const headers = this.buildAuthHeaders(config.auth);
      const url = this.buildAuthUrl(config.url, config.auth);

      fetch(url, {
        headers: { ...headers, Accept: 'text/event-stream' },
        signal: abortController.signal,
      })
        .then(async (response) => {
          if (!response.ok || !response.body) {
            logger.error({ sourceId: config.id, status: response.status }, 'SSE connection failed');
            if (!closed) {
              reconnectTimer = setTimeout(connect, 5000);
            }
            return;
          }

          logger.info({ sourceId: config.id }, 'SSE connected');
          const source = this.sources.get(config.id);
          if (source) source.active = true;

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let currentEvent = 'message';
          let currentData = '';

          try {
            while (!closed) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';

              for (const line of lines) {
                if (line.startsWith('event:')) {
                  currentEvent = line.slice(6).trim();
                } else if (line.startsWith('data:')) {
                  currentData += (currentData ? '\n' : '') + line.slice(5).trim();
                } else if (line === '') {
                  // Empty line = end of event
                  if (currentData) {
                    let payload: Record<string, unknown>;
                    try {
                      const parsed: unknown = JSON.parse(currentData);
                      payload =
                        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
                          ? (parsed as Record<string, unknown>)
                          : { data: parsed };
                    } catch {
                      payload = { data: currentData };
                    }

                    if (this.shouldHandle(config, currentEvent)) {
                      void this.dispatchEvent(config.id, config.integration, currentEvent, payload);
                    }
                  }
                  currentEvent = 'message';
                  currentData = '';
                }
              }
            }
          } catch (err) {
            if (!closed) {
              logger.error({ sourceId: config.id, err }, 'SSE stream error');
            }
          }

          const src = this.sources.get(config.id);
          if (src) src.active = false;
          if (!closed) {
            reconnectTimer = setTimeout(connect, 5000);
          }
        })
        .catch((err: unknown) => {
          if (!closed) {
            logger.error({ sourceId: config.id, err }, 'SSE fetch error');
            reconnectTimer = setTimeout(connect, 5000);
          }
        });
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (abortController) abortController.abort();
    };
  }

  // ── Internal: Polling source ─────────────────────────────────

  private startPolling(config: EventSourceConfig): () => void {
    const interval = config.pollingInterval ?? 30_000;
    let lastData: string | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const poll = async (): Promise<void> => {
      if (closed) return;

      try {
        const headers = this.buildAuthHeaders(config.auth);
        const url = this.buildAuthUrl(config.url, config.auth);
        const response = await fetch(url, { headers });

        if (!response.ok) {
          logger.warn({ sourceId: config.id, status: response.status }, 'Polling request failed');
          return;
        }

        const text = await response.text();

        // Only dispatch if data changed
        if (text !== lastData) {
          const isFirst = lastData === null;
          lastData = text;

          // Skip first poll (baseline) — only dispatch on changes
          if (isFirst) {
            logger.debug({ sourceId: config.id }, 'Polling baseline captured');
            return;
          }

          let payload: Record<string, unknown>;
          try {
            const parsed: unknown = JSON.parse(text);
            payload =
              parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
                ? (parsed as Record<string, unknown>)
                : { data: parsed };
          } catch {
            payload = { data: text };
          }

          void this.dispatchEvent(config.id, config.integration, 'data_changed', payload);
        }
      } catch (err) {
        logger.error({ sourceId: config.id, err }, 'Polling error');
      }
    };

    // Initial poll
    void poll();
    timer = setInterval(() => void poll(), interval);

    const source = this.sources.get(config.id);
    if (source) source.active = true;

    return () => {
      closed = true;
      if (timer) clearInterval(timer);
    };
  }

  // ── Internal: Webhook source (delegates to WebhookRouter) ────

  private startWebhook(config: EventSourceConfig): () => void {
    if (!this.webhookRouter) {
      logger.warn(
        { sourceId: config.id },
        'Webhook source requires a WebhookRouter — event source will not receive events',
      );
      return () => {};
    }

    // Register a route for each event pattern in the webhook router
    for (const event of config.events) {
      // Webhook events use exact names (not glob patterns)
      if (event.includes('*')) {
        logger.warn(
          { sourceId: config.id, event },
          'Webhook events do not support glob patterns — use exact event names',
        );
        continue;
      }

      this.webhookRouter.registerRoute(config.integration, event, async (payload) => {
        await this.dispatchEvent(config.id, config.integration, event, payload);
      });
    }

    const source = this.sources.get(config.id);
    if (source) source.active = true;

    return () => {
      if (this.webhookRouter) {
        void this.webhookRouter.deregisterIntegration(config.integration);
      }
    };
  }

  // ── Internal: event filtering ────────────────────────────────

  /**
   * Check if an event from a source should be handled based on the
   * configured event patterns.
   */
  private shouldHandle(config: EventSourceConfig, eventName: string): boolean {
    // If no event filters, handle everything
    if (config.events.length === 0) return true;
    return config.events.some((pattern) => this.matchPattern(pattern, eventName));
  }
}
