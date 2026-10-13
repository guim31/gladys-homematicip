// -----------------------------------------------------------------------------
// The live event stream of the Homematic IP cloud: one WebSocket per access
// point, opened with the same three headers as the REST calls. Each message is
// a JSON object `{ events: { "0": { pushEventType, ... }, ... } }` carrying the
// complete new version of what changed (a device, a group, the home) or a
// channel event (a key press).
//
// The stream reconnects by itself with an exponential backoff (10 s to
// 10 min). A connection silent for 8 hours is closed and opened again: the
// cloud may keep a dead socket open. Node 22+ has a WebSocket client built in
// (undici), which accepts headers: no dependency.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';

export const STREAM_TIMINGS = {
  retryMinMs: 10_000,
  retryMaxMs: 10 * 60_000,
  connectTimeoutMs: 30_000,
  staleMs: 8 * 60 * 60_000,
};

/**
 * Events: 'open', 'close' (reason), 'message' (parsed JSON).
 */
export class EventStream extends EventEmitter {
  /**
   * @param {object} options
   * @param {() => Promise<{ url: string, headers: object }>} options.target
   *   where to connect, asked again before every attempt (the host may move)
   * @param {typeof WebSocket} [options.WebSocket]
   * @param {object} [options.timings] STREAM_TIMINGS overrides
   */
  constructor({ target, WebSocket: WebSocketImpl, timings }) {
    super();
    this.target = target;
    this.WebSocket = WebSocketImpl ?? globalThis.WebSocket;
    this.timings = { ...STREAM_TIMINGS, ...timings };
    this.socket = null;
    this.connected = false;
    this.running = false;
    this.failures = 0;
    this.retryTimer = null;
    this.connectTimer = null;
    this.staleTimer = null;
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.failures = 0;
    this.connect();
  }

  stop() {
    this.running = false;
    clearTimeout(this.retryTimer);
    clearTimeout(this.connectTimer);
    clearTimeout(this.staleTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // already closed
      }
    }
    if (this.connected) {
      this.connected = false;
      this.emit('close', 'stopped');
    }
  }

  async connect() {
    if (!this.running) {
      return;
    }
    let target;
    try {
      target = await this.target();
    } catch (err) {
      this.retry(err.message);
      return;
    }
    if (!this.running) {
      return;
    }
    let socket;
    try {
      socket = new this.WebSocket(target.url, { headers: target.headers });
    } catch (err) {
      this.retry(err.message);
      return;
    }
    this.socket = socket;
    this.connectTimer = setTimeout(() => {
      if (this.socket === socket && !this.connected) {
        this.drop(socket, 'connection timed out');
      }
    }, this.timings.connectTimeoutMs);

    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        return;
      }
      clearTimeout(this.connectTimer);
      this.connected = true;
      this.failures = 0;
      this.armStaleTimer(socket);
      this.emit('open');
    });
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) {
        return;
      }
      this.armStaleTimer(socket);
      this.handleMessage(event.data);
    });
    socket.addEventListener('error', () => {
      // A 'close' always follows: the reconnection is handled there.
    });
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) {
        return;
      }
      const reason = event?.code ? `closed (code ${event.code})` : 'closed';
      this.drop(socket, reason);
    });
  }

  async handleMessage(data) {
    let text = data;
    if (typeof data !== 'string') {
      // Binary frames: Blob in undici, Buffer or ArrayBuffer elsewhere.
      text =
        typeof data?.text === 'function' ? await data.text() : Buffer.from(data).toString('utf8');
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      this.emit('invalid');
      return;
    }
    this.emit('message', json);
  }

  armStaleTimer(socket) {
    clearTimeout(this.staleTimer);
    this.staleTimer = setTimeout(() => {
      if (this.socket === socket) {
        this.drop(socket, 'silent for too long');
      }
    }, this.timings.staleMs);
  }

  /** The socket is gone (closed, failed, stale): say it once, then retry. */
  drop(socket, reason) {
    clearTimeout(this.connectTimer);
    clearTimeout(this.staleTimer);
    if (this.socket === socket) {
      this.socket = null;
    }
    try {
      socket.close();
    } catch {
      // already closed
    }
    const wasConnected = this.connected;
    this.connected = false;
    if (wasConnected) {
      this.emit('close', reason);
    }
    this.retry(reason);
  }

  retry(reason) {
    if (!this.running) {
      return;
    }
    this.failures += 1;
    this.lastFailure = reason;
    const delay = Math.min(
      this.timings.retryMinMs * 2 ** Math.min(this.failures - 1, 16),
      this.timings.retryMaxMs,
    );
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
    this.emit('retry', { reason, delay, failures: this.failures });
  }
}
