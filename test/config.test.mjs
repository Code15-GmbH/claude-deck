import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test, vi } from 'vitest';

let dir;
// config.mjs reads CLAUDE_DECK_HOME at import time, so every test imports a fresh copy.
const load = async () => { vi.resetModules(); return import('../server/config.mjs'); };
beforeEach(() => {
  dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'deck-config-')), 'home');
  vi.stubEnv('CLAUDE_DECK_HOME', dir);
});
afterEach(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }));

test('paths follow CLAUDE_DECK_HOME', async () => {
  const c = await load();
  assert.equal(c.DIR, dir);
  assert.equal(c.CONFIG, path.join(dir, 'config.json'));
  assert.equal(c.STATE, path.join(dir, 'state.json'));
});

test('paths default to ~/.claude-deck', async () => {
  vi.stubEnv('CLAUDE_DECK_HOME', '');
  const c = await load();
  assert.equal(c.DIR, path.join(os.homedir(), '.claude-deck'));
});

test('readConfig returns null without a file', async () => {
  const c = await load();
  assert.equal(c.readConfig(), null);
});

test('loadOrCreateConfig creates a private config with fresh tokens once', async () => {
  const c = await load();
  const cfg = c.loadOrCreateConfig();
  assert.equal(cfg.port, 4777);
  assert.equal(cfg.host, '0.0.0.0');
  assert.match(cfg.ingestToken, /^[A-Za-z0-9_-]{32}$/);
  assert.match(cfg.viewToken, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(fs.statSync(c.CONFIG).mode & 0o777, 0o600);
  assert.deepEqual(c.readConfig(), cfg);
  const mtime = fs.statSync(c.CONFIG).mtimeMs;
  assert.deepEqual(c.loadOrCreateConfig(), cfg); // stable, not rewritten
  assert.equal(fs.statSync(c.CONFIG).mtimeMs, mtime);
});

test('loadOrCreateConfig keeps existing values and fills in missing ones', async () => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ port: 5000, viewToken: 'mine' }));
  const c = await load();
  const cfg = c.loadOrCreateConfig();
  assert.equal(cfg.port, 5000);
  assert.equal(cfg.viewToken, 'mine');
  assert.ok(cfg.ingestToken);
  assert.equal(c.readConfig().ingestToken, cfg.ingestToken);
});

test('lanAddresses lists external IPv4 addresses only', async () => {
  vi.spyOn(os, 'networkInterfaces').mockReturnValue({
    lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    en0: [{ family: 'IPv6', internal: false, address: 'fe80::1' }, { family: 'IPv4', internal: false, address: '192.168.1.5' }],
    utun: undefined,
  });
  const c = await load();
  assert.deepEqual(c.lanAddresses(), ['192.168.1.5']);
});
