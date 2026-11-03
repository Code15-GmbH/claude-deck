import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { alive, createDeck, makeGitBranch, MIME, readBody, safeEqual, urls, viewKey } from '../server/server.mjs';

const cfg = { ingestToken: 'in-token', viewToken: 'view-token' };
let tmp, deck, base;
const quietLog = () => ({ error: vi.fn() });
const fakeLocate = () => vi.fn(async (list) => ({ locations: new Map(list.map((s) => [s.id, { app: 'iTerm', tab: 1 }])), currentDesktop: ['Desktop 1'] }));

async function start(opts = {}) {
  deck = createDeck({
    cfg,
    statePath: path.join(tmp, 'state.json'),
    dir: tmp,
    dist: path.join(tmp, 'dist'),
    locate: fakeLocate(),
    focus: vi.fn(async () => ({ ok: true, reason: 'iterm' })),
    gitBranch: vi.fn(async () => 'main'),
    isAlive: () => true,
    saveDelay: 0,
    refreshDelay: 0,
    log: quietLog(),
    ...opts,
  });
  await new Promise((r) => deck.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${deck.server.address().port}`;
  return deck;
}
const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const event = (body) => post('/api/event', body, { Authorization: 'Bearer in-token' });
const ev = (evName, extra = {}) => ({ event: evName, sessionId: 's1', cwd: '/p/proj', ts: Date.now(), ...extra });
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-server-')); });
afterEach(async () => { if (deck) await deck.close(); deck = null; fs.rmSync(tmp, { recursive: true, force: true }); vi.useRealTimers(); });

test('safeEqual and viewKey', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual(undefined, ''), true);
  const url = new URL('http://x/?key=q');
  assert.equal(viewKey({ headers: {} }, url), 'q');
  assert.equal(viewKey({ headers: { authorization: 'bearer h' } }, new URL('http://x/')), 'h');
  assert.equal(viewKey({ headers: {} }, new URL('http://x/')), '');
  assert.equal(MIME['.js'], 'text/javascript');
});

test('urls lists localhost, the Bonjour name and LAN addresses', () => {
  const list = urls({ viewToken: 'k' }, 4777, { exec: () => Buffer.from('MyMac\n'), lan: () => ['10.0.0.2'] });
  assert.deepEqual(list, ['http://localhost:4777/?key=k', 'http://MyMac.local:4777/?key=k', 'http://10.0.0.2:4777/?key=k']);
  const fallback = urls({ viewToken: 'k' }, 1, { exec: () => { throw new Error('no scutil'); }, lan: () => [] });
  assert.equal(fallback[1], `http://${os.hostname().split('.')[0]}.local:1/?key=k`);
  assert.equal(urls({ viewToken: 'k' }, 1).length >= 2, true); // real defaults do not throw
});

test('makeGitBranch caches per folder', async () => {
  const exec = vi.fn((cmd, args, opts, cb) => cb(null, 'feature/x\n'));
  const branch = makeGitBranch({ exec });
  assert.equal(await branch('/a'), 'feature/x');
  assert.equal(await branch('/a'), 'feature/x');
  assert.equal(exec.mock.calls.length, 1);
  assert.deepEqual(exec.mock.calls[0][1], ['-C', '/a', 'branch', '--show-current']);
  const failing = makeGitBranch({ exec: (cmd, args, opts, cb) => cb(new Error('not a repo')), ttl: -1 });
  assert.equal(await failing('/b'), '');
  assert.equal(typeof makeGitBranch(), 'function');
});

test('alive: running, missing and foreign processes', () => {
  assert.equal(alive(process.pid), true);
  vi.spyOn(process, 'kill').mockImplementationOnce(() => { throw Object.assign(new Error('x'), { code: 'ESRCH' }); });
  assert.equal(alive(123), false);
  vi.spyOn(process, 'kill').mockImplementationOnce(() => { throw Object.assign(new Error('x'), { code: 'EPERM' }); });
  assert.equal(alive(1), true);
});

test('readBody collects the body and rejects oversized ones', async () => {
  const req = new EventEmitter();
  const p = readBody(req);
  req.emit('data', Buffer.from('{"a"'));
  req.emit('data', Buffer.from(':1}'));
  req.emit('end');
  assert.equal(await p, '{"a":1}');
  const big = Object.assign(new EventEmitter(), { destroy: vi.fn() });
  const q = readBody(big, 4);
  big.emit('data', Buffer.from('12345'));
  await assert.rejects(q, /too large/);
  assert.equal(big.destroy.mock.calls.length, 1);
  const broken = new EventEmitter();
  const r = readBody(broken);
  broken.emit('error', new Error('reset'));
  await assert.rejects(r, /reset/);
});

