import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { DeckClient } from '../plugin/src/client.js';

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-client-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); vi.useRealTimers(); });

const writeConfig = (cfg) => fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
const enc = new TextEncoder();
/** A fetch Response whose body yields the given chunks. */
const streamResponse = (chunks, ok = true, status = 200) => ({
  ok, status,
  body: { getReader: () => { let i = 0; return { read: async () => (i < chunks.length ? { value: enc.encode(chunks[i++]), done: false } : { value: undefined, done: true }) }; } },
});

test('defaults the folder from CLAUDE_DECK_HOME', () => {
  vi.stubEnv('CLAUDE_DECK_HOME', dir);
  assert.equal(new DeckClient().dir, dir);
  vi.stubEnv('CLAUDE_DECK_HOME', '');
  assert.equal(new DeckClient().dir, path.join(os.homedir(), '.claude-deck'));
});

test('config and dashboardUrl', () => {
  const c = new DeckClient({ dir });
  assert.equal(c.config(), null);
  assert.equal(c.dashboardUrl(), '');
  writeConfig({ port: 4800, viewToken: 'a b' });
  assert.deepEqual(c.config(), { base: 'http://127.0.0.1:4800', key: 'a b' });
  assert.equal(c.dashboardUrl(), 'http://localhost:4800/?key=a%20b');
  writeConfig({});
  assert.deepEqual(c.config(), { base: 'http://127.0.0.1:4777', key: '' });
});

test('handle parses state events and ignores everything else', () => {
  const c = new DeckClient({ dir });
  const states = [];
  const errors = [];
  c.on('state', (s) => states.push(s));
  c.on('error', (e) => errors.push(e));
  c.handle('event: ping\ndata: {}');
  c.handle('event: state');
  c.handle('data: {"sessions":[1]}'); // default event "message"
  assert.equal(states.length, 0);
  c.handle('retry: 3000\nevent: state\ndata: {"sessions":[{"id":"a"}]}');
  assert.deepEqual(c.sessions, [{ id: 'a' }]);
  c.handle('event: state\ndata: {"nope":1}');
  assert.deepEqual(c.sessions, []);
  c.handle('event: state\ndata: {broken');
  assert.equal(states.length, 2);
  assert.equal(errors.length, 1);
});

test('setConnected emits only on change and keeps the last error', () => {
  const c = new DeckClient({ dir });
  const seen = [];
  c.on('connection', (v, e) => seen.push([v, e]));
  c.setConnected(false, 'x');
  assert.deepEqual(seen, []);
  assert.equal(c.lastError, 'x');
  c.setConnected(true);
  c.setConnected(true);
  assert.equal(c.lastError, '');
  c.setConnected(false, 'down');
  assert.deepEqual(seen, [[true, ''], [false, 'down']]);
});

test('stream reads SSE blocks across chunk borders, then reports the end', async () => {
  writeConfig({ port: 1, viewToken: 'k' });
  const fetchMock = vi.fn(async () => streamResponse(['event: state\ndata: {"sessions":[{"id":"a"}', ']}\n\nevent: ping\ndata: {}\n\n']));
  vi.stubGlobal('fetch', fetchMock);
  const c = new DeckClient({ dir });
  const states = [];
  c.on('state', (s) => states.push(s));
  await assert.rejects(c.stream(), /Stream beendet/);
  assert.equal(fetchMock.mock.calls[0][0], 'http://127.0.0.1:1/api/stream?key=k');
  assert.equal(c.connected, true);
  assert.deepEqual(states, [[{ id: 'a' }]]);
});

test('stream fails without config or on HTTP errors', async () => {
  const c = new DeckClient({ dir });
  await assert.rejects(c.stream(), /config\.json missing/);
  writeConfig({ port: 1 });
  vi.stubGlobal('fetch', vi.fn(async () => streamResponse([], false, 401)));
  await assert.rejects(c.stream(), /HTTP 401/);
});

test('loop reconnects with backoff and stop() ends it', async () => {
  vi.useFakeTimers();
  const c = new DeckClient({ dir });
  let calls = 0;
  c.stream = vi.fn(async () => { calls += 1; if (calls === 3) c.stop(); throw new Error(`fail ${calls}`); });
  const done = c.loop();
  await vi.advanceTimersByTimeAsync(1000);
  assert.equal(calls, 2);
  assert.equal(c.lastError, 'fail 2');
  await vi.advanceTimersByTimeAsync(2000);
  await done;
  assert.equal(calls, 3);
  assert.equal(c.stopped, true);
});

test('a stream that ends cleanly resets the backoff; start() runs the loop', async () => {
  vi.useFakeTimers();
  const c = new DeckClient({ dir });
  let calls = 0;
  c.stream = vi.fn(async () => { calls += 1; if (calls >= 2) c.stop(); });
  c.start();
  assert.equal(c.stopped, false);
  await vi.advanceTimersByTimeAsync(1000);
  assert.equal(calls, 2);
  c.ctrl = { abort: vi.fn() };
  c.stop();
  assert.equal(c.ctrl.abort.mock.calls.length, 1);
});

test('post, focus and ack', async () => {
  const c = new DeckClient({ dir });
  await assert.rejects(c.post('/api/x', {}), /configuration missing/);
  writeConfig({ port: 2, viewToken: 'v' });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '{"ok":true,"reason":"iterm"}' })
    .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' })
    .mockResolvedValueOnce({ ok: false, status: 409, text: async () => '{"ok":false,"reason":"tab-closed"}' })
    .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'oops' });
  vi.stubGlobal('fetch', fetchMock);
  assert.deepEqual(await c.focus('s1'), { ok: true, reason: 'iterm' });
  const [url, init] = fetchMock.mock.calls[0];
  assert.equal(url, 'http://127.0.0.1:2/api/focus?key=v');
  assert.equal(init.method, 'POST');
  assert.deepEqual(JSON.parse(init.body), { id: 's1' });
  assert.deepEqual(await c.ack('s1'), {});
  assert.deepEqual(JSON.parse(fetchMock.mock.calls[1][1].body), { id: 's1', acked: true });
  assert.deepEqual(await c.focus('s2'), { ok: false, reason: 'tab-closed' }); // server answer is passed through
  await assert.rejects(c.ack('s3', false), /HTTP 500/);
});
