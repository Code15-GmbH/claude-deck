import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const cp = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => cp);
const { focusSession } = await import('../server/focus.mjs');

/** Next osascript call answers with (err, stdout, stderr). */
const answer = (err, stdout = '', stderr = '') => cp.execFile.mockImplementationOnce((cmd, args, opts, cb) => cb(err, stdout, stderr));
beforeEach(() => cp.execFile.mockReset());

test('unknown session', async () => {
  assert.deepEqual(await focusSession(null), { ok: false, reason: 'unknown-session' });
});

test('iTerm2 session: selects it by unique id', async () => {
  answer(null, 'ok\n');
  assert.deepEqual(await focusSession({ term: { itermSession: 'UUID-1' } }), { ok: true, reason: 'iterm' });
  const [cmd, args, opts] = cp.execFile.mock.calls[0];
  assert.equal(cmd, 'osascript');
  assert.equal(args[0], '-e');
  assert.match(args[1], /unique id of s is wanted/);
  assert.equal(args[2], 'UUID-1');
  assert.equal(opts.timeout, 4000);
});

test('iTerm2 answers are mapped to reasons', async () => {
  const s = { term: { itermSession: 'U' } };
  answer(null, 'not-found');
  assert.deepEqual(await focusSession(s), { ok: false, reason: 'tab-closed' });
  answer(null, 'not-running');
  assert.deepEqual(await focusSession(s), { ok: false, reason: 'iterm-not-running' });
  answer(new Error('exec failed'), '', 'not allowed to send Apple events');
  assert.deepEqual(await focusSession(s), { ok: false, reason: 'not allowed to send Apple events' });
  answer(new Error('timeout'));
  assert.deepEqual(await focusSession(s), { ok: false, reason: 'timeout' });
  answer(null, 'something else');
  assert.deepEqual(await focusSession(s), { ok: false, reason: 'osascript-failed' });
});

test('other terminals only get their app activated', async () => {
  answer(null, '');
  assert.deepEqual(await focusSession({ term: { program: 'Apple_Terminal' } }), { ok: true, reason: 'app-only' });
  assert.equal(cp.execFile.mock.calls[0][1][1], 'tell application "Terminal" to activate');
  answer(null, '');
  await focusSession({ term: { program: 'vscode', cursor: true } });
  assert.equal(cp.execFile.mock.calls[1][1][1], 'tell application "Cursor" to activate');
  answer(new Error('x'), '', 'no app');
  assert.deepEqual(await focusSession({ term: { program: 'ghostty' } }), { ok: false, reason: 'no app' });
  answer(null, null, null);
  answer(new Error(''), null, null);
  assert.deepEqual(await focusSession({ term: { program: 'WarpTerminal' } }), { ok: true, reason: 'app-only' });
  assert.deepEqual(await focusSession({ term: { program: 'WarpTerminal' } }), { ok: false, reason: 'osascript-failed' });
});

test('no terminal info', async () => {
  assert.deepEqual(await focusSession({ term: { program: 'tmux' } }), { ok: false, reason: 'no-terminal-info' });
  assert.deepEqual(await focusSession({}), { ok: false, reason: 'no-terminal-info' });
  assert.equal(cp.execFile.mock.calls.length, 0);
});