test('health needs no key', async () => {
  await start();
  const res = await fetch(base + '/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('events need the ingest token and update the state', async () => {
  await start();
  assert.equal((await post('/api/event', ev('SessionStart'))).status, 401);
  assert.equal((await post('/api/event', ev('SessionStart'), { Authorization: 'Bearer view-token' })).status, 401);
  assert.equal((await event(ev('UserPromptSubmit', { prompt: 'Bau das', pid: 77 }))).status, 204);
  assert.equal((await event(ev('Notification', { notificationType: 'idle_prompt' }))).status, 204); // ignored
  assert.equal((await event('{broken')).status, 400);

  assert.equal((await fetch(base + '/api/state')).status, 401);
  assert.equal((await fetch(base + '/api/state?key=in-token')).status, 401);
  const res = await fetch(base + '/api/state?key=view-token');
  const st = await res.json();
  assert.ok(st.version >= 1);
  assert.equal(st.sessions[0].status, 'working');
  assert.equal(st.sessions[0].prompt, 'Bau das');
  const bearer = await fetch(base + '/api/state', { headers: { Authorization: 'Bearer view-token' } });
  assert.equal(bearer.status, 200);

  await tick(); // scheduled refresh: branch and location arrive
  const after = await (await fetch(base + '/api/state?key=view-token')).json();
  assert.equal(after.sessions[0].branch, 'main');
  assert.deepEqual(after.sessions[0].location, { app: 'iTerm', tab: 1 });
  assert.deepEqual(after.currentDesktop, ['Desktop 1']);
  // the state was saved to disk
  const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'state.json'), 'utf8'));
  assert.equal(saved.sessions.s1.status, 'working');
});

