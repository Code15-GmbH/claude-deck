#!/usr/bin/env node
// Adds (or removes) the Claude Tower hook in every Claude profile's settings.json.
//
//   node scripts/install-hooks.mjs              dry run: shows what would change
//   node scripts/install-hooks.mjs --apply      writes it (backup next to each file)
//   node scripts/install-hooks.mjs --uninstall  removes only the tower entries (add --apply)
//
// Profiles: ~/.claude plus every ~/.claude-profiles/<name>. Symlinked settings.json
// (code15-belege -> ~/.claude/settings.json) are resolved, so each real file is
// patched once. Only entries whose command points at claude-tower/hook are touched;
// Telegram, Jev router, AgentDeck and gstack hooks stay exactly as they are.
// AgentDeck's installer and agentdeck-reapply-profile only strip AgentDeck's own
// entries, so the tower hook survives AgentDeck upgrades.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hook', 'tower-hook.sh');
const MARK = 'claude-tower/hook/tower-hook';
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'Stop', 'Notification', 'SessionEnd'];
const apply = process.argv.includes('--apply');
const uninstall = process.argv.includes('--uninstall');

function settingsFiles() {
  const candidates = [path.join(HOME, '.claude', 'settings.json')];
  const profiles = path.join(HOME, '.claude-profiles');
  try { for (const name of fs.readdirSync(profiles)) candidates.push(path.join(profiles, name, 'settings.json')); } catch {}
  const seen = new Map();
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const real = fs.realpathSync(file);
    if (!seen.has(real)) seen.set(real, []);
    seen.get(real).push(file.replace(HOME, '~'));
  }
  return seen;
}

const isTower = (h) => String(h?.command || '').includes(MARK);

function patch(settings) {
  settings.hooks ||= {};
  const changes = [];
  for (const event of EVENTS) {
    const list = settings.hooks[event] || [];
    const has = list.some((m) => (m.hooks || []).some(isTower));
    if (uninstall) {
      if (!has) continue;
      const next = list.map((m) => ({ ...m, hooks: (m.hooks || []).filter((h) => !isTower(h)) })).filter((m) => m.hooks.length);
      if (next.length) settings.hooks[event] = next; else delete settings.hooks[event];
      changes.push(`- ${event}`);
    } else if (!has) {
      list.push({ matcher: '', hooks: [{ type: 'command', command: `"${HOOK}"`, timeout: 5 }] });
      settings.hooks[event] = list;
      changes.push(`+ ${event}`);
    }
  }
  return changes;
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
let total = 0;
for (const [real, names] of settingsFiles()) {
  const raw = fs.readFileSync(real, 'utf8');
  const settings = JSON.parse(raw);
  const changes = patch(settings);
  console.log(`${names.join(' + ')}${names.length > 1 || names[0] !== real.replace(HOME, '~') ? `  (-> ${real.replace(HOME, '~')})` : ''}`);
  if (!changes.length) { console.log('   ok, nichts zu tun'); continue; }
  console.log('   ' + changes.join('  '));
  total += changes.length;
  if (apply) {
    fs.copyFileSync(real, `${real}.bak-${stamp}-tower`);
    fs.writeFileSync(real, JSON.stringify(settings, null, 2) + '\n');
    console.log(`   geschrieben (Backup: ${path.basename(real)}.bak-${stamp}-tower)`);
  }
}
if (!apply && total) console.log(`\nTrockenlauf. Mit --apply schreiben${uninstall ? ' (Entfernen)' : ''}.`);
if (apply && total && !uninstall) console.log('\nNeue Hooks greifen in neu gestarteten Claude-Sessions (laufende Sessions ggf. /hooks öffnen oder neu starten).');
