#!/usr/bin/env node
// Claude Code hook -> Claude Deck. Wire it for SessionStart, UserPromptSubmit, Stop,
// Notification and SessionEnd (scripts/install-hooks.mjs does that).
//
// It reads the hook JSON from stdin, adds what only the session process knows
// (profile, claude pid, terminal ids, AI session title) and POSTs it to the deck server
// server. It NEVER blocks Claude: every failure exits 0 silently (errors are logged
// to ~/.claude-deck/hook-errors.log) and the request times out after 1.5 s.
//
// Target: CLAUDE_DECK_URL env, else http://127.0.0.1:<port from ~/.claude-deck/config.json>.
// CLAUDE_DECK_DRY_RUN=1 prints the event instead of sending it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DIR = process.env.CLAUDE_DECK_HOME || path.join(os.homedir(), '.claude-deck');
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const logError = (msg) => {
  try {
    const f = path.join(DIR, 'hook-errors.log');
    if (fs.existsSync(f) && fs.statSync(f).size > 256 * 1024) fs.truncateSync(f, 0);
    fs.appendFileSync(f, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
};

// Which profile? CLAUDE_CONFIG_DIR is set by the claude() shell function for
// ~/.claude-profiles/<name>; unset means the main profile (~/.claude).
function profile(transcript) {
  const dir = process.env.CLAUDE_CONFIG_DIR || '';
  const m = (dir || transcript || '').match(/\.claude-profiles\/([^/]+)/);
  return m ? m[1] : 'main';
}

// The claude process (for liveness checks) and its TTY: walk up a few parents.
function claudeProcess() {
  let pid = process.ppid;
  for (let i = 0; i < 5 && pid > 1; i++) {
    let line = '';
    try { line = execFileSync('ps', ['-o', 'ppid=,tty=,comm=', '-p', String(pid)], { timeout: 500, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { break; }
    const [ppid, tty, ...rest] = line.split(/\s+/);
    const comm = rest.join(' ');
    if (/(^|\/)claude$/.test(comm)) return { pid, tty: tty && tty !== '??' ? tty : '' };
    pid = Number(ppid) || 0;
  }
  return { pid: null, tty: '' };
}

// Last AI-generated session title ("ai-title" entries) from the transcript tail.
function aiTitle(file) {
  if (!file) return '';
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - 512 * 1024);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const text = buf.toString('utf8');
    let at = text.lastIndexOf('"type":"ai-title"');
    if (at < 0) return '';
    const lineStart = text.lastIndexOf('\n', at) + 1;
    const lineEnd = text.indexOf('\n', at);
    return JSON.parse(text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd)).aiTitle || '';
  } catch { return ''; }
}

function target() {
  if (process.env.CLAUDE_DECK_URL) return { url: process.env.CLAUDE_DECK_URL.replace(/\/$/, '') + '/api/event', token: process.env.CLAUDE_DECK_TOKEN || '' };
  const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
  return { url: `http://127.0.0.1:${cfg.port || 4777}/api/event`, token: cfg.ingestToken };
}

async function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }
  const event = input.hook_event_name;
  if (!event || !input.session_id) return;

  const proc = claudeProcess();
  const e = process.env;
  const ev = {
    v: 1,
    event,
    ts: Date.now(),
    sessionId: input.session_id,
    cwd: input.cwd || process.cwd(),
    transcript: input.transcript_path || '',
    profile: profile(input.transcript_path),
    pid: proc.pid,
    term: {
      program: e.TERM_PROGRAM || '',
      cursor: Boolean(e.CURSOR_TRACE_ID),
      itermSession: (e.ITERM_SESSION_ID || '').split(':')[1] || '',
      tty: proc.tty,
      tmux: e.TMUX_PANE || '',
    },
    title: event === 'UserPromptSubmit' || event === 'Stop' || event === 'SessionStart' ? aiTitle(input.transcript_path) : '',
  };
  if (event === 'UserPromptSubmit') ev.prompt = clip(input.prompt, 400);
  if (event === 'Stop') ev.lastMessage = clip(input.last_assistant_message, 400);
  if (event === 'Notification') { ev.notificationType = input.notification_type || ''; ev.message = clip(input.message, 200); }
  if (event === 'SessionStart') ev.source = input.source || '';
  if (event === 'SessionEnd') ev.reason = input.reason || '';

  if (e.CLAUDE_DECK_DRY_RUN) { process.stdout.write(JSON.stringify(ev, null, 2) + '\n'); return; }
  const { url, token } = target();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(ev),
    signal: AbortSignal.timeout(1500),
  });
  if (!res.ok) logError(`${event}: HTTP ${res.status}`);
}

try { await main(); } catch (err) {
  // server not running is normal (ECONNREFUSED) -> don't spam the log with it
  if (!/ECONNREFUSED|fetch failed|ENOENT/.test(String(err?.cause?.code || err?.message))) logError(String(err?.message || err));
}
process.exit(0);