test('the stream sends the full state on connect and on every change', async () => {
  await start();
  const ctrl = new AbortController();
  const res = await fetch(base + '/api/stream?key=view-token', { signal: ctrl.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const first = dec.decode((await reader.read()).value);
  assert.match(first, /^retry: 3000\nevent: state\ndata: \{"version":0/);
  assert.equal(deck.clients.size, 1);
  await event(ev('Stop', { lastMessage: 'fertig' }));
  const second = dec.decode((await reader.read()).value);
  assert.match(second, /^event: state\ndata: .*"status":"done"/);
  ctrl.abort();
  await tick(50);
  assert.equal(deck.clients.size, 0);
});

test('ack clears and restores a finished session', async () => {
  await start();
  await event(ev('Stop'));
  assert.equal((await post('/api/ack', { id: 's1' })).status, 401);
  assert.equal((await post('/api/ack?key=view-token', { id: 's1' })).status, 204);
  assert.ok(deck.sessions.s1.ackedAt);
  await post('/api/ack?key=view-token', { id: 's1', acked: false });
  assert.equal(deck.sessions.s1.ackedAt, null);
  assert.equal((await post('/api/ack?key=view-token', { id: 'nope' })).status, 204);
  assert.equal((await post('/api/ack?key=view-token', 'x')).status, 400);
});

test('focus answers 200, 409 or 404', async () => {
  const focus = vi.fn().mockResolvedValueOnce({ ok: true, reason: 'iterm' }).mockResolvedValueOnce({ ok: false, reason: 'tab-closed' });
  await start({ focus });
  await event(ev('SessionStart'));
  const ok = await post('/api/focus?key=view-token', { id: 's1' });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, reason: 'iterm' });
  assert.equal(focus.mock.calls[0][0].id, 's1');
  const closed = await post('/api/focus?key=view-token', { id: 's1' });
  assert.equal(closed.status, 409);
  assert.equal((await closed.json()).reason, 'tab-closed');
  const unknown = await post('/api/focus?key=view-token', { id: 'zzz' });
  assert.equal(unknown.status, 404);
  assert.equal((await fetch(base + '/api/nothing?key=view-token')).status, 404);
  assert.equal((await fetch(base + '/api/focus?key=view-token')).status, 404); // GET is not a focus
});

test('static dashboard files, SPA fallback and traversal protection', async () => {
  await start();
  assert.equal((await fetch(base + '/')).status, 503); // not built
  fs.mkdirSync(path.join(tmp, 'dist', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'dist', 'index.html'), '<html>deck</html>');
  fs.writeFileSync(path.join(tmp, 'dist', 'assets', 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(tmp, 'dist', 'assets', 'blob.xyz'), 'raw');
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'nope');
  const index = await fetch(base + '/');
  assert.equal(index.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(await index.text(), '<html>deck</html>');
  const js = await fetch(base + '/assets/app.js');
  assert.equal(js.headers.get('content-type'), 'text/javascript');
  assert.equal((await fetch(base + '/assets/blob.xyz')).headers.get('content-type'), 'application/octet-stream');
  assert.equal(await (await fetch(base + '/some/route')).text(), '<html>deck</html>');
  assert.equal(await (await fetch(base + '/assets')).text(), '<html>deck</html>'); // directory
  assert.equal(await (await fetch(base + '/%2e%2e/secret.txt')).text(), '<html>deck</html>');
});

test('state survives a restart; a broken state file starts empty', async () => {
  fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({ sessions: { old: { id: 'old', status: 'idle', updatedAt: Date.now() } } }));
  await start();
  assert.deepEqual(Object.keys(deck.sessions), ['old']);
  await deck.close();
  fs.writeFileSync(path.join(tmp, 'state.json'), '{"no":"sessions"}');
  await start();
  assert.deepEqual(deck.sessions, {});
  await deck.close();
  fs.writeFileSync(path.join(tmp, 'state.json'), 'garbage');
  await start();
  assert.deepEqual(deck.sessions, {});
});

test('a failed save is logged, not thrown', async () => {
  const log = quietLog();
  fs.writeFileSync(path.join(tmp, 'blocker'), '');
  await start({ log, dir: path.join(tmp, 'blocker', 'sub'), statePath: path.join(tmp, 'blocker', 'sub', 'state.json') });
  deck.saveNow();
  assert.match(log.error.mock.calls[0][0], /save failed/);
});

test('refresh: dead process ends the session, moved-on transcript ends waiting', async () => {
  const transcript = path.join(tmp, 't.jsonl');
  fs.writeFileSync(transcript, '');
  const isAlive = vi.fn((pid) => pid !== 666);
  await start({ isAlive });
  await event(ev('UserPromptSubmit', { sessionId: 'dead', pid: 666 }));
  await event(ev('Notification', { sessionId: 'wait', pid: 1, transcript, notificationType: 'permission_prompt', message: 'perm', ts: Date.now() - 10_000 }));
  await event(ev('Notification', { sessionId: 'still', pid: 1, transcript: path.join(tmp, 'missing.jsonl'), notificationType: 'permission_prompt' }));
  await event(ev('SessionStart', { sessionId: 'nocwd', cwd: '' }));
  await deck.refresh();
  assert.equal(deck.sessions.dead.status, 'ended');
  assert.ok(deck.sessions.dead.endedAt);
  assert.equal(deck.sessions.wait.status, 'working');
  assert.equal(deck.sessions.wait.waitingReason, '');
  assert.equal(deck.sessions.still.status, 'waiting');
  assert.equal(deck.sessions.nocwd.branch, '');
  const v = deck.snapshot().version;
  await deck.refresh(); // nothing new
  assert.equal(deck.snapshot().version, v);
});

test('refresh runs once at a time and logs failures', async () => {
  const log = quietLog();
  let release;
  const locate = vi.fn(() => new Promise((r) => { release = () => r({ locations: new Map(), currentDesktop: [] }); }));
  await start({ locate, log });
  const first = deck.refresh();
  await tick(5);
  await deck.refresh(); // skipped while the first one runs
  assert.equal(locate.mock.calls.length, 1);
  release();
  await first;
  locate.mockRejectedValueOnce(new Error('osascript hung'));
  await deck.refresh();
  assert.match(log.error.mock.calls[0][0], /refresh failed/);
});

test('timers: ping every 20 s, refresh every 10 s; close stops them and ends streams', async () => {
  vi.useFakeTimers();
  const locate = vi.fn(async () => ({ locations: new Map(), currentDesktop: [] }));
  const d = createDeck({ cfg, statePath: path.join(tmp, 's.json'), dir: tmp, locate, log: quietLog() });
  const client = { write: vi.fn(), end: vi.fn() };
  d.clients.add(client);
  d.startTimers();
  await vi.advanceTimersByTimeAsync(20_000);
  assert.ok(client.write.mock.calls.some((c) => c[0].startsWith('event: ping')));
  assert.equal(locate.mock.calls.length, 2);
  await d.close();
  assert.equal(client.end.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(30_000);
  assert.equal(locate.mock.calls.length, 2);
});
