import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, test, vi } from 'vitest';

const cp = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => cp);

const HELPER = path.resolve(import.meta.dirname, '..', '.bin', 'spaces');
const SWIFT = path.resolve(import.meta.dirname, '..', 'server', 'spaces.swift');

// Every execFile call is routed by command: osascript (iTerm list), swiftc (build), the helper (spaces).
let replies;
beforeEach(() => {
  replies = { osascript: '', swiftc: '', helper: '{"windows":{},"current":[]}' };
  cp.execFile.mockReset();
});
/** Fresh module (the helper build is memoised per module instance). */
const load = async ({ helperExists = true, helperFresh = true, builds = true } = {}) => {
  let built = false;
  vi.spyOn(fs, 'existsSync').mockImplementation((p) => (p === HELPER ? helperExists || (builds && built) : true));
  vi.spyOn(fs, 'statSync').mockImplementation((p) => ({ mtimeMs: p === HELPER ? (helperFresh ? 2 : 0) : 1 }));
  vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
  cp.execFile.mockImplementation((cmd, args, opts, cb) => {
    if (cmd === 'swiftc') built = true;
    const key = cmd === HELPER ? 'helper' : cmd;
    const r = replies[key];
    if (r instanceof Error) cb(r, ''); else cb(null, r);
  });
  vi.resetModules();
  return import('../server/locate.mjs');
};
const calls = (cmd) => cp.execFile.mock.calls.filter((c) => c[0] === cmd);

test('appName maps terminal programs', async () => {
  const { appName } = await load();
  assert.equal(appName({ program: 'iTerm.app' }), 'iTerm');
  assert.equal(appName({ program: 'vscode', cursor: true }), 'Cursor');
  assert.equal(appName({ program: 'Alacritty' }), 'Alacritty');
  assert.equal(appName(undefined), '');
});

test('ensureHelper: fresh binary is used as is, and only checked once', async () => {
  const { ensureHelper } = await load();
  assert.equal(await ensureHelper(), true);
  assert.equal(await ensureHelper(), true);
  assert.equal(calls('swiftc').length, 0);
});

test('ensureHelper: stale or missing binary is compiled with swiftc', async () => {
  const { ensureHelper } = await load({ helperFresh: false });
  assert.equal(await ensureHelper(), true);
  const [, args, opts] = calls('swiftc')[0];
  assert.deepEqual(args, ['-O', SWIFT, '-o', HELPER]);
  assert.equal(opts.timeout, 120000);
});

test('ensureHelper: no swiftc means no desktop detection', async () => {
  const { ensureHelper } = await load({ helperExists: false, builds: false });
  assert.equal(await ensureHelper(), false);
});

test('ensureHelper: file system errors count as unavailable', async () => {
  const mod = await load();
  fs.statSync.mockImplementation(() => { throw new Error('EACCES'); });
  assert.equal(await mod.ensureHelper(), false);
});

test('locateAll resolves iTerm window, tab, tty and desktop', async () => {
  const { locateAll } = await load();
  replies.osascript = '11\t2\tUUID-A\t/dev/ttys004\t  Projekt  \n12\t1\tUUID-B\t/dev/ttys009\t\n\n';
  replies.helper = JSON.stringify({ windows: { 11: 'Desktop 5 · Display 2' }, current: ['Desktop 1'] });
  const sessions = [
    { id: 'a', term: { program: 'iTerm.app', itermSession: 'UUID-A', tty: 'old' } },
    { id: 'b', term: { program: 'iTerm.app', itermSession: 'UUID-B' } },
    { id: 'gone', term: { program: 'iTerm.app', itermSession: 'UUID-X' } },
    { id: 'cursor', term: { program: 'vscode', cursor: true, tty: 'ttys1' } },
    { id: 'bare' },
  ];
  const { locations, currentDesktop } = await locateAll(sessions);
  assert.deepEqual(locations.get('a'), { app: 'iTerm', tty: 'ttys004', tab: 2, windowId: 11, windowTitle: 'Projekt', desktop: 'Desktop 5 · Display 2' });
  assert.deepEqual(locations.get('b'), { app: 'iTerm', tty: 'ttys009', tab: 1, windowId: 12, windowTitle: '', desktop: '' });
  assert.deepEqual(locations.get('gone'), { app: 'iTerm', tty: '', gone: true });
  assert.deepEqual(locations.get('cursor'), { app: 'Cursor', tty: 'ttys1' });
  assert.deepEqual(locations.get('bare'), { app: '', tty: '' });
  assert.deepEqual(currentDesktop, ['Desktop 1']);
  assert.deepEqual(calls(HELPER)[0][1], ['11', '12']);
});

test('locateAll: iTerm not answering means unknown, not closed', async () => {
  const { locateAll } = await load();
  replies.osascript = new Error('iTerm not running');
  const { locations, currentDesktop } = await locateAll([{ id: 'a', term: { program: 'iTerm.app', itermSession: 'U' } }]);
  assert.deepEqual(locations.get('a'), { app: 'iTerm', tty: '' });
  assert.deepEqual(currentDesktop, []);
  assert.equal(calls(HELPER).length, 0); // no windows, no helper call
});

test('locateAll: hit without tty keeps the hook tty; broken helper output is ignored', async () => {
  const { locateAll } = await load();
  replies.osascript = '7\t1\tU\t\tWin\n';
  replies.helper = 'not json';
  const { locations, currentDesktop } = await locateAll([{ id: 'a', term: { itermSession: 'U', tty: 'ttys2' } }]);
  assert.equal(locations.get('a').tty, 'ttys2');
  assert.equal(locations.get('a').desktop, '');
  assert.deepEqual(currentDesktop, []);
});

test('locateAll: helper without "current" and without the window', async () => {
  const { locateAll } = await load();
  replies.osascript = '7\t1\tU\t/dev/ttys1\tWin\n';
  replies.helper = '{}';
  const { locations, currentDesktop } = await locateAll([{ id: 'a', term: { itermSession: 'U' } }]);
  assert.equal(locations.get('a').desktop, '');
  assert.deepEqual(currentDesktop, []);
});

test('locateAll: no helper available', async () => {
  const { locateAll } = await load({ helperExists: false, builds: false });
  replies.osascript = '7\t1\tU\t/dev/ttys1\tWin\n';
  const { locations } = await locateAll([{ id: 'a', term: { itermSession: 'U' } }]);
  assert.equal(locations.get('a').desktop, '');
  assert.equal(calls(HELPER).length, 0);
});

test('locateAll: without iTerm sessions no AppleScript runs', async () => {
  const { locateAll } = await load();
  const { locations } = await locateAll([{ id: 'x', term: { program: 'Apple_Terminal' } }]);
  assert.deepEqual(locations.get('x'), { app: 'Terminal', tty: '' });
  assert.equal(calls('osascript').length, 0);
});
