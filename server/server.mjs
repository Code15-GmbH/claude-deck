#!/usr/bin/env node
// Claude Deck server — runs on the Mac, zero dependencies.
//
//   POST /api/event    hook events           (Authorization: Bearer <ingestToken>)
//   GET  /api/state    current board as JSON (?key=<viewToken>)
//   GET  /api/stream   Server-Sent Events    (?key=<viewToken>)
//   POST /api/ack      clear a strip from "Braucht dich" / put it back (?key=<viewToken>, {id, acked})
//   POST /api/focus    bring a session's terminal to the front (?key=<viewToken>, {id}) — used by the Stream Deck plugin
//   GET  /api/health   {ok:true}
//   GET  /*            the React dashboard (web/dist)
//
//   node server/server.mjs            start
//   node server/server.mjs --urls     print the dashboard URLs (with key) and exit
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadOrCreateConfig, lanAddresses, STATE, DIR } from './config.mjs';
import { applyEvent, acknowledge, prune } from './store.mjs';
import { locateAll, ensureHelper } from './locate.mjs';
import { focusSession } from './focus.mjs';
import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'web', 'dist');
const cfg = loadOrCreateConfig();
const PORT = Number(process.env.CLAUDE_DECK_PORT || cfg.port);
const HOST = process.env.CLAUDE_DECK_HOST || cfg.host;

function urls() {
  let name = '';
  try { name = execFileSync('scutil', ['--get', 'LocalHostName'], { timeout: 1000 }).toString().trim(); } catch {}
  const host = (name || os.hostname().split('.')[0]) + '.local'; // Bonjour name, works in the LAN
  return [`http://localhost:${PORT}/?key=${cfg.viewToken}`, `http://${host}:${PORT}/?key=${cfg.viewToken}`,
    ...lanAddresses().map((ip) => `http://${ip}:${PORT}/?key=${cfg.viewToken}`)];
}
if (process.argv.includes('--urls')) { console.log(urls().join('\n')); process.exit(0); }

// --- state -----------------------------------------------------------------
let sessions = {};
try { sessions = JSON.parse(fs.readFileSync(STATE, 'utf8')).sessions || {}; } catch {}
let currentDesktop = [];
let version = 0;
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(STATE + '.tmp', JSON.stringify({ sessions }), { mode: 0o600 });
      fs.renameSync(STATE + '.tmp', STATE);
    } catch (e) { console.error('save failed:', e.message); }
  }, 500);
}
const snapshot = () => ({ version, now: Date.now(), currentDesktop, sessions: Object.values(sessions) });

const clients = new Set();
function changed() {
  version += 1;
  save();
  const data = `event: state\ndata: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of clients) res.write(data);
}

// --- enrichment: location, git branch, liveness -----------------------------
const branchCache = new Map();
const gitBranch = (cwd) => new Promise((resolve) => {
  const hit = branchCache.get(cwd);
  if (hit && Date.now() - hit.at < 60e3) return resolve(hit.value);
  execFile('git', ['-C', cwd, 'branch', '--show-current'], { timeout: 1500 }, (err, out) => {
    const value = err ? '' : String(out).trim();
    branchCache.set(cwd, { at: Date.now(), value });
    resolve(value);
  });
});

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    let dirty = prune(sessions);
    const live = Object.values(sessions).filter((s) => s.status !== 'ended');
    for (const s of live) {
      // claude process gone without SessionEnd (terminal closed, crash) -> ended
      if (s.pid && !alive(s.pid)) { s.status = 'ended'; s.endedAt = Date.now(); dirty = true; continue; }
      // permission granted/denied -> transcript moves on -> back to "working"
      if (s.status === 'waiting' && s.transcript) {
        try { if (fs.statSync(s.transcript).mtimeMs > s.attentionAt + 1500) { s.status = 'working'; s.waitingReason = ''; dirty = true; } } catch {}
      }
      const branch = s.cwd ? await gitBranch(s.cwd) : '';
      if (branch !== s.branch) { s.branch = branch; dirty = true; }
    }
    const still = live.filter((s) => s.status !== 'ended');
    const { locations, currentDesktop: cur } = await locateAll(still);
    for (const s of still) {
      const loc = locations.get(s.id);
      if (JSON.stringify(loc) !== JSON.stringify(s.location)) { s.location = loc; dirty = true; }
    }
    if (JSON.stringify(cur) !== JSON.stringify(currentDesktop)) { currentDesktop = cur; dirty = true; }
    if (dirty) changed();
  } catch (e) {
    console.error('refresh failed:', e.message);
  } finally { refreshing = false; }
}
let refreshSoon = null;
const scheduleRefresh = () => { clearTimeout(refreshSoon); refreshSoon = setTimeout(refresh, 150); };

// --- http --------------------------------------------------------------------
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const viewKey = (req, url) => url.searchParams.get('key') || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/health') return send(res, 200, { ok: true });

    if (p === '/api/event' && req.method === 'POST') {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!safeEqual(token, cfg.ingestToken)) return send(res, 401, { error: 'unauthorized' });
      const ev = JSON.parse(await readBody(req));
      if (applyEvent(sessions, ev)) { changed(); scheduleRefresh(); }
      return send(res, 204, '');
    }

    if (p.startsWith('/api/')) {
      if (!safeEqual(viewKey(req, url), cfg.viewToken)) return send(res, 401, { error: 'unauthorized' });
      if (p === '/api/state') return send(res, 200, snapshot());
      if (p === '/api/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`retry: 3000\nevent: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (p === '/api/ack' && req.method === 'POST') {
        const { id, acked = true } = JSON.parse(await readBody(req));
        if (acknowledge(sessions, id, acked !== false)) changed();
        return send(res, 204, '');
      }
      if (p === '/api/focus' && req.method === 'POST') {
        const { id } = JSON.parse(await readBody(req));
        const s = sessions[id];
        if (!s) return send(res, 404, { ok: false, reason: 'unknown-session' });
        const result = await focusSession(s);
        scheduleRefresh(); // the window may have moved to the current desktop
        return send(res, result.ok ? 200 : 409, result);
      }
      return send(res, 404, { error: 'not found' });
    }

    // static dashboard (contains no data; data needs the key)
    let file = path.normalize(path.join(DIST, p === '/' ? 'index.html' : p));
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    if (!fs.existsSync(file)) return send(res, 503, 'Dashboard not built yet: npm run web:build', 'text/plain; charset=utf-8');
    return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
});

setInterval(() => { for (const res of clients) res.write('event: ping\ndata: {}\n\n'); }, 20e3);
setInterval(refresh, 10e3);

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is in use. Is the server already running? (lsof -nP -iTCP:${PORT})` : e.message);
  process.exit(1);
});
server.listen(PORT, HOST, async () => {
  console.log(`Claude Deck server listening on ${HOST}:${PORT}`);
  console.log('Dashboard:\n  ' + urls().join('\n  '));
  if (await ensureHelper()) console.log('Desktop detection: on'); else console.log('Desktop detection: off (swiftc missing)');
  refresh();
});
