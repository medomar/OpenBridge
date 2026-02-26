import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connector, ConnectorEvents } from '../../types/connector.js';
import type { InboundMessage, OutboundMessage, ProgressEvent } from '../../types/message.js';
import { WebChatConfigSchema } from './webchat-config.js';
import type { WebChatConfig } from './webchat-config.js';
import { createLogger } from '../../core/logger.js';
import { getQrCode } from '../../core/qr-store.js';
import type { ActivityRecord } from '../../memory/activity-store.js';

const logger = createLogger('webchat');

type EventListeners = {
  [E in keyof ConnectorEvents]: ConnectorEvents[E][];
};

/** Minimal WS client interface — avoids importing ws types at module level */
interface WsClient {
  readyState: number;
  send(data: string): void;
  ping(): void;
  on(event: 'message', listener: (data: Buffer | string) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
}

/** Minimal WebSocketServer interface */
interface WssServer {
  on(event: 'connection', listener: (socket: WsClient) => void): void;
  on(event: 'close', listener: () => void): void;
  close(callback?: () => void): void;
}

/** WebSocket OPEN state constant */
const WS_OPEN = 1;

const CHAT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OpenBridge WebChat</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f2f5; height: 100vh; display: flex; align-items: center; justify-content: center; }
    .chat-wrap { width: 100%; max-width: 720px; height: 92vh; display: flex; flex-direction: column; background: #fff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.12); overflow: hidden; }
    .header { padding: 14px 20px; background: #1a73e8; color: #fff; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
    .header h1 { font-size: 17px; font-weight: 600; }
    .conn-status { display: flex; align-items: center; gap: 7px; font-size: 13px; opacity: 0.92; }
    .conn-dot { width: 9px; height: 9px; border-radius: 50%; background: #ff5252; transition: background 0.4s; flex-shrink: 0; }
    .conn-dot.online { background: #69f0ae; }
    #msgs { flex: 1; overflow-y: auto; padding: 18px 16px; display: flex; flex-direction: column; gap: 10px; scroll-behavior: smooth; }
    .bubble { max-width: 78%; padding: 10px 14px; border-radius: 16px; font-size: 14px; line-height: 1.55; word-wrap: break-word; }
    .bubble.user { align-self: flex-end; background: #1a73e8; color: #fff; border-bottom-right-radius: 4px; }
    .bubble.ai { align-self: flex-start; background: #f1f3f4; color: #202124; border-bottom-left-radius: 4px; }
    .bubble.sys { align-self: center; background: transparent; color: #9aa0a6; font-size: 12px; font-style: italic; padding: 2px 0; }
    .dot-anim span { display: inline-block; animation: pulse 1.3s infinite; }
    .dot-anim span:nth-child(2) { animation-delay: 0.22s; }
    .dot-anim span:nth-child(3) { animation-delay: 0.44s; }
    @keyframes pulse { 0%,80%,100%{opacity:0.2} 40%{opacity:1} }
    .bubble.ai code { font-family: 'SF Mono', 'Fira Code', Consolas, monospace; font-size: 13px; background: rgba(0,0,0,0.07); padding: 1px 5px; border-radius: 3px; }
    .bubble.ai pre { background: rgba(0,0,0,0.06); border-radius: 6px; padding: 10px 12px; margin: 6px 0; overflow-x: auto; }
    .bubble.ai pre code { background: transparent; padding: 0; }
    .bubble.ai strong { font-weight: 600; }
    .bubble.ai em { font-style: italic; }
    #status-bar { padding: 6px 16px; border-top: 1px solid #e8eaed; display: flex; align-items: center; gap: 10px; flex-shrink: 0; min-height: 34px; background: #fafbfc; }
    #status-bar.hidden { display: none; }
    #status-text { flex: 1; font-size: 13px; color: #5f6368; }
    #status-timer { font-size: 12px; color: #9aa0a6; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .status-dot-anim span { display: inline-block; animation: pulse 1.3s infinite; }
    .status-dot-anim span:nth-child(2) { animation-delay: 0.22s; }
    .status-dot-anim span:nth-child(3) { animation-delay: 0.44s; }
    .input-row { padding: 12px 16px; border-top: 1px solid #e8eaed; display: flex; gap: 10px; flex-shrink: 0; }
    #inp { flex: 1; padding: 10px 16px; border: 1.5px solid #dadce0; border-radius: 24px; font-size: 14px; outline: none; transition: border-color 0.2s; background: #fff; }
    #inp:focus { border-color: #1a73e8; }
    #inp:disabled { background: #f8f9fa; }
    #send { padding: 10px 22px; background: #1a73e8; color: #fff; border: none; border-radius: 24px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background 0.2s; white-space: nowrap; }
    #send:hover:not(:disabled) { background: #1557b0; }
    #send:disabled { background: #bdc1c6; cursor: not-allowed; }
    .download-link { display: inline-block; margin-top: 6px; padding: 6px 14px; background: #1a73e8; color: #fff; border-radius: 16px; text-decoration: none; font-size: 13px; }
    .download-link:hover { background: #1557b0; }
    #dash { border-bottom: 1px solid #e8eaed; background: #f8f9fa; flex-shrink: 0; max-height: 220px; overflow-y: auto; }
    #dash.hidden { display: none; }
    .dash-hdr { padding: 6px 16px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 12px; font-weight: 500; color: #5f6368; user-select: none; }
    .dash-hdr:hover { background: #f1f3f4; }
    #dash-body { padding: 2px 16px 8px; font-size: 12px; }
    .agent-row { display: flex; gap: 6px; align-items: center; padding: 2px 0; }
    .prog-wrap { width: 72px; height: 7px; background: #e8eaed; border-radius: 4px; overflow: hidden; flex-shrink: 0; }
    .prog-bar { height: 100%; background: #1a73e8; border-radius: 4px; transition: width 0.4s; }
    .abadge { padding: 1px 6px; border-radius: 10px; font-size: 11px; font-weight: 500; flex-shrink: 0; }
    .s-starting { background: #fef3c7; color: #92400e; }
    .s-running { background: #d1fae5; color: #065f46; }
    .s-completing { background: #dbeafe; color: #1e40af; }
    .dash-cost { padding: 4px 0 0; color: #5f6368; border-top: 1px solid #e8eaed; margin-top: 4px; }
    .stop-btn { background: #ff5252; color: #fff; border: none; border-radius: 4px; padding: 1px 7px; font-size: 12px; cursor: pointer; flex-shrink: 0; line-height: 1.6; }
    .stop-btn:hover { background: #d32f2f; }
    .stop-all-btn { background: #ff5252; color: #fff; border: none; border-radius: 6px; padding: 4px 12px; font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap; }
    .stop-all-btn:hover { background: #d32f2f; }
    .stop-all-btn:disabled { background: #e57373; cursor: not-allowed; }
  </style>
</head>
<body>
  <div class="chat-wrap">
    <div class="header">
      <h1>OpenBridge WebChat</h1>
      <div style="display:flex;align-items:center;gap:12px">
        <button class="stop-all-btn" id="stop-all-btn" disabled onclick="stopAll()">Stop All</button>
        <div class="conn-status">
          <div class="conn-dot" id="dot"></div>
          <span id="connLabel">Connecting...</span>
        </div>
      </div>
    </div>
    <div id="dash" class="hidden">
      <div class="dash-hdr" id="dash-hdr">
        <span id="dash-lbl">Agent Status</span>
        <span id="dash-icon">&#9650;</span>
      </div>
      <div id="dash-body">
        <div id="dash-master"></div>
        <div id="dash-workers"></div>
        <div id="dash-cost"></div>
      </div>
    </div>
    <div id="msgs"></div>
    <div id="status-bar" class="hidden">
      <span id="status-text"></span>
      <span id="status-timer"></span>
    </div>
    <form class="input-row" id="form">
      <input id="inp" type="text" placeholder="Type a message..." autocomplete="off" disabled />
      <button type="submit" id="send" disabled>Send</button>
    </form>
  </div>
  <script>
    var msgs = document.getElementById('msgs');
    var form = document.getElementById('form');
    var inp = document.getElementById('inp');
    var send = document.getElementById('send');
    var dot = document.getElementById('dot');
    var connLabel = document.getElementById('connLabel');
    var statusBar = document.getElementById('status-bar');
    var statusText = document.getElementById('status-text');
    var statusTimer = document.getElementById('status-timer');
    var timerInterval = null;
    var timerStart = null;

    function md(raw) {
      var h = raw.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
      // Code blocks: \`\`\`lang\\ncode\`\`\`
      var T3 = '\x60\x60\x60';
      var cp = h.split(T3);
      var cr = '';
      for (var ci = 0; ci < cp.length; ci++) {
        if (ci % 2 === 1) {
          var ln = cp[ci].split('\\n');
          var firstLine = ln[0] ? ln[0].trim() : '';
          var code = firstLine ? ln.slice(1).join('\\n').trim() : cp[ci].trim();
          cr += '<pre><code>' + code + '</code></pre>';
        } else { cr += cp[ci]; }
      }
      h = cr;
      // Inline code: \`...\`
      var T1 = '\x60';
      var ip = h.split(T1);
      var ir = '';
      for (var ii = 0; ii < ip.length; ii++) {
        ir += ii % 2 === 1 ? '<code>' + ip[ii] + '</code>' : ip[ii];
      }
      h = ir;
      // Bold+italic: ***text***
      var tp = h.split('***');
      var tr = '';
      for (var ti = 0; ti < tp.length; ti++) {
        tr += ti % 2 === 1 ? '<strong><em>' + tp[ti] + '</em></strong>' : tp[ti];
      }
      h = tr;
      // Bold: **text**
      var bp = h.split('**');
      var br = '';
      for (var bi = 0; bi < bp.length; bi++) {
        br += bi % 2 === 1 ? '<strong>' + bp[bi] + '</strong>' : bp[bi];
      }
      h = br;
      // Newlines
      return h.split('\\n').join('<br>');
    }

    function addBubble(content, cls) {
      var div = document.createElement('div');
      div.className = 'bubble ' + cls;
      if (cls === 'ai') { div.innerHTML = md(content); }
      else { div.textContent = content; }
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
      return div;
    }

    function startTimer() {
      if (timerInterval) return;
      timerStart = Date.now();
      statusTimer.textContent = '0s';
      timerInterval = setInterval(function() {
        var elapsed = Math.floor((Date.now() - timerStart) / 1000);
        statusTimer.textContent = elapsed + 's';
      }, 1000);
    }

    function stopTimer() {
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      timerStart = null;
      statusTimer.textContent = '';
    }

    function showStatus(html) {
      statusBar.classList.remove('hidden');
      statusText.innerHTML = html;
      if (!timerInterval) startTimer();
    }

    function hideStatus() {
      statusBar.classList.add('hidden');
      statusText.innerHTML = '';
      stopTimer();
    }

    function progressLabel(event) {
      if (event.type === 'classifying') {
        return '\uD83D\uDD0D Analyzing request<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>';
      }
      if (event.type === 'planning') {
        return '\uD83D\uDCCB Planning subtasks<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>';
      }
      if (event.type === 'spawning') {
        var n = event.workerCount;
        return '\uD83D\uDCCB Breaking into ' + n + ' subtask' + (n !== 1 ? 's' : '') + '<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>';
      }
      if (event.type === 'worker-progress') {
        var label = event.workerName ? '\u2699\uFE0F ' + event.workerName + ': ' : '\u2699\uFE0F ';
        return label + event.completed + '/' + event.total + ' workers done<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>';
      }
      if (event.type === 'synthesizing') {
        return '\uD83D\uDCDD Preparing final response<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>';
      }
      if (event.type === 'exploring') {
        return '\uD83D\uDDFA\uFE0F ' + event.phase + '<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>';
      }
      if (event.type === 'exploring-directory') {
        return '\uD83D\uDCC2 Exploring directories: ' + event.completed + '/' + event.total + (event.directory ? ' (' + event.directory + ')' : '') + '<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>';
      }
      return null;
    }

    var dashOpen = true;
    document.getElementById('dash-hdr').addEventListener('click', function() {
      dashOpen = !dashOpen;
      document.getElementById('dash-body').style.display = dashOpen ? '' : 'none';
      document.getElementById('dash-icon').textContent = dashOpen ? '\u25B2' : '\u25BC';
    });

    function updateDashboard(agents) {
      var dash = document.getElementById('dash');
      var stopAllBtn = document.getElementById('stop-all-btn');
      if (!agents || agents.length === 0) { dash.classList.add('hidden'); stopAllBtn.disabled = true; return; }
      dash.classList.remove('hidden');
      var master = null;
      var workers = [];
      for (var i = 0; i < agents.length; i++) {
        if (agents[i].type === 'master') master = agents[i];
        else workers.push(agents[i]);
      }
      var masterDiv = document.getElementById('dash-master');
      masterDiv.innerHTML = master
        ? '<div style="padding:2px 0;color:#202124"><strong>Master:</strong> ' + (master.model || 'unknown') + ' &nbsp;|&nbsp; ' + master.status + '</div>'
        : '';
      var workersDiv = document.getElementById('dash-workers');
      if (workers.length === 0) {
        workersDiv.innerHTML = '';
        stopAllBtn.disabled = true;
      } else {
        stopAllBtn.disabled = false;
        var h = '<div style="font-weight:500;padding:2px 0">Workers (' + workers.length + '):</div>';
        for (var j = 0; j < workers.length; j++) {
          var w = workers[j];
          var pct = w.progress_pct || 0;
          var sc = 's-' + (w.status || 'running');
          var elapsed = w.started_at ? Math.floor((Date.now() - new Date(w.started_at).getTime()) / 1000) + 's' : '';
          var wid = String(w.id);
          h += '<div class="agent-row">' +
            '<span style="font-family:monospace;color:#5f6368;flex-shrink:0">' + wid.slice(0, 8) + '</span>' +
            '<span class="abadge ' + sc + '">' + (w.model || '\u2014') + '</span>' +
            '<span style="color:#9aa0a6;flex-shrink:0">' + (w.profile || '\u2014') + '</span>' +
            '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#202124">' + (w.task_summary || '\u2014') + '</span>' +
            '<div class="prog-wrap"><div class="prog-bar" style="width:' + pct + '%"></div></div>' +
            '<span style="color:#9aa0a6;white-space:nowrap;flex-shrink:0">' + pct + '%</span>' +
            '<span style="color:#9aa0a6;white-space:nowrap;flex-shrink:0;min-width:32px;text-align:right">' + elapsed + '</span>' +
            '<button class="stop-btn" title="Stop this worker" onclick="stopWorker(' + JSON.stringify(wid) + ')">&#x2715;</button>' +
            '</div>';
        }
        workersDiv.innerHTML = h;
      }
      var totalCost = 0;
      for (var k = 0; k < agents.length; k++) { totalCost += agents[k].cost_usd || 0; }
      document.getElementById('dash-cost').innerHTML =
        '<div class="dash-cost">Cost: $' + totalCost.toFixed(4) + ' &nbsp;|&nbsp; Active workers: ' + workers.length + '</div>';
      document.getElementById('dash-lbl').textContent = 'Agent Status (' + agents.length + ' active)';
    }

    function stopWorker(workerId) {
      if (!ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify({ type: 'stop-worker', workerId: workerId }));
    }

    function stopAll() {
      if (!ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify({ type: 'stop-all' }));
    }

    function setOnline(online) {
      dot.className = 'conn-dot' + (online ? ' online' : '');
      connLabel.textContent = online ? 'Connected' : 'Disconnected';
      inp.disabled = !online;
      send.disabled = !online;
    }

    var ws;
    function connectWs() {
      ws = new WebSocket('ws://' + location.host);
      ws.onopen = function() { setOnline(true); addBubble('Connected to OpenBridge', 'sys'); };
      ws.onclose = function() { setOnline(false); hideStatus(); addBubble('Disconnected — reconnecting...', 'sys'); setTimeout(connectWs, 2000); };
      ws.onmessage = function(e) {
        try {
          var data = JSON.parse(e.data);
          if (data.type === 'response') {
            hideStatus();
            addBubble(data.content, 'ai');
          } else if (data.type === 'download') {
            hideStatus();
            var div = document.createElement('div');
            div.className = 'bubble ai';
            if (data.content) { div.innerHTML = md(data.content) + '<br>'; }
            var link = document.createElement('a');
            link.href = data.url;
            link.download = data.filename || 'download';
            link.className = 'download-link';
            link.textContent = '\u2B07\uFE0F Download ' + (data.filename || 'file');
            div.appendChild(link);
            msgs.appendChild(div);
            msgs.scrollTop = msgs.scrollHeight;
          } else if (data.type === 'typing') {
            showStatus('\uD83E\uDD14 Thinking<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>');
          } else if (data.type === 'progress') {
            if (data.event && data.event.type === 'complete') {
              hideStatus();
            } else if (data.event && data.event.type === 'worker-result') {
              var icon = data.event.success ? '\u2705' : '\u274C';
              var toolLabel = data.event.tool ? ' \u00b7 ' + data.event.tool : '';
              var header = icon + ' **Subtask ' + data.event.workerIndex + '/' + data.event.total + '** (' + data.event.profile + toolLabel + '):\\n\\n';
              addBubble(header + data.event.content, 'ai');
            } else if (data.event) {
              var label = progressLabel(data.event);
              if (label) showStatus(label);
            }
          } else if (data.type === 'agent-status') {
            updateDashboard(data.agents);
          }
        } catch(ex) {}
      };
    }
    connectWs();
    form.onsubmit = function(e) {
      e.preventDefault();
      var text = inp.value.trim();
      if (!text || ws.readyState !== 1) return;
      addBubble(text, 'user');
      ws.send(JSON.stringify({ type: 'message', content: text }));
      inp.value = '';
      showStatus('\uD83E\uDD14 Thinking<span class="status-dot-anim"><span>.</span><span>.</span><span>.</span></span>');
    };
  </script>
</body>
</html>`;

/**
 * WebChat connector — serves a minimal HTML chat UI on localhost:3000
 * and exchanges messages via WebSocket.
 *
 * Uses Node.js built-in `http` module + the `ws` package.
 * No auth required for localhost connections.
 *
 * Usage in config.json:
 * ```json
 * {
 *   "channels": [{ "type": "webchat", "options": { "port": 3000 } }]
 * }
 * ```
 */
export class WebChatConnector implements Connector {
  readonly name = 'webchat';
  private config: WebChatConfig;
  private connected = false;
  private httpServer: { close(cb?: (err?: Error) => void): void } | null = null;
  private wss: WssServer | null = null;
  private clients = new Set<WsClient>();
  private messageCounter = 0;
  private readonly pendingDownloads = new Map<
    string,
    { data: Buffer; mimeType: string; filename?: string; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly listeners: EventListeners = {
    message: [],
    ready: [],
    auth: [],
    error: [],
    disconnected: [],
  };

  constructor(options: Record<string, unknown>) {
    this.config = WebChatConfigSchema.parse(options);
  }

  async initialize(): Promise<void> {
    const http = await import('node:http');

    const WsServer = (await import('ws')).WebSocketServer as unknown as new (opts: {
      server: unknown;
    }) => WssServer;

    const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? '/';

      // QR code endpoint — serves a scannable QR page in headless mode
      if (url === '/qr') {
        const qrData = getQrCode();
        if (!qrData) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>WhatsApp QR</title>' +
              '<meta http-equiv="refresh" content="3"></head><body style="font-family:sans-serif;text-align:center;padding:40px">' +
              '<h2>Waiting for QR code...</h2><p>This page will auto-refresh.</p></body></html>',
          );
          return;
        }
        const html =
          '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Scan WhatsApp QR</title>' +
          '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>' +
          '<style>body{font-family:sans-serif;text-align:center;padding:40px;background:#f0f2f5}' +
          'h2{color:#128c7e}#qr{display:inline-block;padding:16px;background:#fff;border-radius:8px;' +
          'box-shadow:0 2px 12px rgba(0,0,0,0.12);margin:24px auto}</style></head>' +
          '<body><h2>Scan with WhatsApp</h2>' +
          '<p>Open WhatsApp → Linked Devices → Link a Device</p>' +
          '<div id="qr"></div>' +
          '<script>new QRCode(document.getElementById("qr"),' +
          JSON.stringify({ text: qrData, width: 256, height: 256 }) +
          ');</script></body></html>';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      const match = url.match(/^\/download\/([0-9a-f-]+)$/i);
      if (match) {
        const fileId = match[1]!;
        const entry = this.pendingDownloads.get(fileId);
        if (!entry) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }
        const filename = entry.filename ?? 'download';
        res.writeHead(200, {
          'Content-Type': entry.mimeType,
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': entry.data.length,
        });
        res.end(entry.data);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(CHAT_HTML);
    });

    this.httpServer = server;

    const wss = new WsServer({ server });
    this.wss = wss;

    // Keep WebSocket connections alive during long-running tasks (workers can take 10+ minutes)
    const PING_INTERVAL_MS = 30_000;
    const pingTimer = setInterval(() => {
      for (const client of this.clients) {
        if (client.readyState === WS_OPEN) {
          client.ping();
        }
      }
    }, PING_INTERVAL_MS);
    wss.on('close', () => clearInterval(pingTimer));

    wss.on('connection', (socket: WsClient) => {
      this.clients.add(socket);

      socket.on('message', (raw: Buffer | string) => {
        let payload: { type: string; content?: string; workerId?: string };
        try {
          payload = JSON.parse(raw.toString()) as {
            type: string;
            content?: string;
            workerId?: string;
          };
        } catch {
          return;
        }

        if (payload.type === 'message' && typeof payload.content === 'string') {
          this.messageCounter++;
          const message: InboundMessage = {
            id: `webchat-${this.messageCounter.toString()}`,
            source: 'webchat',
            sender: 'webchat-user',
            rawContent: payload.content,
            content: payload.content,
            timestamp: new Date(),
          };
          this.emit('message', message);
        } else if (payload.type === 'stop-worker' && typeof payload.workerId === 'string') {
          this.messageCounter++;
          const content = `stop ${payload.workerId}`;
          const message: InboundMessage = {
            id: `webchat-${this.messageCounter.toString()}`,
            source: 'webchat',
            sender: 'webchat-user',
            rawContent: content,
            content,
            timestamp: new Date(),
          };
          this.emit('message', message);
        } else if (payload.type === 'stop-all') {
          this.messageCounter++;
          const message: InboundMessage = {
            id: `webchat-${this.messageCounter.toString()}`,
            source: 'webchat',
            sender: 'webchat-user',
            rawContent: 'stop all',
            content: 'stop all',
            timestamp: new Date(),
          };
          this.emit('message', message);
        }
      });

      socket.on('close', () => {
        this.clients.delete(socket);
      });

      socket.on('error', (err: Error) => {
        this.clients.delete(socket);
        logger.warn({ err }, 'WebChat client error');
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(this.config.port, this.config.host, () => {
        this.connected = true;
        logger.info({ port: this.config.port, host: this.config.host }, 'WebChat connector ready');
        this.emit('ready');
        resolve();
      });
    });
  }

  sendMessage(message: OutboundMessage): Promise<void> {
    if (!this.connected) {
      return Promise.reject(new Error('WebChat connector is not connected'));
    }

    let payload: string;
    if (message.media) {
      const fileId = randomUUID();
      const { data, mimeType, filename } = message.media;
      const timer = setTimeout(
        () => {
          this.pendingDownloads.delete(fileId);
        },
        60 * 60 * 1000,
      ); // 1 hour
      this.pendingDownloads.set(fileId, { data, mimeType, filename, timer });
      payload = JSON.stringify({
        type: 'download',
        content: message.content,
        fileId,
        filename: filename ?? 'download',
        url: `/download/${fileId}`,
        mimeType,
      });
    } else {
      payload = JSON.stringify({ type: 'response', content: message.content });
    }

    for (const client of this.clients) {
      if (client.readyState === WS_OPEN) {
        client.send(payload);
      }
    }
    return Promise.resolve();
  }

  sendTypingIndicator(_chatId: string): Promise<void> {
    if (!this.connected) return Promise.resolve();
    const payload = JSON.stringify({ type: 'typing' });
    for (const client of this.clients) {
      if (client.readyState === WS_OPEN) {
        client.send(payload);
      }
    }
    return Promise.resolve();
  }

  sendProgress(event: ProgressEvent, _chatId: string): Promise<void> {
    if (!this.connected) return Promise.resolve();
    const payload = JSON.stringify({ type: 'progress', event });
    for (const client of this.clients) {
      if (client.readyState === WS_OPEN) {
        client.send(payload);
      }
    }
    return Promise.resolve();
  }

  /** Broadcast current agent activity to all connected WebSocket clients. */
  broadcastAgentStatus(agents: ActivityRecord[]): void {
    if (!this.connected || this.clients.size === 0) return;
    const payload = JSON.stringify({
      type: 'agent-status',
      agents,
      timestamp: new Date().toISOString(),
    });
    for (const client of this.clients) {
      if (client.readyState === WS_OPEN) {
        client.send(payload);
      }
    }
  }

  on<E extends keyof ConnectorEvents>(event: E, listener: ConnectorEvents[E]): void {
    this.listeners[event].push(listener);
  }

  async shutdown(): Promise<void> {
    this.connected = false;
    this.clients.clear();

    for (const entry of this.pendingDownloads.values()) {
      clearTimeout(entry.timer);
    }
    this.pendingDownloads.clear();

    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.close((err?: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.httpServer = null;
    }

    logger.info('WebChat connector shut down');
  }

  isConnected(): boolean {
    return this.connected;
  }

  private emit<E extends keyof ConnectorEvents>(
    event: E,
    ...args: Parameters<ConnectorEvents[E]>
  ): void {
    for (const listener of this.listeners[event]) {
      (listener as (...a: Parameters<ConnectorEvents[E]>) => void)(...args);
    }
  }
}
