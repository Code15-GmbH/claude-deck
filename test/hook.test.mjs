import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test, vi } from 'vitest';
import * as H from '../hook/hook-lib.mjs';

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-hook-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const sink = () => { const out = { text: '', write: (s) => { out.text += s; } }; return out; };
const okFetch = () => vi.fn(async () => ({ ok: true, status: 204 }));

test('deckDir and clip', () => {
  assert.equal(H.deckDir({ CLAUDE_DECK_HOME: '/x' }), '/x');
  assert.equal(H.deckDir({}), path.join(os.homedir(), '.claude-deck'));
  assert.equal(H.clip('  a \n b  ', 10), 'a b');
  assert.equal(H.clip('abcdef', 4), 'abc…');
  assert.equal(H.clip(undefined, 4), '');
});

test('profile comes from CLAUDE_CONFIG_DIR, else the transcript path, else main', () => {
  assert.equal(H.profile('', { CLAUDE_CONFIG_DIR: '/Users/n/.claude-profiles/planni' }), 'planni');
  assert.equal(H.profile('/Users/n/.claude-profiles/code15-belege/projects/x.jsonl', {}), 'code15-belege');
  assert.equal(H.profile('/Users/n/.claude/projects/x.jsonl', {}), 'main');
  assert.equal(H.profile(undefined, {}), 'main');
});

test('claudeProcess walks up to the claude process', () => {
  const table = { 10: '9 ttys001 /bin/zsh', 9: '8 ttys004 /usr/local/bin/claude' };
  const exec = vi.fn((cmd, args) => Buffer.from(table[args.at(-1)]));
  assert.deepEqual(H.claudeProcess(10, exec), { pid: 9, tty: 'ttys004' });
  assert.equal(exec.mock.calls[0][0], 'ps');
  assert.deepEqual(H.claudeProcess(5, () => Buffer.from('1 ?? claude')), { pid: 5, tty: '' });
  assert.deepEqual(H.claudeProcess(5, () => { throw new Error('ps failed'); }), { pid: null, tty: '' });
  assert.deepEqual(H.claudeProcess(5, () => Buffer.from('1 ttys1 node')), { pid: null, tty: '' }); // reached launchd
  assert.deepEqual(H.claudeProcess(1, exec), { pid: null, tty: '' });
  let depth = 100;
  assert.deepEqual(H.claudeProcess(100, () => Buffer.from(`${--depth} ttys1 sh`)), { pid: null, tty: '' }); // gives up after 5
});

test('aiTitle reads the last ai-title line of the transcript', () => {
  const f = path.join(dir, 't.jsonl');
  assert.equal(H.aiTitle(''), '');
  assert.equal(H.aiTitle(f), ''); // missing file
  fs.writeFileSync(f, '{"type":"user"}\n');
  assert.equal(H.aiTitle(f), '');
  fs.writeFileSync(f, '{"type":"ai-title","aiTitle":"Alt"}\n{"type":"user"}\n{"type":"ai-title","aiTitle":"Neu"}\n{"type":"user"}\n');
  assert.equal(H.aiTitle(f), 'Neu');
  fs.writeFileSync(f, '{"type":"ai-title","aiTitle":"Ohne Zeilenende"}');
  assert.equal(H.aiTitle(f), 'Ohne Zeilenende');
  fs.writeFileSync(f, '{"type":"ai-title"}');
  assert.equal(H.aiTitle(f), '');
  fs.writeFileSync(f, '{"type":"ai-title", broken');
  assert.equal(H.aiTitle(f), '');
});

test('target: env URL wins, else the local config', () => {
  assert.deepEqual(H.target({ CLAUDE_DECK_URL: 'http://pi:1/', CLAUDE_DECK_TOKEN: 't' }), { url: 'http://pi:1/api/event', token: 't' });
  assert.deepEqual(H.target({ CLAUDE_DECK_URL: 'http://pi:1' }), { url: 'http://pi:1/api/event', token: '' });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ port: 4800, ingestToken: 'in' }));
  assert.deepEqual(H.target({ CLAUDE_DECK_HOME: dir }), { url: 'http://127.0.0.1:4800/api/event', token: 'in' });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ ingestToken: 'in' }));
  assert.equal(H.target({ CLAUDE_DECK_HOME: dir }).url, 'http://127.0.0.1:4777/api/event');
});

