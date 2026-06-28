/**
 * WebSocket client → Node controller.
 *
 * Protocol (JSON over WS):
 *   { type: 'osc',           address, value }
 *   { type: 'module-load',   id, url? }
 *   { type: 'module-unload', id }
 *   { type: 'module-enable', id, enabled }
 *   { type: 'preset-load',   name }
 *   { type: 'preset-next' | 'preset-prev' }
 *   { type: 'log',           level, text } — server → browser
 */

export function createWs({ url, onMessage }) {
  let ws = null;
  let backoffMs = 500;
  let alive = false;

  function connect() {
    ws = new WebSocket(url);
    ws.onopen = () => {
      alive = true;
      backoffMs = 500;
      console.log('[ws] connected');
    };
    ws.onclose = () => {
      alive = false;
      console.warn('[ws] disconnected — retrying in', backoffMs, 'ms');
      setTimeout(connect, backoffMs);
      backoffMs = Math.min(backoffMs * 2, 8000);
    };
    ws.onerror = (err) => {
      console.warn('[ws] error', err);
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      onMessage?.(msg);
    };
  }
  connect();

  function send(msg) {
    if (!alive || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }

  return {
    send,
    get alive() { return alive; },
  };
}
