// Shared config: ~/.claude-deck/config.json (created on first server start, chmod 600).
//   port         HTTP port of the deck server (default 4777)
//   host         bind address; 0.0.0.0 = reachable from tablet / Raspberry Pi in the LAN
//   ingestToken  secret the hook needs to POST events (never leaves the Mac)
//   viewToken    secret in the dashboard URL (?key=...) — reads the board, can only clear/restore strips
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const DIR = process.env.CLAUDE_DECK_HOME || path.join(os.homedir(), '.claude-deck');
export const CONFIG = path.join(DIR, 'config.json');
export const STATE = path.join(DIR, 'state.json');

export function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return null; }
}

export function loadOrCreateConfig() {
  const existing = readConfig() || {};
  const cfg = {
    port: 4777,
    host: '0.0.0.0',
    ingestToken: crypto.randomBytes(24).toString('base64url'),
    viewToken: crypto.randomBytes(18).toString('base64url'),
    ...existing,
  };
  if (JSON.stringify(cfg) !== JSON.stringify(existing)) {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
    fs.chmodSync(CONFIG, 0o600);
  }
  return cfg;
}

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}