test('buildEvent maps every hook event', () => {
  const env = { TERM_PROGRAM: 'iTerm.app', ITERM_SESSION_ID: 'w0t0p0:UUID-1', TMUX_PANE: '%1', CURSOR_TRACE_ID: '' };
  const opts = { proc: { pid: 9, tty: 'ttys004' }, env, now: 123, cwd: '/fallback' };
  assert.equal(H.buildEvent(null, opts), null);
  assert.equal(H.buildEvent({ hook_event_name: 'Stop' }, opts), null);
  const base = { session_id: 's', cwd: '/p/x', transcript_path: '' };
  const prompt = H.buildEvent({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'x'.repeat(500) }, opts);
  assert.equal(prompt.v, 1);
  assert.equal(prompt.ts, 123);
  assert.equal(prompt.cwd, '/p/x');
  assert.equal(prompt.pid, 9);
  assert.deepEqual(prompt.term, { program: 'iTerm.app', cursor: false, itermSession: 'UUID-1', tty: 'ttys004', tmux: '%1' });
  assert.equal(prompt.prompt.length, 400);
  const stop = H.buildEvent({ ...base, hook_event_name: 'Stop', last_assistant_message: 'fertig' }, opts);
  assert.equal(stop.lastMessage, 'fertig');
  const note = H.buildEvent({ ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'm' }, opts);
  assert.equal(note.notificationType, 'permission_prompt');
  assert.equal(note.message, 'm');
  assert.equal(note.title, '');
  assert.equal(H.buildEvent({ ...base, hook_event_name: 'Notification' }, opts).notificationType, '');
  assert.equal(H.buildEvent({ ...base, hook_event_name: 'SessionStart', source: 'clear' }, opts).source, 'clear');
  assert.equal(H.buildEvent({ ...base, hook_event_name: 'SessionStart' }, opts).source, '');
  assert.equal(H.buildEvent({ ...base, hook_event_name: 'SessionEnd', reason: 'logout' }, opts).reason, 'logout');
  assert.equal(H.buildEvent({ ...base, hook_event_name: 'SessionEnd' }, opts).reason, '');
  const bare = H.buildEvent({ session_id: 's', hook_event_name: 'SessionEnd' }, { env: { CURSOR_TRACE_ID: 'c' }, cwd: '/fallback' });
  assert.equal(bare.cwd, '/fallback');
  assert.equal(bare.pid, null);
  assert.deepEqual(bare.term, { program: '', cursor: true, itermSession: '', tty: '', tmux: '' });
  assert.ok(H.buildEvent({ session_id: 's', hook_event_name: 'SessionEnd' }).ts > 0); // defaults
});

test('main: dry run prints the event and does not post', async () => {
  const out = sink();
  const fetchImpl = okFetch();
  await H.main({ readStdin: () => JSON.stringify({ hook_event_name: 'Stop', session_id: 's' }), env: { CLAUDE_DECK_DRY_RUN: '1' }, out, fetchImpl, proc: { pid: 1, tty: '' } });
  assert.equal(JSON.parse(out.text).event, 'Stop');
  assert.equal(fetchImpl.mock.calls.length, 0);
});

test('main: ignores invalid input', async () => {
  const fetchImpl = okFetch();
  await H.main({ readStdin: () => 'not json', env: {}, fetchImpl });
  await H.main({ readStdin: () => '{}', env: {}, fetchImpl });
  await H.main({ readStdin: () => 'null', env: {}, fetchImpl });
  assert.equal(fetchImpl.mock.calls.length, 0);
});

test('main: posts with the ingest token and logs HTTP errors', async () => {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ port: 4801, ingestToken: 'secret' }));
  const env = { CLAUDE_DECK_HOME: dir };
  const input = () => JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'hi' });
  const fetchImpl = okFetch();
  await H.main({ readStdin: input, env, fetchImpl, proc: { pid: 2, tty: '' } });
  const [url, init] = fetchImpl.mock.calls[0];
  assert.equal(url, 'http://127.0.0.1:4801/api/event');
  assert.equal(init.headers.Authorization, 'Bearer secret');
  assert.equal(JSON.parse(init.body).prompt, 'hi');
  assert.ok(init.signal instanceof AbortSignal);
  await H.main({ readStdin: input, env, fetchImpl: vi.fn(async () => ({ ok: false, status: 401 })), proc: { pid: 2, tty: '' } });
  assert.match(fs.readFileSync(path.join(dir, 'hook-errors.log'), 'utf8'), /UserPromptSubmit: HTTP 401/);
});

test('main: looks up the claude process itself when none is given', async () => {
  const out = sink();
  await H.main({ readStdin: () => JSON.stringify({ hook_event_name: 'Stop', session_id: 's' }), env: { CLAUDE_DECK_DRY_RUN: '1' }, out });
  assert.ok('pid' in JSON.parse(out.text));
});

test('run never throws; only unexpected errors are logged', async () => {
  const env = { CLAUDE_DECK_HOME: dir, CLAUDE_DECK_URL: 'http://x' };
  const input = () => JSON.stringify({ hook_event_name: 'Stop', session_id: 's' });
  const refused = Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  await H.run({ readStdin: input, env, fetchImpl: vi.fn(async () => { throw refused; }), proc: { pid: 1, tty: '' } });
  assert.equal(fs.existsSync(path.join(dir, 'hook-errors.log')), false);
  await H.run({ readStdin: input, env, fetchImpl: vi.fn(async () => { throw new Error('weird'); }), proc: { pid: 1, tty: '' } });
  assert.match(fs.readFileSync(path.join(dir, 'hook-errors.log'), 'utf8'), /weird/);
  await H.run({ readStdin: input, env, fetchImpl: vi.fn(async () => { throw 'plain string'; }), proc: { pid: 1, tty: '' } }); // eslint-disable-line no-throw-literal
  assert.match(fs.readFileSync(path.join(dir, 'hook-errors.log'), 'utf8'), /plain string/);
  assert.equal(H.isQuietError({ message: 'ENOENT: no config' }), true);
  assert.equal(H.isQuietError(undefined), false);
});

test('logError truncates a large log and never throws', () => {
  const f = path.join(dir, 'hook-errors.log');
  fs.writeFileSync(f, 'x'.repeat(300 * 1024));
  H.logError('fresh', dir);
  const text = fs.readFileSync(f, 'utf8');
  assert.ok(text.length < 100 && text.includes('fresh'));
  H.logError('nowhere', path.join(dir, 'missing', 'deeper')); // directory missing: swallowed
});
