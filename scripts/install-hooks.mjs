#!/usr/bin/env node
// Adds (or removes) the Claude Deck hook in every Claude profile's settings.json.
//
//   node scripts/install-hooks.mjs              dry run: shows what would change
//   node scripts/install-hooks.mjs --apply      writes it (backup next to each file)
//   node scripts/install-hooks.mjs --uninstall  removes only the claude-deck entries (add --apply)
//
// Profiles: ~/.claude plus every ~/.claude-profiles/<name>. Symlinked settings.json
// (code15-belege -> ~/.claude/settings.json) are resolved, so each real file is
// patched once. Only entries whose command points at claude-deck/hook are touched;
// Telegram, Jev router, AgentDeck and gstack hooks stay exactly as they are.
// AgentDeck's installer and agentdeck-reapply-profile only strip AgentDeck's own
// entries, so the claude-deck hook survives AgentDeck upgrades.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hook', 'claude-deck-hook.sh');
const MARK = 'claude-deck/hook/claude-deck-hook';
const LEGACY = 'claude-tower/hook/tower-hook'; // entries from the old claude-tower repo are replaced
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

const isOurs = (h) => { const c = String(h?.command || ''); return c.includes(MARK) || c.includes(LEGACY); };

function patch(settings) {
  settings.hooks ||= {};
  const changes = [];
  for (const event of EVENTS) {
    const list = settings.hooks[event] || [];
    const has = list.some((m) => (m.hooks || []).some(isOurs));
    if (uninstall) {
      if (!has) continue;
      const next = list.map((m) => ({ ...m, hooks: (m.hooks || []).filter((h) => !isOurs(h)) })).filter((m) => m.hooks.length);
      if (next.length) settings.hooks[event] = next; else delete settings.hooks[event];
      changes.push(`- ${event}`);
    } else if (!has) {
      list.push({ matcher: '', hooks: [{ type: 'command', command: `"${HOOK}"`, timeout: 5 }] });
      settings.hooks[event] = list;
      changes.push(`+ ${event}`);
    } else {
      // entries from the old claude-tower repo (or a moved checkout) point at the current hook
      let moved = false;
      for (const m of list) for (const h of m.hooks || []) {
        if (isOurs(h) && h.command !== `"${HOOK}"`) { h.command = `"${HOOK}"`; moved = true; }
      }
      if (moved) changes.push(`~ ${event}`);
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
  if (!changes.length) { console.log('   ok, nothing to do'); continue; }
  console.log('   ' + changes.join('  '));
  total += changes.length;
  if (apply) {
    fs.copyFileSync(real, `${real}.bak-${stamp}-deck`);
    fs.writeFileSync(real, JSON.stringify(settings, null, 2) + '\n');
    console.log(`   written (backup: ${path.basename(real)}.bak-${stamp}-deck)`);
  }
}
if (!apply && total) console.log(`\nDry run. Add --apply to write${uninstall ? " (remove)" : ""}.`);
if (apply && total && !uninstall) console.log('\nNew hooks apply to newly started Claude sessions (for running ones open /hooks or restart them).');
