#!/usr/bin/env node
// Plays fake Claude sessions against the running deck server (for testing the board).
//
//   node scripts/simulate.mjs          ~40 s story: sessions start, work, finish one by one
//   node scripts/simulate.mjs --fast   jump straight to a filled board
//   node scripts/simulate.mjs --end    close all simulated sessions again
//
// One simulated session borrows the iTerm session this script runs in, so its strip
// shows the real desktop of this terminal window.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cfg = JSON.parse(fs.readFileSync(path.join(process.env.CLAUDE_DECK_HOME || path.join(os.homedir(), '.claude-deck'), 'config.json'), 'utf8'));
const URL_ = `http://127.0.0.1:${cfg.port}/api/event`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const myIterm = (process.env.ITERM_SESSION_ID || '').split(':')[1] || '';

const S = [
  { id: 'sim-1', profile: 'main', cwd: '/Users/demo/Projects/figoca', title: 'Recent Sales Modal mit Hover-Icon', prompt: 'Bau im Sales-Modal ein Hover-Icon für die Rohdaten ein', last: 'Hover-Icon eingebaut, Tests laufen grün (vitest run, 42 passed).', term: { program: 'iTerm.app', itermSession: myIterm } },
  { id: 'sim-2', profile: 'code15-belege', cwd: '/Users/demo/Projects/code15', title: 'Belege März zuordnen', prompt: 'Ordne die Belege aus dem März den Buchungen zu', last: '17 von 19 Belegen zugeordnet, 2 brauchen deine Entscheidung.', term: { program: 'iTerm.app', tty: 'ttys004' } },
  { id: 'sim-3', profile: 'planni', cwd: '/Users/demo/Projects/planni', title: 'Wochenplanung Sync-Fehler', prompt: 'Warum schlägt der Kalender-Sync seit gestern fehl?', last: '', term: { program: 'iTerm.app', tty: 'ttys011' } },
  { id: 'sim-4', profile: 'main', cwd: '/Users/demo/Projects/kraftwerb', title: 'Vorderseite Slogan und Logos', prompt: 'Setz den neuen Slogan auf die Vorderseite und tausch die Logos', last: 'Slogan gesetzt, Logos als SVG eingebunden, Vorschau im Browser geprüft.', term: { program: 'vscode', cursor: true } },
  { id: 'sim-5', profile: 'main', cwd: '/Users/demo/Projects/company-ki', title: 'Landingpage KI Workflows', prompt: 'Schreib die Hero-Section der Landingpage neu', last: 'Hero-Section neu geschrieben, drei Varianten im PR beschrieben.', term: { program: 'iTerm.app', tty: 'ttys019' } },
];

async function post(s, event, extra = {}) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.ingestToken}` },
    body: JSON.stringify({ v: 1, event, ts: Date.now(), sessionId: s.id, cwd: s.cwd, profile: s.profile, term: s.term, title: s.title, ...extra }),
  });
  if (!res.ok && res.status !== 204) throw new Error(`${event} ${s.id}: HTTP ${res.status}`);
  console.log(`${new Date().toLocaleTimeString('de-DE')}  ${s.id}  ${event}`);
}
const prompt = (s) => post(s, 'UserPromptSubmit', { prompt: s.prompt });
const stop = (s) => post(s, 'Stop', { lastMessage: s.last });

if (process.argv.includes('--end')) {
  for (const s of S) await post(s, 'SessionEnd', { reason: 'other' });
} else if (process.argv.includes('--fast')) {
  for (const s of S) { await post(s, 'SessionStart', { source: 'startup' }); await prompt(s); }
  await stop(S[4]); await sleep(50); await stop(S[3]); await sleep(50);
  await post(S[1], 'Notification', { notificationType: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  await sleep(50); await stop(S[0]);
} else {
  for (const s of S) { await post(s, 'SessionStart', { source: 'startup' }); await sleep(400); }
  for (const s of S) { await prompt(s); await sleep(700); }
  await sleep(5000); await stop(S[4]);
  await sleep(6000); await stop(S[3]);
  await sleep(6000); await post(S[1], 'Notification', { notificationType: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  await sleep(6000); await stop(S[0]);
  await sleep(6000); await prompt(S[4]); // you answered sim-5 -> back to work
  await sleep(6000); await stop(S[1]);
}
