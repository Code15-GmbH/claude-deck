// Client for the local claude-tower server (../claude-tower): subscribes to the SSE
// stream for live session state and calls /api/focus and /api/ack on key presses.
// Port and view token come from ~/.claude-tower/config.json (re-read on every connect).
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class TowerClient extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.dir = opts.dir || process.env.TOWER_HOME || path.join(os.homedir(), '.claude-tower');
    this.sessions = [];
    this.connected = false;
    this.lastError = '';
    this.stopped = false;
    this.ctrl = null;
  }

  config() {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(this.dir, 'config.json'), 'utf8'));
      return { base: `http://127.0.0.1:${c.port || 4777}`, key: c.viewToken || '' };
    } catch { return null; }
  }

  dashboardUrl() {
    const c = this.config();
    return c ? `http://localhost${c.base.slice(c.base.lastIndexOf(':'))}/?key=${encodeURIComponent(c.key)}` : '';
  }

  start() { this.stopped = false; this.loop(); }
  stop() { this.stopped = true; this.ctrl?.abort(); }

  async loop() {
    let delay = 1000;
    while (!this.stopped) {
      try { await this.stream(); delay = 1000; } catch (e) { this.setConnected(false, e.message); }
      if (this.stopped) break;
      await sleep(delay);
      delay = Math.min(delay * 2, 10000);
    }
  }

  async stream() {
    const cfg = this.config();
    if (!cfg) throw new Error('~/.claude-tower/config.json fehlt (Tower nie gestartet?)');
    this.ctrl = new AbortController();
    const res = await fetch(`${cfg.base}/api/stream?key=${encodeURIComponent(cfg.key)}`, { signal: this.ctrl.signal, headers: { Accept: 'text/event-stream' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    this.setConnected(true);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let at;
      while ((at = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, at);
        buf = buf.slice(at + 2);
        this.handle(block);
      }
    }
    throw new Error('Stream beendet');
  }

  handle(block) {
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (event !== 'state' || !data) return;
    try {
      const st = JSON.parse(data);
      this.sessions = Array.isArray(st.sessions) ? st.sessions : [];
      this.emit('state', this.sessions);
    } catch (e) { this.emit('error', e); }
  }

  setConnected(value, error = '') {
    const was = this.connected;
    this.connected = value;
    this.lastError = value ? '' : error;
    if (was !== value) this.emit('connection', value, error);
  }

  async post(p, body) {
    const cfg = this.config();
    if (!cfg) throw new Error('Tower-Konfiguration fehlt');
    const res = await fetch(`${cfg.base}${p}?key=${encodeURIComponent(cfg.key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(6000),
    });
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch {}
    if (!res.ok && json.ok === undefined) throw new Error(`HTTP ${res.status}`);
    return json;
  }

  focus(id) { return this.post('/api/focus', { id }); }
  ack(id, acked = true) { return this.post('/api/ack', { id, acked }); }
}
