import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'vitest';
import { EVENTS, HOOK, isOurs, patch, run, settingsFiles } from '../scripts/install-hooks.mjs';

let home;
beforeEach(() => { home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deck-home-'))); });
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const write = (rel, data) => { const f = path.join(home, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(data)); return f; };
const read = (rel) => JSON.parse(fs.readFileSync(path.join(home, rel), 'utf8'));
const H = '/repo/claude-deck/hook/claude-deck-hook.sh';
const silent = () => { const lines = []; const log = (l) => lines.push(l); log.lines = lines; return log; };

test('HOOK points at the shell wrapper of this checkout', () => {
  assert.ok(HOOK.endsWith(path.join('hook', 'claude-deck-hook.sh')));
  assert.ok(fs.existsSync(HOOK));
});

test('isOurs recognises current and legacy entries only', () => {
  assert.equal(isOurs({ command: '"/a/claude-deck/hook/claude-deck-hook.sh"' }), true);
  assert.equal(isOurs({ command: '/a/claude-tower/hook/tower-hook.sh' }), true);
  assert.equal(isOurs({ command: 'telegram-notify' }), false);
  assert.equal(isOurs(undefined), false);
});

test('patch adds the hook to every event and keeps foreign hooks', () => {
  const foreign = { matcher: '', hooks: [{ type: 'command', command: 'telegram-notify' }] };
  const settings = { hooks: { Stop: [foreign] } };
  const changes = patch(settings, { hook: H });
  assert.deepEqual(changes, EVENTS.map((e) => `+ ${e}`));
  assert.equal(settings.hooks.Stop.length, 2);
  assert.deepEqual(settings.hooks.Stop[0], foreign);
  assert.deepEqual(settings.hooks.SessionStart[0].hooks[0], { type: 'command', command: '"' + H + '"', timeout: 5 });
  assert.deepEqual(patch(settings, { hook: H }), []); // idempotent
});

test('patch rewrites legacy and moved entries to the current hook', () => {
  const settings = { hooks: {} };
  patch(settings, { hook: '/old/claude-deck/hook/claude-deck-hook.sh' });
  settings.hooks.Stop = [{ hooks: [{ command: '/x/claude-tower/hook/tower-hook.sh' }, { command: 'other' }] }, { matcher: 'x' }];
  const changes = patch(settings, { hook: '/new/claude-deck/hook/claude-deck-hook.sh' });
  assert.deepEqual(changes, EVENTS.map((e) => `~ ${e}`));
  assert.equal(settings.hooks.Stop[0].hooks[0].command, '"/new/claude-deck/hook/claude-deck-hook.sh"');
  assert.equal(settings.hooks.Stop[0].hooks[1].command, 'other');
});

test('patch --uninstall removes only our entries and drops empty events', () => {
  const settings = {};
  patch(settings, { hook: '/a/claude-deck/hook/claude-deck-hook.sh' });
  settings.hooks.Stop.push({ matcher: '', hooks: [{ command: 'telegram-notify' }] });
  settings.hooks.Stop[0].hooks.push({ command: 'gstack' });
  settings.hooks.Notification.push({ matcher: 'x' }); // entry without hooks array
  const changes = patch(settings, { uninstall: true });
  assert.deepEqual(changes, EVENTS.map((e) => `- ${e}`));
  assert.deepEqual(settings.hooks.Stop, [{ matcher: '', hooks: [{ command: 'gstack' }] }, { matcher: '', hooks: [{ command: 'telegram-notify' }] }]);
  assert.equal(settings.hooks.SessionStart, undefined);
  assert.deepEqual(patch(settings, { uninstall: true }), []);
});

test('settingsFiles finds every profile once, resolving symlinks', () => {
  assert.equal(settingsFiles(home).size, 0); // no profiles at all
  const main = write('.claude/settings.json', {});
  write('.claude-profiles/planni/settings.json', {});
  fs.mkdirSync(path.join(home, '.claude-profiles', 'belege'));
  fs.symlinkSync(main, path.join(home, '.claude-profiles', 'belege', 'settings.json'));
  fs.mkdirSync(path.join(home, '.claude-profiles', 'empty'));
  const files = settingsFiles(home);
  assert.equal(files.size, 2);
  assert.deepEqual(files.get(main), ['~/.claude/settings.json', '~/.claude-profiles/belege/settings.json']);
});

test('run: dry run changes nothing, --apply writes with backup, --uninstall removes', () => {
  write('.claude/settings.json', { theme: 'dark' });
  write('.claude-profiles/planni/settings.json', { hooks: {} });
  const now = new Date('2026-11-03T09:10:11Z');

  const dry = silent();
  assert.equal(run({ argv: [], home, hook: H, log: dry, now }), 10);
  assert.deepEqual(read('.claude/settings.json'), { theme: 'dark' });
  assert.match(dry.lines.at(-1), /Dry run\. Add --apply to write\./);

  const applied = silent();
  assert.equal(run({ argv: ['--apply'], home, hook: H, log: applied, now }), 10);
  assert.equal(read('.claude/settings.json').hooks.Stop[0].hooks[0].command, '"' + H + '"');
  assert.ok(fs.existsSync(path.join(home, '.claude', 'settings.json.bak-20261103-091011-deck')));
  assert.match(applied.lines.at(-1), /New hooks apply/);

  const again = silent();
  assert.equal(run({ argv: ['--apply'], home, hook: H, log: again, now }), 0);
  assert.ok(again.lines.includes('   ok, nothing to do'));

  const dryRemove = silent();
  run({ argv: ['--uninstall'], home, hook: H, log: dryRemove, now });
  assert.match(dryRemove.lines.at(-1), /\(remove\)/);

  const removed = silent();
  assert.equal(run({ argv: ['--uninstall', '--apply'], home, log: removed, now }), 10);
  assert.deepEqual(read('.claude/settings.json'), { theme: 'dark', hooks: {} });
  assert.match(removed.lines.at(-1), /written/);
});

test('run labels symlinked profiles with their real file', () => {
  const real = write('shared/settings.json', {});
  fs.mkdirSync(path.join(home, '.claude'));
  fs.symlinkSync(real, path.join(home, '.claude', 'settings.json'));
  const log = silent();
  run({ argv: [], home, hook: H, log });
  assert.equal(log.lines[0], '~/.claude/settings.json  (-> ~/shared/settings.json)');
});
